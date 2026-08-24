/**
 * 兼容 shim：实现已迁入 @lenovo/agent-sdk（database/database.module）。
 * 保留 DATABASE token 和 DatabaseModule 导出，存量 @Inject(DATABASE) 无需改动。
 */
export { DATABASE, DatabaseModule } from "@lenovo/agent-sdk";
