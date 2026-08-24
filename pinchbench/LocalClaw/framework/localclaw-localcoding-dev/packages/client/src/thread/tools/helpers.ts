// 工具状态归一化 helper
import type { ToolCallMessagePartProps } from "@assistant-ui/react";

// 错误判定只看 isError(来自 CLI 的 is_error → ThreadMessageLike.isError),且优先级最高。
// assistant-ui 的 status 对 tool-call 只表达"完成/未完成":external store 模式下带 result
// 即恒为 complete,从不会出现 incomplete+error,故不能用 status 判断错误。
export function getStatus(
  status: ToolCallMessagePartProps["status"],
  isError?: boolean,
): "running" | "success" | "error" {
  if (isError) return "error";
  if (!status) return "running";
  if (status.type === "running") return "running";
  return "success";
}

export function truncate(s: string | undefined, n = 90): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export function resultToString(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

// 从工具结果里提取错误正文，供失败时展示给用户。
// CLI 的错误内容常被 <tool_use_error>…</tool_use_error> 包裹（见 Edit 的
// "String to replace not found in file"），这里剥掉标签只留可读正文。
// 仅在 isError 时调用才有意义；空结果回退为通用提示由调用方决定。
export function errorTextFromResult(result: unknown): string {
  const raw = resultToString(result).trim();
  if (!raw) return "";
  const m = raw.match(/<tool_use_error>([\s\S]*?)<\/tool_use_error>/);
  return (m ? m[1] : raw).trim();
}