import { Controller, Get, Put, Post, Body, HttpCode, Inject } from "@nestjs/common";
import { readAgentSettings, writeAgentSettings } from "@lenovo/agent-sdk";
import { isRelease, isDevLogging, getAppVersion, getAppPlatform, getInstanceId } from "../../config/release";
import { TelemetryService, type TelemetryEnvelope } from "./telemetry.service";

/** telemetry 用户开关在 agent-settings 的存放位置。 */
type TelemetrySettings = { enabled?: boolean; consentedAt?: number };

function readTelemetrySettings(): TelemetrySettings {
  const settings = readAgentSettings() as { telemetry?: TelemetrySettings };
  return settings.telemetry ?? {};
}

@Controller("api")
export class TelemetryController {
  constructor(@Inject(TelemetryService) private readonly telemetry: TelemetryService) {}

  /**
   * 应用环境信息。前端启动时拉一次,用于:
   * - 判断是否 release(dev 态前端不初始化任何采集);
   * - 拿到匿名设备 ID / 版本 / 平台作上报公共字段;
   * - 拿到用户开关当前值。
   * external-server 远程部署场景下,前端无 preload,靠此接口兜底。
   */
  @Get("app-info")
  appInfo() {
    const t = readTelemetrySettings();
    return {
      release: isRelease(),
      version: getAppVersion(),
      platform: getAppPlatform(),
      instanceId: getInstanceId(),
      // release 默认开启;未显式设置时视为 true(首启知情提示前默认采集)
      telemetryEnabled: t.enabled !== false,
      consentedAt: t.consentedAt ?? 0,
      // 开发期本地记录:前端据此即使不外发也把事件发到 server(记 server 日志)。
      devLogging: isDevLogging(),
    };
  }

  /**
   * 写入用户开关(设置面板「发送匿名使用统计」)。
   * consentedAt 记录首次知情确认时间;前端首启提示后置位,避免重复弹出。
   */
  @Put("telemetry/consent")
  setConsent(@Body() body: { enabled?: boolean }) {
    const enabled = body?.enabled !== false;
    const settings = readAgentSettings() as { telemetry?: TelemetrySettings };
    const prev = settings.telemetry ?? {};
    settings.telemetry = {
      ...prev,
      enabled,
      consentedAt: prev.consentedAt || Date.now(),
    };
    writeAgentSettings(settings);
    return { ok: true, enabled };
  }

  /**
   * 本地中转上报入口。三端(前端/主进程)POST 信封到这里,service 做双闸门 +
   * 拍平 + 批量外发到 SLS。非 release/开关关闭时 service 内部直接丢弃。
   * 恒返回 204,客户端无需关心结果(打点不应阻塞业务)。
   */
  @Post("telemetry")
  @HttpCode(204)
  report(@Body() body: TelemetryEnvelope | TelemetryEnvelope[]): void {
    this.telemetry.ingest(body);
  }
}
