// 共享解析器：把文本里内联的 <think>...</think>（兼容 <thinking>）拆成
// 正文段 + 推理段。流式和完整消息共用，保证两处行为一致。
//
// - 对流式未闭合标签宽容：未闭合的 <think> 之后内容全算 reasoning（正在生成）。
// - streaming=true 时，剔除结尾不完整的标签前缀（如 "<thi"），避免闪烁。

export interface ThinkSegment {
  type: "text" | "reasoning";
  text: string;
}

const TAG_RE = /<\/?think(?:ing)?>/gi;
// 结尾可能是 think 标签的不完整前缀：<, </, <t ... <think, <thinking, </think...
const PARTIAL_TAG_RE = /<\/?(?:t(?:h(?:i(?:n(?:k(?:i(?:n(?:g)?)?)?)?)?)?)?)?$/i;

export function splitThink(input: string, opts?: { streaming?: boolean }): ThinkSegment[] {
  if (!input) return [];
  const segs: ThinkSegment[] = [];
  let lastIndex = 0;
  let inThink = false;
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(input))) {
    const chunk = input.slice(lastIndex, m.index);
    if (chunk) push(segs, inThink ? "reasoning" : "text", chunk);
    inThink = m[0][1] !== "/"; // 开标签 → true，闭标签 → false
    lastIndex = m.index + m[0].length;
  }
  let tail = input.slice(lastIndex);
  if (opts?.streaming) tail = stripPartialTag(tail);
  if (tail) push(segs, inThink ? "reasoning" : "text", tail);
  return segs;
}

// 结尾若是不完整的 think 标签前缀，截掉这一段（下一帧补全后再显示）。
function stripPartialTag(s: string): string {
  const lt = s.lastIndexOf("<");
  if (lt === -1) return s;
  const rest = s.slice(lt);
  if (rest.includes(">")) return s; // 已闭合，不是尾部残缺标签
  return PARTIAL_TAG_RE.test(rest) ? s.slice(0, lt) : s;
}

// 合并相邻同类段，避免被标签切碎成多段。
function push(segs: ThinkSegment[], type: ThinkSegment["type"], text: string): void {
  const last = segs[segs.length - 1];
  if (last && last.type === type) last.text += text;
  else segs.push({ type, text });
}
