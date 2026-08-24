import { Module } from "@nestjs/common";
import { SessionModule as SdkSessionModule, GitModule } from "@lenovo/agent-sdk";
import { SessionController } from "./session.controller";

/**
 * 宿主 session 模块：能力（Service）来自 SDK，HTTP 路由（Controller）留宿主（模式 A）。
 * - imports SdkSessionModule：提供 SessionService / FileChangeService
 * - imports GitModule：controller 注入 GitService 需要
 * - re-export 两者，供其他模块继续从 SessionModule 取用这些能力。
 */
@Module({
  imports: [SdkSessionModule, GitModule],
  controllers: [SessionController],
  exports: [SdkSessionModule, GitModule],
})
export class SessionModule {}
