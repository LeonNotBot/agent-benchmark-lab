// 各渠道类型的元信息与凭据字段定义，供渠道配置表单使用
import type { ChannelType, ChannelField } from "@lenovo/agent-protocol";
import { zh, en } from "../i18n/locales";

// 凭据字段：label 为技术名词（App ID 等）不翻译；placeholderKey 指向 i18n key（中文示例文案需翻译）
export interface ChannelFieldMeta extends Omit<ChannelField, "placeholder"> {
  placeholder?: string;
  placeholderKey?: string;
}

export interface ChannelTypeMeta {
  type: ChannelType;
  // labelKey / descKey 指向 i18n key，渲染处经 t() 解析以跟随语言切换
  labelKey: string;
  descKey: string;
  // 微信走扫码登录，无凭据表单；其余通过凭据字段配置
  fields: ChannelFieldMeta[];
}

export const CHANNEL_TYPES: ChannelTypeMeta[] = [
  {
    type: "wechat",
    labelKey: "channel.type.wechat",
    descKey: "channelType.wechat.desc",
    fields: [],
  },
  {
    type: "feishu",
    labelKey: "channel.type.feishu",
    descKey: "channelType.feishu.desc",
    fields: [
      { key: "appId", label: "App ID", placeholder: "cli_xxxxxxxx", secret: false, required: true },
      { key: "appSecret", label: "App Secret", placeholderKey: "channelField.appSecret.placeholder", secret: true, required: true },
    ],
  },
  {
    type: "dingtalk",
    labelKey: "channel.type.dingtalk",
    descKey: "channelType.dingtalk.desc",
    fields: [
      { key: "clientId", label: "Client ID", placeholder: "dingxxxxxxxx", secret: false, required: true },
      { key: "clientSecret", label: "Client Secret", placeholderKey: "channelField.clientSecret.placeholder", secret: true, required: true },
    ],
  },
  {
    type: "wecom",
    labelKey: "channel.type.wecom",
    descKey: "channelType.wecom.desc",
    fields: [
      { key: "botId", label: "Bot ID", placeholderKey: "channelField.botId.placeholder", secret: false, required: true },
      { key: "secret", label: "Secret", placeholderKey: "channelField.secret.placeholder", secret: true, required: true },
    ],
  },
];

export function getChannelMeta(type: ChannelType): ChannelTypeMeta | undefined {
  return CHANNEL_TYPES.find((c) => c.type === type);
}

/**
 * 渠道展示名本地化：渠道 name 是创建时落库的，默认值取「创建时语言的类型标签」（如「飞书」）。
 * 切换语言无法回改已存数据，故在展示处做兜底：若 name 仍等于该类型在任一语言下的默认标签，
 * 视为「未自定义」，改用当前语言的标签 t(labelKey)；否则原样返回用户自定义名。
 */
export function resolveChannelDisplayName(
  type: ChannelType,
  name: string,
  t: (key: string) => string,
): string {
  const meta = getChannelMeta(type);
  if (!meta) return name;
  const defaults = [zh[meta.labelKey], en[meta.labelKey]].filter(Boolean);
  return defaults.includes(name) ? t(meta.labelKey) : name;
}

