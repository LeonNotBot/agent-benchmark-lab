import { getJson, putJson } from "./_fetch";

export type TechStackConfig = {
  enabled: boolean;
  language: string;
  frontend: string;
  backend: string;
  database: string;
  packageManager: string;
  testing: string;
  customRules: string;
};

export async function apiGetTechStack(): Promise<TechStackConfig | null> {
  const data = await getJson<{ config: TechStackConfig }>("/api/tech-stack");
  return data?.config ?? null;
}

export async function apiPutTechStack(
  config: TechStackConfig,
): Promise<TechStackConfig | null> {
  const data = await putJson<{ config: TechStackConfig }>("/api/tech-stack", config);
  return data?.config ?? null;
}
