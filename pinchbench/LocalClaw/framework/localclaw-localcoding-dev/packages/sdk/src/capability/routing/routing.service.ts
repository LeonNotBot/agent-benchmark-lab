import { logger } from "../../util/logger";
import { Injectable, Inject, OnModuleInit } from "@nestjs/common";
import { DeviceCapabilityService } from "./device-capability.service";
import { SmartHybridService, buildGatewayEnv, buildGatewayAnthropicEnv, buildDirectEnv, buildBedrockEnv, buildVertexEnv, buildFoundryEnv } from "./smart-hybrid.service";
import { EndpointRegistryService } from "./endpoint-registry.service";
import { type SessionRoutingOverride } from "../../core/session/session.service";
import type { RoutingDecision, RoutingPreference, DeviceCapabilities, SmartHybridConfig, ActiveCloudModel } from "@lenovo/agent-protocol";

/** 注册表无可用模型时的兜底名（仅用于让 CLI 启动，真正请求会被网关拦下并引导配置）。 */
const FALLBACK_CLOUD_MODEL = "claude-sonnet-4-6";

/**
 * ROUTING_SERVICE —— IRoutingService 的 NestJS 注入令牌（@public）。
 * 对外接入方用 `@Inject(ROUTING_SERVICE) svc: IRoutingService` 注入，依赖接口而非具体类。
 */
export const ROUTING_SERVICE = Symbol("ROUTING_SERVICE");

/**
 * IRoutingService —— 对外稳定的路由能力接口（@public）。
 *
 * 只暴露偏好读写、设备能力查询与模型推荐等对外有意义的方法；
 * 内部编排方法（route / buildEnvForDecision / forceCloudDecision）
 * 是 Runner 流水线专用，不进对外接口，可随实现演进。
 */
export interface IRoutingService {
  setPreference(opts: {
    preference: RoutingPreference;
    modelOverride?: string;
    smartHybridConfig?: SmartHybridConfig;
    endpointId?: string;
  }): void;
  getPreference(): RoutingPreference;
  getCapabilities(): DeviceCapabilities;
  /** 当前活跃云端模型快照，供渠道查询「现在用的是哪个大模型」。 */
  getActiveCloudModel(): ActiveCloudModel;
  /** 注册活跃模型变更监听器（如渠道 daemon 据此热切换）。返回取消注册函数。 */
  onActiveModelChange(listener: (model: ActiveCloudModel) => void): () => void;
}

@Injectable()
export class RoutingService implements OnModuleInit, IRoutingService {
  private preference: RoutingPreference = "standard";
  private modelOverride: string | undefined;
  private selectedEndpointId: string | undefined;
  /** 活跃模型变更监听器集合（渠道 daemon 等订阅）。 */
  private readonly activeModelListeners = new Set<(model: ActiveCloudModel) => void>();

  constructor(
    @Inject(DeviceCapabilityService) private readonly device: DeviceCapabilityService,
    @Inject(SmartHybridService) private readonly smartHybrid: SmartHybridService,
    @Inject(EndpointRegistryService) private readonly endpoints: EndpointRegistryService,
  ) {}

  onModuleInit(): void {
    // 设备能力探测在 DeviceCapabilityService.onModuleInit 完成；此处无需额外初始化。
  }

  /**
   * 设置路由偏好。
   *
   * 入参为单一 options 对象（而非位置参数）：新增可选字段不会破坏既有调用方，
   * 是对外稳定的接口形态。
   */
  setPreference(opts: {
    preference: RoutingPreference;
    modelOverride?: string;
    smartHybridConfig?: SmartHybridConfig;
    endpointId?: string;
  }): void {
    const { preference, modelOverride, smartHybridConfig, endpointId } = opts;
    this.preference = preference;
    this.modelOverride = modelOverride;
    this.selectedEndpointId = endpointId;
    this.smartHybrid.configure(preference === "smart-hybrid" ? smartHybridConfig ?? null : null);
    logger.log(`[routing] Preference set to: ${preference}${modelOverride ? ` (model: ${modelOverride})` : ""}${endpointId ? ` (endpoint: ${endpointId})` : ""}`);
    this.notifyActiveModelChange();
  }

  getPreference(): RoutingPreference { return this.preference; }

  getCapabilities(): DeviceCapabilities {
    return this.device.getCapabilities();
  }

  /**
   * 解析本次路由的有效偏好：会话级 override 优先，否则回退全局状态。
   * smart-hybrid 现为会话级——override 可携带 smartHybridConfig（Composer 每会话选定）；
   * 无 override 时回落全局 RoutingService 状态（渠道/定时任务等非-Composer 路径的兜底）。
   */
  private resolvePref(override?: SessionRoutingOverride): {
    preference: RoutingPreference;
    modelOverride: string | undefined;
    endpointId: string | undefined;
    smartHybridConfig: SmartHybridConfig | undefined;
  } {
    if (override) {
      return {
        preference: override.preference,
        modelOverride: override.modelOverride,
        endpointId: override.endpointId ?? this.selectedEndpointId,
        // 会话级 SH：只认 override 自带的 config。绝不回落全局——否则未选 SH 的会话
        // 会串带上一个会话写进全局的 SH 配置（bug #3）。override 存在即代表该会话
        // 已明确表达意图：有 smartHybridConfig=走 SH，无=走单模型。
        smartHybridConfig: override.smartHybridConfig ?? undefined,
      };
    }
    return {
      preference: this.preference,
      modelOverride: this.modelOverride,
      endpointId: this.selectedEndpointId,
      smartHybridConfig: this.smartHybrid.getConfig() ?? undefined,
    };
  }

  async route(
    override?: SessionRoutingOverride,
  ): Promise<RoutingDecision> {
    const { preference, modelOverride, endpointId, smartHybridConfig } = this.resolvePref(override);
    if (preference === "smart-hybrid" && smartHybridConfig) {
      return this.cloudDecision("Smart Hybrid: 使用网关路由", smartHybridConfig.defaultModel.model, smartHybridConfig.defaultModel.endpointId);
    }

    // standard（及任何未显式处理的 preference，含历史遗留的 "auto"/"cloud"/"local"）：
    // 用选定的 model/endpoint 走云端。路由统一由 gateway 按模型名决定。
    return this.cloudDecision("使用选定的云端模型", modelOverride, undefined, endpointId);
  }

  /** 强制云端决策，用于 channel/IM 等不能容忍空回复的场景。 */
  async forceCloudDecision(override?: SessionRoutingOverride): Promise<RoutingDecision> {
    const { modelOverride, endpointId } = this.resolvePref(override);
    return this.cloudDecision("Channel 场景：强制使用云端模型", modelOverride, undefined, endpointId);
  }

  buildEnvForDecision(decision: RoutingDecision, override?: SessionRoutingOverride): Record<string, string> {
    const { preference, smartHybridConfig } = this.resolvePref(override);
    if (preference === "smart-hybrid" && smartHybridConfig) {
      // smart-hybrid 的协议由 default 模型所属 endpoint 的 apiType 决定。
      // 会话级 config 优先（resolvePref 已解析：override.smartHybridConfig > 全局）。
      const apiType = this.resolveApiType(smartHybridConfig.defaultModel.endpointId);
      return this.smartHybrid.buildEnvOverrides(apiType, smartHybridConfig);
    }

    // 按部署渠道（channel）分发。channel 与 apiType（线格式）正交：
    //  - gateway（默认）：经本地网关透传，协议由 apiType 决定
    //  - direct ：CLI 直连（显式 direct endpoint，当前为 bedrock/vertex 一般化预留）
    //  - bedrock/vertex/foundry：CLI 原生直连，当前未落地（stub 抛错）
    const ep = decision.endpointId ? this.endpoints.getById(decision.endpointId) : undefined;
    const channel = ep?.channel ?? "gateway";
    switch (channel) {
      case "direct":
        return buildDirectEnv(decision.modelName);
      case "bedrock":
        return buildBedrockEnv(decision.modelName);
      case "vertex":
        return buildVertexEnv(decision.modelName);
      case "foundry":
        return buildFoundryEnv(decision.modelName);
      case "gateway":
      default: {
        // 经网关，协议由所选 endpoint 的 apiType 决定：
        //  - anthropic        → CLI 原生 Anthropic 协议打网关，网关透传到上游（无转换）
        //  - openai-compatible → CLI 走 OpenAI 协议打网关，网关透传到上游 /chat/completions
        const apiType = this.resolveApiType(decision.endpointId, decision.modelName);
        return apiType === "anthropic"
          ? buildGatewayAnthropicEnv(decision.modelName)
          : buildGatewayEnv(decision.modelName);
      }
    }
  }

  /**
   * 解析 endpoint 的 apiType，决定 CLI 用哪种协议模式 spawn——必须与 gateway 实际路由到的
   * endpoint 一致，否则 CLI 协议与上游协议错配。优先级：
   *  1) 显式 endpointId（用户在 Composer 选定）
   *  2) 无 endpointId 时按模型名走 gateway 同一套 resolveModel 反查（auto/cloud 路径）
   *  3) 都解析不到 → 回落 openai-compatible（历史默认，保守）
   * 一个 CLI 进程只能锁一种协议，故这是 endpoint 级决定。
   */
  private resolveApiType(endpointId?: string, modelName?: string): "anthropic" | "openai-compatible" {
    if (endpointId) {
      const ep = this.endpoints.getById(endpointId);
      if (ep) return ep.apiType;
    }
    if (modelName) {
      const resolved = this.endpoints.resolveModel(modelName);
      if (resolved) return resolved.endpoint.apiType;
    }
    return "openai-compatible";
  }

  private cloudDecision(reason: string, modelName?: string, provider?: string, endpointIdOverride?: string): RoutingDecision {
    // per-request override(会话级选的 endpoint)优先于全局 selectedEndpointId。
    let endpointId = endpointIdOverride ?? this.selectedEndpointId;

    const finalModelName = modelName || this.endpoints.getFirstUsableModel() || FALLBACK_CLOUD_MODEL;
    // provider 是展示/遥测字段（routing.decision 事件用），不参与实际路由。
    // 从 endpoint apiType 推断而非靠 model 名结构（id 是否含 "/"）——后者对扁平命名的
    // openai 上游（如 deepseek-chat）会误判成 firstParty。apiType 是权威来源。
    const finalProvider = provider ?? this.inferProvider(finalModelName, endpointId);
    return {
      target: "cloud",
      modelName: finalModelName,
      provider: finalProvider as RoutingDecision["provider"],
      reason,
      confidence: 1,
      endpointId,
    };
  }

  /** 从 endpoint apiType 推断展示用 provider；无法解析时回落 model 名结构启发式。 */
  private inferProvider(modelName: string, endpointId?: string): RoutingDecision["provider"] {
    const ep = endpointId ? this.endpoints.getById(endpointId) : this.endpoints.resolveModel(modelName)?.endpoint;
    if (ep) return ep.apiType === "anthropic" ? "firstParty" : "openrouter";
    return modelName.includes("/") ? "openrouter" : "firstParty";
  }

  /**
   * 解析当前活跃的云端模型快照。复用 cloudDecision 的解析链路（全局 modelOverride →
   * 首个可用模型 → 兜底），保证与渠道实际 forceCloudDecision 取到的模型一致；
   * label 经 EndpointRegistry 反查可读名。
   */
  getActiveCloudModel(): ActiveCloudModel {
    const decision = this.cloudDecision("查询当前活跃模型", this.modelOverride, undefined, this.selectedEndpointId);
    return {
      modelName: decision.modelName,
      endpointId: decision.endpointId,
      label: this.endpoints.findModelLabel(decision.modelName, decision.endpointId),
    };
  }

  onActiveModelChange(listener: (model: ActiveCloudModel) => void): () => void {
    this.activeModelListeners.add(listener);
    return () => this.activeModelListeners.delete(listener);
  }

  /** 解析当前活跃模型并广播给所有监听器；监听器异常被隔离，不影响主流程。 */
  private notifyActiveModelChange(): void {
    if (this.activeModelListeners.size === 0) return;
    let model: ActiveCloudModel;
    try {
      model = this.getActiveCloudModel();
    } catch (e) {
      logger.warn("[routing] getActiveCloudModel failed during notify:", e);
      return;
    }
    for (const listener of this.activeModelListeners) {
      try {
        listener(model);
      } catch (e) {
        logger.warn("[routing] activeModel listener failed:", e);
      }
    }
  }
}
