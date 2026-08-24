import { Injectable, Inject, type OnModuleInit, type OnModuleDestroy, forwardRef } from "@nestjs/common";
import { existsSync } from "fs";
import type Database from "better-sqlite3";
import type { ChannelConfig, ChannelType, ChannelStatus } from "@lenovo/agent-protocol";
import {
  readAgentSettings as readLocalClawSettings,
  writeAgentSettings as writeLocalClawSettings,
} from "@lenovo/agent-sdk";
import { GolemChannelManager } from "./golem-channel-manager";
import { ChannelGatewayBridge } from "./channel.bridge";
import { ChatSessionService } from "./chat-session.service";
import { NetworkMonitorService, type NetworkHealthEvent } from "./network-monitor.service";
import { migrateChannels } from "./migration";
import { DATABASE } from "@lenovo/agent-sdk";

/** legacy daemon 时代写入 settings.json 的 channel MCP server key（现已废弃，需清理） */
const LEGACY_CHANNEL_MCP_KEYS = [
  "wechat-channel", "feishu-channel", "dingtalk-channel", "wecom-channel",
];

/** 归一化工作目录：把常见全角标点（冒号/反斜杠）转为半角，trim 首尾空白 */
function normalizeWorkspaceDir(dir: string): string {
  return dir
    .replace(/：/g, ":")   // 全角冒号 → 半角
    .replace(/＼/g, "\\")  // 全角反斜杠 → 半角
    .trim();
}

@Injectable()
export class ChannelService implements OnModuleInit, OnModuleDestroy {
  private readonly onNetworkStatus = (event: NetworkHealthEvent) => {
    this.handleNetworkRecovery(event);
  };

  constructor(
    @Inject(DATABASE)
    private readonly db: Database.Database,
    @Inject(forwardRef(() => GolemChannelManager))
    private readonly golemManager: GolemChannelManager,
    @Inject(ChannelGatewayBridge)
    private readonly bridge: ChannelGatewayBridge,
    @Inject(ChatSessionService)
    private readonly chatSessions: ChatSessionService,
    @Inject(NetworkMonitorService)
    private readonly monitor: NetworkMonitorService,
  ) {}

  onModuleInit(): void {
    // 清理 legacy daemon 时代残留的 channel MCP 配置：脚本已删除，留着会让
    // spawn 的 CLI 加载失败的 MCP server，并诱导模型调用已不存在的
    // mcp__wechat-channel__reply 等工具（报 "tool not found"）。
    this.cleanupLegacyChannelMcp();

    const channels = this.listChannels().filter((c) => c.enabled);
    for (const ch of channels) {
      if (ch.type === "wechat") {
        // 微信：已扫码登录（有凭据）则启动 golembot WeixinAdapter，
        // 未登录保持 disconnected，等扫码成功后由 WeChatService 启动。
        if (this.wechatLoggedIn(ch)) {
          this.startWithRetry(ch.id);
        } else {
          this.updateStatus(ch.id, "disconnected");
        }
      } else {
        this.startWithRetry(ch.id);
      }
    }
    if (channels.length) {
      console.log(`[channel-service] Initialized ${channels.length} channel(s)`);
    }

    // 网络恢复时重连：长时间离线（超出启动退避序列）后渠道停在 error，
    // 监听 network.status 在网络回到 online 时把 error 渠道重新拉起。
    this.monitor.on("network.status", this.onNetworkStatus);
  }

  onModuleDestroy(): void {
    this.monitor.off("network.status", this.onNetworkStatus);
  }

  /**
   * 网络从 offline/degraded 恢复 online 时，重启所有 enabled 且处于 error 的渠道。
   * startWithRetry 内置 isRunning / retrying 双重守卫，重复触发安全。
   */
  private handleNetworkRecovery(event: NetworkHealthEvent): void {
    if (event.status !== "online") return;
    const errored = this.listChannels().filter(
      (c) => c.enabled && c.status === "error" && !this.golemManager.isRunning(c.id),
    );
    if (!errored.length) return;
    console.log(`[channel-service] network recovered, reconnecting ${errored.length} channel(s)`);
    for (const ch of errored) {
      if (ch.type === "wechat" && !this.wechatLoggedIn(ch)) continue;
      this.startWithRetry(ch.id);
    }
  }

  /** 启动失败后的后台重连退避序列（毫秒）；耗尽后停在 error，等下次重试唤起 */
  private static readonly START_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000];
  /** 正在后台重连的渠道，避免同一渠道并发多条重试链 */
  private readonly retrying = new Set<string>();

  /**
   * 启动渠道 adapter，失败则按退避序列后台自动重连，直至成功或重试耗尽。
   * 解决冷启动瞬间 IM 长连接尚未就绪导致渠道被永久标 error、需手动重加的问题。
   */
  private startWithRetry(channelId: string, attempt = 0): void {
    if (attempt === 0) {
      if (this.retrying.has(channelId)) return;
      this.retrying.add(channelId);
    }
    // 每次重试都重新读取最新配置：期间用户可能改了凭据或禁用了渠道
    const ch = this.getChannel(channelId);
    if (!ch || !ch.enabled) {
      this.retrying.delete(channelId);
      return;
    }
    if (ch.type === "wechat" && !this.wechatLoggedIn(ch)) {
      this.retrying.delete(channelId);
      return;
    }
    // 重试等待期间用户可能已手动保存使其连上：adapter 已在跑则无需重复启动
    if (this.golemManager.isRunning(channelId)) {
      this.retrying.delete(channelId);
      this.updateStatus(channelId, "connected");
      return;
    }
    this.golemManager.startChannel(ch).then(
      () => {
        this.retrying.delete(channelId);
        this.updateStatus(channelId, "connected");
      },
      (err) => {
        const msg = String((err as Error)?.message ?? err);
        this.updateStatus(channelId, "error", msg);
        const delay = ChannelService.START_RETRY_DELAYS_MS[attempt];
        if (delay === undefined) {
          this.retrying.delete(channelId);
          console.error(`[channel] start failed for ${channelId}, retries exhausted: ${msg}`);
          return;
        }
        console.warn(
          `[channel] start failed for ${channelId} (attempt ${attempt + 1}), retry in ${delay}ms: ${msg}`,
        );
        const timer = setTimeout(() => this.startWithRetry(channelId, attempt + 1), delay);
        (timer as any).unref?.();
      },
    );
  }

  /** 微信是否已扫码登录：以 DB credentials.token 为唯一真相源 */
  private wechatLoggedIn(ch: ChannelConfig): boolean {
    return !!ch.credentials?.token;
  }

  /**
   * 清理 settings.json 中 legacy daemon 时代写入的 channel MCP server 条目。
   * 这些条目指向已删除的 *-channel-server.mjs 脚本，spawn 的 CLI 会加载失败，
   * 且历史会话 --resume 后模型仍会尝试调 mcp__wechat-channel__reply 报错。
   */
  private cleanupLegacyChannelMcp(): void {
    try {
      const settings = readLocalClawSettings();
      const servers = (settings.mcpServers ?? {}) as Record<string, unknown>;
      let changed = false;
      for (const key of LEGACY_CHANNEL_MCP_KEYS) {
        if (key in servers) {
          delete servers[key];
          changed = true;
          console.log(`[channel-service] Removed legacy MCP entry: ${key}`);
        }
      }
      if (changed) {
        settings.mcpServers = servers;
        writeLocalClawSettings(settings);
      }
    } catch (e) {
      console.warn(`[channel-service] cleanupLegacyChannelMcp failed: ${(e as Error)?.message}`);
    }
  }

  listChannels(): ChannelConfig[] {
    const rows = this.db.prepare("SELECT * FROM channels ORDER BY created_at DESC").all();
    const configs = (rows as any[]).map(this.rowToConfig);
    this.reconcileWechatStatus(configs);
    return configs;
  }

  /**
   * 微信渠道连接真相以 DB credentials.token 为准（每渠道独立）。
   * 有 token 且 adapter 正在运行 → connected；DB status 被各路径写乱时自愈对账。
   */
  private reconcileWechatStatus(configs: ChannelConfig[]): void {
    for (const ch of configs) {
      if (ch.type !== "wechat") continue;
      if (!ch.credentials?.token) continue;          // 无 token 不动（未登录）
      if (ch.status === "connected" || ch.status === "connecting") continue;
      if (!this.golemManager.isRunning(ch.id)) continue; // adapter 未跑则不强标 connected
      ch.status = "connected";
      ch.errorMessage = undefined;
      this.updateStatus(ch.id, "connected");
    }
  }

  getChannel(id: string): ChannelConfig | null {
    const row = this.db.prepare("SELECT * FROM channels WHERE id = ?").get(id);
    return row ? this.rowToConfig(row as any) : null;
  }

  /**
   * 列出某渠道下的所有会话（供侧边栏「渠道分组」展示）。
   * 会话与渠道的关联在 chat_sessions 表（chat_id + channel_id → session_key），
   * 这里 join sessions 取出会话元信息，按更新时间倒序。
   * 仅返回 kind in ('chat','cron')，与前端会话列表口径一致；session_key 为空（尚未首条消息）跳过。
   */
  listChannelSessions(channelId: string): Array<{
    id: string;
    title: string;
    status: string;
    cwd?: string;
    kind: string;
    createdAt: number;
    updatedAt: number;
    chatId: string;
  }> {
    const rows = this.db
      .prepare(
        `SELECT s.id, s.title, s.status, s.cwd, s.kind, s.created_at, s.updated_at, cs.chat_id
         FROM chat_sessions cs
         JOIN sessions s ON s.id = cs.session_key
         WHERE cs.channel_id = ? AND s.kind IN ('chat', 'cron')
         ORDER BY s.updated_at DESC`,
      )
      .all(channelId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      title: row.title ? String(row.title) : "",
      status: String(row.status),
      cwd: row.cwd ? String(row.cwd) : undefined,
      kind: row.kind ? String(row.kind) : "chat",
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      chatId: String(row.chat_id),
    }));
  }

  async saveChannel(data: Partial<ChannelConfig> & { type: ChannelType }): Promise<ChannelConfig> {
    // 归一化用户可能误输入的全角字符（如全角冒号 ：→: ），避免绑定路径异常
    if (data.workspaceDir) data.workspaceDir = normalizeWorkspaceDir(data.workspaceDir);
    // 工作目录兜底校验：前端虽改为文件夹选择，但选定到保存之间目录可能被删，
    // 或历史脏数据带着不存在的路径。此处校验存在性，避免保存「成功」却收不到回复
    // （不存在的 cwd 会让 CLI 无法在该目录运行，渠道收到消息后静默失败）。
    if (data.workspaceDir && !existsSync(data.workspaceDir)) {
      throw new Error(`工作目录不存在：${data.workspaceDir}`);
    }
    const now = Date.now();
    if (data.id) {
      return this.updateChannel(data.id, data);
    }
    const id = crypto.randomUUID();
    const config: ChannelConfig = {
      id,
      type: data.type,
      name: data.name || data.type,
      enabled: data.enabled ?? true,
      credentials: data.credentials || {},
      status: "disconnected",
      createdAt: now,
      updatedAt: now,
      engine: "golembot",
      workspaceDir: data.workspaceDir ?? "",
    };
    this.db.prepare(
      `INSERT INTO channels (id, type, name, enabled, credentials, status, engine, workspace_dir, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      config.id, config.type, config.name,
      config.enabled ? 1 : 0,
      JSON.stringify(config.credentials),
      config.status, config.engine, config.workspaceDir,
      config.createdAt, config.updatedAt,
    );
    this.bridge.emitChannelSaved(config);
    if (config.type === "wechat") {
      if (config.enabled && this.wechatLoggedIn(config)) {
        await this.golemManager.startChannel(config).then(
          () => { this.updateStatus(config.id, "connected"); config.status = "connected"; },
          (err) => {
            const msg = String((err as Error)?.message ?? err);
            this.updateStatus(config.id, "error", msg);
            config.status = "error"; config.errorMessage = msg;
          },
        );
      }
    } else if (config.enabled) {
      const result = await this.verifyCredentials(config);
      if (!result.ok) {
        this.updateStatus(config.id, "error", result.error);
        config.status = "error";
        config.errorMessage = result.error;
        return config;
      }
      try {
        await this.golemManager.startChannel(config);
        this.updateStatus(config.id, "connected");
        config.status = "connected";
      } catch (err) {
        const msg = String((err as Error)?.message ?? err);
        console.error(`[channel] start failed: ${msg}`);
        this.updateStatus(config.id, "error", msg);
        config.status = "error";
        config.errorMessage = msg;
      }
    }
    return config;
  }

  private async updateChannel(id: string, data: Partial<ChannelConfig>): Promise<ChannelConfig> {
    const existing = this.getChannel(id);
    if (!existing) throw new Error(`Channel ${id} not found`);
    const now = Date.now();
    // credentials 深合并：以 existing 为基础叠加 data，防止前端提交的 credentials
    // （不含后端扫码写入的 token）整体覆盖掉 DB 已有 token，导致 verifyCredentials 误判未登录。
    const credentials = data.credentials
      ? { ...existing.credentials, ...data.credentials }
      : existing.credentials;
    // 微信 token 是后端扫码写入的唯一真相源：前端表单持有的可能是扫码前的旧（失效）
    // token，WS 同步新 token 前用户若点保存，浅合并会让旧 token 覆盖 DB 新 token →
    // verifyCredentials 拿旧 token 探测报 session timeout（随后 WS 同步又自愈，表现为
    // 「保存报错、几秒后自动恢复」）。故微信强制以 DB token 为准，忽略前端提交的 token。
    if (existing.type === "wechat" && existing.credentials?.token) {
      credentials.token = existing.credentials.token;
    }
    const updated: ChannelConfig = {
      ...existing,
      ...data,
      credentials,
      id,
      updatedAt: now,
    };
    // engine 兜底：所有渠道统一 golembot。绝不允许前端把已有渠道改成 legacy
    // （legacy 会让 GolemChannelManager.startChannel 直接 return，adapter 永不启动）。
    if (updated.engine !== "golembot") updated.engine = "golembot";
    this.db.prepare(
      `UPDATE channels SET name=?, enabled=?, credentials=?, status=?, engine=?, workspace_dir=?, updated_at=? WHERE id=?`
    ).run(
      updated.name, updated.enabled ? 1 : 0,
      JSON.stringify(updated.credentials),
      updated.status, updated.engine ?? "golembot", updated.workspaceDir ?? "",
      updated.updatedAt, id,
    );
    // 同步更新 chat_sessions 中该渠道所有会话绑定的工作目录，否则 resolve() 仍返回旧路径
    if (data.workspaceDir !== undefined) {
      this.chatSessions.updateByChannelId(id, data.workspaceDir);
    }
    // 发事件让前端 channels 数组同步更新（含 credentials.token 等所有字段）
    this.bridge.emitChannelSaved(updated);

    if (updated.type === "wechat") {
      if (updated.enabled) {
        const result = await this.verifyCredentials(updated);
        if (!result.ok) {
          await this.golemManager.stopChannel(updated.id).catch(() => {});
          this.updateStatus(updated.id, "error", result.error);
          updated.status = "error"; updated.errorMessage = result.error;
          return updated;
        }
        try {
          await this.golemManager.restartChannel(updated);
          this.updateStatus(updated.id, "connected");
          updated.status = "connected";
        } catch (err) {
          const msg = String((err as Error)?.message ?? err);
          this.updateStatus(updated.id, "error", msg);
          updated.status = "error"; updated.errorMessage = msg;
        }
      } else {
        await this.golemManager.stopChannel(updated.id).catch(() => {});
        this.updateStatus(updated.id, "disconnected");
        updated.status = "disconnected";
      }
    } else {
      const result = await this.verifyCredentials(updated);
      if (!result.ok) {
        await this.golemManager.stopChannel(updated.id).catch((err) => {
          console.error(`[channel] stop after verify-fail failed: ${err}`);
        });
        this.updateStatus(updated.id, "error", result.error);
        updated.status = "error"; updated.errorMessage = result.error;
        return updated;
      }
      try {
        await this.golemManager.restartChannel(updated);
        this.updateStatus(updated.id, "connected");
        updated.status = "connected";
      } catch (err) {
        const msg = String((err as Error)?.message ?? err);
        console.error(`[channel] restart failed: ${msg}`);
        this.updateStatus(updated.id, "error", msg);
        updated.status = "error"; updated.errorMessage = msg;
      }
    }
    return updated;
  }

  deleteChannel(id: string): boolean {
    const channel = this.getChannel(id);
    if (!channel) return false;
    this.golemManager.stopChannel(id).catch(() => {});
    this.db.prepare("DELETE FROM channels WHERE id = ?").run(id);
    return true;
  }

  /**
   * 清空微信渠道的 DB token（仅供重新扫码登录前调用）。
   * 直接写库 + 发 channel.saved，**不跑** verifyCredentials/restart 副作用——
   * 重新登录场景下旧 token 已失效，跑校验只会把渠道标 error 并发出与随后
   * channel.qrcode 交错的多余状态事件，干扰前端二维码展示。
   */
  clearWechatToken(id: string): ChannelConfig | null {
    const ch = this.getChannel(id);
    if (!ch || ch.type !== "wechat") return null;
    const credentials = { ...ch.credentials };
    delete credentials.token;
    const now = Date.now();
    this.db.prepare(
      "UPDATE channels SET credentials=?, status=?, error_message=?, updated_at=? WHERE id=?",
    ).run(JSON.stringify(credentials), "connecting", null, now, id);
    const updated: ChannelConfig = { ...ch, credentials, status: "connecting", errorMessage: undefined, updatedAt: now };
    this.bridge.emitChannelSaved(updated);
    return updated;
  }

  async toggleChannel(id: string, enabled: boolean): Promise<ChannelConfig | null> {
    const ch = this.getChannel(id);
    if (!ch) return null;
    return this.updateChannel(id, { enabled });
  }

  updateStatus(id: string, status: ChannelStatus, errorMessage?: string): void {
    this.db.prepare(
      "UPDATE channels SET status=?, error_message=?, updated_at=? WHERE id=?"
    ).run(status, errorMessage ?? null, Date.now(), id);
    this.bridge.emitChannelStatus(id, status, errorMessage);
  }

  migrate(): { updated: number } {
    const result = migrateChannels(this.db);
    for (const ch of this.listChannels().filter((c) => c.enabled)) {
      if (ch.engine === "golembot") {
        this.golemManager.restartChannel(ch).then(
          () => this.updateStatus(ch.id, "connected"),
          (err) => {
            console.error(`[channel] migrate restart failed for ${ch.id}: ${err}`);
            this.updateStatus(ch.id, "error", String(err?.message ?? err));
          },
        );
      }
    }
    return result;
  }

  async verifyCredentials(channel: ChannelConfig): Promise<{ ok: boolean; error?: string }> {
    if (channel.type === "wecom") {
      return this.golemManager.verifyWecomConnection(channel);
    }
    const creds = channel.credentials;
    try {
      switch (channel.type) {
        case "feishu": return this.testFeishu(creds);
        case "dingtalk": return this.testDingtalk(creds);
        case "wechat": return this.testWeixin(creds);
        default: return { ok: false, error: `Unsupported type: ${channel.type}` };
      }
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  async testConnection(id: string): Promise<{ ok: boolean; error?: string }> {
    const channel = this.getChannel(id);
    if (!channel) return { ok: false, error: "Channel not found" };
    if (channel.type === "wecom") {
      const result = await this.golemManager.verifyWecomConnection(channel);
      if (channel.enabled) {
        this.golemManager.restartChannel(channel).catch((err) => {
          console.error(`[channel] wecom restart after test failed: ${err}`);
        });
      }
      if (result.ok) this.updateStatus(id, "connected");
      else this.updateStatus(id, "error", result.error);
      return result;
    }
    const res = await this.verifyCredentials(channel);
    if (res.ok) this.updateStatus(id, "connected");
    else this.updateStatus(id, "error", res.error);
    return res;
  }

  async restartChannelService(id: string): Promise<{ ok: boolean; error?: string; engine: string }> {
    const channel = this.getChannel(id);
    if (!channel) return { ok: false, error: "Channel not found", engine: "unknown" };
    const result = await this.verifyCredentials(channel);
    if (!result.ok) {
      await this.golemManager.stopChannel(id).catch((err) => {
        console.error(`[channel] stop after verify-fail failed: ${err}`);
      });
      this.updateStatus(id, "error", result.error);
      return { ok: false, error: result.error, engine: "golembot" };
    }
    if (!channel.enabled) {
      this.updateStatus(id, "disconnected");
      return { ok: true, engine: "golembot" };
    }
    try {
      await this.golemManager.restartChannel(channel);
      this.updateStatus(id, "connected");
      return { ok: true, engine: "golembot" };
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      console.error(`[channel] restart service failed: ${msg}`);
      this.updateStatus(id, "error", msg);
      return { ok: false, error: msg, engine: "golembot" };
    }
  }

  private async testFeishu(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    const { appId, appSecret } = creds;
    if (!appId || !appSecret) return { ok: false, error: "缺少 App ID 或 App Secret" };
    const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const data = await res.json() as { code: number; msg?: string };
    if (data.code !== 0) return { ok: false, error: data.msg || `错误码: ${data.code}` };
    return { ok: true };
  }

  private async testDingtalk(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    const { clientId, clientSecret } = creds;
    if (!clientId || !clientSecret) return { ok: false, error: "缺少 Client ID 或 Client Secret" };
    const res = await fetch("https://oapi.dingtalk.com/gettoken?appkey=" + clientId + "&appsecret=" + clientSecret);
    const data = await res.json() as { errcode: number; errmsg?: string };
    if (data.errcode !== 0) return { ok: false, error: data.errmsg || `错误码: ${data.errcode}` };
    return { ok: true };
  }

  /**
   * 真实校验微信 iLink token 有效性。
   *
   * 微信凭据是扫码拿到的 bot_token（会过期），不同于飞书/钉钉/企微的永久应用凭据。
   * 历史实现只检查 token 字段「存不存在」，token 失效后仍返回 ok=true，导致
   * 重启/验证/编辑全部假阳性标 connected，而 pollLoop 一拉 getupdates 就吃失败
   * 静默空转 —— 表现为「绿点却无任何回复」，唯有删除重加重新扫码才恢复。
   *
   * 关键：iLink token 失效**不是返回 HTTP 401**，而是 **HTTP 200 + body
   * `{errcode:-14, errmsg:"session timeout"}`**（实测）。故必须解析 body 按
   * errcode 判定，不能只看 HTTP status。
   * - errcode 非 0（如 -14 session timeout / 鉴权失败）→ token 失效，引导重新扫码；
   * - HTTP 401 → 同样判失效；
   * - 其它网络/超时错误 → 不武断判失效（避免抖动误杀），按有效放行交给 adapter；
   * - errcode 0 或缺省 → token 有效。
   * 传空 get_updates_buf，不推进游标、不消费消息，对在跑的轮询无副作用。
   */
  private async testWeixin(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    const token = creds?.token;
    if (!token) return { ok: false, error: "未扫码登录，请在微信 Channel 设置页面扫码" };
    const base = (creds.baseUrl || "https://ilinkai.weixin.qq.com").replace(/\/$/, "");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const reLogin = "微信登录已失效，请在微信 Channel 设置页面重新扫码登录";
    try {
      const res = await fetch(`${base}/ilink/bot/getupdates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          AuthorizationType: "ilink_bot_token",
          Authorization: `Bearer ${token}`,
          "X-WECHAT-UIN": String(Math.floor(Math.random() * 1_000_000_000)),
        },
        body: JSON.stringify({ get_updates_buf: "", base_info: { channel_version: "0.1.0" } }),
        signal: controller.signal,
      });
      if (res.status === 401) return { ok: false, error: reLogin };
      // iLink 失效返回 200 + errcode（如 -14 session timeout），必须解析 body
      const data = (await res.json().catch(() => ({}))) as { errcode?: number; errmsg?: string };
      if (typeof data.errcode === "number" && data.errcode !== 0) {
        return { ok: false, error: `${reLogin}（${data.errmsg || data.errcode}）` };
      }
      return { ok: true };
    } catch {
      // 网络抖动/超时不判失效：避免误杀有效 token，交由 adapter 自身退避重试
      return { ok: true };
    } finally {
      clearTimeout(timer);
    }
  }

  private async testWecom(creds: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
    const { botId, secret } = creds;
    if (!botId || !secret) return { ok: false, error: "缺少 Bot ID 或 Secret" };
    return { ok: true };
  }

  private rowToConfig(row: any): ChannelConfig {
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      enabled: row.enabled === 1,
      credentials: JSON.parse(row.credentials || "{}"),
      status: (row.status as ChannelStatus) || "disconnected",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      engine: (row.engine as "golembot" | "legacy") || "golembot",
      workspaceDir: row.workspace_dir || "",
      errorMessage: row.error_message || undefined,
    };
  }
}
