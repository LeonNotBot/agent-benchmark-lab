// 把 CLI 透传的上游 API 错误文本解析成结构化对象，供错误卡片渲染。
//
// CLI 在鉴权/额度/限流等失败时，会把上游错误塞进 assistant 文本块，形如：
//   Failed to authenticate. API Error: 403 {"error":{"type":"...","message":"..."},"type":"error"}
// 同时 assistant 消息顶层带 error: "authentication_failed" 机读码。
// 这里优先用机读码 + 内嵌 JSON，纯文本正则兜底。

export type ApiErrorKind =
  | "balance" // 余额/额度不足
  | "auth" // 鉴权失败（key 无效 / 与地址不匹配）
  | "rate_limit" // 限流
  | "upstream" // 上游 5xx
  | "network" // 连接失败 / 超时
  | "unknown";

export interface ParsedApiError {
  kind: ApiErrorKind;
  code?: number; // HTTP 状态码
  title: string; // 中文分类标题
  message: string; // 可读正文（已剥离 request id）
  requestId?: string; // 供排查，折叠区展示
  raw: string; // 原始整段，折叠区兜底
}

// 判定 + 解析入口。命中返回 ParsedApiError，否则 null（按普通文本渲染）。
export function parseApiError(text: string, errorCode?: string): ParsedApiError | null {
  if (!text || typeof text !== "string") return null;
  const looksLikeError =
    !!errorCode || /API Error:/i.test(text) || /Failed to authenticate/i.test(text);
  if (!looksLikeError) return null;

  const code = extractCode(text);
  const inner = extractInnerError(text);
  const requestId = extractRequestId(inner?.message ?? text);
  const message = cleanMessage(inner?.message, text);
  const kind = classify({ code, errorCode, upstreamType: inner?.type, message });

  return {
    kind,
    code,
    title: titleOf(kind),
    message,
    requestId,
    raw: text,
  };
}

function extractCode(text: string): number | undefined {
  const m = text.match(/API Error:\s*(\d{3})/i);
  return m ? Number(m[1]) : undefined;
}

// 从文本中第一个 '{' 起尝试解析内嵌 JSON，取 error.{type,message}。
// 上游 message 里可能含未转义内容，逐步收缩右括号做容错解析。
function extractInnerError(text: string): { type?: string; message?: string } | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  const json = text.slice(start);
  for (let end = json.length; end > 1; end = json.lastIndexOf("}", end - 1)) {
    try {
      const obj = JSON.parse(json.slice(0, end + 1));
      const err = obj?.error;
      if (err && typeof err === "object") {
        return { type: err.type, message: typeof err.message === "string" ? err.message : undefined };
      }
      if (typeof err === "string") return { message: err };
    } catch {
      /* 继续向左收缩右括号 */
    }
    if (end <= 1) break;
  }
  return null;
}

function extractRequestId(s?: string): string | undefined {
  if (!s) return undefined;
  const m = s.match(/request id:\s*([A-Za-z0-9]+)/i);
  return m?.[1];
}

// 优先用内嵌 message，去掉 (request id: ...) 噪音；缺省回退原始文本首句。
function cleanMessage(inner: string | undefined, raw: string): string {
  const base = (inner ?? raw).replace(/\(request id:[^)]*\)/gi, "").trim();
  // 全角逗号/空格收尾清理
  return base.replace(/[,，]\s*$/, "").trim() || raw.trim();
}

function classify(args: {
  code?: number;
  errorCode?: string;
  upstreamType?: string;
  message: string;
}): ApiErrorKind {
  const { code, errorCode, message } = args;
  // 额度/余额：符号可能是全角 ＄，按关键词判定最稳
  if (/额度|余额|balance|quota|预扣费|insufficient/i.test(message)) return "balance";
  if (errorCode === "authentication_failed" || code === 401 || code === 403) return "auth";
  if (code === 429 || /rate.?limit|too many/i.test(message)) return "rate_limit";
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout|Unable to connect/i.test(message)) return "network";
  if (code != null && code >= 500) return "upstream";
  return "unknown";
}

function titleOf(kind: ApiErrorKind): string {
  switch (kind) {
    case "balance":
      return "余额不足";
    case "auth":
      return "鉴权失败";
    case "rate_limit":
      return "请求过于频繁";
    case "upstream":
      return "服务暂时不可用";
    case "network":
      return "网络连接失败";
    default:
      return "请求失败";
  }
}
