import { Module } from "@nestjs/common";
import { RoutingService, ROUTING_SERVICE } from "./routing.service";
import { SmartHybridService } from "./smart-hybrid.service";
import { DeviceCapabilityService } from "./device-capability.service";
import { EndpointRegistryService } from "./endpoint-registry.service";
import { SessionModule } from "../../core/session/session.module";

/**
 * 路由能力模块（SDK）。不含 HTTP controller —— REST 路由由宿主编排（模式 A）。
 * 同时以 ROUTING_SERVICE 令牌 re-provide 同一 RoutingService 单例（useExisting），
 * 供对外接入方按 IRoutingService 接口注入。
 */
@Module({
  imports: [SessionModule],
  providers: [
    RoutingService,
    SmartHybridService,
    DeviceCapabilityService,
    EndpointRegistryService,
    { provide: ROUTING_SERVICE, useExisting: RoutingService },
  ],
  exports: [RoutingService, SmartHybridService, EndpointRegistryService, ROUTING_SERVICE],
})
export class RoutingModule {}
