import type { SessionInfo, StreamMessage, SessionStatus, FileDiff, UsageSummary, ChangedFile } from "@lenovo/agent-protocol";
import { getJson, postJson, patchJson } from "./_fetch";

export async function apiListSessions(): Promise<SessionInfo[]> {
  const data = await getJson<{ sessions: SessionInfo[] }>("/api/sessions");
  return data?.sessions ?? [];
}

export async function apiGetSessionHistory(id: string): Promise<{
  sessionId: string;
  status: SessionStatus;
  messages: StreamMessage[];
  diffs?: FileDiff[];
} | null> {
  return getJson(`/api/sessions/${encodeURIComponent(id)}/history`);
}

export async function apiGetSessionUsage(sessionId: string): Promise<UsageSummary | null> {
  const data = await getJson<{ summary: UsageSummary }>(`/api/sessions/${encodeURIComponent(sessionId)}/usage`);
  return data?.summary ?? null;
}

// 会话工作区 diff：从 history 拆出单独异步拉取，避免 git diff 阻塞会话打开。
export async function apiGetSessionDiff(sessionId: string): Promise<FileDiff[]> {
  const data = await getJson<{ diffs: FileDiff[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/diff`);
  return data?.diffs ?? [];
}

// 会话工具累计 diff（Write/Edit/MultiEdit 重建，不依赖 git）：审查面板「上一轮」数据源。
export async function apiGetSessionToolDiff(sessionId: string): Promise<FileDiff[]> {
  const data = await getJson<{ diffs: FileDiff[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/session-diff`);
  return data?.diffs ?? [];
}

// 按轮次拆分的 diff：对话流「已编辑 N 个文件」汇总卡片数据源。
export type SessionRoundDiff = { roundKey: string; diffs: FileDiff[] };
export async function apiGetRoundDiffs(sessionId: string): Promise<SessionRoundDiff[]> {
  const data = await getJson<{ rounds: SessionRoundDiff[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/round-diffs`);
  return data?.rounds ?? [];
}

// 撤销前置校验：cwd 是否 git 仓库（4.png）。
export async function apiGitCheck(sessionId: string): Promise<boolean> {
  const data = await getJson<{ isGit: boolean }>(`/api/sessions/${encodeURIComponent(sessionId)}/git-check`);
  return data?.isGit ?? false;
}

export type RevertResult =
  | { ok: false; reason: "not-git" | "no-head" | "no-workspace" | "error"; message?: string }
  | { ok: true; hasSnapshot: boolean };

// 撤销一轮编辑（依赖 git）：after 快照落服务端文件（按 roundKey 隔离），前端只持有 roundKey。
export async function apiRevertRound(sessionId: string, roundKey: string, files: string[]): Promise<RevertResult> {
  const data = await postJson<RevertResult>(`/api/sessions/${encodeURIComponent(sessionId)}/revert-round`, { roundKey, files });
  return data ?? { ok: false, reason: "error", message: "request failed" };
}

// 重新应用一轮：后端按 roundKey 从服务端快照目录读回写盘。
export async function apiReapplyRound(sessionId: string, roundKey: string): Promise<boolean> {
  const data = await postJson<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(sessionId)}/reapply-round`, { roundKey });
  return data?.ok ?? false;
}

export async function apiGetChangedFiles(sessionId: string): Promise<ChangedFile[]> {
  const data = await getJson<{ files: ChangedFile[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/changed-files`);
  return data?.files ?? [];
}

export async function apiGetSessionTitle(prompt: string): Promise<string> {
  const data = await postJson<{ title: string }>("/api/sessions/title", { prompt });
  return data?.title ?? "";
}

// 探测会话工作目录是否仍存在。
export async function apiGetCwdStatus(id: string): Promise<{ cwd: string | null; exists: boolean } | null> {
  return getJson(`/api/sessions/${encodeURIComponent(id)}/cwd-status`);
}

// 写回会话工作目录（重新选择目录）。
export async function apiUpdateCwd(id: string, cwd: string): Promise<{ ok: boolean; cwd?: string; error?: string } | null> {
  return patchJson(`/api/sessions/${encodeURIComponent(id)}/cwd`, { cwd });
}
