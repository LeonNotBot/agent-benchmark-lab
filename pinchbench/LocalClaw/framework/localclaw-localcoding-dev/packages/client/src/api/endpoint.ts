import type { EndpointInfo, EndpointConfig, EndpointCreateInput } from "@lenovo/agent-protocol";
import { getJson, postJson, deleteJson } from "./_fetch";

export type EndpointPreset = {
  id: string;
  label: string;
  apiType: EndpointConfig["apiType"];
  baseUrl: string;
  apiKeyUrl?: string;
  local?: boolean;
  /** Azure OpenAI 默认 api-version；选中预设后写入 endpoint.azure。 */
  azure?: { apiVersion: string };
  /** baseUrl 含占位（如 Azure <resource>），用户必须改写。 */
  baseUrlIsTemplate?: boolean;
  models: EndpointConfig["models"];
};

export async function apiListEndpointPresets(): Promise<EndpointPreset[]> {
  return (await getJson<EndpointPreset[]>("/api/endpoint-presets")) ?? [];
}

export type ModelIdConflict = { modelId: string; endpointIds: string[] };

export type SaveEndpointResult = {
  ok: boolean;
  error?: string;
  code?: string;
  conflicts?: ModelIdConflict[];
  /** 落库后的本条对象（含服务端生成的真实 id），供保存后立即测试连通。 */
  endpoint?: EndpointInfo;
  /** 脱敏后的完整列表，供刷新设置页。 */
  endpoints?: EndpointInfo[];
};

/**
 * 读取响应 body（即便非 2xx，如 409 撞名也带冲突详情）。复用给 create/update。
 * 非 2xx 且无 body 时给通用错误文案。
 */
async function readSaveResult(r: Response): Promise<SaveEndpointResult> {
  const data = (await r.json().catch(() => null)) as SaveEndpointResult | null;
  if (data) return data;
  return { ok: false, error: r.ok ? "请求失败" : `保存失败 (${r.status})` };
}

/** 新建 endpoint。自定义新建省略/留空 id 由服务端铸；预设新建带预设 id。返回的 endpoint 带真实 id。 */
export async function apiCreateEndpoint(input: EndpointCreateInput): Promise<SaveEndpointResult> {
  try {
    const r = await fetch("/api/endpoints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return await readSaveResult(r);
  } catch {
    return { ok: false, error: "请求失败" };
  }
}

/** 局部更新 endpoint。apiKey 省略或空串 = 不改 key。模型 id 撞名时后端 409 带冲突详情。 */
export async function apiUpdateEndpoint(
  id: string,
  patch: Partial<Omit<EndpointConfig, "id">>,
): Promise<SaveEndpointResult> {
  try {
    const r = await fetch(`/api/endpoints/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return await readSaveResult(r);
  } catch {
    return { ok: false, error: "请求失败" };
  }
}

export async function apiTestEndpoint(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  return (
    (await postJson<{ ok: boolean; error?: string }>(
      `/api/endpoints/${encodeURIComponent(id)}/test`,
      {},
    )) ?? { ok: false, error: "请求失败" }
  );
}

/**
 * 临时测试（Preview）：不依赖已保存的 endpoint id，用表单当前值直接测试。
 * 供「首次添加、尚未保存」或「编辑中不想落库」的测试使用。
 */
export async function apiTestEndpointPreview(config: {
  baseUrl: string;
  apiType: EndpointConfig["apiType"];
  apiKey?: string;
  models: Array<{ id: string }>;
  id?: string;
  azure?: { apiVersion: string };
}): Promise<{ ok: boolean; error?: string; suggestedApiType?: EndpointConfig["apiType"] }> {
  return (
    (await postJson<{ ok: boolean; error?: string; suggestedApiType?: EndpointConfig["apiType"] }>(
      "/api/endpoints/test-preview",
      config,
    )) ?? { ok: false, error: "请求失败" }
  );
}

/** 探测某个模型服务的可用模型列表（供编辑卡片时从远程拉取模型名下拉选择）。
 *  apiKey 留空（编辑既有服务时）后端会回退已保存的 key；可传 id 以定位该 key。 */
export async function apiListEndpointModels(opts: {
  baseUrl: string;
  apiType: EndpointConfig["apiType"];
  apiKey?: string;
  id?: string;
}): Promise<{ ok: boolean; models: Array<{ id: string; maxOutputTokens?: number }>; error?: string }> {
  const qs = new URLSearchParams();
  qs.set("baseUrl", opts.baseUrl);
  qs.set("apiType", opts.apiType);
  if (opts.apiKey) qs.set("apiKey", opts.apiKey);
  if (opts.id) qs.set("id", opts.id);
  return (
    (await getJson<{ ok: boolean; models: Array<{ id: string; maxOutputTokens?: number }>; error?: string }>(
      `/api/endpoints/models?${qs.toString()}`,
    )) ?? { ok: false, models: [], error: "请求失败" }
  );
}

export async function apiDeleteEndpoint(
  id: string,
): Promise<{ ok: boolean; endpoints?: EndpointInfo[] }> {
  return (
    (await deleteJson<{ ok: boolean; endpoints?: EndpointInfo[] }>(
      `/api/endpoints/${encodeURIComponent(id)}`,
    )) ?? { ok: false }
  );
}
