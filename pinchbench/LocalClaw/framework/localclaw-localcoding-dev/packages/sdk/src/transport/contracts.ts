import type { ServerEvent } from "@lenovo/agent-protocol";
import type {
  Session,
  SessionRoutingOverride,
} from "../core/session/session.service";

/**
 * 传输层宿主扩展契约。
 *
 * SDK 的 WebsocketGateway 是「通用传输 + 标准会话/路由/模型事件」内核，
 * 不认识任何宿主业务（模板 / 语音 / 渠道 / 定时任务）。宿主通过下面两个
 * 通用扩展点把自己的业务接进来：
 * - SessionStartContributor：参与 session.start 的启动编排（如模板写入路由覆盖 + CLAUDE.md）。
 * - WsEventHandler：处理 SDK 内核不认识的客户端事件类型（如 speech.recognize）。
 *
 * 接线方式见 WebsocketModule.forRoot({ contributors, eventHandlers })。
 */

/** session.start 的载荷（与 shared 的 SessionClientEvent.session.start 对齐）。 */
export type SessionStartPayload = {
  title: string;
  prompt: string;
  cwd?: string;
  templateSlug?: string;
  allowedTools?: string;
  [key: string]: unknown;
};

/**
 * 会话启动贡献者：宿主在 session.start 流程中注入行为。
 *
 * 时序由内核保证（同步、确定，无事件总线竞态）：
 * 1. contributeRouting 在 createSession 之前调用，返回值合并进 session.routingOverride。
 * 2. afterSessionCreated 在 createSession 之后、startRunner 之前调用，跑副作用。
 */
export interface SessionStartContributor {
  contributeRouting?(
    payload: SessionStartPayload,
  ): SessionRoutingOverride | undefined;
  afterSessionCreated?(
    session: Session,
    payload: SessionStartPayload,
  ): void | Promise<void>;
}

/** 注入 token：宿主以 multi-provider 形式提供 SessionStartContributor 列表。 */
export const SESSION_START_CONTRIBUTORS = Symbol("SESSION_START_CONTRIBUTORS");

/**
 * 客户端事件处理器：处理 SDK 内核不认识的事件类型。
 * 内核 handleClientEvent 的 default 分支按 type 匹配并调用。
 */
export interface WsEventHandler {
  /** 客户端事件 type，如 "speech.recognize"。 */
  readonly type: string;
  handle(
    payload: unknown,
    emit: (event: ServerEvent) => void,
  ): void | Promise<void>;
}

/** 注入 token：宿主以 multi-provider 形式提供 WsEventHandler 列表。 */
export const WS_EVENT_HANDLERS = Symbol("WS_EVENT_HANDLERS");

