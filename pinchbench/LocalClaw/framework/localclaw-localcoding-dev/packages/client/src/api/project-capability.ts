import type { ProjectCapabilities } from "@lenovo/agent-protocol";
import { getJson } from "./_fetch";

/**
 * 扫描项目 .claude 能力（命令/子代理/技能/规则/知识库）。
 * cwd 须为绝对路径；后端非法或无 .claude 时返回空集合。
 */
export async function apiScanProjectCapabilities(
  cwd: string,
): Promise<ProjectCapabilities | null> {
  return getJson<ProjectCapabilities>(
    `/api/project-capabilities?cwd=${encodeURIComponent(cwd)}`,
  );
}
