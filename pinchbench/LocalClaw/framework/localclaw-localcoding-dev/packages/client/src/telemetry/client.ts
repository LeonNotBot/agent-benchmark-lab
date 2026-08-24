/**
 * 前端 telemetry 采集客户端。
 *
 * 启动时拿 app-info(preload 优先、/api/app-info 兜底)判断是否启用:
 * 仅 release + 用户开关开启才采集。dev 态 init 后 enabled 恒 false,
 * track() 直接 no-op,不发任何请求。
 *
 * 所有事件经本地 server(/api/telemetry)中转,前端不直连上报后端。
 */
import { putJson } from "../api/_fetch";

type AppInfo = {
  release: boolean;
  version: string;
  platform: string;
  instanceId: string;
  telemetryEnabled?: boolean;
  consentedAt?: number;
  devLogging?: boolean;
};

type Envelope = {
  type: "crash" | "error" | "event" | "perf";
  ts: number;
  instanceId: string;
  version: string;
  platform: string;
  payload?: Record<string, unknown>;
};

let info: AppInfo | null = null;
let enabled = false;
// 开发期本地记录:即使 enabled=false,也把事件发到本地 server 记日志(server 决定不外发)。
let devLogging = false;
let consentedAtCache = 0;

/**
 * 启动初始化:确定是否启用采集。失败则保持禁用(安全默认)。
 * @returns 是否需要首启知情提示(release + 启用 + 从未提示过)。
 */
export async function initTelemetry(): Promise<{ needNotice: boolean }> {
  try {
    // preload 首选(无网络往返),拿不到 telemetryEnabled 再补一次接口。
    const fromPreload = await window.electronAPI?.appInfo?.();
    const fromApi = await fetchAppInfo();
    info = { ...(fromApi ?? {}), ...(fromPreload ?? {}) } as AppInfo;
    if (fromApi) info.telemetryEnabled = fromApi.telemetryEnabled;
    // release 取「任一来源为 true」:dev 测试模式下 server 经 APP_TELEMETRY_DEV
    // 返回 release:true,不被 preload 的 false 覆盖,UI 守卫与采集随之放开。
    info.release = !!(fromPreload?.release || fromApi?.release);
    enabled = !!info?.release && info?.telemetryEnabled !== false;
    devLogging = fromApi?.devLogging === true;
    consentedAtCache = fromApi?.consentedAt ?? 0;
    return { needNotice: enabled && consentedAtCache === 0 };
  } catch {
    enabled = false;
    devLogging = false;
    return { needNotice: false };
  }
}

/** 标记首启知情提示已展示(写 consentedAt,不改变 enabled)。 */
export async function markNoticeShown(): Promise<void> {
  consentedAtCache = Date.now();
  await putJson("/api/telemetry/consent", { enabled: getConsent() });
}

async function fetchAppInfo(): Promise<AppInfo | null> {
  try {
    const r = await fetch("/api/app-info");
    if (!r.ok) return null;
    return (await r.json()) as AppInfo;
  } catch {
    return null;
  }
}

function envelope(type: Envelope["type"], payload?: Record<string, unknown>): Envelope {
  return {
    type,
    ts: Date.now(),
    instanceId: info?.instanceId ?? "",
    version: info?.version ?? "",
    platform: info?.platform ?? "",
    payload,
  };
}

/**
 * 发送一条上报。不读响应体(/api/telemetry 返回 204 空 body,调 .json() 会抛
 * "Unexpected end of JSON input")。静默吞错——打点绝不能抛错污染业务,
 * 更不能反过来触发 trackError 形成回环。keepalive 让页面卸载时也能发出。
 */
function beacon(env: Envelope): void {
  try {
    void fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(env),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // 静默
  }
}

/** 是否应发送到本地 server:正式采集开启,或开发期本地记录。 */
function shouldSend(): boolean {
  return enabled || devLogging;
}

/** 上报一条事件(行为/性能等)。禁用且非开发期时 no-op。 */
export function track(name: string, attrs?: Record<string, unknown>): void {
  if (!shouldSend()) return;
  beacon(envelope("event", { name, ...attrs }));
}

/** 上报性能指标。禁用且非开发期时 no-op。 */
export function trackPerf(name: string, attrs?: Record<string, unknown>): void {
  if (!shouldSend()) return;
  beacon(envelope("perf", { name, ...attrs }));
}

/** 上报前端错误。禁用且非开发期时 no-op。 */
export function trackError(message: string, attrs?: Record<string, unknown>): void {
  if (!shouldSend()) return;
  beacon(envelope("error", { message, ...attrs }));
}

/** 当前是否启用(供 UI/调试查询)。 */
export function isTelemetryEnabled(): boolean {
  return enabled;
}

/** 是否 release 态(dev 态隐藏隐私开关——dev 本就不采集)。 */
export function isReleaseBuild(): boolean {
  return !!info?.release;
}

/** 用户当前开关意愿(与 enabled 区分:enabled 还叠加了 release 条件)。 */
export function getConsent(): boolean {
  return info?.telemetryEnabled !== false;
}

/** 是否已做过首启知情提示(consentedAt 由 server 在首次写 consent 时置位)。 */
export function setConsentedAtCache(v: number): void {
  consentedAtCache = v;
}
export function hasConsented(): boolean {
  return consentedAtCache > 0;
}

/**
 * 写入用户开关。同步更新本地 enabled,使 track() 立即生效/停止。
 * consentedAt 由 server 维护。
 */
export async function setTelemetryConsent(value: boolean): Promise<void> {
  if (info) info.telemetryEnabled = value;
  enabled = !!info?.release && value;
  consentedAtCache = consentedAtCache || Date.now();
  await putJson("/api/telemetry/consent", { enabled: value });
}
