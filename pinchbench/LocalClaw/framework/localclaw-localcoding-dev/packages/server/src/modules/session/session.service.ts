/**
 * 兼容 shim：实现已迁入 @lenovo/agent-sdk（core/session）。
 * 精确 re-export SessionService 及其类型，存量 import 无需改动。
 */
export {
  SessionService,
  type PendingPermission,
  type SessionKind,
  type Session,
  type StoredSession,
  type SessionHistory,
} from "@lenovo/agent-sdk";
