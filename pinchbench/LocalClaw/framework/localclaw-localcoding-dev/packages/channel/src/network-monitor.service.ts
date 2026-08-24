import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { EventEmitter } from "events";
import { EndpointRegistryService } from "@lenovo/agent-sdk";
import type { ChannelAdapter } from "golembot";

export type NetworkStatus = "online" | "offline" | "degraded";

export interface NetworkHealthEvent {
  status: NetworkStatus;
  timestamp: number;
  offlineSince?: number;
  affectedEndpoints?: string[];
  reason?: string;
}

const GATEWAY_CHECK_INTERVAL_MS = 30_000; // 每 30 秒检测一次
const GATEWAY_CHECK_TIMEOUT_MS = 5_000;   // 单次检测超时 5 秒

@Injectable()
export class NetworkMonitorService extends EventEmitter implements OnModuleInit, OnModuleDestroy {
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private currentStatus: NetworkStatus = "online";
  /** 网络从正常变为断开的时间点，用于计算断开时长 */
  private offlineSince: number | undefined;
  private stopped = false;

  constructor(
    @Inject(EndpointRegistryService) private readonly endpoints: EndpointRegistryService,
  ) {
    super();
  }

  onModuleInit(): void {
    this.startMonitoring();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  getStatus(): NetworkStatus {
    return this.currentStatus;
  }

  getOfflineSince(): number | undefined {
    return this.offlineSince;
  }

  private startMonitoring(): void {
    if (this.checkTimer) return;
    this.checkTimer = setInterval(() => {
      if (!this.stopped) void this.checkGatewayHealth();
    }, GATEWAY_CHECK_INTERVAL_MS);
    // 不阻止进程退出
    (this.checkTimer as any).unref?.();
    // 启动后立即做一次检测
    void this.checkGatewayHealth();
  }

  private stop(): void {
    this.stopped = true;
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  /**
   * 探测 gateway /health 端点，并汇总各 endpoint 连通性。
   * 通过本地 fetch 访问 gateway controller（同一进程内，无须鉴权）。
   */
  async checkGatewayHealth(): Promise<NetworkHealthEvent> {
    const endpoints = this.endpoints.getEnabled();
    const results: Array<{ id: string; label: string; reachable: boolean; error?: string }> = [];

    await Promise.allSettled(
      endpoints.map(async (ep) => {
        try {
          const base = ep.baseUrl.replace(/\/v1\/?$/, "");
          const url = `${base}/v1/models`;
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), GATEWAY_CHECK_TIMEOUT_MS);
          const r = await fetch(url, {
            headers: ep.apiKey ? { Authorization: `Bearer ${ep.apiKey}` } : {},
            signal: ctrl.signal,
          });
          clearTimeout(t);
          results.push({ id: ep.id, label: ep.label, reachable: r.ok, error: r.ok ? undefined : `HTTP ${r.status}` });
        } catch (e: any) {
          results.push({ id: ep.id, label: ep.label, reachable: false, error: e?.message ?? String(e) });
        }
      }),
    );

    // 判断网络状态：全部可达=online，部分可达=degraded，全部不可达=offline
    const reachable = results.filter(r => r.reachable);
    let newStatus: NetworkStatus;
    let reason: string | undefined;

    if (reachable.length === results.length && results.length > 0) {
      newStatus = "online";
    } else if (reachable.length === 0) {
      newStatus = "offline";
      const errMsgs = results.map(r => `${r.label}: ${r.error}`).join("; ");
      reason = `所有 ${results.length} 个端点均不可达 — ${errMsgs}`;
    } else {
      newStatus = "degraded";
      const downEndpoints = results.filter(r => !r.reachable).map(r => r.label);
      reason = `部分端点不可用: ${downEndpoints.join(", ")}`;
    }

    // 状态变更时记录 offlineSince，并发出事件
    const changed = newStatus !== this.currentStatus;
    if (changed) {
      const wasOffline = this.currentStatus !== "online";
      this.currentStatus = newStatus;

      if (newStatus === "offline") {
        this.offlineSince = Date.now();
      } else {
        this.offlineSince = undefined;
      }

      const event: NetworkHealthEvent = {
        status: newStatus,
        timestamp: Date.now(),
        offlineSince: newStatus === "offline" ? this.offlineSince : undefined,
        affectedEndpoints: results.filter(r => !r.reachable).map(r => r.id),
        reason,
      };

      console.log(
        `[network-monitor] status changed: ${this.currentStatus} → ${newStatus}` +
        (wasOffline && newStatus !== "offline" ? ` (offline duration: ${this.offlineSince ? "N/A" : ""})` : ""),
      );
      this.emit("network.status", event);
    }

    return {
      status: newStatus,
      timestamp: Date.now(),
      offlineSince: this.offlineSince,
      affectedEndpoints: results.filter(r => !r.reachable).map(r => r.id),
      reason,
    };
  }

  /**
   * 立即触发一次健康检测（不等待），返回 Promise。
   * 用于对话中检测到网络错误后立即验证状态。
   */
  checkNow(): Promise<NetworkHealthEvent> {
    return this.checkGatewayHealth();
  }
}
