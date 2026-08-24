#!/usr/bin/env node
/**
 * 模型切换面包屑过滤 —— 端到端回归验证（CLI 升级后手动跑）。
 *
 * 背景：打包 CLI 在收到 set_model 控制请求时会注入一条「模型切换面包屑」
 *   {type:"user", isReplay:true, content:"<local-command-stdout>Set model to …</local-command-stdout>"}
 * 它本是交互式 TUI 的转录材料，对自维护历史的 localcoding 是噪声。runner-spawn 的
 * processOutput 用 isCliReplayNoise（packages/protocol）在广播/落库前过滤掉它。
 *
 * 本脚本真实 spawn 打包 CLI、真实发 set_model，验证两件事：
 *   1) CLI 实际吐出的面包屑形态被 isCliReplayNoise 正确命中（拦该拦的）；
 *   2) 切模型前后两轮**真实请求**都拿到真实模型回复（不碰真实对话）。
 *
 * ⚠️ 默认跳过（不发任何网络请求 / 不读任何密钥）。需真实验证时：
 *      RUN_E2E=1 node scripts/e2e-model-switch-breadcrumb.cjs
 *   依赖 ~/.localclaw/settings.json 里有一个配好 key 的 endpoint（优先 sky/anthropic，
 *   否则取首个可用 anthropic 类型）。key 仅注入子进程 env，全程不打印。
 *
 * CLI 升级（copy-cli）后若面包屑形态变化，本脚本会失败 —— 那是提醒去复核 isCliReplayNoise。
 */
"use strict";

const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { resolve } = require("node:path");
const { readFileSync, existsSync } = require("node:fs");
const { homedir } = require("node:os");
const { pathToFileURL } = require("node:url");

const ROOT = resolve(__dirname, "..");
const CLI = resolve(ROOT, ".cli-dist/cli.js");
const HELPER_DIST = resolve(ROOT, "packages/protocol/dist/session-types.js");
const SETTINGS = resolve(homedir(), ".localclaw", "settings.json");

function skip(reason) {
  console.log(`[e2e] SKIP: ${reason}`);
  console.log("[e2e] 需真实验证请设 RUN_E2E=1，并确保 ~/.localclaw/settings.json 配有可用 anthropic endpoint。");
  process.exit(0);
}

async function main() {
  if (process.env.RUN_E2E !== "1") skip("未设 RUN_E2E=1（默认不发真实请求）");
  if (!existsSync(CLI)) skip(`找不到打包 CLI：${CLI}（先构建/copy-cli）`);
  if (!existsSync(HELPER_DIST)) skip(`找不到 protocol 编译产物：${HELPER_DIST}（先 pnpm --filter @lenovo/agent-protocol build）`);
  if (!existsSync(SETTINGS)) skip(`找不到 ${SETTINGS}`);

  // 用真实编译产物里的 helper（不复刻逻辑，保证测的是上线代码）
  const { isCliReplayNoise } = await import(pathToFileURL(HELPER_DIST).href);
  if (typeof isCliReplayNoise !== "function") skip("protocol/dist 未导出 isCliReplayNoise（需重新 build）");

  const settings = JSON.parse(readFileSync(SETTINGS, "utf8"));
  const ep = (settings.endpoints || []).find(
    (e) => e.enabled && e.apiType === "anthropic" && e.apiKey && (e.models || []).length > 0,
  );
  if (!ep) skip("无可用 anthropic endpoint（需 enabled + 有 key + 有模型）");

  // anthropic 直连：baseUrl 剥尾部 /v1（CLI 自己拼 /v1/messages）
  const base = ep.baseUrl.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
  const modelA = ep.models[0].id;
  const modelB = (ep.models[1] || ep.models[0]).id;
  console.log(`[e2e] endpoint=${ep.id} base=${base} A=${modelA} B=${modelB}`);

  const args = [
    CLI, "--output-format", "stream-json", "--input-format", "stream-json", "--verbose",
    "--permission-mode", "bypassPermissions", "--allow-dangerously-skip-permissions",
    "--include-partial-messages",
  ];
  const env = {
    ...process.env,
    ANTHROPIC_BASE_URL: base,
    ANTHROPIC_AUTH_TOKEN: ep.apiKey,
    ANTHROPIC_MODEL: modelA,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: modelA,
  };

  const child = spawn(process.execPath, args, { env, stdio: ["pipe", "pipe", "pipe"] });
  const rl = createInterface({ input: child.stdout });
  const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
  const userMsg = (text) => ({
    type: "user", session_id: "",
    message: { role: "user", content: [{ type: "text", text }] },
    parent_tool_use_id: null,
  });

  let phase = 0; // 0=待init 1=等A 3=等B
  let textA = "", textB = "", breadcrumbSeen = false, breadcrumbFiltered = null, stderr = "";
  child.stderr.on("data", (d) => (stderr += d.toString()));

  const timer = setTimeout(() => {
    console.error(`[e2e] ❌ 超时 phase=${phase}\nstderr: ${stderr.slice(0, 400)}`);
    try { child.kill(); } catch {}
    process.exit(2);
  }, 60000);

  function finish() {
    clearTimeout(timer);
    try { child.kill(); } catch {}
    const turn1 = textA.trim().length > 0;
    const turn2 = textB.trim().length > 0;
    // 守卫语义：面包屑必须出现且被拦（若 CLI 改成不发面包屑，breadcrumbSeen=false 也可接受）
    const guardOk = !breadcrumbSeen || breadcrumbFiltered === true;
    console.log("\n=== 结果 ===");
    console.log(`轮1(模型A) 真实回复: ${turn1}`);
    console.log(`轮2(模型B, 切模型后) 真实回复: ${turn2}`);
    console.log(`面包屑出现: ${breadcrumbSeen} / 被 isCliReplayNoise 拦截: ${breadcrumbFiltered}`);
    const pass = turn1 && turn2 && guardOk;
    if (pass) {
      console.log("\n🎯 PASS：切模型前后真实请求均正常，面包屑被守卫拦截、不影响对话。");
      process.exit(0);
    }
    console.error("\n❌ FAIL");
    if (!turn1 || !turn2) console.error("stderr:", stderr.slice(0, 500));
    if (breadcrumbSeen && breadcrumbFiltered !== true) {
      console.error("⚠️ 面包屑形态变化，isCliReplayNoise 未命中 —— 去复核 packages/protocol/src/session-types.ts");
    }
    process.exit(1);
  }

  rl.on("line", (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return; }

    // 复刻 processOutput 守卫：面包屑用真实 helper 判定后「拦截」
    if (m.type === "user" && m.isReplay === true && line.includes("local-command-stdout")) {
      breadcrumbSeen = true;
      breadcrumbFiltered = isCliReplayNoise(m);
      console.log(`[守卫] 面包屑 isCliReplayNoise=${breadcrumbFiltered} ${breadcrumbFiltered ? "→ 拦截" : "→ 漏网!"}`);
      return; // 守卫 return，不进对话
    }
    if (m.type === "assistant" && Array.isArray(m.message?.content)) {
      const t = m.message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      if (phase <= 1) textA += t; else textB += t;
    }

    // CLI 对 initialize 回 control_response（非 system/init）→ ACK 后发第一问
    if (phase === 0 && m.type === "control_response" && m.response?.request_id === "init-1") {
      phase = 1;
      send(userMsg("只回复一个汉字：一"));
    } else if (phase === 1 && m.type === "result") {
      console.log(`[轮1/模型A] 回复=${JSON.stringify(textA.trim().slice(0, 30))} is_error=${m.is_error === true}`);
      phase = 2;
      send({ type: "control_request", request_id: "sm-1", request: { subtype: "set_model", model: modelB } });
      send(userMsg("只回复一个汉字：二"));
      phase = 3;
    } else if (phase === 3 && m.type === "result") {
      console.log(`[轮2/模型B] 回复=${JSON.stringify(textB.trim().slice(0, 30))} is_error=${m.is_error === true}`);
      finish();
    }
  });

  child.on("spawn", () =>
    send({ type: "control_request", request_id: "init-1", request: { subtype: "initialize" } }),
  );
  child.on("error", (e) => { console.error("[e2e] spawn error:", e.message); process.exit(2); });
}

main().catch((e) => { console.error("[e2e] 异常:", e); process.exit(2); });
