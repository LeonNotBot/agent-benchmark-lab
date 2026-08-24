import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChannelService } from "../channel.service";

/**
 * 回归测试：testConnection 必须实际校验凭据，不能因 engine=golembot 就退回
 * isRunning 进程检查（否则乱填凭据也会误报「测试成功」）。
 * - feishu/dingtalk：请求 tenant_access_token / gettoken 认证接口校验。
 * - wecom：无 HTTP 认证接口，通过 verifyWecomConnection 临时建 WebSocket 连接、
 *   等待认证帧结果判定凭据真假；enabled 渠道测试后需重建连接恢复服务。
 */
describe("ChannelService.testConnection", () => {
  function makeService(channel: any, isRunning = false, verifyWecom?: any) {
    const golemManager = {
      isRunning: vi.fn(() => isRunning),
      verifyWecomConnection: verifyWecom ?? vi.fn(async () => ({ ok: true })),
      restartChannel: vi.fn(async () => {}),
      startChannel: vi.fn(async () => {}),
      stopChannel: vi.fn(async () => {}),
    };
    const svc = new ChannelService({} as any, golemManager as any, {} as any, { updateByChannelId: vi.fn() } as any, { on: vi.fn(), off: vi.fn() } as any);
    vi.spyOn(svc, "getChannel").mockReturnValue(channel);
    vi.spyOn(svc, "updateStatus").mockImplementation(() => {});
    return { svc, golemManager };
  }

  function mockFetch(payload: any) {
    return vi.fn(async () => ({ json: async () => payload })) as any;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("feishu 凭据无效时返回失败（即使 adapter 在运行）", async () => {
    const { svc } = makeService(
      { id: "f1", type: "feishu", engine: "golembot", credentials: { appId: "x", appSecret: "y" } },
      /* isRunning */ true,
    );
    vi.stubGlobal("fetch", mockFetch({ code: 10003, msg: "invalid app_id" }));

    const res = await svc.testConnection("f1");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("invalid app_id");
  });

  it("feishu 凭据有效时返回成功", async () => {
    const { svc } = makeService(
      { id: "f1", type: "feishu", engine: "golembot", credentials: { appId: "a", appSecret: "b" } },
      false,
    );
    vi.stubGlobal("fetch", mockFetch({ code: 0, tenant_access_token: "t" }));

    const res = await svc.testConnection("f1");
    expect(res.ok).toBe(true);
  });

  it("feishu 缺少凭据时直接返回失败，不发起请求", async () => {
    const { svc } = makeService(
      { id: "f1", type: "feishu", engine: "golembot", credentials: {} },
      true,
    );
    const fetchSpy = mockFetch({ code: 0 });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await svc.testConnection("f1");
    expect(res.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("dingtalk 凭据无效时返回失败", async () => {
    const { svc } = makeService(
      { id: "d1", type: "dingtalk", engine: "golembot", credentials: { clientId: "x", clientSecret: "y" } },
      true,
    );
    vi.stubGlobal("fetch", mockFetch({ errcode: 40089, errmsg: "invalid appsecret" }));

    const res = await svc.testConnection("d1");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("invalid appsecret");
  });

  it("wecom 凭据无效时返回失败（即使 adapter 在运行）", async () => {
    const verify = vi.fn(async () => ({ ok: false, error: "Authentication failed: invalid secret (code: 40001)" }));
    const { svc, golemManager } = makeService(
      { id: "w1", type: "wecom", engine: "golembot", enabled: true, credentials: { botId: "b", secret: "s" } },
      /* isRunning */ true,
      verify,
    );
    const res = await svc.testConnection("w1");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("40001");
    expect(verify).toHaveBeenCalled();
    // enabled 渠道测试后应重建连接，恢复被临时连接踢掉的长连接
    expect(golemManager.restartChannel).toHaveBeenCalled();
  });

  it("wecom 凭据有效时返回成功", async () => {
    const verify = vi.fn(async () => ({ ok: true }));
    const { svc } = makeService(
      { id: "w1", type: "wecom", engine: "golembot", enabled: true, credentials: { botId: "b", secret: "s" } },
      false,
      verify,
    );
    const res = await svc.testConnection("w1");
    expect(res.ok).toBe(true);
    expect(verify).toHaveBeenCalled();
  });

  it("wecom 未启用渠道测试后不重建连接", async () => {
    const verify = vi.fn(async () => ({ ok: true }));
    const { svc, golemManager } = makeService(
      { id: "w1", type: "wecom", engine: "golembot", enabled: false, credentials: { botId: "b", secret: "s" } },
      false,
      verify,
    );
    await svc.testConnection("w1");
    expect(golemManager.restartChannel).not.toHaveBeenCalled();
  });

  it("testConnection 验证成功后更新 DB status 为 connected", async () => {
    const { svc } = makeService(
      { id: "f1", type: "feishu", engine: "golembot", credentials: { appId: "a", appSecret: "b" } },
      false,
    );
    vi.stubGlobal("fetch", mockFetch({ code: 0, tenant_access_token: "t" }));

    await svc.testConnection("f1");
    expect(svc.updateStatus).toHaveBeenCalledWith("f1", "connected");
  });

  it("testConnection 验证失败后更新 DB status 为 error", async () => {
    const { svc } = makeService(
      { id: "f1", type: "feishu", engine: "golembot", credentials: { appId: "x", appSecret: "y" } },
      false,
    );
    vi.stubGlobal("fetch", mockFetch({ code: 10003, msg: "invalid app_id" }));

    await svc.testConnection("f1");
    expect(svc.updateStatus).toHaveBeenCalledWith("f1", "error", expect.stringContaining("invalid app_id"));
  });

  it("restartChannelService 凭据有效时重建 adapter 并标记 connected", async () => {
    const { svc, golemManager } = makeService(
      { id: "f1", type: "feishu", engine: "golembot", enabled: true, credentials: { appId: "a", appSecret: "b" } },
      false,
    );
    vi.stubGlobal("fetch", mockFetch({ code: 0, tenant_access_token: "t" }));

    const res = await svc.restartChannelService("f1");
    expect(res.ok).toBe(true);
    expect(golemManager.restartChannel).toHaveBeenCalled();
    expect(svc.updateStatus).toHaveBeenCalledWith("f1", "connected");
  });

  it("restartChannelService 凭据失效时不重建 adapter 并标记 error", async () => {
    const { svc, golemManager } = makeService(
      { id: "f1", type: "feishu", engine: "golembot", enabled: true, credentials: { appId: "x", appSecret: "y" } },
      false,
    );
    vi.stubGlobal("fetch", mockFetch({ code: 10003, msg: "invalid app_id" }));

    const res = await svc.restartChannelService("f1");
    expect(res.ok).toBe(false);
    expect(golemManager.restartChannel).not.toHaveBeenCalled();
    expect(svc.updateStatus).toHaveBeenCalledWith("f1", "error", expect.stringContaining("invalid app_id"));
  });

  it("restartChannelService 对 wechat 渠道（无论 engine）走 golembot 路径", async () => {
    const { svc, golemManager } = makeService(
      { id: "w1", type: "wechat", engine: "golembot", enabled: true, credentials: { token: "test" } },
      false,
    );
    // wechat verifyCredentials 现在会真实探测 iLink getupdates：非 401 视为 token 有效
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200, json: async () => ({}) })) as any);
    const res = await svc.restartChannelService("w1");
    expect(res.ok).toBe(true);
    expect(res.engine).toBe("golembot");
    expect(golemManager.restartChannel).toHaveBeenCalled();
  });

  it("wechat token 失效（getupdates 401）时 restartChannelService 返回失败并停 adapter", async () => {
    const { svc, golemManager } = makeService(
      { id: "w1", type: "wechat", engine: "golembot", enabled: true, credentials: { token: "expired" } },
      false,
    );
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 401, json: async () => ({}) })) as any);
    const res = await svc.restartChannelService("w1");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("重新扫码");
    expect(golemManager.restartChannel).not.toHaveBeenCalled();
    expect(golemManager.stopChannel).toHaveBeenCalledWith("w1");
  });

  it("wechat session timeout（HTTP 200 + errcode -14）时判失效并停 adapter", async () => {
    // iLink token 失效返回 200 + body errcode，必须解析 body 而非只看 HTTP status
    const { svc, golemManager } = makeService(
      { id: "w1", type: "wechat", engine: "golembot", enabled: true, credentials: { token: "stale" } },
      false,
    );
    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      json: async () => ({ errcode: -14, errmsg: "session timeout" }),
    })) as any);
    const res = await svc.restartChannelService("w1");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("重新扫码");
    expect(res.error).toContain("session timeout");
    expect(golemManager.restartChannel).not.toHaveBeenCalled();
    expect(golemManager.stopChannel).toHaveBeenCalledWith("w1");
  });

  it("restartChannelService 凭据失效时停掉旧 adapter（状态与消息能力一致）", async () => {
    const { svc, golemManager } = makeService(
      { id: "f1", type: "feishu", engine: "golembot", enabled: true, credentials: { appId: "x", appSecret: "y" } },
      false,
    );
    vi.stubGlobal("fetch", mockFetch({ code: 10003, msg: "invalid app_id" }));

    await svc.restartChannelService("f1");
    expect(golemManager.stopChannel).toHaveBeenCalledWith("f1");
  });
});
