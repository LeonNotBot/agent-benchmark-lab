import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChannelAdapter } from "golembot";
import type { ChannelConfig } from "@lenovo/agent-protocol";
import { FeishuAdapter } from "golembot/dist/channels/feishu.js";
import { DingtalkAdapter } from "golembot/dist/channels/dingtalk.js";
import { WecomAdapter } from "golembot/dist/channels/wecom.js";
import { WeixinAdapter } from "golembot/dist/channels/weixin.js";
import { getAgentConfigDir } from "@lenovo/agent-sdk";
import { enhanceFeishuAdapter } from "./feishu-adapter-wrapper";
import { enhanceWeixinAdapter } from "./weixin-adapter-wrapper";

/**
 * 解析微信 iLink 凭据：优先用渠道 credentials.token；
 * 为兼容扫码登录历史数据，credentials 为空时回退读取 account.json。
 */
function resolveWeixinCreds(
  c: Record<string, string>,
): { token: string; baseUrl?: string } | null {
  if (c.token) return { token: c.token, baseUrl: c.baseUrl };
  const accountFile = join(getAgentConfigDir(), "channels", "weixin", "account.json");
  if (!existsSync(accountFile)) return null;
  try {
    const acc = JSON.parse(readFileSync(accountFile, "utf-8"));
    return acc.token ? { token: acc.token, baseUrl: acc.baseUrl } : null;
  } catch {
    return null;
  }
}

/**
 * 按 ChannelType 实例化对应的 GolemBot Adapter。
 *
 * - 必填字段缺失返回 null（不抛错）
 * - wechat 走 golembot 原生 WeixinAdapter（token 来自扫码，未登录返回 null）
 * - 未知 type 返回 null
 */
export function createAdapterFromChannel(
  channel: ChannelConfig,
): ChannelAdapter | null {
  const c = channel.credentials || {};
  switch (channel.type) {
    case "feishu": {
      if (!c.appId || !c.appSecret) return null;
      const adapter = new FeishuAdapter({
        appId: c.appId,
        appSecret: c.appSecret,
      } as any);
      return enhanceFeishuAdapter(adapter);
    }
    case "dingtalk": {
      if (!c.clientId || !c.clientSecret) return null;
      return new DingtalkAdapter({
        clientId: c.clientId,
        clientSecret: c.clientSecret,
      } as any);
    }
    case "wecom": {
      if (!c.botId || !c.secret) return null;
      return new WecomAdapter({ botId: c.botId, secret: c.secret } as any);
    }
    case "wechat": {
      const creds = resolveWeixinCreds(c);
      if (!creds) return null;
      const adapter = new WeixinAdapter({
        token: creds.token,
        baseUrl: creds.baseUrl,
      } as any);
      return enhanceWeixinAdapter(adapter, creds.token, creds.baseUrl);
    }
    default:
      return null;
  }
}
