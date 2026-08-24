import { useMemo } from "react";
import { getSkillIconInfo, type SkillCategory } from "./skillIconMap";

/**
 * 根据 skill 元数据获取图标和配色信息
 */
export function useSkillIcon(skill: {
  name?: string;
  displayName?: string;
  description?: string;
  tags?: string[];
}) {
  return useMemo(() => getSkillIconInfo(skill), [
    skill.name,
    skill.displayName,
    skill.description,
    skill.tags?.join(","),
  ]);
}

export type { SkillCategory };
