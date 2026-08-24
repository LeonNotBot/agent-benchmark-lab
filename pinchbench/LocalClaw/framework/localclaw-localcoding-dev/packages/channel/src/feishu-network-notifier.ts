import { Injectable, Inject, OnModuleDestroy } from "@nestjs/common";
import type Database from "better-sqlite3";
import type { ChannelMessage, ChannelAdapter } from "golembot";
import { NetworkMonitorService, type NetworkHealthEvent, type NetworkStatus } from "./network-monitor.service";
import { GolemChannelManager } from "./golem-channel-manager";
import { ChatSessionService } from "./chat-session.service";
import { ChannelService } from "./channel.service";
import { DATABASE } from "@lenovo/agent-sdk";

/** 每次状态变更最多通知的会话数，防止广播风暴 */
const MAX_NOTIFY_SESSIONS = 50;
/** 同一会话通知间隔（ms），避免短时状态震荡重复通知 */
const NOTIFY_COOLDOWN_MS = 5 * 60 * 1000; // 5 分钟

interface LocaleText {
  title: string;
  body: string;
}

@Injectable()
export class FeishuNetworkNotifier implements OnModuleDestroy {
  private readonly localeTexts: Record<NetworkStatus, LocaleText> = {
    offline: {
      title: "⚠️ LocalCoding 网络已断开",
      body:
        "**断开时间**：{time}\n\n" +
        "**可能原因**：{reason}\n\n" +
        "**建议操作**：\n" +
        "1. 检查本地网络连接\n" +
        "2. 等待几秒后重新发送消息\n" +
        "3. 如持续断开请联系管理员",
    },
    degraded: {
      title: "⚡ LocalCoding 网络不稳定",
      body: "部分服务不可用，可能影响响应速度。请稍后重试。",
    },
    online: {
      title: "✅ LocalCoding 网络已恢复",
      body: "网络已恢复正常，所有功能已可用。",
    },
  };

  /** chatId → 上次通知时间，防止频繁重复通知 */
  private readonly notifyCooldowns = new Map<string, number>();

  constructor(
    @Inject(NetworkMonitorService)
    private readonly monitor: NetworkMonitorService,
    @Inject(GolemChannelManager)
    private readonly manager: GolemChannelManager,
    @Inject(ChatSessionService)
    private readonly chatSessions: ChatSessionService,
    @Inject(ChannelService)
    private readonly channelService: ChannelService,
    @Inject(DATABASE)
    private readonly db: Database.Database,
  ) {
    this.monitor.on("network.status", this.handleNetworkStatus.bind(this));
  }

  onModuleDestroy(): void {
    this.monitor.off("network.status", this.handleNetworkStatus.bind(this));
  }

  private async handleNetworkStatus(event: NetworkHealthEvent): Promise<void> {
    if (event.status === "online") {
      await this.broadcastToFeishu(event, "online");
    } else if (event.status === "offline") {
      await this.broadcastToFeishu(event, "offline");
    } else if (event.status === "degraded") {
      await this.broadcastToFeishu(event, "degraded");
    }
  }

  /**
   * 将网络状态消息广播给所有绑定了工作区的飞书会话。
   * 通过飞书 bot 的 reply 接口发送私信通知。
   */
  private async broadcastToFeishu(
    event: NetworkHealthEvent,
    status: NetworkStatus,
  ): Promise<void> {
    const adapters = this.manager.getAllFeishuAdapters();
    if (!adapters.length) return;

    const text = this.buildNotificationText(event, status);
    if (!text) return;

    // 收集所有飞书渠道的 chatId
    const feishuChannels = this.channelService
      .listChannels()
      .filter((c) => c.type === "feishu" && c.enabled);

    const chatIds = new Set<string>();
    for (const ch of feishuChannels) {
      const sessions = this.getSessionsForChannel(ch.id);
      for (const s of sessions) {
        if (chatIds.size >= MAX_NOTIFY_SESSIONS) break;
        chatIds.add(s.chatId);
      }
    }

    // 向每个会话发送通知（过滤冷却期）
    const now = Date.now();
    const tasks: Promise<void>[] = [];
    for (const chatId of chatIds) {
      const lastNotify = this.notifyCooldowns.get(chatId) ?? 0;
      if (now - lastNotify < NOTIFY_COOLDOWN_MS) continue;
      this.notifyCooldowns.set(chatId, now);

      const fakeMsg: ChannelMessage = {
        chatId, senderId: "", text: "", images: [], files: [],
        channelType: "feishu", chatType: "dm", raw: undefined,
      };

      for (const adapter of adapters) {
        tasks.push(
          this.safeReply(adapter, fakeMsg, text).catch(() => {}),
        );
      }
    }

    await Promise.allSettled(tasks);
    console.log(
      `[feishu-network-notifier] notified ${chatIds.size} sessions for status=${status}`,
    );
  }

  private buildNotificationText(
    event: NetworkHealthEvent,
    status: NetworkStatus,
  ): string {
    const tpl = this.localeTexts[status];
    if (!tpl) return "";

    const time = new Date(event.timestamp).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    let body = tpl.body
      .replace("{time}", time)
      .replace("{reason}", this.classifyReason(event.reason));

    return `${tpl.title}\n\n${body}`;
  }

  /** 根据 error message 归类可能原因 */
  private classifyReason(reason?: string): string {
    if (!reason) return "网络连接异常，请检查本地网络状态";
    const r = reason.toLowerCase();
    if (r.includes("enotfound") || r.includes("dns"))
      return "DNS 解析失败，请检查网络是否正常";
    if (r.includes("timeout") || r.includes("etimedout"))
      return "连接超时，可能是网络不稳定或防火墙阻断";
    if (r.includes("econnrefused"))
      return "目标服务器拒绝连接，请检查 API 服务是否在线";
    return `网络异常（${reason.substring(0, 60)}）`;
  }

  private getSessionsForChannel(
    channelId: string,
  ): Array<{ chatId: string }> {
    const rows = this.db
      .prepare(
        "SELECT chat_id FROM chat_sessions WHERE channel_id = ? AND workspace_dir IS NOT NULL AND workspace_dir != ''",
      )
      .all(channelId) as any[];
    return rows.map((r: any) => ({ chatId: r.chat_id }));
  }

  private async safeReply(
    adapter: ChannelAdapter,
    msg: ChannelMessage,
    text: string,
  ): Promise<void> {
    try {
      await adapter.reply(msg, text);
    } catch (e) {
      console.warn(
        `[feishu-network-notifier] reply failed: ${(e as Error)?.message}`,
      );
    }
  }
}
