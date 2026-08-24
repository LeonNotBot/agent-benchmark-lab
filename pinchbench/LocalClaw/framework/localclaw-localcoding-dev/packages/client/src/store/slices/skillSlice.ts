import type { SkillMeta } from "@lenovo/agent-protocol";

export interface SkillSlice {
  skills: SkillMeta[];
  /**
   * 被用户停用的 skill 名称集合。
   * 真相源在服务端磁盘（<skillsDir>/.disabled.json），由 setSkills 从 skills[].disabled
   * 派生，前端不再独立持久化。停用真正生效由 SDK runner 在技能激活时强制门控。
   */
  disabledSkills: string[];
  setSkills: (skills: SkillMeta[]) => void;
}

export function createSkillSlice(set: any): SkillSlice {
  return {
    skills: [],
    disabledSkills: [],
    setSkills: (skills) =>
      set({
        skills,
        disabledSkills: skills.filter((s) => s.disabled).map((s) => s.name),
      }),
  };
}
