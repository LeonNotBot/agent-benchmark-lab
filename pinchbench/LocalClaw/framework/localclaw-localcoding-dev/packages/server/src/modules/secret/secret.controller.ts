import { Controller, Get, Post, Delete, Body, Param, Inject } from "@nestjs/common";
import { SecretService } from "./secret.service";
import type {
  SecretEntry,
  SecretListResponse,
  SecretUpsertRequest,
} from "@lenovo/agent-protocol";

@Controller("api/secrets")
export class SecretController {
  constructor(
    @Inject(SecretService) private readonly secretService: SecretService,
  ) {}

  /** GET /api/secrets — 列出所有 secrets */
  @Get()
  listSecrets(): SecretListResponse {
    return {
      secrets: this.secretService.listSecrets(),
      storagePath: this.secretService.getStoragePath(),
    };
  }

  /** GET /api/secrets/:key — 获取单个 secret */
  @Get(":key")
  getSecret(@Param("key") key: string): SecretEntry | { error: string } {
    const secret = this.secretService.getSecret(key);
    if (!secret) {
      return { error: "Secret not found" };
    }
    return secret;
  }

  /** POST /api/secrets — 创建或更新 secret */
  @Post()
  upsertSecret(@Body() dto: SecretUpsertRequest): SecretEntry {
    return this.secretService.upsertSecret(dto);
  }

  /** DELETE /api/secrets/:key — 删除 secret */
  @Delete(":key")
  deleteSecret(@Param("key") key: string): { success: boolean } {
    const success = this.secretService.deleteSecret(key);
    return { success };
  }
}
