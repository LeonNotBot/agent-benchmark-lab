// 规整 OpenAI 格式请求体，修正下游（OpenAI→Anthropic 转换型）上游不接受的写法。
//
// 已知问题：CLI 把「纯 tool_calls、无文本」的 assistant 消息的 content 设为 null（或空串），
// 而 Anthropic 协议下这类消息不应带独立 text content，sky 等转换型上游会回
// 400 Improperly formed request。实测：content=null 和 content="" 都被拒，
// 只有「不带 content 字段」才被接受。故这里直接删除空 content。

export function normalizeOpenAIBody<T extends { messages?: any[] }>(body: T): T {
  if (!Array.isArray(body.messages)) return body;
  for (const m of body.messages) {
    if (m && m.role === "assistant" && hasToolCalls(m) && isEmptyContent(m.content)) {
      delete m.content;
    }
  }
  return body;
}

function hasToolCalls(m: any): boolean {
  return Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
}

function isEmptyContent(content: unknown): boolean {
  return content == null || content === "";
}
