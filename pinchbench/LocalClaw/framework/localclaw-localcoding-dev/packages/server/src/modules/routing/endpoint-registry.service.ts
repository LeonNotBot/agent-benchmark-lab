/** 兼容 shim：实现已迁入 @lenovo/agent-sdk（capability/routing）。 */
export {
  modelTier,
  EndpointRegistryService,
  findModelIdConflicts,
  ModelIdConflictError,
  EndpointNotFoundError,
} from "@lenovo/agent-sdk";
export type { ModelIdConflict } from "@lenovo/agent-sdk";
