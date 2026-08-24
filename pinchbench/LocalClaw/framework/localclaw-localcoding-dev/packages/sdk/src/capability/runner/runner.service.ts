import { logger } from "../../util/logger";
import { Injectable, Inject } from "@nestjs/common";
import { RunnerSpawnService, type RunnerInput, type RunnerOptions, type RunnerHandle } from "./runner-spawn.service";
import { RoutingService } from "../routing/routing.service";

@Injectable()
export class RunnerService {
  constructor(
    @Inject(RunnerSpawnService) private readonly spawnService: RunnerSpawnService,
    @Inject(RoutingService) private readonly routingService: RoutingService,
  ) {}

  async createRunner(input: RunnerInput): Promise<{ handle: RunnerHandle; envOverrides: Record<string, string> }> {
    logger.log("[runner.service] createRunner called", { sessionId: input.session.id, prompt: input.prompt?.slice(0, 80), resumeSessionId: input.resumeSessionId });
    // 把对外的 RunnerInput 收进内部完整选项，内部中间态字段由本层填充。
    const options: RunnerOptions = { ...input };
    // 路由覆盖优先级：per-message SmartHybrid(会话选了智能升级) > per-message 单一模型
    //  > 会话级模板 override > 全局偏好。SH 与单一模型互斥（Composer 保证只传其一）。
    const templateOverride = options.session.routingOverride;
    const routingOverride = options.smartHybrid
      ? { preference: "smart-hybrid" as const, smartHybridConfig: options.smartHybrid }
      : options.modelOverride
        ? { preference: "standard" as const, modelOverride: options.modelOverride, endpointId: options.endpointId }
        : templateOverride;
    const decision = options.forceCloud
      ? await this.routingService.forceCloudDecision(routingOverride)
      : await this.routingService.route(routingOverride);
    const envOverrides = this.routingService.buildEnvForDecision(decision, routingOverride);

    // Emit routing decision via onEvent
    options.onEvent({
      type: "routing.decision",
      payload: { sessionId: options.session.id, decision },
    });

    return this.runWithEnv(options, envOverrides, decision);
  }

  private async runWithEnv(
    options: RunnerOptions,
    envOverrides: Record<string, string>,
    decision?: RunnerOptions["routingDecision"],
  ): Promise<{ handle: RunnerHandle; envOverrides: Record<string, string> }> {
    const augmentedOptions = { ...options, envOverrides, routingDecision: decision };
    logger.log(`[runner] Using spawn mode, target: ${Object.keys(envOverrides).length ? "local" : "cloud"}`);
    const handle = await this.spawnService.run(augmentedOptions);
    return { handle, envOverrides };
  }

  /**
   * 预热：为某个已存在的会话提前 spawn CLI 进程并跑到就绪，但不发送任何消息。
   * 用于「用户聚焦/切到某个 tab」时，把冷启动成本提前到用户发消息之前。
   *
   * 路由/env 准备与 createRunner 一致（同一套 fingerprint 输入），保证预热出的进程
   * 与随后真实 run() 的 fingerprint 匹配、可被复用。尽力而为：任何异常只记日志，不抛出。
   */
  async prewarmRunner(input: RunnerInput): Promise<void> {
    try {
      const options: RunnerOptions = { ...input };
      const routingOverride = options.smartHybrid
        ? { preference: "smart-hybrid" as const, smartHybridConfig: options.smartHybrid }
        : options.modelOverride
          ? { preference: "standard" as const, modelOverride: options.modelOverride, endpointId: options.endpointId }
          : options.session.routingOverride;
      const decision = await this.routingService.route(routingOverride);
      const envOverrides = this.routingService.buildEnvForDecision(decision, routingOverride);
      this.spawnService.prewarm({ ...options, envOverrides, routingDecision: decision });
    } catch (e) {
      logger.warn(`[runner] prewarm failed (ignored): ${String(e)}`);
    }
  }
}
