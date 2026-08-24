import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, unlinkSync, statSync } from "fs";
import { join } from "path";
import { getAgentHomeDir, readAgentSettings } from "@lenovo/agent-sdk";
import { isRelease, isDevLogging, getAppVersion, getAppPlatform, getInstanceId } from "../../config/release";
import { getTelemetryUrl } from "../../config/telemetry-endpoint";

/** 上报信封(三端 → 本地 server)。 */
export type TelemetryEnvelope = {
  type: "crash" | "error" | "event" | "perf";
  ts?: number;
  instanceId?: string;
  version?: string;
  platform?: string;
  sessionId?: string;
  payload?: Record<string, unknown>;
};

const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_BATCH_SIZE = 20;
// buffer 文件硬上限:超过则丢弃最旧的,防补传一直失败时无限增长(典型断网/地址错)。
const BUFFER_MAX_BYTES = 1_000_000;
// 单次补传最多带多少条积压(避免一次性 POST 过大被 SLS 拒)。
const DRAIN_MAX_LINES = 200;

@Injectable()
export class TelemetryService implements OnModuleDestroy {
  private readonly logger = new Logger(TelemetryService.name);
  private queue: Record<string, string>[] = [];
  private timer: NodeJS.Timeout | null = null;

  /** 用户开关:agent-settings.telemetry.enabled,未显式设置默认 true。 */
  private telemetryEnabled(): boolean {
    try {
      const s = readAgentSettings() as { telemetry?: { enabled?: boolean } };
      return s.telemetry?.enabled !== false;
    } catch {
      return true;
    }
  }

  /** 是否应当采集/外发:必须 release 且开关开启。dev 态恒 false。 */
  private active(): boolean {
    return isRelease() && this.telemetryEnabled();
  }

  /**
   * 上报入口。接收单条或一批信封。
   *
   * 开发期间(非真打包)无论是否外发,都把事件落到 server 日志便于排查;
   * 随后按双闸门(release + 用户开关)决定是否真正入队外发。
   * dev 态默认只本地记录、不外发;APP_TELEMETRY_DEV=1 时两者都做。
   */
  ingest(input: TelemetryEnvelope | TelemetryEnvelope[]): void {
    const list = Array.isArray(input) ? input : [input];

    // 开发期本地记录:进 server-YYYY-MM-DD.log(需 LOCALCLAW_LOG_FILE=1 落盘)。
    if (isDevLogging()) {
      for (const env of list) {
        this.logger.log(`[telemetry][${env.type}] ${JSON.stringify(this.flatten(env))}`);
      }
    }

    if (!this.active()) return;
    let immediate = false;
    for (const env of list) {
      this.queue.push(this.flatten(env));
      if (env.type === "crash") immediate = true;
    }
    if (immediate || this.queue.length >= FLUSH_BATCH_SIZE) {
      void this.flush();
    } else {
      this.ensureTimer();
    }
  }

  /**
   * 信封拍平成 SLS 扁平 KV:payload 提到顶层,所有值转字符串
   * (WebTracking 要求字段值为 string,且不支持嵌套对象)。
   */
  private flatten(env: TelemetryEnvelope): Record<string, string> {
    const out: Record<string, string> = {
      type: env.type,
      ts: String(env.ts ?? Date.now()),
      instanceId: env.instanceId || getInstanceId(),
      version: env.version || getAppVersion(),
      platform: env.platform || getAppPlatform(),
    };
    if (env.sessionId) out.sessionId = env.sessionId;
    const flat = (obj: Record<string, unknown>, prefix = "") => {
      for (const [k, v] of Object.entries(obj)) {
        if (v == null) continue;
        if (typeof v === "object") flat(v as Record<string, unknown>, `${prefix}${k}_`);
        else out[`${prefix}${k}`] = String(v);
      }
    };
    if (env.payload) flat(env.payload);
    return out;
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, FLUSH_INTERVAL_MS);
    this.timer.unref?.();
  }

  /** 把队列内全部事件外发(或落盘)。 */
  private async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];

    const url = getTelemetryUrl();
    const names = batch.map((r) => r.name || r.type).join(",");
    if (!url) {
      // 未配置外发地址:仅落盘(等 APP_TELEMETRY_URL 注入)。
      this.persist(batch);
      this.logger.log(
        `telemetry: 未配置 APP_TELEMETRY_URL,${batch.length} 条仅落盘不外发 [${names}]`,
      );
      return;
    }

    try {
      await this.postToSls(url, batch);
      this.logger.log(`telemetry: 已上报 ${batch.length} 条到 SLS [${names}] → ${url}`);
      // 本批成功 → 顺带补传之前落盘积压的,成功则清空 buffer 文件。
      await this.drainBuffer(url);
    } catch (err: any) {
      // 外发失败:落盘留待下次成功 flush 时补传。
      this.persist(batch);
      this.logger.warn(
        `telemetry: 上报失败,${batch.length} 条已落盘 [${names}]: ${err?.message}`,
      );
    }
  }

  /** buffer 文件路径。 */
  private bufferFile(): string {
    return join(getAgentHomeDir(), "logs", "telemetry-buffer.jsonl");
  }

  /**
   * 补传落盘积压:读 buffer 文件,成功 POST 后删除文件;失败则保留等下次。
   * 仅在一次正常 flush 成功后调用(说明网络/地址此刻可用)。
   */
  private async drainBuffer(url: string): Promise<void> {
    const file = this.bufferFile();
    if (!existsSync(file)) return;
    let lines: Record<string, string>[];
    try {
      lines = readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Record<string, string>);
    } catch {
      // 文件损坏:直接删除,不阻塞。
      try { unlinkSync(file); } catch { /* ignore */ }
      return;
    }
    if (lines.length === 0) {
      try { unlinkSync(file); } catch { /* ignore */ }
      return;
    }
    const drain = lines.slice(0, DRAIN_MAX_LINES);
    const rest = lines.slice(DRAIN_MAX_LINES);
    try {
      await this.postToSls(url, drain);
      this.logger.log(`telemetry: 补传积压 ${drain.length} 条成功`);
      // 补传成功:删文件;若还有剩余(超 DRAIN_MAX_LINES),回写剩余等下轮。
      if (rest.length > 0) {
        writeFileSync(file, rest.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
      } else {
        unlinkSync(file);
      }
    } catch (err: any) {
      // 补传仍失败:原样保留,下次再试。
      this.logger.warn(`telemetry: 补传积压失败,保留 ${lines.length} 条: ${err?.message}`);
    }
  }

  /** SLS WebTracking POST 批量格式:{__topic__,__source__,__logs__:[...]}。 */
  private async postToSls(url: string, batch: Record<string, string>[]): Promise<void> {
    const headers = { "Content-Type": "application/json" };
    const body = JSON.stringify({
      __topic__: "telemetry",
      __source__: "client",
      __logs__: batch,
    });
    // 完整上报请求打印(debug 级,避免正常运行刷屏;开 LENOVO_SDK_LOG_LEVEL=debug 可见)。
    this.logger.debug(
      `telemetry 上报请求:\n` +
        `  POST ${url}\n` +
        `  headers: ${JSON.stringify(headers)}\n` +
        `  body: ${body}`,
    );
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
    });
    const respText = await res.text().catch(() => "");
    this.logger.debug(`telemetry 上报响应: HTTP ${res.status} ${respText}`);
    if (!res.ok) {
      throw new Error(`SLS track HTTP ${res.status}`);
    }
  }

  /** 落盘到 agentHomeDir/logs/telemetry-buffer.jsonl(每行一条,便于补传)。 */
  private persist(batch: Record<string, string>[]): void {
    try {
      const dir = join(getAgentHomeDir(), "logs");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const file = join(dir, "telemetry-buffer.jsonl");
      appendFileSync(file, batch.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
      this.capBufferSize(file);
    } catch (err: any) {
      this.logger.warn(`telemetry persist failed: ${err?.message}`);
    }
  }

  /** 超过 BUFFER_MAX_BYTES 时丢弃最旧的行,只保留尾部,防文件无限增长。 */
  private capBufferSize(file: string): void {
    try {
      const { size } = statSync(file);
      if (size <= BUFFER_MAX_BYTES) return;
      const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
      // 保留后一半(较新的),丢弃较旧的一半。
      const kept = lines.slice(Math.floor(lines.length / 2));
      writeFileSync(file, kept.join("\n") + "\n", "utf8");
      this.logger.warn(`telemetry: buffer 超限,已丢弃 ${lines.length - kept.length} 条最旧记录`);
    } catch { /* ignore */ }
  }

  onModuleDestroy(): void {
    void this.flush();
  }
}
