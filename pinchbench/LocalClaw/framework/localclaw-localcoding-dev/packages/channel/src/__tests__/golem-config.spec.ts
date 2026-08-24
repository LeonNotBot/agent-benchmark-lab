import { describe, it, expect } from "vitest";
import { buildDefaultGolemConfig } from "../golem-config";

describe("buildDefaultGolemConfig", () => {
  it("返回的 config 有 name/engine 必填字段", () => {
    const cfg = buildDefaultGolemConfig({ botName: "local-claw" });
    expect(cfg.name).toBe("local-claw");
    expect(cfg.engine).toBe("claude-code");
  });

  it("有合理的 group/streaming 默认", () => {
    const cfg = buildDefaultGolemConfig({ botName: "x" });
    expect(cfg.groupChat?.groupPolicy).toBe("mention-only");
    expect(cfg.groupChat?.maxTurns).toBeGreaterThan(0);
    expect(cfg.groupChat?.historyLimit).toBeGreaterThan(0);
    expect(cfg.streaming).toBeDefined();
    expect(cfg.streaming?.mode).toBeDefined();
  });

  it("可覆盖 botName 用于 @mention 检测", () => {
    const cfg = buildDefaultGolemConfig({ botName: "my-bot" });
    expect(cfg.name).toBe("my-bot");
  });

  it("微信用 streaming 模式但关闭 showToolCalls（多气泡 + 无工具 hint）", () => {
    const cfg = buildDefaultGolemConfig({ botName: "x", channelType: "wechat" });
    expect(cfg.streaming?.mode).toBe("streaming");
    expect(cfg.streaming?.showToolCalls).toBe(false);
  });

  it("非微信渠道 streaming + showToolCalls=true", () => {
    for (const t of ["feishu", "dingtalk", "wecom"] as const) {
      const cfg = buildDefaultGolemConfig({ botName: "x", channelType: t });
      expect(cfg.streaming?.mode).toBe("streaming");
      expect(cfg.streaming?.showToolCalls).toBe(true);
    }
  });
});
