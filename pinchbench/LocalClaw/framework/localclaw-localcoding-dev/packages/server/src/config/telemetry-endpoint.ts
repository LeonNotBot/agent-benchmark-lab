/**
 * SLS WebTracking 上报地址配置。
 *
 * 地址是固定的(阿里云 localcoding logstore),故写死为默认常量,不依赖每处手配。
 * 环境变量 APP_TELEMETRY_URL 仅作覆盖用(内测指向别的 logstore / 临时置空关闭):
 *   - 未设:用 DEFAULT_TELEMETRY_URL(默认行为,dev 与 release 一致都发往阿里云)
 *   - 设为合法 track URL:覆盖默认
 *   - 显式设为空串 "":关闭外发(仅落盘)
 *
 * 注:是否真的外发还要过 isRelease() + 用户开关双闸门(见 telemetry.service)。
 * dev 态默认 isRelease()=false 仍不外发;设 APP_TELEMETRY_DEV=1 放开后才会发。
 */

/** 固定上报地址(阿里云 SLS WebTracking)。 */
const DEFAULT_TELEMETRY_URL =
  "https://localcoding.cn-beijing.log.aliyuncs.com/logstores/localcoding/track";

/** 完整 SLS WebTracking track URL;显式置空或格式非法返回 null(外发关闭)。 */
export function getTelemetryUrl(): string | null {
  // 环境变量存在(含空串)时以它为准;未设置时回落到默认常量。
  const raw = process.env.APP_TELEMETRY_URL;
  const url = (raw === undefined ? DEFAULT_TELEMETRY_URL : raw).trim();
  if (!url) return null;
  // 仅接受 https,且形似 SLS track 端点,避免误配把数据发到任意地址。
  if (!/^https:\/\/.+\/logstores\/.+\/track$/.test(url)) {
    return null;
  }
  return url;
}
