import { Module, MiddlewareConsumer, NestModule } from "@nestjs/common";
import { GatewayController } from "./gateway.controller";
import { GatewayLoopbackMiddleware } from "./gateway-loopback.middleware";
import { RoutingModule } from "../routing/routing.module";

@Module({
  imports: [RoutingModule],
  controllers: [GatewayController],
})
export class GatewayModule implements NestModule {
  // 仅对网关 /v1/* 施加回环限制；Web UI(/api、WS) 不受影响，照常 0.0.0.0 可达。
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(GatewayLoopbackMiddleware).forRoutes(GatewayController);
  }
}
