import { Module } from "@nestjs/common";
import { SecretController } from "./secret.controller";
import { SecretConfigController } from "./secret-config.controller";
import { SecretService } from "./secret.service";
import { SecretRegistrarService } from "./secret-registrar.service";

@Module({
  controllers: [SecretController, SecretConfigController],
  providers: [SecretService, SecretRegistrarService],
  exports: [SecretService],
})
export class SecretModule {}
