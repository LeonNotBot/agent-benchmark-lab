import { describe, it, expect } from "vitest";
import { isCliReplayNoise } from "@lenovo/agent-protocol";

/**
 * 模型切换面包屑过滤的回归测试。核心保证：合取判别（isReplay + local-command-stdout tag）
 * 只删「set_model 实时注入的面包屑」，对三个**必须放行**的失效模式零误伤。
 * 详见 isCliReplayNoise 与 runner-spawn.service.ts processOutput 守卫的注释。
 */
describe("isCliReplayNoise", () => {
  it("命中：set_model 注入的模型切换面包屑（顶层 content 字符串，cli.js:834945 形态）", () => {
    expect(
      isCliReplayNoise({
        type: "user",
        isReplay: true,
        content: "<local-command-stdout>Set model to Sonnet</local-command-stdout>",
        message: { role: "user", content: "<local-command-stdout>Set model to Sonnet</local-command-stdout>" },
      }),
    ).toBe(true);
  });

  it("放行：resume 回放的真实历史 user 消息（带 isReplay 但无 tag）——防『开 replay flag 后吞历史』", () => {
    expect(
      isCliReplayNoise({
        type: "user",
        isReplay: true,
        message: { role: "user", content: [{ type: "text", text: "帮我重构这个函数" }] },
      }),
    ).toBe(false);
  });

  it("放行：用户真敲 /model 的命令输出（system 型，不是 user）", () => {
    expect(
      isCliReplayNoise({
        type: "system",
        subtype: "local_command",
        content: "<local-command-stdout>Set model to X</local-command-stdout>",
      }),
    ).toBe(false);
  });

  it("放行：用户用 ! 跑 bash 的真实回显（user 型、含 tag、但无 isReplay）", () => {
    expect(
      isCliReplayNoise({
        type: "user",
        message: { role: "user", content: "<local-command-stdout>file.txt</local-command-stdout>" },
      }),
    ).toBe(false);
  });

  it("放行：普通 assistant / user 消息与非对象输入", () => {
    expect(isCliReplayNoise({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } })).toBe(false);
    expect(isCliReplayNoise({ type: "user", message: { role: "user", content: "hello" } })).toBe(false);
    expect(isCliReplayNoise(null)).toBe(false);
    expect(isCliReplayNoise(undefined)).toBe(false);
    expect(isCliReplayNoise("string")).toBe(false);
  });
});
