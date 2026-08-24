import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Body,
  Inject,
  HttpCode,
} from "@nestjs/common";
import { ChannelService } from "./channel.service";
import { WeChatService } from "./wechat.service";
import type { ChannelConfig, ChannelType } from "@lenovo/agent-protocol";

@Controller("api")
export class ChannelRestController {
  constructor(
    @Inject(ChannelService)
    private readonly channelService: ChannelService,
    @Inject(WeChatService)
    private readonly wechatService: WeChatService,
  ) {}

  @Get("channels")
  list() {
    return { channels: this.channelService.listChannels() };
  }

  /** 列出某渠道下的所有会话（侧边栏渠道分组用） */
  @Get("channels/:channelId/sessions")
  listChannelSessions(@Param("channelId") channelId: string) {
    return { channelId, sessions: this.channelService.listChannelSessions(channelId) };
  }

  @Post("channels")
  async save(@Body() body: { channel: Partial<ChannelConfig> & { type: ChannelType } }) {
    try {
      const channel = await this.channelService.saveChannel(body.channel);
      return { channel };
    } catch (err) {
      // 工作目录不存在等校验失败：返回明确错误供前端 toast 展示，而非 500 → 前端只见「保存失败」
      return { channel: null, error: String((err as Error)?.message ?? err) };
    }
  }

  @Delete("channels/:channelId")
  @HttpCode(200)
  delete(@Param("channelId") id: string) {
    this.channelService.deleteChannel(id);
    return { ok: true };
  }

  @Patch("channels/:channelId/toggle")
  async toggle(
    @Param("channelId") id: string,
    @Body() body: { enabled: boolean },
  ) {
    const channel = await this.channelService.toggleChannel(id, body.enabled);
    return { channel };
  }

  @Post("channels/:channelId/test")
  async test(@Param("channelId") id: string) {
    return this.channelService.testConnection(id);
  }

  @Post("channels/:channelId/restart")
  @HttpCode(200)
  async restart(@Param("channelId") id: string) {
    return this.channelService.restartChannelService(id);
  }

  /** 微信重新扫码登录：删除旧账号 → 触发 golembot WeixinAdapter 扫码流程 */
  @Post("channels/:channelId/relogin")
  @HttpCode(200)
  async relogin(@Param("channelId") id: string) {
    const channel = this.channelService.getChannel(id);
    if (!channel) return { ok: false, error: "Channel not found" };
    if (channel.type !== "wechat") return { ok: false, error: "仅微信渠道支持重新登录" };

    try {
      const { qrDataUrl, deadline } = await this.wechatService.startLogin(id);
      return { ok: true, qrDataUrl, deadline };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  @Post("channels/migrate")
  @HttpCode(200)
  async migrate() {
    return this.channelService.migrate();
  }
}
