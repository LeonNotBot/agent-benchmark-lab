import { describe, it, expect } from "vitest";
import { buildThreadMessages } from "./buildThreadMessages";

// 模拟内置 Skill 工具触发后的 CLI 消息流：
// 1) assistant 调用 Skill 工具(tool_use)
// 2) user 携带 tool_result(Skill 工具的执行结果，合并回 tool-call)
// 3) user + isSynthetic:true，content 为技能正文(SKILL.md)——仅供模型读取，不应渲染成用户气泡
//    注意：真实 CLI content 是数组([{type:"text",text:...}])，且字段名是 isSynthetic（打包 CLI 输出）。
function skillStream() {
  return [
    { type: "user_prompt", prompt: "使用 frontend-design skill 设计一个登录页" },
    {
      type: "assistant",
      uuid: "a1",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "tool_1", name: "Skill", input: { skill: "frontend-design" } }],
      },
    },
    {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tool_1", content: "ok" }],
      },
    },
    {
      type: "user",
      isSynthetic: true,
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [
          {
            type: "text",
            text: "Base directory for this skill: C:/Users/x/.localclaw/skills/frontend-design\n\n# Frontend Design",
          },
        ],
      },
    },
  ];
}

describe("buildThreadMessages — skill isSynthetic 注入消息", () => {
  it("不把 isSynthetic 技能正文渲染成用户气泡", () => {
    const out = buildThreadMessages(skillStream());
    const userTexts = out
      .filter((m) => m.role === "user")
      .flatMap((m) => (m.content as any[]).map((p) => p.text ?? ""));
    expect(userTexts.some((t) => t.includes("Base directory for this skill"))).toBe(false);
    expect(userTexts.some((t) => t.includes("# Frontend Design"))).toBe(false);
  });

  it("仍保留真实用户 prompt 与工具调用结果合并", () => {
    const out = buildThreadMessages(skillStream());
    // 真实用户 prompt 保留
    expect(out.some((m) => m.role === "user" && (m.content as any[]).some((p) => p.text?.includes("登录页")))).toBe(true);
    // Skill 的 tool_result 合并回 assistant 的 tool-call
    const assistant = out.find((m) => m.role === "assistant");
    const toolCall = (assistant?.content as any[]).find((p) => p.type === "tool-call");
    expect(toolCall?.result).toBe("ok");
  });

  it("跳过 isMeta / isVisibleInTranscriptOnly / isCompactSummary 合成消息", () => {
    const out = buildThreadMessages([
      { type: "user", isMeta: true, message: { role: "user", content: "meta only" } },
      { type: "user", isVisibleInTranscriptOnly: true, message: { role: "user", content: "transcript only" } },
      { type: "user", isCompactSummary: true, message: { role: "user", content: "summary" } },
      { type: "user", message: { role: "user", content: "真实发言" } },
    ]);
    const userTexts = out.flatMap((m) => (m.content as any[]).map((p) => p.text ?? ""));
    expect(userTexts).toContain("真实发言");
    expect(userTexts).not.toContain("meta only");
    expect(userTexts).not.toContain("transcript only");
    expect(userTexts).not.toContain("summary");
  });
});

describe("buildThreadMessages — ExecuteExtraTool 解包", () => {
  function extraToolMsg(input: any) {
    return [
      {
        type: "assistant",
        uuid: "a1",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name: "ExecuteExtraTool", input }],
        },
      },
    ];
  }

  it("把 ExecuteExtraTool 解包成内层 tool_name + params", () => {
    const out = buildThreadMessages(
      extraToolMsg({ tool_name: "CronCreate", params: { schedule: "*/5 * * * *", prompt: "check" } }),
    );
    const tc = (out[0].content as any[]).find((p) => p.type === "tool-call");
    expect(tc.toolName).toBe("CronCreate");
    expect(tc.args).toEqual({ schedule: "*/5 * * * *", prompt: "check" });
  });

  it("params 缺省时降级为空对象，仍用内层真名", () => {
    const out = buildThreadMessages(extraToolMsg({ tool_name: "mcp__slack__send" }));
    const tc = (out[0].content as any[]).find((p) => p.type === "tool-call");
    expect(tc.toolName).toBe("mcp__slack__send");
    expect(tc.args).toEqual({});
  });

  it("非 ExecuteExtraTool 的普通工具原样透传", () => {
    const out = buildThreadMessages([
      {
        type: "assistant",
        uuid: "a1",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }],
        },
      },
    ]);
    const tc = (out[0].content as any[]).find((p) => p.type === "tool-call");
    expect(tc.toolName).toBe("Bash");
    expect(tc.args).toEqual({ command: "ls" });
  });
});
