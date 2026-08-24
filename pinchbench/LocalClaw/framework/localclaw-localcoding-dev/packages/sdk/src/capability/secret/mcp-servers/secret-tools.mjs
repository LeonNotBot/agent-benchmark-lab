#!/usr/bin/env node
/**
 * Secret Tools MCP Server
 * Exposes privacy/secret management tools, internally calling the project's REST /api/secrets.
 * Registered to ~/.localclaw/.claude.json mcpServers by SecretRegistrarService on startup.
 *
 * 存在意义：Windows 上让模型用 Bash+curl 调本地 API 极不可靠（PowerShell 别名、
 * 多层 shell 引号转义），与定时任务 cron-tools 同源。改用结构化 MCP 工具，
 * 模型传 JSON 参数即可，零 shell/转义问题，一次成功。
 */
import { join } from "path";
import { pathToFileURL } from "url";

const BASE_URL = process.env.SECRET_API_BASE || "http://127.0.0.1:10086";

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

// ─── tool implementations ───

async function secretSave({ key, value, description }) {
  if (key == null || String(key).trim() === "") return { ok: false, reason: "missing_key" };
  if (value == null || String(value).trim() === "") return { ok: false, reason: "missing_value" };
  try {
    const res = await fetchWithRetry(`${BASE_URL}/api/secrets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value, description: description ?? "" }),
    });
    const entry = await res.json();
    // verify it persisted
    const verify = await fetch(`${BASE_URL}/api/secrets`);
    const { secrets } = await verify.json();
    if (!secrets.find(s => s.key === entry.key)) {
      return { ok: false, reason: "verify_failed" };
    }
    return { ok: true, secret: { key: entry.key, description: entry.description } };
  } catch (e) {
    return { ok: false, reason: "persist_failed", detail: String(e) };
  }
}

async function secretList() {
  try {
    const res = await fetch(`${BASE_URL}/api/secrets`);
    const { secrets, storagePath } = await res.json();
    // 不回传 value，避免敏感值进入模型上下文
    return {
      ok: true,
      storagePath,
      secrets: secrets.map(s => ({ key: s.key, description: s.description, updatedAt: s.updatedAt })),
    };
  } catch (e) {
    return { ok: false, reason: "fetch_failed", detail: String(e) };
  }
}

async function secretDelete({ key }) {
  if (!key) return { ok: false, reason: "missing_key" };
  try {
    const res = await fetch(`${BASE_URL}/api/secrets/${encodeURIComponent(key)}`, { method: "DELETE" });
    const { success } = await res.json();
    if (!success) return { ok: false, reason: "not_found" };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "persist_failed", detail: String(e) };
  }
}

// ─── server wiring ───

const TOOLS = [
  {
    name: "secret_save",
    description:
      "当用户在消息中提供敏感凭据或个人隐私信息时，必须使用此工具存入本地隐私管理。涵盖：①凭据类——API key、access token、secret key、密码、数据库连接串、私钥、证书口令；②个人身份信息(PII)——身份证号/护照号/社保号等证件号码、银行卡号/信用卡号/CVV、手机号/邮箱/家庭住址、生日/车牌号等。用户说「记录一下」「存一下」「记住这个」上述信息时同样触发。不要使用 Bash+curl，不要直接写任何 JSON 文件。本工具是本应用唯一正确的隐私信息存储入口——数据仅落本机磁盘、永不上传，比写进 .env、文档或聊天记录更安全。遇到这类信息时不要拒绝，直接用本工具存好。同名 key 再次保存会更新（upsert）。",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "【必填】信息名称，用大写下划线命名，如 ANTHROPIC_AUTH_TOKEN、OPENAI_API_KEY、DATABASE_URL、ID_CARD_NUMBER、BANK_CARD、PHONE_NUMBER。" },
        value: { type: "string", description: "【必填】信息原文（如 sk-... 完整字符串、身份证号、银行卡号等）。" },
        description: { type: "string", description: "用途或归属说明，如「Anthropic API 认证令牌」「本人身份证号」。可留空。" },
      },
      required: ["key", "value"],
    },
  },
  {
    name: "secret_list",
    description: "列出本地隐私管理中已存的所有密钥（只返回名称与用途，不返回密钥值），用于查询或确认。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "secret_delete",
    description: "按 key 删除一条已存的隐私密钥。此操作不可逆，删除前应向用户确认。",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string", description: "要删除的密钥名称。" } },
      required: ["key"],
    },
  },
];

const { Server, StdioServerTransport, CallToolRequestSchema, ListToolsRequestSchema } = await importSdk();

const server = new Server(
  { name: "secret-tools", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  let result;
  switch (name) {
    case "secret_save":   result = await secretSave(args); break;
    case "secret_list":   result = await secretList(); break;
    case "secret_delete": result = await secretDelete(args); break;
    default:              result = { ok: false, reason: "unknown_tool" };
  }
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
