/**
 * 兼容 shim：实现已迁入 @lenovo/agent-sdk（config/claude-settings）。
 * 保留导出名，存量调用方无需改动。
 */
export { loadClaudeSettingsEnv, claudeCodeEnv } from "@lenovo/agent-sdk";
