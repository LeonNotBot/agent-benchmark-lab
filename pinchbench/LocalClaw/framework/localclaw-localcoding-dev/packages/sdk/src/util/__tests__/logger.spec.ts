import { describe, it, expect, vi, afterEach } from "vitest";
import {
  logger,
  setSdkLogger,
  setSdkLogLevel,
  type SdkLogger,
} from "../logger";

/**
 * logger 单测 —— 公共日志门面的行为契约。
 *
 * logger 有模块级全局状态(currentLevel / active),每个用例后必须还原:
 * setSdkLogger(null) 恢复默认 console 实现,setSdkLogLevel("log") 恢复默认级别。
 * 否则会污染其它测试。
 */
afterEach(() => {
  vi.restoreAllMocks();
  setSdkLogger(null);
  setSdkLogLevel("log");
});

/** 构造一个记录各级别调用次数的假 logger。 */
function makeSpyLogger(): SdkLogger & { calls: Record<string, number> } {
  const calls = { debug: 0, log: 0, warn: 0, error: 0 };
  return {
    calls,
    debug: () => void calls.debug++,
    log: () => void calls.log++,
    warn: () => void calls.warn++,
    error: () => void calls.error++,
  };
}

describe("setSdkLogLevel — 默认 console 实现的级别过滤", () => {
  it('"log" 级别:log/warn/error 输出,debug 被吞', () => {
    const c = {
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };
    setSdkLogLevel("log");
    logger.debug("d");
    logger.log("l");
    logger.warn("w");
    logger.error("e");
    expect(c.debug).not.toHaveBeenCalled(); // debug < log,被过滤
    expect(c.log).toHaveBeenCalledOnce();
    expect(c.warn).toHaveBeenCalledOnce();
    expect(c.error).toHaveBeenCalledOnce();
  });

  it('"warn" 级别:log 被吞,warn/error 仍出', () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    setSdkLogLevel("warn");
    logger.log("l");
    logger.warn("w");
    logger.error("e");
    expect(log).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
  });

  it('"silent" 级别:全部被吞', () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    setSdkLogLevel("silent");
    logger.log("l");
    logger.error("e");
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('"debug" 级别:全部输出', () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    setSdkLogLevel("debug");
    logger.debug("d");
    expect(debug).toHaveBeenCalledOnce();
  });
});

describe("setSdkLogger — 注入接管", () => {
  it("注入自定义 logger 后,日志走自定义实现而非 console", () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const custom = makeSpyLogger();
    setSdkLogger(custom);
    logger.log("hi");
    logger.error("boom");
    expect(custom.calls.log).toBe(1);
    expect(custom.calls.error).toBe(1);
    expect(consoleLog).not.toHaveBeenCalled(); // 不再走 console
  });

  it("注入的自定义 logger 不受 setSdkLogLevel 过滤(级别只管默认实现)", () => {
    const custom = makeSpyLogger();
    setSdkLogger(custom);
    setSdkLogLevel("silent"); // 对自定义实现无效
    logger.log("still logged");
    expect(custom.calls.log).toBe(1);
  });

  it("setSdkLogger(null) 恢复默认 console 实现", () => {
    const custom = makeSpyLogger();
    setSdkLogger(custom);
    setSdkLogger(null);
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    setSdkLogLevel("log");
    logger.log("back to console");
    expect(custom.calls.log).toBe(0); // 自定义已解除
    expect(consoleLog).toHaveBeenCalledOnce();
  });
});
