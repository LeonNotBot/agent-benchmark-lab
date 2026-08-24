#!/usr/bin/env node
/**
 * Cron Tools MCP Server
 * Exposes scheduled task management tools, internally calling the project's REST /api/scheduled-tasks.
 * Registered to ~/.localclaw/settings.json mcpServers by CronMcpRegistrarService on startup.
 */
import { isAbsolute, join } from "path";
import { pathToFileURL } from "url";

const BASE_URL = process.env.CRON_API_BASE || "http://127.0.0.1:10086";

// Resolve SDK via MCP_SDK_DIR (absolute path to node_modules dir containing @modelcontextprotocol)
// Falls back to bare specifier (works in dev if node can resolve it normally)
async function importSdk() {
  const sdkDir = process.env.MCP_SDK_DIR;
  if (sdkDir) {
    const base = pathToFileURL(join(sdkDir, "@modelcontextprotocol", "sdk", "dist", "esm")).href;
    const [serverMod, studioMod, typesMod] = await Promise.all([
      import(`${base}/server/index.js`),
      import(`${base}/server/stdio.js`),
      import(`${base}/types.js`),
    ]);
    return { Server: serverMod.Server, StdioServerTransport: studioMod.StdioServerTransport, ...typesMod };
  }
  const [serverMod, studioMod, typesMod] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/index.js"),
    import("@modelcontextprotocol/sdk/server/stdio.js"),
    import("@modelcontextprotocol/sdk/types.js"),
  ]);
  return { Server: serverMod.Server, StdioServerTransport: studioMod.StdioServerTransport, ...typesMod };
}


async function fetchWithRetry(url, init, { retries = 3, backoffMs = 500 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}: ${await res.text()}`);
    } catch (e) { lastErr = e; }
    if (i < retries - 1) await new Promise(r => setTimeout(r, backoffMs * Math.pow(2, i)));
  }
  throw lastErr;
}

function validateCommon({ name, prompt, cwd }) {
  if (name != null && (typeof name !== "string" || name.length === 0 || name.length > 100)) {
    return { ok: false, reason: "invalid_name" };
  }
  // cron 合法性由 server（SDK isValidCron / resolveCron）权威判定，此处不再重复校验。
  if (prompt != null && (typeof prompt !== "string" || prompt.length === 0)) {
    return { ok: false, reason: "empty_prompt" };
  }
  if (cwd != null && cwd !== "" && !isAbsolute(cwd)) {
    return { ok: false, reason: "cwd_must_be_absolute", detail: "got: " + cwd };
  }
  return null;
}

// ─── tool implementations ───

async function cronCreate({ name, cron, prompt, cwd, schedule }) {
  const err = validateCommon({ name, prompt, cwd });
  if (err) return err;
  // create 专属必填：name / prompt 缺失会被 JSON.stringify 静默丢弃 → 脏数据落盘。
  // validateCommon 为 create/update 共用须保持可选，故在此早失败（server 也会兜底强制）。
  if (name == null || String(name).trim() === "") return { ok: false, reason: "missing_name" };
  if (prompt == null || String(prompt).trim() === "") return { ok: false, reason: "missing_prompt" };
  // cron 必填/合法 + 结构化 schedule 回退，均由 server resolveCron 统一收口。
  // 此处不预判，避免与真相源漂移；server 返回 400 时下方 catch 会带出 reason。
  try {
    const res = await fetchWithRetry(`${BASE_URL}/api/scheduled-tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, cron, prompt, cwd, schedule, status: "active", source: "mcp" }),
    });
    const task = await res.json();
    const verify = await fetch(`${BASE_URL}/api/scheduled-tasks`);
    const { tasks } = await verify.json();
    if (!tasks.find(t => t.id === task.id)) {
      return { ok: false, reason: "verify_failed" };
    }
    return { ok: true, task: { id: task.id, name: task.name, cron: task.cron, status: task.status } };
  } catch (e) {
    return { ok: false, reason: "persist_failed", detail: String(e) };
  }
}

async function cronList() {
  try {
    const res = await fetch(`${BASE_URL}/api/scheduled-tasks`);
    const { tasks } = await res.json();
    return {
      ok: true,
      tasks: tasks.map(t => ({
        id: t.id, name: t.name, cron: t.cron, status: t.status,
        lastRunAt: t.lastRunAt, lastRunStatus: t.lastRunStatus,
      })),
    };
  } catch (e) {
    return { ok: false, reason: "fetch_failed", detail: String(e) };
  }
}

async function cronUpdate({ id, patch }) {
  if (!id) return { ok: false, reason: "missing_id" };
  const err = validateCommon(patch || {});
  if (err) return err;
  try {
    const res = await fetchWithRetry(`${BASE_URL}/api/scheduled-tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const task = await res.json();
    if (task === null) return { ok: false, reason: "not_found" };
    return { ok: true, task };
  } catch (e) {
    return { ok: false, reason: "persist_failed", detail: String(e) };
  }
}

async function cronDelete({ id }) {
  if (!id) return { ok: false, reason: "missing_id" };
  try {
    const res = await fetch(`${BASE_URL}/api/scheduled-tasks/${id}`, { method: "DELETE" });
    const { ok } = await res.json();
    if (!ok) return { ok: false, reason: "not_found" };
    const verify = await fetch(`${BASE_URL}/api/scheduled-tasks`);
    const { tasks } = await verify.json();
    if (tasks.find(t => t.id === id)) return { ok: false, reason: "delete_verify_failed" };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "persist_failed", detail: String(e) };
  }
}

async function cronToggle({ id, status }) {
  if (!id) return { ok: false, reason: "missing_id" };
  if (status !== "active" && status !== "paused") return { ok: false, reason: "invalid_status" };
  return cronUpdate({ id, patch: { status } });
}

async function cronRunNow({ id }) {
  if (!id) return { ok: false, reason: "missing_id" };
  try {
    const res = await fetch(`${BASE_URL}/api/scheduled-tasks/${id}/run`, { method: "POST" });
    const { ok } = await res.json();
    if (!ok) return { ok: false, reason: "trigger_failed" };
    return { ok: true, note: "已触发；前往 CronPage 历史 Tab 查看结果" };
  } catch (e) {
    return { ok: false, reason: "persist_failed", detail: String(e) };
  }
}

// ─── server wiring ───

const TOOLS = [
  {
    name: "cron_create",
    description:
      "当用户要求周期性地或在未来某时刻让 Claude 自动执行某个 prompt 时，必须使用此工具在本应用的定时任务系统中创建任务。不要使用 Bash+curl，不要使用 CronCreate，不要直接修改任何 JSON 文件。本工具是本应用唯一正确的定时任务创建入口。\n\n触发时机【二选一，必须提供其一】：优先用结构化 schedule（不易出错），仅当用户给出复杂规则时才用 cron 裸串。两者都缺会创建失败。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "【必填】任务显示名，简短概括任务用途（最多 100 字符），如「每周科技新闻周报」。不要省略。" },
        prompt: { type: "string", description: "【必填】到时 Claude 要执行的 prompt 全文" },
        cwd: { type: "string", description: "可选；必须是绝对路径。不填则使用默认工作空间" },
        schedule: {
          type: "object",
          description: "结构化触发时机（推荐）。服务端据此生成 cron，免去手写表达式出错。",
          properties: {
            kind: { type: "string", enum: ["interval", "hourly", "daily", "workday", "weekly", "custom"], description: "interval=每N分钟 hourly=每小时整点 daily=每天 workday=工作日 weekly=每周 custom=用下面cron字段" },
            intervalMin: { type: "number", description: "kind=interval：每几分钟（1~59）" },
            time: { type: "string", description: "kind=daily/workday/weekly：触发时间 HH:MM（24小时制）" },
            weekday: { type: "number", description: "kind=weekly：1(周一)~7(周日)" },
            cron: { type: "string", description: "kind=custom：直接给定 5 段表达式" },
          },
          required: ["kind"],
        },
        cron: { type: "string", description: "可选裸 cron：5 段表达式（分 时 日 月 星期），本地时区。仅在不便用 schedule 时使用。" },
      },
      required: ["name", "prompt"],
    },
  },
  {
    name: "cron_list",
    description: "列出本应用所有已登记的定时任务，用于查询或确认。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "cron_update",
    description: "按 id 更新某个定时任务的字段（name/cron/prompt/status/cwd 任意组合）。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        patch: {
          type: "object",
          properties: {
            name: { type: "string" },
            cron: { type: "string" },
            prompt: { type: "string" },
            cwd: { type: "string" },
            status: { type: "string", enum: ["active", "paused"] },
          },
        },
      },
      required: ["id", "patch"],
    },
  },
  {
    name: "cron_delete",
    description: "按 id 删除定时任务。",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "cron_toggle",
    description: "按 id 启用或暂停定时任务。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: { type: "string", enum: ["active", "paused"] },
      },
      required: ["id", "status"],
    },
  },
  {
    name: "cron_run_now",
    description: "立即触发某个定时任务一次（fire-and-forget，不等待完成）。",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
];

const { Server, StdioServerTransport, CallToolRequestSchema, ListToolsRequestSchema } = await importSdk();

const server = new Server(
  { name: "cron-tools", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  let result;
  switch (name) {
    case "cron_create":  result = await cronCreate(args); break;
    case "cron_list":    result = await cronList(); break;
    case "cron_update":  result = await cronUpdate(args); break;
    case "cron_delete":  result = await cronDelete(args); break;
    case "cron_toggle":  result = await cronToggle(args); break;
    case "cron_run_now": result = await cronRunNow(args); break;
    default:             result = { ok: false, reason: "unknown_tool" };
  }
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);

