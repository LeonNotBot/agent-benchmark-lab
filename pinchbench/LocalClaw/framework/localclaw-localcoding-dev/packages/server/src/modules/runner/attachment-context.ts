/**
 * 兼容 shim：实现已迁入 @lenovo/agent-sdk（util/attachment-context）。
 * 该工具被 runner / workspace / websocket 共用，故放 SDK util 层。
 */
export {
  type PersistedAttachmentFile,
  type PersistedAttachmentContext,
  isTextFile,
  buildPromptWithAttachments,
} from "@lenovo/agent-sdk";
