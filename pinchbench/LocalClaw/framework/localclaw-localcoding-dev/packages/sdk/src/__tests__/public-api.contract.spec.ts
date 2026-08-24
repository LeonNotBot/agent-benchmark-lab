import { describe, it, expect } from "vitest";
import * as sdk from "../index";

/**
 * 公共 API 契约测试（运行时维度）。
 *
 * api-extractor 的 etc/*.api.md 是「静态类型契约」；本测试是「运行时契约」——
 * 断言对外承诺的入口确实被导出、类型正确、注入令牌存在。
 * 接入方据此确信：升级 SDK 后这些入口不会无声消失。
 */
describe("公共入口导出", () => {
  it("两种接入入口存在且为函数/类", () => {
    expect(typeof sdk.createAgent).toBe("function");
    expect(typeof sdk.AgentModule).toBe("function");
    expect(typeof sdk.AgentModule.forRoot).toBe("function");
  });

  it("基座装配件导出存在", () => {
    expect(typeof sdk.DatabaseModule).toBe("function");
    expect(typeof sdk.DatabaseModule.forRoot).toBe("function");
    expect(typeof sdk.runSdkMigrations).toBe("function");
    expect(typeof sdk.applyMigrations).toBe("function");
    expect(sdk.DATABASE).toBe("DATABASE");
  });

  it("能力模块导出存在", () => {
    for (const m of [
      "SessionModule",
      "RunnerModule",
      "RoutingModule",
      "WorkspaceModule",
      "ScheduledTaskModule",
      "WebsocketModule",
    ] as const) {
      expect(typeof (sdk as any)[m]).toBe("function");
    }
  });

  it("DI 注入令牌（@public）均为 symbol/常量", () => {
    expect(typeof sdk.SESSION_SERVICE).toBe("symbol");
    expect(typeof sdk.ROUTING_SERVICE).toBe("symbol");
    expect(typeof sdk.SCHEDULED_TASK_SERVICE).toBe("symbol");
    expect(typeof sdk.WORKSPACE_SERVICE).toBe("symbol");
    expect(typeof sdk.GIT_SERVICE).toBe("symbol");
    expect(typeof sdk.WS_EVENT_HANDLERS).toBe("symbol");
    expect(typeof sdk.SESSION_START_CONTRIBUTORS).toBe("symbol");
  });

  it("配置/路径/日志公共函数存在", () => {
    for (const fn of [
      "configurePaths",
      "getProductName",
      "getAgentHomeDir",
      "getWorkspaceRoot",
      "getSkillsDir",
      "getTemplatesDir",
      "getProjectsDir",
      "getChannelsDir",
      "readAgentSettings",
      "writeAgentSettings",
      "setSdkLogLevel",
      "setSdkLogger",
    ] as const) {
      expect(typeof (sdk as any)[fn]).toBe("function");
    }
    expect(sdk.logger).toBeDefined();
  });
});
