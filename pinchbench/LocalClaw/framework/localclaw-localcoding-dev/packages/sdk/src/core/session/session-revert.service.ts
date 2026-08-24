import { Injectable, Inject, Optional, OnModuleInit, Logger } from "@nestjs/common";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from "fs";
import { relative, isAbsolute, dirname, resolve, join } from "path";
import { getAgentHomeDir } from "../../config/paths";
import { SessionService } from "./session.service";
import { ToolDiffService } from "./tool-diff.service";

const execFileAsync = promisify(execFile);

// 快照目录保留期：启动时清理更旧的残留（撤销后既不重新应用也不再管的轮次）。
const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

export type RevertResult =
  | { ok: false; reason: "not-git" | "no-head" | "no-workspace" | "error"; message?: string }
  | { ok: true; hasSnapshot: boolean };

export type ReapplyResult =
  | { ok: false; reason: "no-workspace" | "no-snapshot" | "error"; message?: string }
  | { ok: true };

// 撤销快照清单项：path=相对 cwd 的文件路径；snap=快照文件名（null 表示撤销前该文件不存在，
// 本轮新建 → 重新应用时删除）。快照字节存在同目录下的 snap 文件里（原始字节，编码/CRLF 安全）。
type ManifestEntry = { path: string; snap: string | null };

/**
 * 会话「整轮撤销 / 重新应用」能力（依赖 git）。
 *
 * ── 快照落服务端文件（不再由前端 localStorage 持有内容）──
 * 撤销时把「撤销前」的磁盘原始字节写入服务端快照目录
 * （getAgentHomeDir()/revert-snapshots/<sessionId>/<roundKey>/），前端只持有 roundKey。
 * 重新应用时后端按 roundKey 从快照目录读回写盘。好处：文件内容不在前后端往返、
 * 不占 localStorage 配额、二进制/编码安全、跨刷新与重启都在。
 *
 * ── git 语义 ──
 * 撤销 before = `git show HEAD:<file>`（HEAD 版本）写回；HEAD 无该文件（本轮新建）→ 删除。
 * 恢复到 HEAD 而非「本轮前」，本轮之外的未提交改动会一并回退（已与产品确认）。
 */
@Injectable()
export class SessionRevertService implements OnModuleInit {
  private readonly logger = new Logger(SessionRevertService.name);

  constructor(
    @Inject(SessionService) private readonly sessionService: SessionService,
    // 可选：无 HEAD（刚 git init、尚无 commit）时，用本轮 round-diff 的 oldContent 作撤销基线。
    // 设为可选，手动 new SessionRevertService(sessions) 的调用点/旧测试无需改动（退化为要求 HEAD）。
    @Optional() @Inject(ToolDiffService) private readonly toolDiffService?: ToolDiffService,
  ) {}

  // 启动时清理过期快照目录：撤销后既不重新应用也不再管的快照会长期堆积，
  // 删除 mtime 超过 SNAPSHOT_TTL_MS 的会话级目录。清理是尽力而为，任何失败都不阻塞启动。
  onModuleInit(): void {
    try {
      this.cleanupStaleSnapshots();
    } catch (e) {
      this.logger.warn(`[revert] snapshot cleanup skipped: ${String(e)}`);
    }
  }

  private cleanupStaleSnapshots(): void {
    const root = join(getAgentHomeDir(), "revert-snapshots");
    if (!existsSync(root)) return;
    const now = Date.now();
    let removed = 0;
    // 每个 <sessionId> 目录一个清理单元：整目录 mtime 过期即删（含其下所有轮次）。
    for (const seg of readdirSync(root)) {
      const sessionDir = join(root, seg);
      try {
        const st = statSync(sessionDir);
        if (!st.isDirectory()) continue;
        if (now - st.mtimeMs > SNAPSHOT_TTL_MS) {
          rmSync(sessionDir, { recursive: true, force: true });
          removed++;
        }
      } catch {
        // 单个目录 stat/删除失败不影响其余
      }
    }
    if (removed > 0) this.logger.log(`[revert] cleaned ${removed} stale snapshot dir(s)`);
  }

  async isGitRepo(cwd: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
      const ok = stdout.trim() === "true";
      this.logger.log(`[revert] isGitRepo cwd=${JSON.stringify(cwd)} -> ${ok} (stdout=${JSON.stringify(stdout.trim())})`);
      return ok;
    } catch (e: any) {
      // 区分「git 命令找不到」(ENOENT，打包环境 PATH 缺 git) 与「非 git 仓库」——排障关键。
      this.logger.warn(
        `[revert] isGitRepo cwd=${JSON.stringify(cwd)} -> false code=${e?.code ?? "?"} msg=${String(e?.message ?? e).split("\n")[0]}`,
      );
      return false;
    }
  }

  // 撤销一轮：files 为本轮涉及的相对路径（相对 cwd）。roundKey 用于隔离本轮快照目录。
  async revertRound(sessionId: string, roundKey: string, files: string[]): Promise<RevertResult> {
    const cwd = this.sessionService.getSession(sessionId)?.cwd;
    if (!cwd) return { ok: false, reason: "no-workspace" };
    if (!(await this.isGitRepo(cwd))) return { ok: false, reason: "not-git" };

    // 撤销基线来源：有 HEAD → 用 git HEAD 版本（可回退本轮外的未提交改动，语义如注释）；
    // 无 HEAD（刚 git init 尚无 commit）→ 用本轮 round-diff 重建的 oldContent 作基线。
    // 两者都拿不到（无 HEAD 且无 ToolDiffService）才回退到 no-head 拒绝。
    const hasHead = await this.hasHead(cwd);
    const fallback = hasHead ? null : this.buildRoundBaseline(sessionId, roundKey);
    if (!hasHead && !fallback) return { ok: false, reason: "no-head" };

    const roundDir = this.roundDir(sessionId, roundKey);
    try {
      // 1) 先把「撤销前」磁盘原始字节全部快照到服务端目录（写盘前先备份，保证可恢复）。
      rmSync(roundDir, { recursive: true, force: true }); // 清掉同轮旧快照，避免残留混淆
      mkdirSync(roundDir, { recursive: true });
      const manifest: ManifestEntry[] = [];
      let snapIdx = 0;
      const targets: Array<{ abs: string; rel: string }> = [];
      for (const rel of files) {
        const abs = this.safeResolve(cwd, rel);
        if (!abs) continue;
        targets.push({ abs, rel });
        if (existsSync(abs)) {
          const snap = `f${snapIdx++}`;
          writeFileSync(join(roundDir, snap), readFileSync(abs)); // 原始字节
          manifest.push({ path: rel, snap });
        } else {
          manifest.push({ path: rel, snap: null }); // 撤销前不存在 → 重新应用时删除
        }
      }
      writeFileSync(join(roundDir, "manifest.json"), JSON.stringify(manifest), "utf8");

      // 2) 快照完成后，再把「撤销前」内容写回磁盘 / 删除新建文件。
      // 基线取自 git HEAD（有 commit）或本轮 round-diff 的 oldContent（无 commit）。
      for (const { abs, rel } of targets) {
        const before = hasHead ? await this.gitShowHead(cwd, rel) : fallback!(rel);
        if (before === NOT_IN_HEAD) {
          if (existsSync(abs)) rmSync(abs, { force: true });
        } else {
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, before); // 原始字节写回，不改写行尾/编码
        }
      }
      return { ok: true, hasSnapshot: manifest.length > 0 };
    } catch (e: any) {
      return { ok: false, reason: "error", message: e?.message ?? String(e) };
    }
  }

  // 重新应用一轮：从服务端快照目录按 roundKey 读回「撤销前」内容写盘，成功后清理该轮快照。
  async reapplyRound(sessionId: string, roundKey: string): Promise<ReapplyResult> {
    const cwd = this.sessionService.getSession(sessionId)?.cwd;
    if (!cwd) return { ok: false, reason: "no-workspace" };
    const roundDir = this.roundDir(sessionId, roundKey);
    const manifestPath = join(roundDir, "manifest.json");
    if (!existsSync(manifestPath)) return { ok: false, reason: "no-snapshot" };
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestEntry[];
      for (const entry of manifest) {
        const abs = this.safeResolve(cwd, entry.path);
        if (!abs) continue;
        if (entry.snap === null) {
          // 撤销前该文件不存在（本轮新建）→ 重新应用即删除
          if (existsSync(abs)) rmSync(abs, { force: true });
        } else {
          const snapPath = join(roundDir, entry.snap);
          if (!existsSync(snapPath)) continue; // 快照文件缺失（异常）→ 跳过
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, readFileSync(snapPath)); // 原始字节写回
        }
      }
      rmSync(roundDir, { recursive: true, force: true }); // 重新应用成功 → 清理快照
      return { ok: true };
    } catch (e: any) {
      return { ok: false, reason: "error", message: e?.message ?? String(e) };
    }
  }

  // 仓库是否已有 HEAD（任何 commit）。无 HEAD 时撤销不安全（无基线可恢复）。
  private async hasHead(cwd: string): Promise<boolean> {
    try {
      await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], { cwd });
      return true;
    } catch {
      return false;
    }
  }

  // 无 HEAD 时的撤销基线：用本轮 round-diff 重建每个文件的「撤销前」内容。
  // 返回一个按相对路径查基线的函数；查不到 ToolDiffService 或本轮 diff 时返回 null（调用方回退 no-head）。
  // added（本轮新建）→ NOT_IN_HEAD（删除）；modified → oldContent 字节；deleted 无内容 → 也当新建删除处理。
  private buildRoundBaseline(
    sessionId: string,
    roundKey: string,
  ): ((rel: string) => Buffer | typeof NOT_IN_HEAD) | null {
    if (!this.toolDiffService) return null;
    const rounds = this.toolDiffService.buildRoundDiffs(sessionId);
    const round = rounds.find((r) => r.roundKey === roundKey);
    if (!round) return null;
    // 按归一化相对路径建索引（分隔符统一为 /），与传入 files 的相对路径对齐。
    const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\/+/, "");
    const byPath = new Map(round.diffs.map((d) => [norm(d.path), d]));
    return (rel: string) => {
      const d = byPath.get(norm(rel));
      // 未知文件、本轮新建、或已删除（无 oldContent）→ 撤销即删除。
      if (!d || d.status === "added" || d.oldContent === undefined) return NOT_IN_HEAD;
      return Buffer.from(d.oldContent, "utf8");
    };
  }

  // 取 HEAD 版本的原始字节；文件不在 HEAD（本轮新建）返回 NOT_IN_HEAD 哨兵。
  // git 本身报错（非「路径不存在」）会抛出，交由 revertRound 归为 error，避免误删。
  private async gitShowHead(cwd: string, rel: string): Promise<Buffer | typeof NOT_IN_HEAD> {
    const gitPath = rel.replace(/\\/g, "/");
    try {
      const r = await execFileAsync("git", ["show", `HEAD:${gitPath}`], { cwd, encoding: "buffer", maxBuffer: 256 * 1024 * 1024 } as any);
      return (r as any).stdout as Buffer;
    } catch (e: any) {
      // git show 对「HEAD 中不存在该路径」的报错信息含 exist 关键字。这类视为本轮新建 → 删除。
      const msg = String(e?.stderr ?? e?.message ?? "");
      if (/exist/i.test(msg)) return NOT_IN_HEAD;
      throw e; // 其他 git 错误：抛出，整轮撤销失败（不误删）
    }
  }

  // 本轮快照目录：<agentHome>/revert-snapshots/<sessionId>/<roundKey>。
  // sessionId / roundKey 做文件名净化，防路径穿越与非法字符。
  private roundDir(sessionId: string, roundKey: string): string {
    return join(getAgentHomeDir(), "revert-snapshots", sanitizeSeg(sessionId), sanitizeSeg(roundKey));
  }

  // 把相对路径解析为 cwd 内的绝对路径；越界（路径逃逸到 cwd 之外）返回 null。
  private safeResolve(cwd: string, rel: string): string | null {
    const abs = isAbsolute(rel) ? resolve(rel) : resolve(cwd, rel);
    const base = resolve(cwd);
    const relBack = relative(base, abs);
    if (relBack.startsWith("..") || isAbsolute(relBack)) return null;
    return abs;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

// gitShowHead 的哨兵：文件不在 HEAD（本轮新建），撤销应删除而非还原。
const NOT_IN_HEAD = Symbol("NOT_IN_HEAD");

// 目录段净化：只保留字母数字与 ._-，其余（含 / \ ..）替换为 _，防路径穿越。
function sanitizeSeg(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "_") || "_";
}
