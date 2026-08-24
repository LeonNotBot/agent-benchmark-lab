#!/usr/bin/env node
/**
 * multica-agent.js — localclaw 对接 multica 的 openclaw 兼容 CLI
 *
 * 使用方式：
 *   在 multica 机器上设置环境变量：
 *     MULTICA_OPENCLAW_PATH=/path/to/localclaw/bin/multica-agent.js
 *
 * 实现的 openclaw 兼容接口：
 *   multica-agent config file                    → 返回配置文件路径
 *   multica-agent config get agents.list --json  → 返回 agent 列表 JSON
 *   multica-agent <prompt>                       → 执行任务（读取 OPENCLAW_CONFIG_PATH）
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { WebSocket } from "ws";

// ─── 配置文件路径 ────────────────────────────────────────────────────────────

const DEFAULT_CONFIG_PATH = join(homedir(), ".openclaw", "openclaw.json");

function getConfigPath() {
  return process.env.OPENCLAW_CONFIG_PATH || DEFAULT_CONFIG_PATH;
}

function readConfig() {
  const p = getConfigPath();
  if (!existsSync(p)) return getDefaultConfig();
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return getDefaultConfig();
  }
}

function getDefaultConfig() {
  return {
    agents: {
      defaults: { workspace: join(homedir(), "localclaw-workspace") },
      list: [{ id: "default", model: "claude-sonnet-4-6", workspace: join(homedir(), "localclaw-workspace") }],
    },
  };
}

// ─── config 子命令 ───────────────────────────────────────────────────────────

function cmdConfigFile() {
  const p = getConfigPath();
  // 若文件不存在，自动创建默认配置
  if (!existsSync(p)) {
    const dir = join(homedir(), ".openclaw");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(p, JSON.stringify(getDefaultConfig(), null, 2), "utf8");
  }
  process.stdout.write(p + "\n");
}

function cmdConfigGet(keyPath, asJson) {
  const cfg = readConfig();
  // 支持 "agents.list" 这样的点分路径
  const parts = keyPath.split(".");
  let val = cfg;
  for (const part of parts) {
    if (val == null || typeof val !== "object") {
      process.stderr.write(`No value at ${keyPath}\n`);
      process.exit(1);
    }
    val = val[part];
  }
  if (val === undefined) {
    process.stderr.write(`No value at ${keyPath}\n`);
    process.exit(1);
  }
  if (asJson) {
    process.stdout.write(JSON.stringify(val) + "\n");
  } else {
    process.stdout.write(String(val) + "\n");
  }
}

// ─── 任务执行 ────────────────────────────────────────────────────────────────

/**
 * 从 OPENCLAW_CONFIG_PATH 读取 multica 写入的 per-task wrapper config，
 * 提取 workspace 目录（即任务工作目录）。
 */
function getWorkspaceFromTaskConfig() {
  const taskConfigPath = process.env.OPENCLAW_CONFIG_PATH;
  if (!taskConfigPath || !existsSync(taskConfigPath)) return null;
  try {
    const cfg = JSON.parse(readFileSync(taskConfigPath, "utf8"));
    return cfg?.agents?.defaults?.workspace || null;
  } catch {
    return null;
  }
}

/**
 * 读取 multica 写入工作目录的任务上下文文件。
 * multica 会在 workspace 下写入 issue_context.md（任务描述）。
 */
function readIssueContext(workspace) {
  const contextFile = join(workspace, "issue_context.md");
  if (!existsSync(contextFile)) return null;
  return readFileSync(contextFile, "utf8").trim();
}

/**
 * 通过 WebSocket 连接 localclaw 后端，创建会话并执行 prompt，
 * 将流式输出打印到 stdout，等待会话完成后退出。
 */
async function runSession(prompt, workspace) {
  const port = process.env.LOCALCLAW_PORT || "10086";
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      reject(new Error(`无法连接 localclaw 后端 ${wsUrl}: ${e.message}`));
      return;
    }

    let sessionId = null;
    let done = false;

    const finish = (code) => {
      if (done) return;
      done = true;
      try { ws.close(); } catch {}
      resolve(code);
    };

    ws.on("error", (e) => {
      process.stderr.write(`[multica-agent] WebSocket 错误: ${e.message}\n`);
      reject(e);
    });

    ws.on("open", () => {
      // 启动新会话
      ws.send(JSON.stringify({
        type: "session.start",
        payload: {
          title: "multica task",
          prompt,
          cwd: workspace || undefined,
        },
      }));
    });

    ws.on("message", (raw) => {
      let event;
      try { event = JSON.parse(raw.toString()); } catch { return; }

      const { type, payload } = event;

      if (type === "session.status") {
        if (!sessionId && payload.sessionId) sessionId = payload.sessionId;
        if (payload.status === "completed") {
          process.stdout.write("\n");
          finish(0);
        } else if (payload.status === "error") {
          process.stderr.write(`[multica-agent] 会话出错\n`);
          finish(1);
        }
      }

      // 流式文本输出到 stdout（multica 会读取这些输出作为进度）
      if (type === "stream.message" && payload.sessionId === sessionId) {
        const msg = payload.message;
        if (msg?.type === "content_block_delta") {
          const delta = msg.delta;
          if (delta?.type === "text_delta" && delta.text) {
            process.stdout.write(delta.text);
          }
        }
      }

      if (type === "runner.error" && payload.sessionId === sessionId) {
        process.stderr.write(`[multica-agent] Runner 错误: ${payload.message}\n`);
        finish(1);
      }
    });

    ws.on("close", () => {
      if (!done) finish(1);
    });

    // 超时保护：2 小时
    setTimeout(() => {
      if (!done) {
        process.stderr.write("[multica-agent] 超时（2h），强制退出\n");
        finish(1);
      }
    }, 2 * 60 * 60 * 1000);
  });
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // config file
  if (args[0] === "config" && args[1] === "file") {
    cmdConfigFile();
    return;
  }

  // config get <key> [--json]
  if (args[0] === "config" && args[1] === "get" && args[2]) {
    const asJson = args.includes("--json");
    cmdConfigGet(args[2], asJson);
    return;
  }

  // 任务执行模式：multica 传入 prompt（可能是参数，也可能通过 issue_context.md）
  const workspace = getWorkspaceFromTaskConfig();
  const contextPrompt = workspace ? readIssueContext(workspace) : null;

  // prompt 优先级：命令行参数 > issue_context.md
  const prompt = args.join(" ").trim() || contextPrompt;

  if (!prompt) {
    process.stderr.write("[multica-agent] 错误：未提供 prompt，且未找到 issue_context.md\n");
    process.exit(1);
  }

  process.stderr.write(`[multica-agent] 启动任务，workspace=${workspace || "(auto)"}\n`);

  try {
    const code = await runSession(prompt, workspace);
    process.exit(code);
  } catch (e) {
    process.stderr.write(`[multica-agent] 致命错误: ${e.message}\n`);
    process.exit(1);
  }
}

main();
