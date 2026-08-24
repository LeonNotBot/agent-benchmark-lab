import { Injectable } from "@nestjs/common";
import type Database from "better-sqlite3";

export type ChatSession = {
  chatId: string;
  channelId: string;
  workspaceDir: string;
  sessionKey: string | null;
};

@Injectable()
export class ChatSessionService {
  constructor(private readonly db: Database.Database) {}

  resolve(chatId: string, channelId: string): ChatSession | null {
    const row = this.db.prepare(
      "SELECT chat_id, channel_id, workspace_dir, session_key FROM chat_sessions WHERE chat_id = ? AND channel_id = ?"
    ).get(chatId, channelId) as any;
    if (!row) return null;
    return {
      chatId: row.chat_id, channelId: row.channel_id,
      workspaceDir: row.workspace_dir, sessionKey: row.session_key,
    };
  }

  bind(chatId: string, channelId: string, workspaceDir: string): void {
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO chat_sessions (chat_id, channel_id, workspace_dir, session_key, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)
       ON CONFLICT(chat_id, channel_id) DO UPDATE SET workspace_dir=excluded.workspace_dir, updated_at=excluded.updated_at`
    ).run(chatId, channelId, workspaceDir, now, now);
  }

  setSessionKey(chatId: string, channelId: string, sessionKey: string): void {
    this.db.prepare(
      `UPDATE chat_sessions SET session_key=?, updated_at=? WHERE chat_id=? AND channel_id=?`
    ).run(sessionKey, Date.now(), chatId, channelId);
  }

  /**
   * 同步更新指定渠道所有会话绑定的工作目录。
   * 当用户在 UI 修改了渠道的 workspaceDir 配置后，需同步更新已有绑定，
   * 否则 chatSessions.resolve() 仍返回旧路径（chat_sessions.workspace_dir 固化）。
   */
  updateByChannelId(channelId: string, workspaceDir: string): void {
    const now = Date.now();
    this.db.prepare(
      `UPDATE chat_sessions SET workspace_dir=?, updated_at=? WHERE channel_id=?`
    ).run(workspaceDir, now, channelId);
  }
}
