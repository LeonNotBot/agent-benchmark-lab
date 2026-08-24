import type { Template, TemplateSummary } from "@lenovo/agent-protocol";
import { getJson, postJson, deleteJson } from "./_fetch";

export async function apiListTemplates(): Promise<TemplateSummary[]> {
  const data = await getJson<{ templates: TemplateSummary[] }>("/api/templates");
  return data?.templates ?? [];
}

export async function apiGetTemplate(slug: string): Promise<Template | null> {
  const data = await getJson<{ template: Template }>(`/api/templates/${encodeURIComponent(slug)}`);
  return data?.template ?? null;
}

export async function apiSaveTemplate(
  template: Omit<Template, "builtin">,
): Promise<TemplateSummary | null> {
  const data = await postJson<{ template: TemplateSummary }>("/api/templates", { template });
  return data?.template ?? null;
}

export async function apiDeleteTemplate(slug: string): Promise<boolean> {
  const data = await deleteJson<{ ok: boolean }>(`/api/templates/${encodeURIComponent(slug)}`);
  return data?.ok === true;
}
