import { Module } from "@nestjs/common";
import { ProjectCapabilityService } from "./project-capability.service";

/** 项目能力扫描模块（SDK）。无 HTTP controller —— REST 路由由宿主编排。 */
@Module({
  providers: [ProjectCapabilityService],
  exports: [ProjectCapabilityService],
})
export class ProjectCapabilityModule {}
