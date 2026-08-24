import type { SecretEntry, SecretListResponse, SecretUpsertRequest, SecretDefConfig } from "@lenovo/agent-protocol";
import { getJson, postJson, putJson, deleteJson } from "./_fetch";

export async function apiListSecrets(): Promise<{ secrets: SecretEntry[]; storagePath: string }> {
  const data = await getJson<SecretListResponse>("/api/secrets");
  return { secrets: data?.secrets ?? [], storagePath: data?.storagePath ?? "" };
}

export async function apiGetSecret(key: string): Promise<SecretEntry | null> {
  const data = await getJson<SecretEntry>(`/api/secrets/${encodeURIComponent(key)}`);
  return data ?? null;
}

export async function apiUpsertSecret(dto: SecretUpsertRequest): Promise<SecretEntry | null> {
  const data = await postJson<SecretEntry>("/api/secrets", dto);
  return data;
}

export async function apiDeleteSecret(key: string): Promise<boolean> {
  const data = await deleteJson<{ success: boolean }>(`/api/secrets/${encodeURIComponent(key)}`);
  return data?.success ?? false;
}

// ── 隐私定义配置 ──

export async function apiGetSecretConfig(): Promise<{ config: SecretDefConfig; defaults: SecretDefConfig } | null> {
  return getJson<{ config: SecretDefConfig; defaults: SecretDefConfig }>("/api/secret-config");
}

export async function apiSaveSecretConfig(config: SecretDefConfig): Promise<SecretDefConfig | null> {
  const data = await putJson<{ config: SecretDefConfig }>("/api/secret-config", config);
  return data?.config ?? null;
}
