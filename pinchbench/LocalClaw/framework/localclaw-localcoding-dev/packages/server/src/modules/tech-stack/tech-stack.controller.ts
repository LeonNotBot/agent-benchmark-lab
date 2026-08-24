import { Controller, Get, Put, Body, Inject } from "@nestjs/common";
import { TechStackRegistrarService } from "./tech-stack-registrar.service";
import {
  readTechStackConfig,
  writeTechStackConfig,
  DEFAULT_TECH_STACK,
  type TechStackConfig,
} from "./tech-stack.config";

@Controller("api/tech-stack")
export class TechStackController {
  constructor(
    @Inject(TechStackRegistrarService)
    private readonly registrar: TechStackRegistrarService,
  ) {}

  /** 回填当前配置（缺字段已用默认值补全）。 */
  @Get()
  get(): { config: TechStackConfig } {
    return { config: readTechStackConfig() };
  }

  /** 保存配置并立即重新注入 CLAUDE.md。 */
  @Put()
  put(@Body() body: Partial<TechStackConfig>): { config: TechStackConfig } {
    const next = this.normalize(body);
    writeTechStackConfig(next);
    this.registrar.sync();
    return { config: next };
  }

  /** 强制类型与字段，避免脏数据写入 settings.json。 */
  private normalize(body: Partial<TechStackConfig>): TechStackConfig {
    const str = (v: unknown, fallback: string): string =>
      typeof v === "string" ? v : fallback;
    return {
      enabled: typeof body.enabled === "boolean" ? body.enabled : DEFAULT_TECH_STACK.enabled,
      language: str(body.language, DEFAULT_TECH_STACK.language),
      frontend: str(body.frontend, DEFAULT_TECH_STACK.frontend),
      backend: str(body.backend, DEFAULT_TECH_STACK.backend),
      database: str(body.database, DEFAULT_TECH_STACK.database),
      packageManager: str(body.packageManager, DEFAULT_TECH_STACK.packageManager),
      testing: str(body.testing, DEFAULT_TECH_STACK.testing),
      customRules: str(body.customRules, ""),
    };
  }
}
