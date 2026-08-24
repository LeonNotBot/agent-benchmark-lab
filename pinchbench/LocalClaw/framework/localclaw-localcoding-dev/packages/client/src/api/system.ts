import { postJson } from "./_fetch";

export async function apiBrowseFolder(): Promise<string | null> {
  const data = await postJson<{ path: string }>("/api/system/browse-folder", {});
  return data?.path ?? null;
}

export async function apiGetGitStatus(cwd: string): Promise<{
  branch: string;
  gitStatus: string;
  hasUncommitted: boolean;
} | null> {
  return postJson("/api/git/status", { cwd });
}
