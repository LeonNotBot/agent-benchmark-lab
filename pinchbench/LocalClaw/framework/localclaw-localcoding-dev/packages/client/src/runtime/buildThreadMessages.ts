// 把 StreamMessage[] 一次性转成 ThreadMessageLike[]
// 合并了原 convertMessage.ts（97 行）+ mergeToolResults.ts（68 行）的逻辑

import type { ThreadMessageLike } from "@assistant-ui/react";
import { splitThink } from "./parseThink";
import { parseApiError } from "./parseApiError";

type AnyMsg = any;

export function buildThreadMessages(raw: AnyMsg[], isError = false): ThreadMessageLike[] {
  const out: ThreadMessageLike[] = [];
  const toolCallIndex = new Map<string, { msgIdx: number; partIdx: number }>();

  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const t = m.type;

    // 跳过子任务(Task/Agent 子 agent)内部的对话消息：parent_tool_use_id 非 null
    // 表示这条消息属于某个子 agent 的内部对话(它收到的 prompt / 产生的 tool_result),
    // 不应平铺到主会话视图，否则会把子 agent 的 prompt 误渲染成"用户消息"。
    if (m.parent_tool_use_id != null) continue;

    // 跳过 CLI 注入的「上下文消息」：isSynthetic=true（打包 CLI 输出字段，源码里叫 isMeta）。
    // 典型来源是内置 Skill 工具——模型调用 Skill 后，CLI 用合成 user 消息把技能正文
    // （SKILL.md，形如「Base directory for this skill: …」）塞回对话(见打包 CLI SkillTool)，
    // 仅供模型读取、不应作为「用户发言」渲染。否则技能正文会被 convertUserText 当成用户气泡。
    // isMeta 作为源码字段名一并兜底；isVisibleInTranscriptOnly / isCompactSummary 同属仅转录合成消息。
    if (
      m.isSynthetic === true ||
      m.isMeta === true ||
      m.isVisibleInTranscriptOnly === true ||
      m.isCompactSummary === true
    ) continue;

    // 跳过非消息类型
    if (t === "system" || t === "result" || t === "auth_status" || t === "tool_progress" || t === "stream_event" || t === "session_stopped") continue;

    // user_prompt（含附件）
    if (t === "user_prompt") {
      const msg = convertUserPrompt(m);
      if (msg) out.push(msg);
      continue;
    }

    // assistant：转换 + 记录 tool-call 索引
    if (t === "assistant") {
      const msg = convertAssistant(m);
      if (!msg) continue;
      const idx = out.length;
      const parts = msg.content as any[];
      parts.forEach((p: any, pi: number) => {
        if (p.type === "tool-call" && p.toolCallId) toolCallIndex.set(p.toolCallId, { msgIdx: idx, partIdx: pi });
      });
      out.push(msg);
      continue;
    }

    // user：tool_result 合并回 assistant，普通文本独立
    if (t === "user") {
      const content = m?.message?.content;
      if (Array.isArray(content) && content.some((c: any) => c?.type === "tool_result")) {
        for (const block of content) {
          if (block?.type !== "tool_result") continue;
          const ref = block.tool_use_id ? toolCallIndex.get(block.tool_use_id) : undefined;
          if (!ref) continue;
          const part: any = (out[ref.msgIdx].content as any[])[ref.partIdx];
          part.result = extractResult(block);
          if (block.is_error) part.isError = true;
        }
        continue;
      }
      // type:"user" 但只含 text 块：这不是真实用户输入（真实输入走 user_prompt 单独通道），
      // 而是 CLI 在「工具入参校验失败 / no-op / 权限拒绝」时注入的合成反馈消息——本应是
      // tool_result，却被 CLI 以 role=user 的纯文本塞回对话喂给模型（见打包 CLI createUserMessage）。
      // 若直接落到 convertUserText 会被右浮成「用户气泡」(docs/images/11.png 的问题)。
      // 正确做法：把它并入紧邻的上一条 assistant 里尚未拿到结果的 tool-call，作为错误结果在工具卡内展示。
      const pending = findPendingToolCall(out);
      if (pending) {
        pending.result = extractTextContent(content);
        pending.isError = true;
        continue;
      }
      const msg = convertUserText(m);
      if (msg) out.push(msg);
      continue;
    }
  }

  // 会话出错（如流式输出中途上游中断，server 下发 session.status: error）时，
  // 给最后一条 assistant 消息标记 incomplete/error 状态。
  // assistant-ui 据此渲染 ActionBar 的 Reload（重新生成）按钮，无需自定义 banner。
  if (isError && !latestTurnCompletedSuccessfully(raw)) {
    const lastAssistant = [...out].reverse().find((m) => m.role === "assistant");
    if (lastAssistant) {
      (lastAssistant as any).status = { type: "incomplete", reason: "error" };
    }
  }

  return out;
}

// claude-cli 的延迟工具（deferred tools：MCP 工具、CronCreate、artifact 等）不在核心工具列表里，
// 模型通过 ExecuteExtraTool({"tool_name":"X","params":{...}}) 包一层调用。直接透传的话卡片名会显示
// 包装器名 "ExecuteExtraTool"，对用户无意义 —— 这里解包成内层真实工具名 + 真实参数。
// 兼容 params 缺省（入参校验失败/no-op 时可能只有 tool_name）与 params 非对象的情况。
function unwrapExtraTool(name: string, input: any): { toolName: string; args: any } {
  if (name === "ExecuteExtraTool" && input && typeof input === "object" && typeof input.tool_name === "string") {
    const params = input.params;
    return { toolName: input.tool_name, args: params && typeof params === "object" ? params : {} };
  }
  return { toolName: name, args: input ?? {} };
}

function convertAssistant(m: AnyMsg): ThreadMessageLike | null {
  const content = m?.message?.content;
  if (!Array.isArray(content)) return null;
  const errorCode = typeof m?.error === "string" ? m.error : undefined;
  const parts: any[] = [];
  let apiError: ReturnType<typeof parseApiError> = null;
  for (const b of content) {
    if (b?.type === "text" && typeof b.text === "string") {
      // 上游 API 错误被 CLI 当成 text 块吐出（鉴权/额度/限流），拦截成结构化错误，
      // 挂到消息 metadata.custom 由 AssistantMessage 渲染成卡片，
      // 避免把 "API Error: 403 {...}" 原始英文+JSON 直接糊给用户。
      const err = parseApiError(b.text, errorCode);
      if (err) {
        apiError = err;
        continue;
      }
      // text 块里可能内联 <think> 标签（如 Kimi/DeepSeek），拆成 reasoning + text
      for (const seg of splitThink(b.text)) {
        if (!seg.text) continue;
        parts.push(seg.type === "reasoning"
          ? { type: "reasoning", text: seg.text }
          : { type: "text", text: seg.text });
      }
    }
    else if (b?.type === "thinking") parts.push({ type: "reasoning", text: b.thinking ?? b.text ?? "" });
    else if (b?.type === "tool_use") {
      const { toolName, args } = unwrapExtraTool(b.name, b.input);
      parts.push({ type: "tool-call", toolCallId: b.id, toolName, args });
    }
  }
  // 纯错误消息（无其它内容）也要渲染：给一个空 text part 占位，让卡片有挂载点。
  if (apiError && parts.length === 0) parts.push({ type: "text", text: "" });
  if (!parts.length) return null;
  const msg: ThreadMessageLike = { id: m.uuid ?? m.id ?? rnd(), role: "assistant", content: parts };
  if (apiError) (msg as any).metadata = { custom: { apiError } };
  return msg;
}

function convertUserText(m: AnyMsg): ThreadMessageLike | null {
  const content = m?.message?.content;
  if (typeof content === "string") return { id: rnd(), role: "user", content: [{ type: "text", text: content }] };
  if (!Array.isArray(content)) return null;
  const parts: any[] = [];
  for (const b of content) {
    if (b?.type === "text" && typeof b.text === "string") parts.push({ type: "text", text: b.text });
    else if (typeof b === "string") parts.push({ type: "text", text: b });
  }
  return parts.length ? { id: m.uuid ?? m.id ?? rnd(), role: "user", content: parts } : null;
}

function convertUserPrompt(m: AnyMsg): ThreadMessageLike | null {
  const text = m?.prompt ?? m?.text ?? "";
  const atts: any[] = Array.isArray(m?.attachments) ? m.attachments : [];
  const parts: any[] = [];
  for (const a of atts) {
    if (a?.mimeType?.startsWith("image/") && a.base64) parts.push({ type: "image", image: `data:${a.mimeType};base64,${a.base64}` });
    else if (a?.name) parts.push({ type: "text", text: `📄 ${a.name}` });
  }
  if (text) parts.push({ type: "text", text });
  if (!parts.length) return null;
  const msg: ThreadMessageLike = { id: m.uuid ?? m.id ?? rnd(), role: "user", content: parts };
  // 定时任务续聊自动发送的消息：透传 source，供 UserMessage 渲染「通过自动化发送」徽标。
  if (m?.source === "automation") (msg as any).metadata = { custom: { source: "automation" } };
  return msg;
}

function extractResult(block: AnyMsg): unknown {
  const c = block?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    const t = c.filter((x: any) => typeof x === "string" || x?.type === "text").map((x: any) => typeof x === "string" ? x : x.text ?? "").join("\n");
    return t || c;
  }
  return c ?? "";
}

// 从 type:"user" 的 content（text 块数组或字符串）抽出纯文本，用作合成反馈的工具错误结果。
function extractTextContent(content: AnyMsg): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b: any) => (typeof b === "string" ? b : b?.type === "text" ? b.text ?? "" : ""))
    .filter(Boolean)
    .join("\n");
}

// 在已转换的 out 里，从后往前找最近一条 assistant 中「等待真正结果」的 tool-call part。
// 两种情况都算等待中：
//   1) 还没有 result（普通工具，结果尚未回流）；
//   2) 已有 result 但内容为空/null —— 这是 ExecuteExtraTool 的特例：它在入参校验失败/no-op/
//      权限拒绝时，会先回一条 tool_result（内容形如 {"result":null,...}，实为占位），紧接着再以
//      role=user 的纯文本把真正的错误详情喂回模型。占位结果不该挡住把这条错误文本并入工具卡。
function findPendingToolCall(out: ThreadMessageLike[]): any | null {
  for (let i = out.length - 1; i >= 0; i--) {
    const msg = out[i];
    if (msg.role !== "assistant") continue;
    const parts = msg.content as any[];
    for (let pi = parts.length - 1; pi >= 0; pi--) {
      const p = parts[pi];
      if (p?.type === "tool-call" && isResultEmpty(p)) return p;
    }
    return null; // 最近的 assistant 里没有等待中的 tool-call，不再向更早的消息回溯
  }
  return null;
}

// tool-call 的 result 是否为「空占位」：未设置、null、空串，或形如 {result:null,...} 的占位对象。
function isResultEmpty(p: any): boolean {
  if (!("result" in p)) return true;
  const r = p.result;
  if (r == null || r === "") return true;
  // CLI 把 {"result":null,"tool_name":"X"} 作为 tool_result 内容回传，extractResult 后常为该字符串/对象
  if (typeof r === "string") {
    try { const o = JSON.parse(r); return o && typeof o === "object" && o.result == null; } catch { return false; }
  }
  if (typeof r === "object") return (r as any).result == null && "tool_name" in (r as any);
  return false;
}

function latestTurnCompletedSuccessfully(raw: AnyMsg[]): boolean {
  let latestPromptIndex = -1;
  let latestResultIndex = -1;
  let latestResult: AnyMsg | null = null;

  raw.forEach((m, index) => {
    if (m?.type === "user_prompt") latestPromptIndex = index;
    if (m?.type === "result") {
      latestResultIndex = index;
      latestResult = m;
    }
  });

  return Boolean(
    latestResult &&
      latestResultIndex >= latestPromptIndex &&
      latestResult.subtype === "success" &&
      latestResult.is_error !== true,
  );
}

function rnd(): string { return `msg-${Math.random().toString(36).slice(2)}`; }

// 是否存在「未应答的 AskUserQuestion」：CLI 在等用户做选择，而非模型在运行。
// 用于让运行中指示器（底部圆点）在等待用户输入时不显示——此时表现为 running 会误导，
// 也会触发 assistant-ui 持续 autoscroll。判定纯基于消息结构：
// 收集 AskUserQuestion 的 tool_use id，减去已出现 tool_result 的 id，差集非空即待答。
// （答案由前端乐观写入 appendToolResult，会进 rawMessages，故这里能感知到已应答。）
export function hasPendingAskUserQuestion(raw: AnyMsg[]): boolean {
  const answered = new Set<string>();
  const asked: string[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object" || m.parent_tool_use_id != null) continue;
    const content = m?.message?.content;
    if (!Array.isArray(content)) continue;
    if (m.type === "assistant") {
      for (const b of content) {
        if (b?.type === "tool_use" && b?.name === "AskUserQuestion" && b?.id) asked.push(b.id);
      }
    } else if (m.type === "user") {
      for (const b of content) {
        if (b?.type === "tool_result" && b?.tool_use_id) answered.add(b.tool_use_id);
      }
    }
  }
  return asked.some((id) => !answered.has(id));
}
