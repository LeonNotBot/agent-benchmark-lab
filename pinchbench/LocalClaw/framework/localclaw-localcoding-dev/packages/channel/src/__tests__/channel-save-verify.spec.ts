import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runSdkMigrations } from "@lenovo/agent-sdk";
import { runChannelMigrations } from "../channel-migrations";
import { ChannelService } from "../channel.service";

/**
 * 回归测试：保存渠道时若凭据校验失败，必须停掉进程内仍在运行的旧 adapter，
 * 否则旧凭据长连接会继续收发 IM 消息 —— 状态显示「错误」但消息照常接收，
 * 造成凭据验证机制与消息收发功能不一致。
 */
describe("ChannelService.saveChannel 校验失败时停旧 adapter", () => {
  function makeDb(): Database.Database {
    const db = new Database(":memory:");
    runSdkMigrations(db);
    runChannelMigrations(db);
    return db;
  }

  function makeGolem() {
    return {
      isRunning: vi.fn(() => true),
      verifyWecomConnection: vi.fn(async () => ({ ok: true })),
      restartChannel: vi.fn(async () => {}),
      startChannel: vi.fn(async () => {}),
      stopChannel: vi.fn(async () => {}),
    };
  }

  const bridge = { emitChannelStatus: vi.fn(), emitChannelSaved: vi.fn() };

  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("更新已连接 feishu 渠道为错误凭据时，调用 stopChannel 并标记 error", async () => {
    const db = makeDb();
    const golem = makeGolem();
    const svc = new ChannelService(db as any, golem as any, bridge as any, { updateByChannelId: vi.fn() } as any, { on: vi.fn(), off: vi.fn() } as any);

    // 先用有效凭据建立渠道（校验通过 → startChannel）
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ code: 0, tenant_access_token: "t" }) })) as any);
    const created = await svc.saveChannel({
      type: "feishu",
      name: "测试飞书",
      enabled: true,
      credentials: { appId: "good", appSecret: "good" },
    });
    expect(created.status).toBe("connected");
    expect(golem.startChannel).toHaveBeenCalled();

    // 改成错误凭据保存（校验失败 → 必须 stopChannel）
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ code: 10003, msg: "invalid app_id" }) })) as any);
    const updated = await svc.saveChannel({
      id: created.id,
      type: "feishu",
      name: "测试飞书",
      enabled: true,
      credentials: { appId: "bad", appSecret: "bad" },
    });

    expect(updated.status).toBe("error");
    expect(updated.errorMessage).toContain("invalid app_id");
    expect(golem.stopChannel).toHaveBeenCalledWith(created.id);
    // DB 中状态也应为 error
    const fromDb = svc.getChannel(created.id);
    expect(fromDb?.status).toBe("error");
  });
});

/**
 * 回归测试：saveChannel（INSERT/UPDATE）后必须触发 emitChannelSaved 事件，
 * 让前端 channels 数组同步 credentials.token 等字段。
 * 否则 wechatBound=!!credentials.token 判断永远为 false，导致扫码绑定后
 * 点保存仍报错「请先完成扫码绑定」。
 */
describe("ChannelService.saveChannel 触发 emitChannelSaved", () => {
  function makeDb(): Database.Database {
    const db = new Database(":memory:");
    runSdkMigrations(db);
    runChannelMigrations(db);
    return db;
  }

  function makeBridge() {
    return {
      emitChannelStatus: vi.fn(),
      emitChannelSaved: vi.fn(),
    };
  }

  function makeGolem() {
    return {
      isRunning: vi.fn(() => false),
      verifyWecomConnection: vi.fn(async () => ({ ok: true })),
      restartChannel: vi.fn(async () => {}),
      startChannel: vi.fn(async () => {}),
      stopChannel: vi.fn(async () => {}),
    };
  }

  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("INSERT 新渠道后触发 emitChannelSaved，payload 含完整渠道数据", async () => {
    const db = makeDb();
    const bridge = makeBridge();
    const golem = makeGolem();
    const svc = new ChannelService(db as any, golem as any, bridge as any, { updateByChannelId: vi.fn() } as any, { on: vi.fn(), off: vi.fn() } as any);

    const created = await svc.saveChannel({
      type: "wechat",
      name: "测试微信",
      enabled: true,
      credentials: { token: "abc123", baseUrl: "https://ilinkai.weixin.qq.com" },
    });

    expect(bridge.emitChannelSaved).toHaveBeenCalledTimes(1);
    const savedChannel = (bridge.emitChannelSaved as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(savedChannel.id).toBe(created.id);
    expect(savedChannel.type).toBe("wechat");
    expect(savedChannel.credentials.token).toBe("abc123");
    expect(savedChannel.credentials.baseUrl).toBe("https://ilinkai.weixin.qq.com");
  });

  it("UPDATE 渠道 credentials 后触发 emitChannelSaved，payload 含新 token", async () => {
    const db = makeDb();
    const bridge = makeBridge();
    const golem = makeGolem();
    const svc = new ChannelService(db as any, golem as any, bridge as any, { updateByChannelId: vi.fn() } as any, { on: vi.fn(), off: vi.fn() } as any);

    // 先建一个无 token 的草稿渠道
    const draft = await svc.saveChannel({
      type: "wechat",
      name: "微信草稿",
      enabled: true,
      credentials: {},
    });
    expect(draft.credentials.token).toBeUndefined();

    // 扫码成功后用新 token 更新（updateChannel 会真实探测 iLink，stub 为非 401）
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200, json: async () => ({}) })) as any);
    bridge.emitChannelSaved.mockClear();
    const updated = await svc.saveChannel({
      id: draft.id,
      type: "wechat",
      enabled: true,
      credentials: { token: "new_token_xyz", baseUrl: "https://ilinkai.weixin.qq.com" },
    });

    expect(updated.credentials.token).toBe("new_token_xyz");
    expect(bridge.emitChannelSaved).toHaveBeenCalledTimes(1);
    const savedChannel = (bridge.emitChannelSaved as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(savedChannel.credentials.token).toBe("new_token_xyz");
  });

  it("UPDATE 非 credentials 字段也触发 emitChannelSaved（前端需要完整同步）", async () => {
    const db = makeDb();
    const bridge = makeBridge();
    const golem = makeGolem();
    const svc = new ChannelService(db as any, golem as any, bridge as any, { updateByChannelId: vi.fn() } as any, { on: vi.fn(), off: vi.fn() } as any);

    const created = await svc.saveChannel({
      type: "feishu",
      name: "原名",
      enabled: true,
      credentials: { appId: "a", appSecret: "b" },
    });

    bridge.emitChannelSaved.mockClear();
    const updated = await svc.saveChannel({
      id: created.id,
      type: "feishu",
      name: "新名",
      enabled: true,
      credentials: { appId: "a", appSecret: "b" },
    });

    expect(updated.name).toBe("新名");
    expect(bridge.emitChannelSaved).toHaveBeenCalledTimes(1);
  });

  it("微信 UPDATE 时前端提交的 stale token 不得覆盖 DB 新 token", async () => {
    const db = makeDb();
    const bridge = makeBridge();
    const golem = makeGolem();
    const svc = new ChannelService(db as any, golem as any, bridge as any, { updateByChannelId: vi.fn() } as any, { on: vi.fn(), off: vi.fn() } as any);

    // 扫码前：渠道带旧（失效）token
    const created = await svc.saveChannel({
      type: "wechat", name: "微信", enabled: true,
      credentials: { token: "OLD_STALE", baseUrl: "https://ilinkai.weixin.qq.com" },
    });
    // 模拟扫码成功：后端 confirmed 分支直接写入新 token（绕过前端）
    (svc as any).db.prepare("UPDATE channels SET credentials=? WHERE id=?")
      .run(JSON.stringify({ token: "NEW_FRESH", baseUrl: "https://ilinkai.weixin.qq.com" }), created.id);

    // 前端用扫码前的 stale token 提交保存（WS 新 token 尚未同步到表单）
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200, json: async () => ({}) })) as any);
    const updated = await svc.saveChannel({
      id: created.id, type: "wechat", enabled: true,
      credentials: { token: "OLD_STALE", baseUrl: "https://ilinkai.weixin.qq.com" },
    });

    // DB 新 token 必须保留，不被前端 stale token 覆盖
    expect(updated.credentials.token).toBe("NEW_FRESH");
    expect(svc.getChannel(created.id)?.credentials.token).toBe("NEW_FRESH");
  });
});

/**
 * 回归测试：保存渠道时若 workspaceDir 填了但磁盘上不存在，必须抛错而非静默保存成功。
 * 不存在的 cwd 会让 CLI 无法在该目录运行 —— 渠道显示「保存成功」却收不到任何回复。
 */
describe("ChannelService.saveChannel 工作目录存在性校验", () => {
  function makeDb(): Database.Database {
    const db = new Database(":memory:");
    runSdkMigrations(db);
    runChannelMigrations(db);
    return db;
  }
  function makeGolem() {
    return {
      isRunning: vi.fn(() => false),
      verifyWecomConnection: vi.fn(async () => ({ ok: true })),
      restartChannel: vi.fn(async () => {}),
      startChannel: vi.fn(async () => {}),
      stopChannel: vi.fn(async () => {}),
    };
  }
  const bridge = { emitChannelStatus: vi.fn(), emitChannelSaved: vi.fn() };

  beforeEach(() => { vi.restoreAllMocks(); });

  it("workspaceDir 不存在时抛错，且不写库", async () => {
    const db = makeDb();
    const svc = new ChannelService(db as any, makeGolem() as any, bridge as any, { updateByChannelId: vi.fn() } as any, { on: vi.fn(), off: vi.fn() } as any);
    await expect(svc.saveChannel({
      type: "feishu", name: "坏目录", enabled: true,
      credentials: { appId: "a", appSecret: "b" },
      workspaceDir: "Z:/this/does/not/exist/12345",
    })).rejects.toThrow(/工作目录不存在/);
    expect(svc.listChannels()).toHaveLength(0);
  });

  it("workspaceDir 指向真实目录时正常保存", async () => {
    const db = makeDb();
    const svc = new ChannelService(db as any, makeGolem() as any, bridge as any, { updateByChannelId: vi.fn() } as any, { on: vi.fn(), off: vi.fn() } as any);
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ code: 0, tenant_access_token: "t" }) })) as any);
    const created = await svc.saveChannel({
      type: "feishu", name: "好目录", enabled: true,
      credentials: { appId: "a", appSecret: "b" },
      workspaceDir: process.cwd(),
    });
    expect(created.workspaceDir).toBe(process.cwd());
    vi.unstubAllGlobals();
  });
});
