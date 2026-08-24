import type { ChannelConfig, ChannelType } from "@lenovo/agent-protocol";
import { getJson, postJson, patchJson, deleteJson } from "./_fetch";

export async function apiListChannels(): Promise<ChannelConfig[]> {
  const data = await getJson<{ channels: ChannelConfig[] }>("/api/channels");
  return data?.channels ?? [];
}

/** 某渠道下的会话（侧边栏渠道分组用） */
export interface ChannelSession {
  id: string;
  title: string;
  status: string;
  cwd?: string;
  kind: string;
  createdAt: number;
  updatedAt: number;
  chatId: string;
}

export async function apiListChannelSessions(channelId: string): Promise<ChannelSession[]> {
  const data = await getJson<{ sessions: ChannelSession[] }>(
    `/api/channels/${encodeURIComponent(channelId)}/sessions`,
  );
  return data?.sessions ?? [];
}

export async function apiSaveChannel(
  channel: Partial<ChannelConfig> & { type: ChannelType },
): Promise<{ channel: ChannelConfig | null; error?: string }> {
  const data = await postJson<{ channel: ChannelConfig | null; error?: string }>("/api/channels", { channel });
  return data ?? { channel: null };
}

export async function apiDeleteChannel(channelId: string): Promise<boolean> {
  const data = await deleteJson<{ ok: boolean }>(`/api/channels/${encodeURIComponent(channelId)}`);
  return data?.ok === true;
}

export async function apiToggleChannel(
  channelId: string,
  enabled: boolean,
): Promise<ChannelConfig | null> {
  const data = await patchJson<{ channel: ChannelConfig }>(
    `/api/channels/${encodeURIComponent(channelId)}/toggle`,
    { enabled },
  );
  return data?.channel ?? null;
}

export async function apiTestChannel(
  channelId: string,
): Promise<{ ok: boolean; error?: string }> {
  const data = await postJson<{ ok: boolean; error?: string }>(
    `/api/channels/${encodeURIComponent(channelId)}/test`,
    {},
  );
  return data ?? { ok: false, error: "Request failed" };
}

export async function apiRestartChannel(
  channelId: string,
): Promise<{ ok: boolean; error?: string }> {
  const data = await postJson<{ ok: boolean; error?: string }>(
    `/api/channels/${encodeURIComponent(channelId)}/restart`,
    {},
  );
  return data ?? { ok: false, error: "Request failed" };
}

export async function apiCheckWechatQr(): Promise<{ available: boolean; url?: string }> {
  const data = await getJson<{ available: boolean; url?: string }>("/api/wechat-qr-status");
  return data ?? { available: false };
}

export async function apiReloginChannel(channelId: string): Promise<{ ok: boolean; error?: string; qrDataUrl?: string }> {
  const data = await postJson<{ ok: boolean; error?: string; qrDataUrl?: string }>(
    `/api/channels/${encodeURIComponent(channelId)}/relogin`, {},
  );
  return data ?? { ok: false, error: "Request failed" };
}
