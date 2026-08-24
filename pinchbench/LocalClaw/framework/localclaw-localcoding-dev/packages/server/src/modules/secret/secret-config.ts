// 隐私「定义」配置：存于 ~/.localclaw/settings.json 的 secretDef 字段（单一数据源），
// 由 SecretRegistrarService 渲染进 CLAUDE.md 的 <!-- local-claw:secrets --> 标记块中
// 「隐私类别」那一段。机制部分（必须用 secret_save、禁止 curl 等）写死在 registrar，不可配置。

import {
  readLocalClawSettings,
  writeLocalClawSettings,
} from "../../config/localclaw-settings";

/** 单个隐私类别：标签 + 该类别包含的具体信息示例（自由文本，渲染为一行）。 */
export type SecretCategory = {
  label: string;
  examples: string;
};

export type SecretDefConfig = {
  /** 隐私类别清单，决定 CLAUDE.md 中「哪些算隐私」。 */
  categories: SecretCategory[];
  /** 触发口语提示（用户说哪些话时也应存储）。 */
  triggerPhrases: string;
  /** 自由补充规则，逐行渲染为额外约束。 */
  extraRules: string;
};

/**
 * 默认值与当前 secrets:v3 块里写死的类别对齐，
 * 这样首次启动用默认值渲染时不会改变用户已见到的内容（无缝迁移）。
 */
export const DEFAULT_SECRET_DEF: SecretDefConfig = {
  categories: [
    { label: "凭据类", examples: "API key、access token、secret key（如 sk-...、ghp_...）、密码、数据库连接串、私钥、证书口令" },
    { label: "证件号码", examples: "身份证号、护照号、社保号、驾照号、军官证等" },
    { label: "金融信息", examples: "银行卡号、信用卡号、CVV、支付账号" },
    { label: "联系方式", examples: "手机号、固定电话、个人邮箱、家庭/详细住址" },
    { label: "其他个人敏感信息", examples: "生日、车牌号、紧急联系人等" },
  ],
  triggerPhrases: "用户明确说「记录一下」「存一下」「记住这个」「帮我保存」的任何上述信息。",
  extraRules: "",
};

/** 从 settings.json 读取 secretDef，缺字段用默认值补全。 */
export function readSecretDefConfig(): SecretDefConfig {
  const settings = readLocalClawSettings();
  const raw = (settings.secretDef ?? {}) as Partial<SecretDefConfig>;
  return {
    categories: Array.isArray(raw.categories) && raw.categories.length > 0
      ? raw.categories.filter((c) => c && typeof c.label === "string")
      : DEFAULT_SECRET_DEF.categories,
    triggerPhrases: typeof raw.triggerPhrases === "string"
      ? raw.triggerPhrases : DEFAULT_SECRET_DEF.triggerPhrases,
    extraRules: typeof raw.extraRules === "string"
      ? raw.extraRules : DEFAULT_SECRET_DEF.extraRules,
  };
}

/** 写回 settings.json 的 secretDef 字段（保留其它字段）。 */
export function writeSecretDefConfig(config: SecretDefConfig): void {
  const settings = readLocalClawSettings();
  settings.secretDef = config;
  writeLocalClawSettings(settings);
}
