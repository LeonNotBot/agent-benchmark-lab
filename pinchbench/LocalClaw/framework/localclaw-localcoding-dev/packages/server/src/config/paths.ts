/**
 * 兼容 shim：实现已迁入 @lenovo/agent-sdk（config/paths）。
 * LOCALCLAW_DIR 保留为 CLAUDE_HOME_DIR（CLI 共用目录 ~/.claude）的别名。
 */
import { CLAUDE_HOME_DIR } from "@lenovo/agent-sdk";

export { CLAUDE_JSON_PATH } from "@lenovo/agent-sdk";
export const LOCALCLAW_DIR = CLAUDE_HOME_DIR;
