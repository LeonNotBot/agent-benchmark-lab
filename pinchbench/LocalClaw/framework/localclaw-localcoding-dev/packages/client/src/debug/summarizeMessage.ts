// 把一条 StreamMessage 提炼成「类型标签 + 预览文本」，供查看器逐条对比。
// 目的：一眼看清某帧里每条消息的类型与内容，方便在相邻帧间对比渲染状态差异。

export interface MessageInfo {
  /** 简短类型标签 */
  type: string;
  /** 内容预览（截断） */
  preview: string;
}

const MAX_PREVIEW = 120;

function truncate(s: string): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > MAX_PREVIEW ? flat.slice(0, MAX_PREVIEW) + "…" : flat;
}

/** 从 content block 数组里提炼预览文本 + 更精确的类型。 */
function summarizeBlocks(blocks: any[]): MessageInfo {
  const parts: string[] = [];
  const kinds = new Set<string>();
  for (const b of blocks) {
    if (b?.type === "text" && typeof b.text === "string") {
      kinds.add("text");
      parts.push(b.text);
    } else if (b?.type === "thinking" && typeof b.thinking === "string") {
      kinds.add("thinking");
      parts.push(`[思考] ${b.thinking}`);
    } else if (b?.type === "tool_use") {
      kinds.add("tool_use");
      parts.push(`[工具:${b.name ?? "?"}]`);
    } else if (b?.type === "tool_result") {
      kinds.add("tool_result");
      const c = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
      parts.push(`[结果] ${c ?? ""}`);
    } else if (b?.type) {
      kinds.add(b.type);
    }
  }
  return { type: [...kinds].join("+") || "empty", preview: truncate(parts.join(" ")) };
}

/** 主入口：按消息类型分派。 */
export function summarizeMessage(m: any): MessageInfo {
  const t = m?.type as string;

  if (t === "user_prompt") {
    return { type: "user_prompt", preview: truncate(String(m.prompt ?? "")) };
  }
  if (t === "session_stopped") {
    return { type: "session_stopped", preview: "（用户停止）" };
  }

  // assistant / user：内容在 message.content
  const content = m?.message?.content;
  if (Array.isArray(content)) {
    const info = summarizeBlocks(content);
    return { type: `${t}:${info.type}`, preview: info.preview };
  }
  if (typeof content === "string") {
    return { type: t ?? "unknown", preview: truncate(content) };
  }

  // system / result 等其它 SDK 消息
  return { type: t ?? "unknown", preview: truncate(JSON.stringify(m).slice(0, 200)) };
}
