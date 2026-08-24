/**
 * 兼容 shim：实现已迁入 @lenovo/agent-sdk（config/agent-settings）。
 * 保留旧函数名作别名，存量调用方无需改动。新代码请直接用 SDK 的 agent-settings。
 */
import {
  type AgentSettings,
  getAgentSettingsPath,
  readAgentSettings,
  writeAgentSettings,
} from "@lenovo/agent-sdk";

export type LocalClawSettings = AgentSettings;

export const getLocalClawSettingsPath = getAgentSettingsPath;
export const readLocalClawSettings = readAgentSettings;
export const writeLocalClawSettings = writeAgentSettings;
