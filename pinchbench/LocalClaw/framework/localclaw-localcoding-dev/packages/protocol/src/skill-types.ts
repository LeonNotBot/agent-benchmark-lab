// ── Skill types ──

export type SkillMeta = {
  name: string;
  displayName?: string;
  description: string;
  whenToUse?: string;
  allowedTools: string[];
  userInvocable: boolean;
  context?: "inline" | "fork";
  argumentHint?: string;
  arguments?: string[];
  source: "user" | "project" | "market" | "builtin";
  installedAt?: number;
  /** 是否被用户停用。停用后 runner 拒绝激活该技能（磁盘真相源 .disabled.json）。 */
  disabled?: boolean;
};

export type SkillDetail = SkillMeta & {
  content: string;
  rawMarkdown: string;
  files?: string[];
};

export type MarketSkill = {
  name: string;
  displayName: string;
  description: string;
  author?: string;
  version?: string;
  tags?: string[];
  downloads?: number;
  readme?: string;
  installed: boolean;
};

export type MarketSource = {
  id: string;
  name: string;
  url: string;
  type: "github" | "registry" | "custom";
  skillsPath?: string;
  skillCount: number;
  lastSync?: number;
};