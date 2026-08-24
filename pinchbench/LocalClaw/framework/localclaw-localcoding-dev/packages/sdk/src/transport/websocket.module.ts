import {
  type DynamicModule,
  Module,
  type Type,
  type Provider,
} from "@nestjs/common";
import { WebsocketGateway } from "./websocket.gateway";
import { SESSION_START_CONTRIBUTORS, WS_EVENT_HANDLERS } from "./contracts";
import { SessionModule } from "../core/session/session.module";
import { RunnerModule } from "../capability/runner/runner.module";
import { RoutingModule } from "../capability/routing/routing.module";
import { WorkspaceModule } from "../capability/workspace/workspace.module";

/**
 * SDK WebSocket 传输模块（动态模块）。
 *
 * 内核（WebsocketGateway）只依赖 SDK 自有能力，处理标准会话/路由/模型事件。
 * 宿主通过 forRoot 注入两类扩展：
 * - contributors：实现 SessionStartContributor，参与 session.start 编排（如模板）。
 * - eventHandlers：实现 WsEventHandler，处理内核不认识的事件（如语音）。
 *
 * 宿主把扩展类 + 它们依赖的宿主模块一起传进来：forRoot 在本模块上下文里
 * 注册这些类为 provider（imports 宿主模块以解析它们的依赖），再用 useFactory
 * 聚合进两个 multi-token 数组。SDK 代码对宿主业务零静态引用。
 * 与 DatabaseModule.forRoot({db}) 同源：能力在 SDK，编排/业务在宿主。
 */
@Module({})
export class WebsocketModule {
  static forRoot(opts?: {
    /** 宿主模块：用于解析 contributors / eventHandlers 的依赖（如 TemplateModule）。 */
    imports?: DynamicModule["imports"];
    contributors?: Type<unknown>[];
    eventHandlers?: Type<unknown>[];
  }): DynamicModule {
    const contributors = opts?.contributors ?? [];
    const eventHandlers = opts?.eventHandlers ?? [];
    return {
      module: WebsocketModule,
      imports: [
        SessionModule,
        RunnerModule,
        RoutingModule,
        WorkspaceModule,
        ...(opts?.imports ?? []),
      ],
      providers: [
        WebsocketGateway,
        // 宿主扩展类在本模块上下文注册为 provider，其依赖由上面 imports 的宿主模块解析。
        ...(contributors as Provider[]),
        ...(eventHandlers as Provider[]),
        {
          provide: SESSION_START_CONTRIBUTORS,
          useFactory: (...instances: unknown[]) => instances,
          inject: contributors,
        },
        {
          provide: WS_EVENT_HANDLERS,
          useFactory: (...instances: unknown[]) => instances,
          inject: eventHandlers,
        },
      ],
      exports: [WebsocketGateway],
    };
  }
}
