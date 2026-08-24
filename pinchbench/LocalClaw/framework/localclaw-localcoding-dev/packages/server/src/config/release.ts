/**
 * 环境判别:区分「打包安装包(release)」与「开发调试态」。
 *
 * 唯一真相源是 Electron 主进程的 app.isPackaged,经 fork 时注入的环境变量
 * APP_IS_PACKAGED 传递到 server。不要用 NODE_ENV——前端 bundle 与 server fork
 * 都把它写死成 "production",dev/release 无从区分。
 */

/**
 * 是否为打包安装包。dev 态(pnpm electron:dev / standalone node)恒为 false。
 *
 * 测试用:设环境变量 APP_TELEMETRY_DEV=1 可在 dev 态强制视为 release,
 * 用于本地验证采集/UI(在 .env.local 写一行即可,见文档)。生产无需关心。
 */
export function isRelease(): boolean {
  return process.env.APP_IS_PACKAGED === "1" || process.env.APP_TELEMETRY_DEV === "1";
}

/** 应用版本(打包时注入 app.getVersion());dev/未注入时回退到 package.json 或 "0.0.0"。 */
export function getAppVersion(): string {
  return process.env.APP_VERSION || "0.0.0";
}

/** 运行平台。注入缺失时回退到当前进程 platform。 */
export function getAppPlatform(): string {
  return process.env.APP_PLATFORM || process.platform;
}

/** 匿名设备 ID(主进程从 userData/telemetry-id.json 读出后注入);未注入返回空串。 */
export function getInstanceId(): string {
  return process.env.APP_INSTANCE_ID || "";
}

/**
 * 开发期间本地记录开关:非真打包(dev / standalone server)即开。
 * 据此把 telemetry 事件落到 server 日志(server-YYYY-MM-DD.log),便于开发期排查。
 * 独立于 isRelease():APP_TELEMETRY_DEV=1 时两者都为 true(既外发又本地记录);
 * 真打包(APP_IS_PACKAGED=1)时关闭,避免线上日志刷屏。
 */
export function isDevLogging(): boolean {
  return process.env.APP_IS_PACKAGED !== "1";
}
