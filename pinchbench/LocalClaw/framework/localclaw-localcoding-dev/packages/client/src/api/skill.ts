import type { SkillMeta, MarketSkill } from "@lenovo/agent-protocol";
import { getJson, postJson, putJson } from "./_fetch";

export async function apiListSkills(): Promise<SkillMeta[]> {
  const data = await getJson<{ skills: SkillMeta[] }>("/api/skills");
  return data?.skills ?? [];
}

export async function apiGetSkill(name: string): Promise<SkillMeta | null> {
  const data = await getJson<{ skill: SkillMeta }>(`/api/skills/${encodeURIComponent(name)}`);
  return data?.skill ?? null;
}

export async function apiCreateSkill(skill: Omit<SkillMeta, "source">): Promise<void> {
  await postJson("/api/skills", skill);
}

export async function apiUpdateSkill(name: string, skill: SkillMeta): Promise<void> {
  await putJson(`/api/skills/${encodeURIComponent(name)}`, skill);
}

export async function apiSetSkillDisabled(name: string, disabled: boolean): Promise<void> {
  const r = await putJson<{ success: boolean }>(
    `/api/skills/${encodeURIComponent(name)}/disabled`,
    { disabled },
  );
  if (!r?.success) throw new Error(`Toggle disabled failed: ${name}`);
}

export async function apiExportSkill(name: string): Promise<Blob> {
  const r = await fetch(`/api/skills/${encodeURIComponent(name)}/export`);
  if (!r.ok) throw new Error(`Export failed: ${name}`);
  return r.blob();
}

export async function apiImportSkillZip(
  buffer: ArrayBuffer,
): Promise<{ name: string; warnings: string[] }> {
  const r = await fetch("/api/skills/import-zip", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: buffer,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || "Import failed");
  return { name: data.name ?? "", warnings: data.warnings ?? [] };
}

export async function apiDeleteSkill(name: string): Promise<void> {
  await fetch(`/api/skills/${encodeURIComponent(name)}`, { method: "DELETE" });
}

// ── 技能市场 ──────────────────────────────────────────────
export async function apiListMarketSkills(query?: string): Promise<MarketSkill[]> {
  const q = query ? `?q=${encodeURIComponent(query)}` : "";
  const data = await getJson<{ skills: MarketSkill[] }>(`/api/market/skills${q}`);
  return data?.skills ?? [];
}

export async function apiInstallMarketSkill(name: string, sourceId = "official"): Promise<{ success: boolean; reason?: string; message?: string }> {
  const r = await fetch("/api/market/skills/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId, name }),
  });
  const data = await r.json().catch(() => null) as { success?: boolean; reason?: string; message?: string } | null;
  if (r.ok) {
    return { success: true, ...data };
  }
  // 解析后端返回的详细错误信息
  return {
    success: false,
    reason: data?.reason ?? "",
    message: data?.message ?? (r.status >= 500 ? "服务器错误，请稍后重试" : "安装失败"),
  };
}

