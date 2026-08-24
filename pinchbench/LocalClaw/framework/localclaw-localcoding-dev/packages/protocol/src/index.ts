// 包入口别名：统一从 types.ts 重导出，避免类型定义重复。
// 历史上 index.ts 与 types.ts 各自维护了一份 ClaudeSettingsEnv，
// 现归一到 types.ts 作为唯一来源。消费方从包入口或 types.ts 导入均可。
export * from "./types";
