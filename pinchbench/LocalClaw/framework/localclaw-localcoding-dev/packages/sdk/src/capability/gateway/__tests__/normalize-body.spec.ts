import { describe, it, expect } from "vitest";
import { normalizeOpenAIBody } from "../normalize-body";

describe("normalizeOpenAIBody", () => {
  it("删除 content=null 的纯 tool_calls assistant 消息的 content 字段", () => {
    const body = {
      messages: [
        { role: "assistant", content: null, tool_calls: [{ id: "t1" }] },
      ],
    };
    normalizeOpenAIBody(body);
    expect("content" in body.messages[0]).toBe(false);
  });

  it("删除 content='' 的纯 tool_calls assistant 消息的 content 字段", () => {
    const body = {
      messages: [
        { role: "assistant", content: "", tool_calls: [{ id: "t1" }] },
      ],
    };
    normalizeOpenAIBody(body);
    expect("content" in body.messages[0]).toBe(false);
  });

  it("不改动有文本的 assistant 消息", () => {
    const body = { messages: [{ role: "assistant", content: "hi", tool_calls: [{ id: "t1" }] }] };
    normalizeOpenAIBody(body);
    expect(body.messages[0].content).toBe("hi");
  });

  it("不动没有 tool_calls 的空 assistant 消息（保留 content）", () => {
    const body = { messages: [{ role: "assistant", content: "" }] };
    normalizeOpenAIBody(body);
    expect("content" in body.messages[0]).toBe(true);
  });

  it("不改动 user / tool 消息的 content", () => {
    const body = {
      messages: [
        { role: "user", content: "q" },
        { role: "tool", content: "result", tool_call_id: "t1" },
      ],
    };
    normalizeOpenAIBody(body);
    expect(body.messages[0].content).toBe("q");
    expect(body.messages[1].content).toBe("result");
  });

  it("无 messages 字段时安全返回", () => {
    expect(() => normalizeOpenAIBody({} as any)).not.toThrow();
  });
});
