import { Module } from "@nestjs/common";
import { RoutingModule as SdkRoutingModule } from "@lenovo/agent-sdk";
import { ModelController } from "./model.controller";

/**
 * 宿主 routing 模块：能力来自 SDK，HTTP 路由（ModelController）留宿主（模式 A）。
 */
@Module({
  imports: [SdkRoutingModule],
  controllers: [ModelController],
  exports: [SdkRoutingModule],
})
export class RoutingModule {}
