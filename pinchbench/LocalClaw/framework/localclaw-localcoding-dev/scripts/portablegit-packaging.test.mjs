import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const repoRoot = join(import.meta.dirname, "..");
const vendorRoot = join(repoRoot, "resources", "portablegit-vendor");
const manifestPath = join(vendorRoot, "manifest.json");

const isWin = process.platform === "win32";
const hasManifest = existsSync(manifestPath);
const manifest = hasManifest ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;

// 最小 bash 集目录（单份，不分架构）
const minDir = manifest?.dir || "minimal-bash";
const bashRel = manifest?.bashRelPath || "usr/bin/bash.exe";
const distMin = join(repoRoot, ".cli-dist", "vendor", "portablegit", minDir);

test("manifest 是单份最小 bash 集（无分架构 binaries）", { skip: !hasManifest && "未跑 fetch-portablegit" }, () => {
  assert.equal(manifest.dir, "minimal-bash");
  assert.equal(manifest.bashRelPath, "usr/bin/bash.exe");
  assert.match(manifest.sha256, /^[0-9a-f]{64}$/);
  // 不应再有按架构的 binaries 字段
  assert.equal(manifest.binaries, undefined);
});

test("dist 注入后 bash.exe + 关键 coreutils + fstab 落地（不含 git.exe）", { skip: !existsSync(distMin) && "未跑 copy-cli 注入" }, () => {
  const binDir = join(distMin, "usr", "bin");
  assert.ok(existsSync(join(binDir, "bash.exe")), "缺 bash.exe");
  for (const c of ["sed.exe", "grep.exe", "awk.exe", "cat.exe", "tr.exe", "sort.exe"]) {
    assert.ok(existsSync(join(binDir, c)), `缺 coreutil: ${c}`);
  }
  // 系统监控工具（git-bash 提供的那部分；top/free/vmstat 等 procfs 工具 MSYS2 不含，无法打包）
  for (const c of ["ps.exe", "df.exe", "du.exe", "nproc.exe", "uname.exe", "kill.exe"]) {
    assert.ok(existsSync(join(binDir, c)), `缺监控工具: ${c}`);
  }
  // 关键：最小集不打包 git（git 靠系统 PATH）
  assert.ok(!existsSync(join(binDir, "git.exe")), "最小集不应含 git.exe");
  assert.ok(existsSync(join(binDir, "msys-2.0.dll")), "缺 msys-2.0.dll 运行时");
  // 关键回归：/etc/fstab 决定 /c/ 前缀映射，缺则 claude-cli 的 pwd -P 重定向全部失败
  const fstab = join(distMin, "etc", "fstab");
  assert.ok(existsSync(fstab), "缺 etc/fstab（会导致 /cygdrive 前缀错乱、bash 命令报错）");
  assert.match(readFileSync(fstab, "utf8"), /cygdrive/, "fstab 应含 cygdrive 挂载行");
});

// after-pack 断言：搭临时包布局，正向通过、删 bash 应 throw。不分架构（arch 参数被忽略）。
test("after-pack 校验 win32 包内 bash.exe（正向 + 删后 throw）", { skip: !existsSync(distMin) && "无 dist 产物" }, async () => {
  const mod = await import(pathToFileURL(join(repoRoot, "scripts", "after-pack.cjs")).href);
  const inner = typeof mod.assertPackagedGitBash === "function"
    ? mod.assertPackagedGitBash
    : mod.default.assertPackagedGitBash;
  const tmp = mkdtempSync(join(tmpdir(), "pgit-ap-"));
  try {
    const binDir = join(tmp, "resources", "claude-cli", "vendor", "portablegit", minDir, "usr", "bin");
    mkdirSync(binDir, { recursive: true });
    // 只复刻断言读取的 bash.exe
    cpSync(join(distMin, bashRel), join(binDir, "bash.exe"));
    // 正向：x64(1) / arm64(3) 都校验同一份，均应通过
    inner(tmp, 1, repoRoot);
    inner(tmp, 3, repoRoot);
    // 反向：删 bash.exe → throw
    rmSync(join(binDir, "bash.exe"));
    assert.throws(() => inner(tmp, 1, repoRoot), /缺最小 bash 集|hash 不符/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// 裁剪冒烟：仅 Windows。用打包 bash.exe 跑真实执行链路（无 git），验证最小集没删坏核心。
test("最小集 bash + coreutils + 执行链路可用（无 git）", { skip: !isWin && "非 Windows" }, () => {
  const bash = join(distMin, bashRel);
  if (!existsSync(bash)) assert.fail(`无打包 bash.exe: ${bash}`);
  // 模拟 claude-cli bash 执行链路：shopt extglob + eval 管道 + pwd -P 重定向到 /c/ 路径。
  // 重定向到 /c/ 是关键——它依赖 /etc/fstab 的盘符映射，正是漏 fstab 时出 bug 的地方。
  const cwdFile = "/c/Windows/Temp/pgit-smoke-cwd";
  const r = spawnSync(bash, ["-c",
    `shopt -u extglob 2>/dev/null||true; eval 'echo hi|tr a-z A-Z|sed s/HI/PASS/'; awk "BEGIN{print 1+2}"; grep --version|head -1; pwd -P >| "${cwdFile}" && echo "CWD:$(cat ${cwdFile})"; rm -f "${cwdFile}"`],
    { encoding: "utf8", windowsHide: true });
  assert.equal(r.status, 0, `bash 退出码非0: ${r.stderr}`);
  assert.match(r.stdout, /PASS/);
  assert.match(r.stdout, /^3$/m);
  assert.match(r.stdout, /GNU grep/);
  // 关键回归：pwd -P 写到 /c/ 路径成功（前缀映射正常），且不是 /cygdrive/ 前缀
  assert.match(r.stdout, /CWD:\/[a-z]\//, "pwd -P 应输出 /c//d/ 短前缀，而非 /cygdrive/");
  assert.doesNotMatch(r.stdout, /cygdrive/, "不应出现 /cygdrive 前缀（fstab 未生效的标志）");

  // 监控工具冒烟：df/nproc/ps 能在打包运行时下真实执行（依赖已在 KEEP_DLLS 内）
  const m = spawnSync(bash, ["-c",
    `export PATH=/usr/bin; df -h / | tail -1; echo "NPROC:$(nproc)"; ps | head -1`],
    { encoding: "utf8", windowsHide: true });
  assert.equal(m.status, 0, `监控工具执行失败: ${m.stderr}`);
  assert.match(m.stdout, /NPROC:\d+/, "nproc 应输出核数");
  assert.match(m.stdout, /PID/, "ps 应输出表头");
});
