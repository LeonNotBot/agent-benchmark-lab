import { describe, it, expect, vi } from "vitest";
import { isLoopbackAddress, GatewayLoopbackMiddleware } from "./gateway-loopback.middleware";

describe("isLoopbackAddress", () => {
  it("接受 IPv4 回环整段 127.0.0.0/8", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("127.0.0.53")).toBe(true);
    expect(isLoopbackAddress("127.255.255.254")).toBe(true);
  });

  it("接受 IPv6 回环与 IPv4-mapped 回环", () => {
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.5")).toBe(true);
  });

  it("拒绝 LAN / 公网地址", () => {
    expect(isLoopbackAddress("192.168.1.10")).toBe(false);
    expect(isLoopbackAddress("10.0.0.4")).toBe(false);
    expect(isLoopbackAddress("172.16.5.6")).toBe(false);
    expect(isLoopbackAddress("8.8.8.8")).toBe(false);
    expect(isLoopbackAddress("::ffff:192.168.1.10")).toBe(false);
  });

  it("拒绝伪装前缀（127 不在地址起始即非回环）", () => {
    expect(isLoopbackAddress("8.127.0.1")).toBe(false);
    expect(isLoopbackAddress("1270.0.0.1")).toBe(false); // 不以 "127." 起始
    expect(isLoopbackAddress("foo127.0.0.1")).toBe(false);
  });

  it("空/undefined（socket 已销毁）按非回环拒绝", () => {
    expect(isLoopbackAddress(undefined)).toBe(false);
    expect(isLoopbackAddress("")).toBe(false);
  });
});

describe("GatewayLoopbackMiddleware", () => {
  const mw = new GatewayLoopbackMiddleware();
  const makeRes = () => {
    const res: any = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
  };

  it("回环对端 → next() 放行，不写响应", () => {
    const next = vi.fn();
    const res = makeRes();
    mw.use({ socket: { remoteAddress: "127.0.0.1" } } as any, res as any, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("非回环对端 → 403，不调 next()", () => {
    const next = vi.fn();
    const res = makeRes();
    mw.use({ socket: { remoteAddress: "192.168.1.20" } } as any, res as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: "forbidden_non_local" }) }),
    );
  });

  it("socket 缺失 remoteAddress → 拒绝（fail-closed）", () => {
    const next = vi.fn();
    const res = makeRes();
    mw.use({ socket: {} } as any, res as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
