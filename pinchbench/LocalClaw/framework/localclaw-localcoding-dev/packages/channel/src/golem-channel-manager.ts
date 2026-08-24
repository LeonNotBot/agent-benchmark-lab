import { Inject, Injectable, Logger } from "@nestjs/common";
import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { ChannelAdapter, ChannelMessage } from "golembot";
import { handleMessage } from "golembot/dist/gateway.js";
import type { ChannelConfig } from "@lenovo/agent-protocol";
import { RunnerService, DATABASE } from "@lenovo/agent-sdk";
import { SessionService } from "@lenovo/agent-sdk";
import { ROUTING_SERVICE, type IRoutingService } from "@lenovo/agent-sdk";
import type Database from "better-sqlite3";
import { ChannelAssistant } from "./channel-assistant";
import { ChatSessionService } from "./chat-session.service";
import { MessageRecordService } from "./message-record.service";
import { ChannelGatewayBridge } from "./channel.bridge";
import { NetworkMonitorService } from "./network-monitor.service";
import { buildDefaultGolemConfig } from "./golem-config";
import { getAgentConfigDir } from "@lenovo/agent-sdk";

export type AdapterFactory = (channel: ChannelConfig) => ChannelAdapter | null;

@Injectable()
export class GolemChannelManager {
  private readonly logger = new Logger(GolemChannelManager.name);
  private readonly adapters = new Map<string, ChannelAdapter>();
  private readonly assistants = new Map<string, ChannelAssistant>();

  constructor(
    @Inject(RunnerService) private readonly runner: RunnerService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(ChatSessionService) private readonly chatSessions: ChatSessionService,
    @Inject(MessageRecordService) private readonly messageRecord: MessageRecordService,
    @Inject(ChannelGatewayBridge) private readonly bridge: ChannelGatewayBridge,
    @Inject("ADAPTER_FACTORY") private readonly factory: AdapterFactory,
    @Inject(NetworkMonitorService) private readonly monitor: NetworkMonitorService,
    @Inject(ROUTING_SERVICE) private readonly routing: IRoutingService,
    @Inject(DATABASE) private readonly db: Database.Database,
  ) {}

  async startChannel(channel: ChannelConfig): Promise<void> {
    if (channel.engine === "legacy") return;
    if (this.adapters.has(channel.id)) await this.stopChannel(channel.id);

    const adapter = this.factory(channel);
    if (!adapter) {
      this.logger.warn(
        `No adapter for type=${channel.type} (channel=${channel.id})`,
      );
      return;
    }

    const assistant = new ChannelAssistant(
      this.runner,
      this.sessions,
      this.chatSessions,
      channel.id,
      (msg, text) => this.replyAndRecord(channel, adapter, msg, text),
      () => this.monitor.checkNow(),
      this.routing,
      this.bridge,
    );
    this.assistants.set(channel.id, assistant);

    const golemConfig = buildDefaultGolemConfig({ botName: channel.name, channelType: channel.type });
    const dir = getAgentConfigDir();

    await adapter.start(
      this.makeOnMessage(channel, adapter, assistant, golemConfig, dir),
    );

    // 微信 wrapper：pollLoop 因 token 失效静默死亡时，如实把状态翻成 error
    // （而非停留在假阳性 connected），并停掉死 adapter。失效 token 重连只会刷
    // 401，故不重连，等用户重新扫码 —— 由 verifyCredentials 真实校验后拉起。
    const pollAware = adapter as ChannelAdapter & {
      setPollDeadHandler?: (cb: () => void) => void;
    };
    pollAware.setPollDeadHandler?.(() => this.handleWeixinPollDead(channel));

    this.adapters.set(channel.id, adapter);
    this.logger.log(`Adapter started: ${channel.type} (${channel.id})`);
  }

  /** 微信 pollLoop 静默死亡（token 失效）处理：停 adapter + 标 error + 通知前端 */
  private handleWeixinPollDead(channel: ChannelConfig): void {
    const msg = "微信登录已失效，请在微信 Channel 设置页面重新扫码登录";
    this.logger.warn(`weixin pollLoop dead for ${channel.id}: ${msg}`);
    void this.stopChannel(channel.id);
    try {
      this.db
        .prepare("UPDATE channels SET status=?, error_message=?, updated_at=? WHERE id=?")
        .run("error", msg, Date.now(), channel.id);
    } catch (err) {
      this.logger.warn(`failed to persist weixin poll-dead status: ${err}`);
    }
    this.bridge.emitChannelStatus(channel.id, "error", msg);
  }

  async stopChannel(channelId: string): Promise<void> {
    const adapter = this.adapters.get(channelId);
    if (adapter) {
      try {
        await adapter.stop();
      } catch (err) {
        this.logger.warn(`stop failed: ${err}`);
      }
      this.adapters.delete(channelId);
    }
    this.assistants.delete(channelId);
  }

  async restartChannel(channel: ChannelConfig): Promise<void> {
    await this.stopChannel(channel.id);
    if (channel.enabled) await this.startChannel(channel);
  }

  async stopAll(): Promise<void> {
    for (const id of Array.from(this.adapters.keys())) {
      await this.stopChannel(id);
    }
  }

  isRunning(channelId: string): boolean {
    return this.adapters.has(channelId);
  }

  /**
   * 真实校验企业微信凭据：企业微信没有 HTTP 认证接口，只能通过 WebSocket
   * 认证帧校验 botId/secret。@wecom/aibot-node-sdk 的 WSClient 在 TCP 连接
   * 建立后才异步发送认证帧，认证成功 emit 'authenticated'、失败 emit 'error'，
   * 因此不能只看 adapter.start() 是否 resolve（乱填凭据 TCP 照样连上）。
   *
   * 这里用临时 adapter 建立一次连接，等待认证事件判定凭据真假，随后立即断开。
   * 注意：企业微信同一 bot 单长连接，临时连接可能踢掉正在运行的连接，调用方
   * 需在测试结束后对 enabled 渠道重建连接（见 ChannelService.testConnection）。
   */
  async verifyWecomConnection(channel: ChannelConfig): Promise<{ ok: boolean; error?: string }> {
    const adapter = this.factory(channel);
    if (!adapter) return { ok: false, error: "缺少 Bot ID 或 Secret" };
    try {
      await adapter.start(() => { /* 测试连接，不处理消息 */ });
      const wsClient = (adapter as any).wsClient;
      if (!wsClient) return { ok: false, error: "连接未建立" };
      return await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        const timer = setTimeout(() => resolve({ ok: false, error: "认证超时" }), 10000);
        wsClient.once("authenticated", () => {
          clearTimeout(timer);
          resolve({ ok: true });
        });
        wsClient.once("error", (err: unknown) => {
          clearTimeout(timer);
          resolve({ ok: false, error: String((err as Error)?.message ?? err) });
        });
      });
    } catch (err) {
      return { ok: false, error: String((err as Error)?.message ?? err) };
    } finally {
      await adapter.stop().catch(() => { /* best-effort */ });
    }
  }

  /**
   * 返回所有已启动的飞书 adapter（type=feishu），用于批量通知。
   */
  getAllFeishuAdapters(): ChannelAdapter[] {
    return Array.from(this.adapters.values()).filter(
      (a) => a.name === "feishu",
    );
  }

  private makeOnMessage(
    channel: ChannelConfig,
    adapter: ChannelAdapter,
    assistant: ChannelAssistant,
    golemConfig: ReturnType<typeof buildDefaultGolemConfig>,
    dir: string,
  ): (msg: ChannelMessage) => Promise<void> {
    return async (msg: ChannelMessage) => {
      console.log(`[golem-channel-manager] onMessage: channel=${channel.type} chatId=${msg.chatId} senderId=${msg.senderId} text="${msg.text?.slice(0, 100)}" images=${msg.images?.length ?? 0} files=${msg.files?.length ?? 0}`);

      // 记录 incoming 消息（非阻塞，失败不影响主流程）
      try {
        this.messageRecord.recordIncoming({
          channelId: channel.id,
          channelType: channel.type,
          chatId: msg.chatId,
          senderId: msg.senderId,
          content: msg.text || "",
          engine: "golembot",
          images: msg.images,
          files: msg.files,
        });
      } catch (err) {
        this.logger.warn(`Failed to record incoming message: ${err}`);
      }

      const binding = this.chatSessions.resolve(msg.chatId, channel.id);
      console.log(`[golem-channel-manager] binding resolve: chatId=${msg.chatId} channel.id=${channel.id} found=${!!binding}`);

      const bindMatch = msg.text.trim().match(/^\/bind\s+(.+)$/);
      if (bindMatch) {
        const path = bindMatch[1].trim();
        const error = this.validateWorkspacePath(path);
        if (error) {
          console.warn(`[golem-channel-manager] /bind rejected: chatId=${msg.chatId} path="${path}" reason=${error}`);
          await this.replyAndRecord(channel, adapter, msg, error);
          return;
        }
        this.chatSessions.bind(msg.chatId, channel.id, path);
        await this.replyAndRecord(channel, adapter, msg, `Workspace bound: ${path}`);
        return;
      }

      if (!binding && channel.workspaceDir) {
        console.log(`[golem-channel-manager] Auto-binding chatId=${msg.chatId} to workspaceDir="${channel.workspaceDir}"`);
        this.chatSessions.bind(msg.chatId, channel.id, channel.workspaceDir);
      } else if (binding && channel.workspaceDir && binding.workspaceDir !== channel.workspaceDir) {
        // 工作目录漂移自愈：UI 配置的 channel.workspaceDir 是唯一真相源（重启后闭包已是最新值），
        // 但历史绑定 chat_sessions.workspace_dir 仍是旧值。这里无条件以 channel 配置为准刷新，
        // 使「UI 改工作目录」对历史会话也立即生效，无需用户重新保存或重新 /bind。
        // re-bind 更新 chat_sessions.workspace_dir 后，下游 setupRunner 复用 session 时会检测
        // session.cwd 变化 → 同步 cwd + 清空 claudeSessionId（见 channel-assistant.setupRunner）。
        console.log(`[golem-channel-manager] workspaceDir drift: binding="${binding.workspaceDir}" -> channel="${channel.workspaceDir}", re-binding`);
        this.chatSessions.bind(msg.chatId, channel.id, channel.workspaceDir);
      } else if (!binding) {
        await this.replyAndRecord(
          channel, adapter, msg,
          "请先用 `/bind <绝对路径>` 绑定工作目录",
        );
        return;
      }

      try {
        console.log(`[golem-channel-manager] Calling handleMessage: channel.type="${channel.type}" dir="${dir}"`);
        await handleMessage(
          msg,
          golemConfig,
          assistant as any,
          adapter,
          channel.type,
          false,
          dir,
        );
      } catch (err) {
        this.logger.error(`handleMessage failed for ${channel.id}: ${err}`);
        await this.replyAndRecord(channel, adapter, msg, `处理失败：${String(err)}`);
      } finally {
        // 轮末信号：微信 wrapper 据此 flush 累积缓冲的剩余内容（阈值合并 + 封顶策略）。
        // 仅 weixin wrapper 定义 flushPending，其他 adapter 无此方法，?. 跳过、零影响。
        const flushable = adapter as ChannelAdapter & {
          flushPending?: (m: ChannelMessage) => Promise<void>;
        };
        if (flushable.flushPending) {
          await flushable.flushPending(msg).catch((e) => {
            this.logger.warn(`flushPending failed for ${channel.id}: ${e}`);
          });
        }
      }
    };
  }

  /**
   * 校验 /bind 传入的工作目录路径。
   * 返回 null 表示合法；否则返回面向用户的错误提示文本。
   */
  private validateWorkspacePath(path: string): string | null {
    if (!path) {
      return "❌ 路径不能为空。请使用 `/bind <绝对路径>` 绑定工作目录。";
    }
    if (!isAbsolute(path)) {
      return `❌ 路径无效：「${path}」不是绝对路径。请输入绝对路径，例如 \`/bind /home/user/project\` 或 \`/bind D:\\\\work\\\\project\`。`;
    }
    let stat: ReturnType<typeof statSync>;
    try {
      if (!existsSync(path)) {
        return `❌ 路径不存在：「${path}」。请确认目录已创建后再绑定。`;
      }
      stat = statSync(path);
    } catch {
      return `❌ 无法访问路径：「${path}」。请检查路径是否正确以及是否有访问权限。`;
    }
    if (!stat.isDirectory()) {
      return `❌ 路径无效：「${path}」不是一个目录。请绑定到一个已存在的目录。`;
    }
    return null;
  }

  private safeReply(
    adapter: ChannelAdapter,
    msg: ChannelMessage,
    text: string,
  ): Promise<void> {
    return Promise.resolve()
      .then(() => adapter.reply(msg, text))
      .catch(() => {});
  }

  /**
   * 回复消息并记录到 channel_messages 表 + messages 表供前端展示。
   * 所有 outgoing 消息（AI 回复、/bind 响应、错误提示）都走此方法。
   */
  private replyAndRecord(
    channel: ChannelConfig,
    adapter: ChannelAdapter,
    msg: ChannelMessage,
    text: string,
  ): Promise<void> {
    try {
      this.messageRecord.recordOutgoing({
        channelId: channel.id,
        channelType: channel.type,
        chatId: msg.chatId,
        senderId: channel.id,
        content: text,
        engine: "golembot",
      });
      // 同时持久化到 messages 表，使前端会话视图展示完整对话
      const binding = this.chatSessions.resolve(msg.chatId, channel.id);
      const sessionId = binding?.sessionKey;
      if (sessionId) {
        const id = crypto.randomUUID();
        const now = Date.now();
        const data = {
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text }] },
        };
        this.db.prepare(
          "insert into messages (id, session_id, data, created_at) values (?, ?, ?, ?)",
        ).run(id, sessionId, JSON.stringify(data), now);
        this.bridge.emitStreamMessage(sessionId, data);
      }
    } catch (err) {
      this.logger.warn(`Failed to record outgoing message: ${err}`);
    }
    return Promise.resolve()
      .then(() => adapter.reply(msg, text))
      .catch(() => {});
  }
}
