import { Injectable, Inject } from "@nestjs/common";
import type {
  SessionStartContributor,
  SessionStartPayload,
} from "@lenovo/agent-sdk";
import type { Session, SessionRoutingOverride } from "@lenovo/agent-sdk";
import { TemplateService } from "../template/template.service";

/**
 * 模板贡献者（宿主侧）：把「应用模板」接进 SDK 的 session.start 流程。
 *
 * - contributeRouting：读模板配置 → 会话级路由覆盖（createSession 前）。
 * - afterSessionCreated：写 CLAUDE.md 副作用（startRunner 前）。
 *
 * SDK 不认识模板；TemplateService 留在 server，只在此处被适配成通用契约。
 */
@Injectable()
export class TemplateContributor implements SessionStartContributor {
  constructor(
    @Inject(TemplateService) private readonly templateService: TemplateService,
  ) {}

  contributeRouting(
    payload: SessionStartPayload,
  ): SessionRoutingOverride | undefined {
    if (!payload.templateSlug) return undefined;
    const config = this.templateService.getTemplateConfig(payload.templateSlug);
    if (!config) return undefined;
    return {
      preference: config.routingPreference,
      modelOverride: config.modelOverride,
    };
  }

  afterSessionCreated(_session: Session, payload: SessionStartPayload): void {
    if (!payload.templateSlug) return;
    this.templateService.writeTemplateClaudeMd(payload.templateSlug, payload.cwd);
  }
}
