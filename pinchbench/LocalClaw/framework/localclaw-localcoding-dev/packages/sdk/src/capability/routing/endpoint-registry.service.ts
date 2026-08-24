import { logger } from "../../util/logger";
import { randomBytes } from "crypto";
import { resolveUpstream, authHeaders, stripTrailingSlash } from "../provider/provider-descriptor";
import { DEFAULT_CLAUDE_MODELS } from "./endpoint-presets";
import { Injectable, OnModuleInit } from "@nestjs/common";
import {
  readAgentSettings as readLocalClawSettings,
  writeAgentSettings as writeLocalClawSettings,
} from "../../config/agent-settings";
import type { EndpointConfig, EndpointInfo, ModelConfig, EndpointCreateInput, EndpointUpdateInput } from "@lenovo/agent-protocol";

const SETTINGS_KEY = "endpoints";

/**
 * 构造一个走网关的 anthropic endpoint（迁移与 seed 共用「造合法对象」的知识，
 * 不共用带撞名守卫的 create/update）。enabled 恒 true，channel 缺省走 gateway。
 */
function buildAnthropicEndpoint(opts: {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  models: ModelConfig[];
}): EndpointConfig {
  return {
    id: opts.id,
    label: opts.label,
    apiType: "anthropic",
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    enabled: true,
    models: opts.models,
  };
}

/** 一处「模型 id 跨 endpoint 撞名」的冲突描述。 */
export type ModelIdConflict = { modelId: string; endpointIds: string[] };

/**
 * 连通性测试结果。suggestedApiType：当失败特征强烈指向「协议类型选反」
 * （如 OpenAI 兼容端点返回 HTML/404、或 Anthropic 端点 404）时，给出建议切换的
 * 协议类型，前端据此渲染「一键切换并重试」按钮。无把握时不带此字段。
 */
export type EndpointTestResult = {
  ok: boolean;
  error?: string;
  suggestedApiType?: EndpointConfig["apiType"];
};

/**
 * 公开模型 id 不唯一时抛出。公开 id 是路由契约（网关靠 body.model 查表），
 * 撞名会导致 resolveModel 静默路由到第一个命中的 endpoint（误路由）。
 */
export class ModelIdConflictError extends Error {
  constructor(public readonly conflicts: ModelIdConflict[]) {
    const detail = conflicts
      .map(c => `"${c.modelId}" 同时存在于 ${c.endpointIds.join(" / ")}`)
      .join("；");
    super(`模型 id 跨服务重复：${detail}`);
    this.name = "ModelIdConflictError";
  }
}

/** 按 id 更新/操作时目标 endpoint 不存在时抛出。上层转 404。 */
export class EndpointNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`endpoint 不存在：${id}`);
    this.name = "EndpointNotFoundError";
  }
}

/** @internal 从模型名提取档位，用于跨别名的模糊匹配（haiku/sonnet/opus）。 */
export function modelTier(modelId: string): "haiku" | "sonnet" | "opus" | null {
  const s = modelId.toLowerCase();
  if (s.includes("haiku")) return "haiku";
  if (s.includes("sonnet")) return "sonnet";
  if (s.includes("opus")) return "opus";
  return null;
}

/**
 * 在 enabled endpoint 间检查公开模型 id 是否唯一。返回所有撞名冲突（空数组=无冲突）。
 * 仅 enabled endpoint 参与——disabled 的不参与路由，撞名无害。
 */
export function findModelIdConflicts(endpoints: EndpointConfig[]): ModelIdConflict[] {
  const owners = new Map<string, string[]>();
  for (const ep of endpoints) {
    if (!ep.enabled) continue;
    for (const m of ep.models ?? []) {
      const list = owners.get(m.id) ?? [];
      // 同一 endpoint 内重复 id 不算跨服务冲突（属该 endpoint 自身的数据问题，从宽处理）
      if (!list.includes(ep.id)) list.push(ep.id);
      owners.set(m.id, list);
    }
  }
  const conflicts: ModelIdConflict[] = [];
  for (const [modelId, endpointIds] of owners) {
    if (endpointIds.length > 1) conflicts.push({ modelId, endpointIds });
  }
  return conflicts;
}

/**
 * 纯查询：相对 current，next 里**新引入**的模型 id 撞名（current 已有的撞名算存量，豁免）。
 * 「豁免存量」是**交互写入**的策略：别因为遗留 A/B 早就撞名，就拦住用户保存无关的 C。
 * 故此查询只服务 create/update/upsert（有新撞名 → throw ModelIdConflictError → UI 弹 409）。
 * 迁移**不用它**：迁移问的是另一个问题——「我建的 endpoint 可达吗」，那对应 ownedModelIds
 * 的集合求交，与「是否新引入」无关（已被占就是死，管它撞名新旧）。两个调用方两个问题、两个查询。
 */
export function newModelIdConflicts(
  current: EndpointConfig[],
  next: EndpointConfig[],
): ModelIdConflict[] {
  const preexisting = new Set(findModelIdConflicts(current).map(c => c.modelId));
  return findModelIdConflicts(next).filter(c => !preexisting.has(c.modelId));
}

/**
 * 纯查询：所有 **enabled** endpoint 已占用的公开模型 id 集合。供迁移判断「候选 endpoint
 * 是否可达」——只要候选某个模型 id 落在此集合里，它就会被 resolveModel 的「首个命中」遮蔽
 * 成死 endpoint。只数 enabled：disabled 不参与路由，不构成遮蔽。
 * models 用 `?? []` 兜底：脏/旧 schema 的端点可能缺 models 字段，迁移契约是「永不失败」。
 */
export function ownedModelIds(endpoints: EndpointConfig[]): Set<string> {
  const owned = new Set<string>();
  for (const ep of endpoints) {
    if (!ep.enabled) continue;
    for (const m of ep.models ?? []) owned.add(m.id);
  }
  return owned;
}

/** @internal 路由端点注册表，非公共契约。 */
@Injectable()
export class EndpointRegistryService implements OnModuleInit {
  private endpoints: EndpointConfig[] = [];

  onModuleInit(): void {
    // 单一数据源：~/.localclaw/settings.json 的 "endpoints" 字段。
    // 路径基于 homedir() 恒定，不随 process.cwd() 变化，避免「不同目录启动读到不同库」。
    const settings = readLocalClawSettings();

    // 第一步：迁移 directEnv（旧「默认 Claude 通道」直连配置）→ 普通 endpoint。
    // 这是合法的用户配置迁移（把用户曾配过的直连转成普通端点），与已删除的 seedDefaults
    // 无关。一次性、幂等、永不失败，不走带撞名守卫的 create/update（那是交互编辑边界，
    // 撞名要弹 409；boot 期无人在环，守卫只会降级成静默归档）。
    this.migrateDirectEnvToEndpoint(settings);

    // 第二步：纯加载 endpoints（迁移已把 directEnv 转入 settings.endpoints）。
    // 不再有 seed 分支——见 loadEndpoints 注释。
    this.loadEndpoints(settings);
  }

  /**
   * 从 settings 加载 endpoints（纯加载，无 seed）。
   *
   * 设计原则（对齐旗舰产品：env 是运行时覆盖层，不快照进配置）：endpoints 文件
   * **只装用户显式创建的端点**。系统从不读环境变量「种」默认端点——历史的
   * seedDefaults（读 ANTHROPIC_AUTH_TOKEN/OPENAI_API_KEY 种 sky/openrouter 并 persist）
   * 是测试脚手架，已删除。它把 env 瞬时值快照写盘，派生出两层塌缩、endpointsSeeded
   * 标记、以及「文件异常空读 → 摧毁性 re-seed 覆盖用户配置」的数据丢失 bug。
   * 不再 seed 后，文件为空就是「用户还没配过」（无害，由 gateway 引导去配），
   * 不存在任何 boot 期写盘覆盖用户数据的路径。
   */
  private loadEndpoints(settings: ReturnType<typeof readLocalClawSettings>): void {
    const raw = Array.isArray(settings.endpoints) ? (settings.endpoints as EndpointConfig[]) : [];
    this.endpoints = this.sanitizeLoaded(raw);
    // sanitize 清理掉了脏数据（如旧版固化的空壳 ollama / 残留 env-direct）→ 回写一次，
    // 磁盘自愈。这是唯一的 boot 期写盘，且只在「确实清理了脏数据」时发生，永不覆盖用户端点。
    if (this.endpoints.length !== raw.length) this.persist();
    logger.log(`[endpoint-registry] loaded ${this.endpoints.length} endpoints from settings.json`);
    this.warnOnModelIdConflicts();
  }

  /**
   * 启动时检测跨 enabled endpoint 的公开模型 id 撞名，仅 **告警不改数据**。
   * 不自动改名（不静默篡改用户配置）、不 persist。真正的拦截在写入边界
   * assertUniqueModelIds（保存时撞名 → 409，前端引导用户手动改名）。
   * 存量撞名（极少见，实测 sky 扁平名 / openrouter provider 前缀本就不撞）只留日志，
   * 运行时 resolveModel 仍按「第一个命中」确定行为，不崩。
   */
  private warnOnModelIdConflicts(): void {
    const conflicts = findModelIdConflicts(this.endpoints);
    if (conflicts.length === 0) return;
    for (const c of conflicts) {
      logger.warn(
        `[endpoint-registry] 公开模型 id "${c.modelId}" 跨服务重复（${c.endpointIds.join(" / ")}）；` +
        `运行时会路由到第一个命中的服务，建议在设置中改名以消除歧义。`,
      );
    }
  }

  /**
   * 加载时清理历史脏数据：
   * 1. env-direct 虚拟项——应仅由 getPublicList 动态合成，绝不入库；若库里残留，
   *    会与动态项重复，设置页显示两个「默认 Claude 通道」。
   * 2. 空壳 local-ollama——旧版本无条件 seed 的空 ollama endpoint（models 始终为空、
   *    isUsable 恒 false）。ollama 支持已移除，仅剔除「models 为空」的那条，保留用户
   *    自行从模板建并填了模型的合法 openai-compatible 本地 endpoint。
   */
  private sanitizeLoaded(endpoints: EndpointConfig[]): EndpointConfig[] {
    return endpoints.filter(e => {
      // 历史脏数据：旧版本曾把虚拟「env-direct」直连项误存盘；直连概念已移除，剔除残留。
      if (e.id === "env-direct") return false;
      if (e.id === "local-ollama" && (!e.models || e.models.length === 0)) return false;
      return true;
    });
  }

  getAll(): EndpointConfig[] {
    return this.endpoints;
  }

  getEnabled(): EndpointConfig[] {
    return this.endpoints.filter(e => e.enabled);
  }

  getById(id: string): EndpointConfig | undefined {
    return this.endpoints.find(e => e.id === id);
  }

  getPublicList(): EndpointInfo[] {
    return this.endpoints
      .filter(e => e.enabled)
      .map(({ apiKey, ...rest }) => ({ ...rest, hasApiKey: !!apiKey }));
  }

  resolveModel(modelId: string): { endpoint: EndpointConfig; upstreamModel: string; model: ModelConfig } | null {
    // 1) 精确匹配。upstreamModel 优先取 model.upstreamModel（公开 id 与上游真实名解耦），
    //    缺省回落公开 id —— 兼容历史数据（多数 endpoint 公开 id 即上游名）。
    for (const ep of this.endpoints) {
      if (!ep.enabled) continue;
      const found = ep.models.find(m => m.id === modelId);
      if (found) return { endpoint: ep, upstreamModel: found.upstreamModel ?? found.id, model: found };
    }
    // 2) 档位模糊匹配：CLI 的小模型请求可能发内置别名（如 claude-3-5-haiku-20241022），
    //    归一到 endpoint 实际支持的同档模型，避免上游 INVALID_MODEL_ID。
    const tier = modelTier(modelId);
    if (tier) {
      for (const ep of this.endpoints) {
        if (!ep.enabled) continue;
        const found = ep.models.find(m => modelTier(m.id) === tier);
        if (found) {
          // 改动4A：模糊匹配命中即告警，使误路由不再静默——用户删/改了模型后，
          // 含同档关键字的死引用会被静默路由到「第一个同档模型」，用户以为还在用原模型。
          // 此处只观测不改行为（CLI 内置别名归一仍是正当用途）；行为收敛见独立跟踪项
          //（resolveModel 加 scopeEndpointId，与 smart-hybrid pin 耦合，单独一轮）。
          if (found.id !== modelId) {
            logger.warn(
              `[endpoint-registry] 模型 "${modelId}" 未精确匹配，按档位「${tier}」模糊路由到 ` +
              `"${found.id}"（endpoint=${ep.id}）。若该名是已删除/改名的模型，这是静默误路由。`,
            );
          }
          return { endpoint: ep, upstreamModel: found.upstreamModel ?? found.id, model: found };
        }
      }
    }
    return null;
  }

  setAll(endpoints: EndpointConfig[]): void {
    // setAll 是整表替换（无 prior 语义，多为程序化/测试调用）：严格要求全表无撞名。
    this.assertUniqueModelIds(endpoints);
    this.endpoints = endpoints;
    this.persist();
  }

  /**
   * 生成 endpoint 内部主键。endpoint id 是纯内部标识（保存配对 / 删除 / 测试 / 持久化 key），
   * 用户不可见、不可填，对齐 LiteLLM model_info.id（服务端铸 id）。用短随机而非 label 派生：
   * label 多为中文，slug 化后退化成无意义编号，随机 id 更诚实且无并发歧义。
   * 防撞集默认是 this.endpoints；迁移在 this.endpoints 尚空时跑，可传 extraIds（settings
   * 现有 id）一并防撞。
   */
  private mintId(extraIds: string[] = []): string {
    const used = new Set([...this.endpoints.map(e => e.id), ...extraIds]);
    for (;;) {
      const id = "ep_" + randomBytes(4).toString("hex").slice(0, 6);
      if (!used.has(id)) return id;
    }
  }

  /**
   * 新建 endpoint。返回落库后的完整对象。
   * - 入参带 id（预设新建，如 "deepseek"）：沿用该可读 id，但若已被占用则回退铸新 id（防撞名）。
   * - 入参无 id（自定义新建）：服务端铸内部主键 ep_xxxxxx。
   * 撞名校验同写入边界：只拒新引入的模型 id 撞名（抛 ModelIdConflictError → 上层 409）。
   */
  create(input: EndpointCreateInput): EndpointConfig {
    const { id: wantId, ...rest } = input;
    const id = wantId && !this.endpoints.some(e => e.id === wantId)
      ? wantId
      : this.mintId();
    const endpoint: EndpointConfig = { ...rest, id };
    const next = [...this.endpoints, endpoint];
    this.assertNoNewConflicts(next);
    this.endpoints = next;
    this.persist();
    return endpoint;
  }

  /**
   * 按 id 局部更新 endpoint。未提供的字段保持原值；apiKey 省略或空串 = 不改 key
   * （前端列表脱敏，编辑时空 key 表示「不修改」）。
   *
   * 关键不变式：id 是稳定内部主键，**绝不随 label 等字段更新而改变**——它是保存配对、
   * 删除定位、测试、持久化的 key，一旦变动等于「删旧建新」会丢 apiKey、留孤儿。故
   * merged 强制保留原 id。env-direct 是动态合成的虚拟项、从不入 this.endpoints，
   * 故 update 天然不会命中它（findIndex 返回 -1 → 404），无需额外过滤。
   */
  update(id: string, patch: EndpointUpdateInput): EndpointConfig {
    const idx = this.endpoints.findIndex(e => e.id === id);
    if (idx < 0) throw new EndpointNotFoundError(id);
    const old = this.endpoints[idx];
    const apiKey = patch.apiKey ? patch.apiKey : old.apiKey;
    const merged: EndpointConfig = { ...old, ...patch, id, apiKey };
    const next = this.endpoints.map((e, i) => (i === idx ? merged : e));
    this.assertNoNewConflicts(next);
    this.endpoints = next;
    this.persist();
    return merged;
  }

  /**
   * 校验 next 相对当前状态没有**新增**模型 id 撞名。已存在于当前 endpoints 的撞名
   * （启动告警过、用户尚未处理）不算新增，放行。撞名抛 ModelIdConflictError。
   */
  private assertNoNewConflicts(next: EndpointConfig[]): void {
    const introduced = newModelIdConflicts(this.endpoints, next);
    if (introduced.length > 0) throw new ModelIdConflictError(introduced);
  }

  /** 跨 enabled endpoint 严格校验公开模型 id 全表唯一，撞名抛 ModelIdConflictError。 */
  private assertUniqueModelIds(endpoints: EndpointConfig[]): void {
    const conflicts = findModelIdConflicts(endpoints);
    if (conflicts.length > 0) throw new ModelIdConflictError(conflicts);
  }

  /** 新增或按 id 覆盖单个 endpoint。撞名校验同写入边界（只拒新引入的撞名）。 */
  upsert(endpoint: EndpointConfig): void {
    const idx = this.endpoints.findIndex(e => e.id === endpoint.id);
    const next = idx >= 0
      ? this.endpoints.map((e, i) => (i === idx ? endpoint : e))
      : [...this.endpoints, endpoint];
    this.assertNoNewConflicts(next);
    this.endpoints = next;
    this.persist();
  }

  /** 按 id 删除 endpoint。返回是否删除成功。 */
  remove(id: string): boolean {
    const before = this.endpoints.length;
    this.endpoints = this.endpoints.filter(e => e.id !== id);
    if (this.endpoints.length === before) return false;
    this.persist();
    return true;
  }

  /** 是否存在至少一个「可发请求」的 endpoint：启用 + 有模型 + (本地 or 已填 key)。 */
  hasUsableEndpoint(): boolean {
    return this.endpoints.some(e => this.isUsable(e));
  }

  private isUsable(e: EndpointConfig): boolean {
    if (!e.enabled || e.models.length === 0) return false;
    // 本地端点（host 为 127.0.0.1 / localhost）无需 key。与前端 utils/endpointUsable 同口径：
    // 锚定到 host 段，避免 localhost.evil.com 这类把本地名当子域的远程地址被误判为本地。
    const isLocal = e.apiType === "openai-compatible"
      && /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:[/?#]|$)/i.test(e.baseUrl);
    return isLocal || !!e.apiKey;
  }

  /** 第一个可用 endpoint 的首个模型 id，用作默认/回退模型。无可用时返回 null。 */
  getFirstUsableModel(): string | null {
    const ep = this.endpoints.find(e => this.isUsable(e));
    return ep?.models[0]?.id ?? null;
  }

  /**
   * 反查模型的可读名（label）。优先在指定 endpoint 内找；找不到再全局精确匹配。
   * 供渠道查询「当前模型」时展示友好名称。无任何命中时返回 modelId 本身。
   */
  findModelLabel(modelId: string, endpointId?: string): string {
    const search = (ep: EndpointConfig | EndpointInfo) =>
      ep.models.find(m => m.id === modelId);
    if (endpointId) {
      const ep = this.getById(endpointId);
      const hit = ep && search(ep);
      if (hit) return hit.label || hit.id;
    }
    for (const ep of this.endpoints) {
      const hit = search(ep);
      if (hit) return hit.label || hit.id;
    }
    return modelId;
  }

  private persist(): void {
    // 写回 settings.json 的 endpoints 字段（保留其余字段，原子写）
    const settings = readLocalClawSettings();
    settings[SETTINGS_KEY] = this.endpoints;
    writeLocalClawSettings(settings);
  }

  /**
   * 一次性迁移：把 settings.directEnv（旧「默认 Claude 通道」直连配置）转成普通的
   * 走网关 anthropic endpoint。**在 load 之前跑**，直接构造 endpoint 写进
   * settings.endpoints —— 不走 create/update（那是交互编辑边界，撞名要弹 409；
   * 一次性迁移必须幂等、永不失败，是 boot 期数据转换，属不同抽象层，对齐旗舰做法）。
   *
   * 三条出路，均不销毁凭据（对齐 Action A「备份不删」）：
   *  - 不完整（缺 BASE_URL/TOKEN）→ 归档 directEnv；
   *  - 候选的**全部**模型 id 都已被现有 enabled endpoint 占用 → 候选是真·死 endpoint（每个模型
   *    都被 resolveModel 的「首个命中」遮蔽），纯污染 → 归档 directEnv，凭据留档备查；
   *  - 否则 → append「Claude 默认服务」，但**只含未被占用的模型**（survivors）。被占的模型
   *    经既有 owner 仍可达，放进候选只会造影子 id；剔掉它们既不丢真能力、也不引入撞名。删 directEnv。
   *
   * 决策粒度 == 不变量粒度 == **模型**：可达性是逐模型的，不是端点级全有或全无。早期版本用
   * 「任一模型撞名 → 归档整个 directEnv」，会连累候选里可达的兄弟模型（违背「不丢能力」原则）；
   * 降到逐模型后这类过度归档在结构上不可能。判据是 ownedModelIds（「这个模型 id 被占了吗」），
   * **不是** newModelIdConflicts（那编码交互写入的「豁免存量撞名」策略，与迁移无关）。也**不做**
   * upstream 去重：「上游 URL 唯一」从来不是系统不变量。唯一不变量是「模型 id 跨 enabled endpoint 唯一」。
   *
   * 现有 endpoint 先 sanitizeLoaded 再判：迁移在 load 之前跑，settings.endpoints 可能含
   * 即将被 sanitize 清掉的脏数据（残留 env-direct / 空壳 local-ollama）。若拿脏数据判占用，
   * 会因一条马上要消失的行误归档 directEnv → 用户两头落空。故此处用与 load 同口径的 sanitize 结果。
   *
   * 幂等：删/归档后字段不再是 directEnv，重启即跳过。settings 是 onModuleInit 刚读的
   * 新鲜对象，直接 mutate + 写一次盘即可（无需 fresh re-read）。
   */
  private migrateDirectEnvToEndpoint(settings: ReturnType<typeof readLocalClawSettings>): void {
    const directEnv = settings.directEnv as Record<string, unknown> | undefined;
    if (!directEnv) return;

    const baseUrl = directEnv.ANTHROPIC_BASE_URL;
    const token = directEnv.ANTHROPIC_AUTH_TOKEN;

    // 不完整 → 归档不删（保留凭据）。reason 列出缺失键（用 filter+join，
    // 避免两键同缺时拼出空串/多余分隔符）。
    if (typeof baseUrl !== "string" || !baseUrl || typeof token !== "string" || !token) {
      const missing = [
        (typeof baseUrl !== "string" || !baseUrl) && "ANTHROPIC_BASE_URL",
        (typeof token !== "string" || !token) && "ANTHROPIC_AUTH_TOKEN",
      ].filter(Boolean).join(" / ");
      this.archiveDirectEnv(settings, `缺少必需键：${missing}`);
      return;
    }

    const models = this.parseDirectEnvModels(directEnv);
    // 与 load 同口径 sanitize：避免拿即将被清掉的脏数据（残留 env-direct 等）误判占用。
    const rawEndpoints = Array.isArray(settings.endpoints)
      ? (settings.endpoints as EndpointConfig[])
      : [];
    const existingEndpoints = this.sanitizeLoaded(rawEndpoints);

    // 决策粒度 == 不变量粒度 == 模型：可达性是逐模型的，不是端点级全有或全无。
    // 被占的模型经既有 owner 仍可达，候选里放它只会造影子 id；可达的模型只在候选里有 owner。
    // 故只迁「未被占用」的模型（survivors）：
    //  - survivors 为空（全部被占）→ 候选是真·死 endpoint → 归档（对齐「全遮蔽才算污染」）；
    //  - 否则 → append 仅含 survivors 的候选，不丢能力、不引入撞名、不造影子 id。
    const owned = ownedModelIds(existingEndpoints);
    const survivors = models.filter((m) => !owned.has(m.id));
    if (survivors.length === 0) {
      // 全部被占 → 归档（append 出的端点每个模型都被遮蔽，纯污染）。凭据留档备查，绝不静默销毁。
      const occupied = models.map((m) => `"${m.id}"`).join(" / ");
      this.archiveDirectEnv(
        settings,
        `模型 ${occupied} 已被现有服务占用，directEnv 留档备查；改名后可恢复迁移`,
      );
      return;
    }

    // 有可达模型 → append（仅含 survivors；被占模型经既有 owner 可达，丢之不丢真能力）。
    const candidate = buildAnthropicEndpoint({
      id: this.mintId(existingEndpoints.map((e) => e.id)),
      label: "Claude 默认服务",
      baseUrl: stripTrailingSlash(baseUrl), // 原样搬运（仅去尾斜杠），descriptor 解析时归一 /v1
      apiKey: token,
      models: survivors,
    });
    settings.endpoints = [...existingEndpoints, candidate];
    delete settings.directEnv; // token 已活在 endpoint.apiKey，删字段不丢凭据
    writeLocalClawSettings(settings);
    logger.log(
      `[endpoint-registry] migration: directEnv → endpoint "${candidate.id}" (${models.length} models)`,
    );
  }

  /** 解析 directEnv 的模型列表：ANTHROPIC_MODELS 数组 → ANTHROPIC_MODEL 单值 → 默认三档。 */
  private parseDirectEnvModels(directEnv: Record<string, unknown>): ModelConfig[] {
    const rawModels = directEnv.ANTHROPIC_MODELS;
    if (Array.isArray(rawModels)) {
      // 校验 model 对象：id 必须是字符串，label 若非字符串归一化为 id（#4）。
      const parsed = rawModels
        .filter((m: any) => m && typeof m.id === "string")
        .map((m: any) => ({
          id: m.id,
          label: typeof m.label === "string" ? m.label : m.id,
          tags: Array.isArray(m.tags) ? m.tags : undefined,
          upstreamModel: typeof m.upstreamModel === "string" ? m.upstreamModel : undefined,
          maxOutputTokens: typeof m.maxOutputTokens === "number" ? m.maxOutputTokens : undefined,
        }));
      if (parsed.length > 0) return parsed;
    }
    const singleModel = directEnv.ANTHROPIC_MODEL;
    if (typeof singleModel === "string" && singleModel) {
      return [{ id: singleModel, label: singleModel }];
    }
    return [...DEFAULT_CLAUDE_MODELS]; // 单一事实源（#5），克隆避免共享可变引用
  }

  /**
   * 归档 directEnv 为 directEnvArchived（保留凭据不销毁），删 directEnv，写回。
   * 对应 Action A 的「备份不删」规则：降级可以，销毁不行。直接 mutate 入参 settings
   * （迁移在 load 之前跑，settings 是 onModuleInit 刚读的新鲜对象）。
   */
  private archiveDirectEnv(settings: ReturnType<typeof readLocalClawSettings>, reason: string): void {
    if (!settings.directEnv) return;
    settings.directEnvArchived = {
      ...(settings.directEnv as Record<string, unknown>),
      _archivedReason: reason,
      _archivedAt: new Date().toISOString(),
    };
    delete settings.directEnv;
    writeLocalClawSettings(settings);
    logger.warn(
      `[endpoint-registry] migration: directEnv 归档至 directEnvArchived（${reason}）。` +
        `凭据已保留，可在 settings.json 手工恢复或补全后重启完成迁移。`,
    );
  }

  /** 连通性测试：查表后委托 testEndpointByConfig。 */
  async testEndpoint(id: string): Promise<EndpointTestResult> {
    const ep = this.getById(id);
    if (!ep) return { ok: false, error: "endpoint 不存在" };
    return this.testEndpointByConfig(ep);
  }

  /**
   * 用给定配置（不依赖 id / 不查表）测试连通性。供两类调用方共用：
   *  1) testEndpoint(id)：查表得 config 后委托此处（既有「测已存服务」路径）；
   *  2) 临时测试（test-preview）：用表单当前值直接测，无需先落库。
   *
   * 对 endpoint 打一发**与真实发消息同路径**的轻量请求，验证 baseUrl + apiKey 可用。
   * 关键：openai-compatible 用 POST /chat/completions（而非 GET /models），
   * 否则会出现「测试通过但发消息失败」的误导（/models 可达不代表 /chat/completions 可达）。
   * 同时检测上游返回 HTML 的情况（baseUrl 漏 /v1 时打到网页）。
   */
  async testEndpointByConfig(ep: EndpointConfig): Promise<EndpointTestResult> {
    // 协议选反时建议切换的目标类型：与当前相反。HTML/404 这类「打错了门」的失败常源于此。
    const otherApiType: EndpointConfig["apiType"] =
      ep.apiType === "anthropic" ? "openai-compatible" : "anthropic";
    try {
      const m = ep.models[0];
      if (!m) return { ok: false, error: "请先添加至少一个模型" };

      // 经 resolveUpstream 解析 URL + 上游真名 + auth：与对话路径同源，杜绝
      // 「测试成功但对话失败」。purpose 按 apiType 选 messages / chat。
      const purpose = ep.apiType === "anthropic" ? "messages" : "chat";
      const { url, upstreamModel, auth } = resolveUpstream(ep, m, purpose);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...authHeaders(auth, ep.apiKey),
      };
      if (ep.apiType === "anthropic") headers["anthropic-version"] = "2023-06-01";

      const resp = await fetch(url, {
        method: "POST",
        headers,
        // max_tokens 取 16 而非 1：部分上游对过小的 max_tokens 回参数类 400（旧代码因此
        // 不得不把 4xx 一律当成功，从而吞掉「模型名无效」这类真错）。16 足以清除最小值
        // 校验，使「任何 4xx 都是真错」成立——这是下面忠实判定的前提。
        // 实测：DeepSeek 推理模型在小 max_tokens 下回 200 + content:[{thinking}]、
        // stop_reason:max_tokens（合法但截断、可能零 text），故判定只看信封结构不看 text。
        body: JSON.stringify({ model: upstreamModel, max_tokens: 16, messages: [{ role: "user", content: "ping" }] }),
      });

      const ct = resp.headers.get("content-type") || "";
      if (ct.includes("text/html")) {
        return { ok: false, error: "返回了网页而非 API，请检查 Base URL（通常需以 /v1 结尾）" };
      }
      if (resp.status === 401 || resp.status === 403) {
        return { ok: false, error: `鉴权失败 (${resp.status})，请检查 API Key` };
      }
      if (resp.status === 404) {
        // 404 = 打到了不存在的路径。两类根因，归因要克制：
        //  (a) openai-compatible 且 baseUrl 漏 /v1（如 https://host 而非 https://host/v1）
        //      —— 最常见的配置错误。genericOpenAI.resolveUrl 刻意不补 /v1，故漏写即 404。
        //      此时切协议是南辕北辙：表单已有「补全 /v1」内联提示在引导，这里**不给**
        //      suggestedApiType，避免与之打架把用户带偏（azure 走 deployment 路径不在此列）。
        //  (b) 其余 404（含已带 /vN 仍 404）→ 更可能是协议选反，给切换建议供一键修正。
        const looksLikeMissingV1 =
          ep.apiType === "openai-compatible" && !ep.azure && !/\/v\d+\/?$/.test((ep.baseUrl ?? "").trim());
        return looksLikeMissingV1
          ? { ok: false, error: "接口不存在 (404)，Base URL 可能缺少 /v1 后缀（OpenAI 兼容服务常见）" }
          : { ok: false, error: "接口不存在 (404)，请检查 Base URL，或协议类型可能选反了", suggestedApiType: otherApiType };
      }

      // ── 忠实判定：解析响应体，校验「信封结构」而非状态码或 text 内容 ──
      // 这是 Phase 2.5 的核心：测试必须与真实对话同样地解读上游响应，否则会
      // 复现「测试成功但对话失败」（旧逻辑：2xx/4xx 一律 ok）。
      const text = await resp.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        // 2xx 却不是合法 JSON（且非已拦截的 HTML）→ 可疑，判失败。
        return { ok: false, error: `上游响应不是有效 JSON (${resp.status})：${text.slice(0, 120)}` };
      }

      // 1) 错误信封 → 失败并回传上游原文。覆盖：模型名无效（anthropic
      //    {type:"error",error:{type:"invalid_request_error",...}} / openai
      //    {error:{code:"model_not_found",...}}）、无可用渠道、配额等语义错误。
      const errObj =
        json && json.type === "error" ? json.error :
        json && json.error ? json.error : undefined;
      if (errObj) {
        const msg = (typeof errObj === "string" ? errObj : errObj.message) || "上游返回错误";
        // 已知模式给更友好的前缀，其余原文回传。
        if (/model_not_found|no.*channel|无可用渠道|distributor|supported model/i.test(msg)) {
          return { ok: false, error: `上游无此模型或渠道：${String(msg).slice(0, 140)}` };
        }
        return { ok: false, error: `上游错误：${String(msg).slice(0, 140)}` };
      }

      // 2) 无错误信封但 HTTP 非 2xx → 失败（带状态码与片段，便于诊断）。
      if (!resp.ok) {
        return { ok: false, error: `上游返回 ${resp.status}：${text.slice(0, 120)}` };
      }

      // 3) 2xx + 成功信封结构校验（只看结构，不要求 text 非空——容忍 thinking-only /
      //    stop_reason:max_tokens 截断）。anthropic: {type:"message",content:[...]}；
      //    openai: {choices:[...]}。识别到任一即连通且模型可用。
      const isAnthropicMsg = json && json.type === "message" && Array.isArray(json.content);
      const isOpenAIChat = json && Array.isArray(json.choices);
      if (isAnthropicMsg || isOpenAIChat) {
        return { ok: true };
      }

      // 4) 2xx + 合法 JSON + 无错误 + 形态不识别：宽容判通（避免误伤非标准但可用的
      //    上游）。严判只施加在「有错误信封」一侧，正是 Phase 2.5 的不对称设计。
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || "无法连接" };
    }
  }
}
