import { Module } from "@nestjs/common";
import { PluginModule as SdkPluginModule } from "@lenovo/agent-sdk";
import { PluginController } from "./plugin.controller";

/** 宿主 plugin 模块：能力来自 SDK，controller 留宿主（模式 A）。 */
@Module({
  imports: [SdkPluginModule],
  controllers: [PluginController],
  exports: [SdkPluginModule],
})
export class PluginModule {}
