import { Controller, Get, Post, Res, Inject, Body } from "@nestjs/common";
import { join } from "path";
import { existsSync, createReadStream } from "fs";
import type { Response } from "express";
import { ChannelGatewayBridge } from "./channel.bridge";
import { ChannelService } from "./channel.service";
import { getChannelsDir } from "@lenovo/agent-sdk";

@Controller("api")
export class ChannelController {
  constructor(
    @Inject(ChannelGatewayBridge) private readonly bridge: ChannelGatewayBridge,
    @Inject(ChannelService) private readonly channelService: ChannelService,
  ) {}

  /**
   * 返回微信扫码登录的二维码图片。
   * golembot 路径由 WeixinAdapter.startLogin() 生成 wechat-qr.png 文件，
   * 此端点供前端轮询获取。
   */
  @Get("wechat-qr")
  getWechatQr(@Res() res: Response): void {
    const qrPath = join(getChannelsDir(), "weixin", "wechat-qr.png");
    if (!existsSync(qrPath)) {
      res.status(404).json({ error: "QR code not available" });
      return;
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-cache, no-store");
    createReadStream(qrPath).pipe(res as unknown as NodeJS.WritableStream);
  }

  /** 检查二维码是否就绪 */
  @Get("wechat-qr-status")
  getWechatQrStatus(): { available: boolean; url?: string } {
    const qrPath = join(getChannelsDir(), "weixin", "wechat-qr.png");
    const available = existsSync(qrPath);
    return available
      ? { available: true, url: `/api/wechat-qr?t=${Date.now()}` }
      : { available: false };
  }

  /** WeixinAdapter 通知二维码已就绪 */
  @Post("wechat-qr-ready")
  notifyQrReady(@Body() body: { qrDataUrl?: string }): { ok: boolean } {
    this.bridge.emitQrReady(body.qrDataUrl);
    for (const ch of this.channelService.listChannels().filter((c) => c.type === "wechat")) {
      this.channelService.updateStatus(ch.id, "connecting");
    }
    return { ok: true };
  }

  /** 扫码完成后关闭二维码 */
  @Post("wechat-qr-dismiss")
  dismissQr(): { ok: boolean } {
    this.bridge.emitQrDismiss();
    for (const ch of this.channelService.listChannels().filter((c) => c.type === "wechat")) {
      this.channelService.updateStatus(ch.id, "connected");
    }
    return { ok: true };
  }
}
