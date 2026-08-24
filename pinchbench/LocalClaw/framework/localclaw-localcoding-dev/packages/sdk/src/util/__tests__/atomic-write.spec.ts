import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// mock fs：用内存桩替代真实文件操作，控制 renameSync 的成功/失败序列。
// vi.hoisted 确保桩函数先于被提升的 vi.mock 工厂初始化。
const { writeFileSync, renameSync, unlinkSync } = vi.hoisted(() => ({
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
}));
vi.mock("fs", () => ({ writeFileSync, renameSync, unlinkSync }));
// 静默 logger，避免重试告警污染测试输出
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), log: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { atomicWriteFile } from "../atomic-write";

/** 构造带 code 的 errno 错误。 */
function errnoError(code: string): NodeJS.ErrnoException {
  const e = new Error(code) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

describe("atomicWriteFile", () => {
  beforeEach(() => {
    writeFileSync.mockReset();
    renameSync.mockReset();
    unlinkSync.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("成功路径：先写 tmp 再 rename，一次成功不重试", () => {
    atomicWriteFile("/x/settings.json", "{}");
    // 写的是 .tmp.<pid>.<ts> 临时文件
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const tmpArg = writeFileSync.mock.calls[0][0] as string;
    expect(tmpArg).toMatch(/^\/x\/settings\.json\.tmp\.\d+\.\d+$/);
    expect(writeFileSync.mock.calls[0][1]).toBe("{}");
    // rename tmp → 目标，一次成功
    expect(renameSync).toHaveBeenCalledTimes(1);
    expect(renameSync.mock.calls[0][0]).toBe(tmpArg);
    expect(renameSync.mock.calls[0][1]).toBe("/x/settings.json");
    // 成功不清理
    expect(unlinkSync).not.toHaveBeenCalled();
  });

  it("可重试错误（EPERM）：重试后成功，不抛错、不清理 tmp", () => {
    renameSync
      .mockImplementationOnce(() => { throw errnoError("EPERM"); })
      .mockImplementationOnce(() => { throw errnoError("EBUSY"); })
      .mockImplementationOnce(() => { /* 第三次成功 */ });
    expect(() => atomicWriteFile("/x/a.json", "data")).not.toThrow();
    expect(renameSync).toHaveBeenCalledTimes(3);
    expect(unlinkSync).not.toHaveBeenCalled();
  });

  it("重试耗尽：清理 tmp 并抛出原始错误", () => {
    renameSync.mockImplementation(() => { throw errnoError("EPERM"); });
    expect(() => atomicWriteFile("/x/b.json", "data")).toThrow(/EPERM/);
    // 初次 + 10 次重试 = 11 次尝试
    expect(renameSync).toHaveBeenCalledTimes(11);
    // 失败后清理临时文件，不残留垃圾
    expect(unlinkSync).toHaveBeenCalledTimes(1);
    const tmpArg = writeFileSync.mock.calls[0][0] as string;
    expect(unlinkSync.mock.calls[0][0]).toBe(tmpArg);
  });

  it("非可重试错误（ENOSPC）：立即抛出，不重试，清理 tmp", () => {
    renameSync.mockImplementation(() => { throw errnoError("ENOSPC"); });
    expect(() => atomicWriteFile("/x/c.json", "data")).toThrow(/ENOSPC/);
    // 只尝试一次，不进入重试
    expect(renameSync).toHaveBeenCalledTimes(1);
    expect(unlinkSync).toHaveBeenCalledTimes(1);
  });

  it("tmp 清理失败被吞掉，仍抛出原始 rename 错误", () => {
    renameSync.mockImplementation(() => { throw errnoError("ENOSPC"); });
    unlinkSync.mockImplementation(() => { throw new Error("unlink boom"); });
    // 抛的是 rename 的 ENOSPC，而非 unlink 的错误
    expect(() => atomicWriteFile("/x/d.json", "data")).toThrow(/ENOSPC/);
  });

  it("透传自定义 encoding 给 writeFileSync", () => {
    atomicWriteFile("/x/e.bin", "payload", "base64");
    expect(writeFileSync.mock.calls[0][2]).toBe("base64");
  });
});
