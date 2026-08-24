import { Injectable, Inject, forwardRef } from "@nestjs/common";
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import QRCode from "qrcode";
import { ChannelGatewayBridge } from "./channel.bridge";
import { ChannelService } from "./channel.service";
import { GolemChannelManager } from "./golem-channel-manager";
import { getAgentConfigDir } from "@lenovo/agent-sdk";

const ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";
const STATE_DIR = join(getAgentConfigDir(), "channels", "weixin");
const ACCOUNT_FILE = join(STATE_DIR, "account.json");

interface WeChatAccount {
  token: string; baseUrl: string; userId: string; savedAt: string;
}

@Injectable()
export class WeChatService {
  private loginInProgress = false;
  private qrPollingTimer: ReturnType<typeof setTimeout> | null = null;
  private loginDeadlines: Map<string, number> = new Map();
  private _warningEmitted = false;

  constructor(
    @Inject(forwardRef(() => ChannelService))
    private readonly channelService: ChannelService,
    @Inject(ChannelGatewayBridge)
    private readonly bridge: ChannelGatewayBridge,
    @Inject(GolemChannelManager)
    private readonly golemManager: GolemChannelManager,
  ) {}

  /** 该渠道是否已登录：以 DB credentials.token 为唯一真相源 */
  isLoggedIn(channelId?: string): boolean {
    if (channelId) {
      const ch = this.channelService.getChannel(channelId);
      return !!ch?.credentials?.token;
    }
    // 无 channelId 时：任一微信渠道有 token 即视为已登录（兼容旧调用）
    return this.channelService.listChannels()
      .some((c) => c.type === "wechat" && !!c.credentials?.token);
  }

  getLoginStatus(channelId?: string): { loggedIn: boolean; inProgress: boolean } {
    return { loggedIn: this.isLoggedIn(channelId), inProgress: this.loginInProgress };
  }

  async startLogin(channelId: string): Promise<{ qrDataUrl: string; deadline: number }> {
    if (this.loginInProgress) throw new Error("Login already in progress");

    const channel = this.channelService.getChannel(channelId);
    if (!channel) throw new Error("Channel not found");

    // 已登录时：停止旧 adapter、清空 DB token、删除 account.json，重新发起登录
    if (channel.credentials?.token) {
      console.log(`[wechat-login] Existing login on ${channelId}, cleaning up for re-login...`);
      this.cancelLogin();
      await this.golemManager.stopChannel(channelId).catch((e) =>
        console.warn(`[wechat-login] stopChannel error: ${e}`));
      // 仅清 token（不跑 verifyCredentials/restart 副作用）：旧 token 已失效，
      // 跑校验只会标 error 并发出与随后 channel.qrcode 交错的多余状态事件。
      try { this.channelService.clearWechatToken(channelId); }
      catch (e) { console.warn(`[wechat-login] clear token failed: ${e}`); }
      try { unlinkSync(ACCOUNT_FILE); } catch {}
    }

    this.loginInProgress = true;
    this._warningEmitted = false;
    const deadline = Date.now() + 8 * 60 * 1000;
    this.loginDeadlines.set(channelId, deadline);

    const qrRes = await fetch(`${ILINK_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`);
    if (!qrRes.ok) throw new Error(`QR fetch failed: HTTP ${qrRes.status}`);
    const qrData = await qrRes.json() as { qrcode: string; qrcode_img_content?: string };
    const qrcodeId = qrData.qrcode;
    const qrcodeContent = qrData.qrcode_img_content || qrData.qrcode;
    if (!qrcodeId) throw new Error("No qrcode in response");

    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    const qrDataUrl = await QRCode.toDataURL(qrcodeContent, { width: 280, margin: 2 });

    this.bridge.emitQrReady(qrDataUrl);
    for (const ch of this.channelService.listChannels().filter((c) => c.type === "wechat")) {
      this.channelService.updateStatus(ch.id, "connecting");
    }

    this.startQrPolling(channelId, qrcodeId, deadline);
    return { qrDataUrl, deadline };
  }

  private startQrPolling(channelId: string, qrcodeId: string, deadline: number): void {
    this.qrPollingTimer = setTimeout(async () => {
      if (Date.now() > deadline || !this.loginInProgress) {
        if (this.loginInProgress) {
          console.log("[wechat-login] QR code expired, auto-refreshing...");
          this.bridge.emitQrWarning("二维码已过期，正在刷新...");
          try {
            const qrRes = await fetch(`${ILINK_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`);
            if (qrRes.ok) {
              const qrData = await qrRes.json() as { qrcode: string; qrcode_img_content?: string };
              const newQrcodeId = qrData.qrcode;
              const qrcodeContent = qrData.qrcode_img_content || qrData.qrcode;
              const newDeadline = Date.now() + 8 * 60 * 1000;
              this.loginDeadlines.set(channelId, newDeadline);
              const qrDataUrl = await QRCode.toDataURL(qrcodeContent, { width: 280, margin: 2 });
              this.bridge.emitQrReady(qrDataUrl);
              console.log("[wechat-login] QR code refreshed successfully");
              this.startQrPolling(channelId, newQrcodeId, newDeadline);
              return;
            }
          } catch (err) {
            console.error(`[wechat-login] QR refresh failed: ${err}`);
          }
        }
        this.loginInProgress = false;
        this.loginDeadlines.delete(channelId);
        this.abortLogin("二维码已超时，请重新获取");
        return;
      }

      const remaining = deadline - Date.now();
      if (remaining > 0 && remaining <= 30_000 && !this._warningEmitted) {
        this._warningEmitted = true;
        this.bridge.emitQrWarning(`二维码还有 ${Math.ceil(remaining / 1000)} 秒即将过期，请尽快扫描`);
      }
      try {
        const res = await fetch(
          `${ILINK_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcodeId)}`,
          { headers: { "iLink-App-ClientVersion": "1" } },
        );
        const data = await res.json() as {
          status: string; bot_token?: string; baseurl?: string; ilink_user_id?: string;
        };
        console.log(`[wechat-login] QR status: ${data.status}`);

        if (data.status === "confirmed") {
          const account: WeChatAccount = {
            token: data.bot_token || "",
            baseUrl: data.baseurl || ILINK_BASE_URL,
            userId: data.ilink_user_id || "",
            savedAt: new Date().toISOString(),
          };
          // account.json 仅作 WeixinAdapter 兼容缓存，不再作登录判断依据
          writeFileSync(ACCOUNT_FILE, JSON.stringify(account, null, 2), "utf-8");
          this.loginInProgress = false;
          this.loginDeadlines.delete(channelId);
          this.bridge.emitQrDismiss();

          // 只把 token 写到「发起登录的那一个渠道」，避免污染/新建其它渠道
          const target = this.channelService.getChannel(channelId);
          if (target) {
            const newCreds = { ...target.credentials, token: account.token, baseUrl: account.baseUrl };
            await this.channelService.saveChannel({
              id: channelId,
              type: "wechat",
              enabled: true,
              credentials: newCreds,
              engine: "golembot",
            }).catch((err) => console.error(`[wechat-login] saveChannel failed: ${err}`));
          } else {
            console.warn(`[wechat-login] target channel ${channelId} gone, skip token write`);
          }
          console.log("[wechat-login] Login successful! WeixinAdapter starting via GolemChannelManager.");
          return;
        }
        if (data.status === "scaned") {
          console.log("[wechat-login] QR scanned, waiting for confirm...");
        }
        if (data.status === "expired") {
          this.abortLogin("二维码已过期，请重新获取");
          return;
        }
      } catch (err) {
        console.log(`[wechat-login] Poll error: ${err}`);
      }
      this.startQrPolling(channelId, qrcodeId, deadline);
    }, 2000);
  }

  cancelLogin(): void {
    this.loginInProgress = false;
    if (this.qrPollingTimer) {
      clearTimeout(this.qrPollingTimer);
      this.qrPollingTimer = null;
    }
    this.loginDeadlines.clear();
  }

  private abortLogin(reason: string): void {
    console.log(`[wechat-login] Login aborted: ${reason}`);
    this.loginInProgress = false;
    if (this.qrPollingTimer) {
      clearTimeout(this.qrPollingTimer);
      this.qrPollingTimer = null;
    }
    this.loginDeadlines.clear();
    this.bridge.emitQrDismiss();
    for (const ch of this.channelService.listChannels().filter((c) => c.type === "wechat")) {
      this.channelService.updateStatus(ch.id, "disconnected", reason);
    }
  }
}
