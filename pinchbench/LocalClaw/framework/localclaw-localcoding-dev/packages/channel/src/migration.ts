import type Database from "better-sqlite3";

/**
 * 旧迁移脚本（已由 channel-migrations.ts 的 v4 替代）。
 * 本文件仅处理非微信渠道的 engine 默认值。
 */
export function migrateChannels(db: Database.Database): { updated: number } {
  const update = db.prepare("UPDATE channels SET engine=?, updated_at=? WHERE id=?");
  const now = Date.now();
  let updated = 0;

  // 非 wechat 行、engine 为 NULL/空 → golembot
  const blankRows = db.prepare(
    "SELECT id, type FROM channels WHERE (engine IS NULL OR engine = '') AND type != 'wechat'"
  ).all() as Array<{ id: string; type: string }>;
  for (const row of blankRows) {
    update.run("golembot", now, row.id);
    updated++;
  }

  return { updated };
}
