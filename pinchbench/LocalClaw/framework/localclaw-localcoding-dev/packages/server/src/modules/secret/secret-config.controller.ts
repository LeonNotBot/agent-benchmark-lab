import { Controller, Get, Put, Body, Inject } from "@nestjs/common";
import { SecretRegistrarService } from "./secret-registrar.service";
import {
  readSecretDefConfig,
  writeSecretDefConfig,
  DEFAULT_SECRET_DEF,
  type SecretDefConfig,
  type SecretCategory,
} from "./secret-config";

/**
 * 隐私「定义」配置的读写入口。与 SecretController(api/secrets) 分开，
 * 避免与 GET /api/secrets/:key 的动态路由冲突。
 * PUT 后立即重新渲染 CLAUDE.md，使新的隐私定义即时对后续会话生效。
 */
@Controller("api/secret-config")
export class SecretConfigController {
  constructor(
    @Inject(SecretRegistrarService)
    private readonly registrar: SecretRegistrarService,
  ) {}

  /** 回填当前配置（缺字段已用默认值补全），并附带默认值供「恢复默认」用。 */
  @Get()
  get(): { config: SecretDefConfig; defaults: SecretDefConfig } {
    return { config: readSecretDefConfig(), defaults: DEFAULT_SECRET_DEF };
  }

  /** 保存配置并立即重新注入 CLAUDE.md。 */
  @Put()
  put(@Body() body: Partial<SecretDefConfig>): { config: SecretDefConfig } {
    const next = this.normalize(body);
    writeSecretDefConfig(next);
    this.registrar.syncClaudeMd();
    return { config: next };
  }

  /** 强制类型与字段，避免脏数据写入 settings.json。 */
  private normalize(body: Partial<SecretDefConfig>): SecretDefConfig {
    const cats: SecretCategory[] = Array.isArray(body.categories)
      ? body.categories
          .filter((c) => c && typeof c.label === "string" && c.label.trim() !== "")
          .map((c) => ({
            label: String(c.label).trim(),
            examples: typeof c.examples === "string" ? c.examples : "",
          }))
      : [];
    return {
      categories: cats.length > 0 ? cats : DEFAULT_SECRET_DEF.categories,
      triggerPhrases:
        typeof body.triggerPhrases === "string"
          ? body.triggerPhrases
          : DEFAULT_SECRET_DEF.triggerPhrases,
      extraRules: typeof body.extraRules === "string" ? body.extraRules : "",
    };
  }
}
