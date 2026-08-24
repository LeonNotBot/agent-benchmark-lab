import { Module } from "@nestjs/common";
import { PluginService } from "./plugin.service";

/** Plugin(.claude 场景包) 导入模块（SDK）。无 HTTP controller —— REST 路由由宿主编排。 */
@Module({
  providers: [PluginService],
  exports: [PluginService],
})
export class PluginModule {}
