export class CreateSkillDto {
  name!: string;
  displayName?: string;
  description!: string;
  whenToUse?: string;
  allowedTools?: string[];
  userInvocable?: boolean;
  context?: "inline" | "fork";
  argumentHint?: string;
  arguments?: string[];
  content!: string;
}

export class UpdateSkillDto extends CreateSkillDto {}
