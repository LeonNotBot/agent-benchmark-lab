import { Controller, Get, Put, Post, Patch, Delete, Param, Body, Query, Inject, Res } from "@nestjs/common";
import type { Response as ExpressResponse } from "express";
import { resolveUpstream, authHeaders, resolveDescriptor } from "@lenovo/agent-sdk";
import { EndpointRegistryService, ModelIdConflictError, EndpointNotFoundError } from "./endpoint-registry.service";
import { ENDPOINT_PRESETS } from "./endpoint-presets";
import type { EndpointInfo, EndpointConfig, EndpointCreateInput, EndpointUpdateInput } from "@lenovo/agent-protocol";

/** EndpointConfig → EndpointInfo：剥 apiKey、补 hasApiKey。返回给前端的单条对象用。 */
function toPublic(e: EndpointConfig): EndpointInfo {
  const { apiKey, ...rest } = e;
  return { ...rest, hasApiKey: !!apiKey };
}

@Controller("api")
export class ModelController {
  constructor(
    @Inject(EndpointRegistryService)
    private readonly endpointRegistry: EndpointRegistryService,
  ) {}

  /**
   * 解析 API Key：优先用用户输入（trim 后），回退到已存 key（通过 id 查表），再回退空串。
   * 复用于 testEndpointPreview 和 listEndpointModels。
   */
  private resolveApiKey(rawKey: string | undefined, id: string | undefined): string {
    return rawKey?.trim() || (id ? this.endpointRegistry.getById(id)?.apiKey ?? "" : "");
  }

  @Get("endpoints")
  listEndpoints(): EndpointInfo[] {
    return this.endpointRegistry.getPublicList();
  }

  /** 内置服务商预设，供前端「从模板新建」。 */
  @Get("endpoint-presets")
  listPresets() {
    return ENDPOINT_PRESETS;
  }

  /**
   * 新建 endpoint。id 由服务端生成（内部主键，用户不可见），返回落库后的脱敏对象。
   * 模型 id 跨服务撞名 → 409，前端引导改名。
   */
  @Post("endpoints")
  createEndpoint(@Body() body: EndpointCreateInput, @Res({ passthrough: true }) res: ExpressResponse) {
    if (!body?.label || !body?.baseUrl) {
      res.status(400);
      return { ok: false, error: "endpoint 必须有 label、baseUrl" };
    }
    try {
      const ep = this.endpointRegistry.create(body);
      return { ok: true, endpoint: toPublic(ep), endpoints: this.endpointRegistry.getPublicList() };
    } catch (err) {
      if (err instanceof ModelIdConflictError) {
        res.status(409);
        return { ok: false, code: "model_id_conflict", conflicts: err.conflicts, error: err.message };
      }
      throw err;
    }
  }

  /**
   * 局部更新 endpoint。未提供字段保持原值；apiKey 省略或空串 = 不改 key。
   * id 是稳定主键，不可改（路径参数定位，body 里的 id 即便传了也被服务端忽略）。
   */
  @Patch("endpoints/:id")
  updateEndpoint(@Param("id") id: string, @Body() body: EndpointUpdateInput, @Res({ passthrough: true }) res: ExpressResponse) {
    try {
      const ep = this.endpointRegistry.update(id, body);
      return { ok: true, endpoint: toPublic(ep), endpoints: this.endpointRegistry.getPublicList() };
    } catch (err) {
      if (err instanceof EndpointNotFoundError) {
        res.status(404);
        return { ok: false, error: err.message };
      }
      if (err instanceof ModelIdConflictError) {
        res.status(409);
        return { ok: false, code: "model_id_conflict", conflicts: err.conflicts, error: err.message };
      }
      throw err;
    }
  }

  /** 连通性测试：验证 baseUrl + apiKey 是否可用。 */
  @Post("endpoints/:id/test")
  async testEndpoint(@Param("id") id: string) {
    return this.endpointRegistry.testEndpoint(id);
  }

  /**
   * 临时测试（Preview）：不依赖已保存的 endpoint id，直接用表单当前值测试。
   * 供「首次添加、尚未保存」或「编辑中不想落库」的测试使用。
   * id 可选，用于编辑态回退已存 key（表单 key 被脱敏为空串）。
   * azure 字段透传，Azure endpoint 依赖 apiVersion。
   */
  @Post("endpoints/test-preview")
  async testEndpointPreview(@Body() body: {
    baseUrl: string;
    apiType: EndpointConfig["apiType"];
    apiKey?: string;
    models: Array<{ id: string }>;
    id?: string;
    azure?: { apiVersion: string };
  }) {
    if (!body.baseUrl || !body.models?.length) {
      return { ok: false, error: "请先填写 Base URL 和至少一个模型" };
    }
    // key 留空时回退已存 key
    const apiKey = this.resolveApiKey(body.apiKey, body.id);

    // 构造临时配置，不入库
    const tempConfig: EndpointConfig = {
      id: "__preview__",
      label: "Preview",
      enabled: true,
      baseUrl: body.baseUrl,
      apiType: body.apiType,
      apiKey,
      models: body.models,
      ...(body.azure ? { azure: body.azure } : {}),
    };
    return this.endpointRegistry.testEndpointByConfig(tempConfig);
  }

  /**
   * 探测某个模型服务的可用模型列表，供编辑卡片时「从远程拉取模型名」下拉选择。
   * 用表单当前的 baseUrl/apiType/apiKey 实时探测（首次添加、尚未保存也能用）；
   * apiKey 留空时回退已保存的 endpoint key（编辑既有服务时表单 key 为脱敏空值）。
   *
   * URL + auth 经 resolveUpstream(purpose=listModels) 解析，与对话/测试三路同源。
   * descriptor 已编码各家 listModels 拓扑（如 DeepSeek 跨到 OpenAI 侧 /v1/models +
   * Bearer，实测 anthropic 侧 /anthropic/v1/models → 404），故此处无需任何 host 特例
   * 或「404 再回退」的猜测逻辑。
   */
  @Get("endpoints/models")
  async listEndpointModels(
    @Query("baseUrl") qBaseUrl?: string,
    @Query("apiType") qApiType?: string,
    @Query("apiKey") qApiKey?: string,
    @Query("id") qId?: string,
  ): Promise<{ ok: boolean; models: Array<{ id: string; maxOutputTokens?: number }>; error?: string }> {
    const baseUrl = (qBaseUrl ?? "").trim();
    if (!baseUrl) return { ok: false, models: [], error: "请先填写 Base URL" };
    const apiType: EndpointConfig["apiType"] = qApiType === "anthropic" ? "anthropic" : "openai-compatible";
    // 表单 key 留空（编辑既有服务）→ 回退已存 key
    const apiKey = this.resolveApiKey(qApiKey, qId);

    // Azure OpenAI 例外：其「模型列表」是资源下的部署（deployment），列举接口需控制面
    // 权限（非数据面 key），且 deployment 名是用户在门户自起的——拉取既需额外权限、
    // 多数 key 也拉不到。诚实标注手填，不发注定 400/403 的请求（preset 已提示手填）。
    if (resolveDescriptor({ baseUrl, apiType }).id === "azure-openai") {
      return { ok: false, models: [], error: "Azure OpenAI 请手动填写部署名（deployment），在 Azure 门户的部署详情中查看" };
    }

    const { url, auth } = resolveUpstream({ baseUrl, apiType }, undefined, "listModels");
    const headers: Record<string, string> = { ...(apiKey ? authHeaders(auth, apiKey) : {}) };
    if (auth === "x-api-key") headers["anthropic-version"] = "2023-06-01";

    try {
      const resp = await fetch(url, { headers });

      const ct = resp.headers.get("content-type") || "";
      if (ct.includes("text/html")) {
        return { ok: false, models: [], error: "返回了网页而非 API，请检查 Base URL（通常需以 /v1 结尾）" };
      }
      if (resp.status === 401 || resp.status === 403) {
        return { ok: false, models: [], error: "鉴权失败，请检查 API Key" };
      }
      if (resp.status === 404) {
        return {
          ok: false,
          models: [],
          error: "该服务未提供模型列表接口 (404)。可能原因：\n1. Base URL 缺少 /v1 后缀（OpenAI 兼容服务常见）\n2. 协议类型选反了（试试切换协议）\n3. 该服务确实未实现模型列表接口",
        };
      }
      if (!resp.ok) return { ok: false, models: [], error: `上游返回 ${resp.status}` };
      // OpenRouter 等上游在 /models 里附带能力字段：top_provider.max_completion_tokens（输出上限）。
      // 顺带抓下来，让 endpoint 保存时自动填充 ModelConfig.maxOutputTokens，避免依赖硬编码 cap 表。
      // 上游未提供该字段（OpenAI 官方 / DeepSeek 等）时留空，由 gateway 的 cap 表兜底。
      type UpstreamModel = {
        id?: string;
        max_completion_tokens?: number;
        top_provider?: { max_completion_tokens?: number };
      };
      const json = (await resp.json()) as { data?: UpstreamModel[] };
      const models = (json.data ?? [])
        .filter((m): m is UpstreamModel & { id: string } => !!m.id)
        .map((m) => {
          const cap = m.top_provider?.max_completion_tokens ?? m.max_completion_tokens;
          return typeof cap === "number" && cap > 0
            ? { id: m.id, maxOutputTokens: cap }
            : { id: m.id };
        });
      if (models.length === 0) return { ok: false, models: [], error: "上游未返回任何模型" };
      return { ok: true, models };
    } catch (err: any) {
      return { ok: false, models: [], error: err?.message || "无法连接上游" };
    }
  }

  @Delete("endpoints/:id")
  deleteEndpoint(@Param("id") id: string) {
    const ok = this.endpointRegistry.remove(id);
    return { ok, endpoints: this.endpointRegistry.getPublicList() };
  }
}
