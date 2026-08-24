/**
 * .claude 场景包脚手架模板（纯数据）。对标 claude-cli 的 frontmatter 格式约定，
 * 零 LocalClaw 私货——生成的包在别处也能用。scaffold() 据此写入示例文件。
 */

/** 一个待写入的模板文件：相对 .claude 根的路径 + 内容。 */
export type TemplateFile = { rel: string; content: string };

const COMMAND_EXAMPLE = `---
description: 示例命令（改成你的命令说明）
argument-hint: <可选参数提示>
---

# 示例命令

在这里写命令的提示词。用户输入 /example 时会执行本文件内容。
删除本示例，按此格式新建你自己的命令。
`;

const AGENT_EXAMPLE = `---
description: 示例子代理（改成你的代理职责）
---

# 示例子代理

在这里定义这个子代理的专长与行为约束。
主 agent 可用 @example 委托任务给它。
`;

const SKILL_EXAMPLE = `---
name: 示例技能
description: 示例技能（改成技能能做什么）
when_to_use: 当用户需要……时调用此技能
user-invocable: true
---

# 示例技能

在这里写技能的执行步骤 / know-how。
可在同目录放 scripts/ 脚本供技能调用。
`;

const RULE_EXAMPLE = `# 示例规则

在这里写常驻约束（如编码规范、安全要求）。
规则会作为上下文注入，影响 agent 的所有行为。
`;

const MEMORY_EXAMPLE = `# 示例知识库（YAML）
# 在这里放领域知识 / 数据字典，供 agent 按需检索。
example_key: example_value
`;

const README = (name: string) => `# ${name}

这是一个 .claude 场景包（scene pack），包含命令 / 子代理 / 技能 / 规则 / 知识库。

## 目录结构
- commands/  斜杠命令
- agents/    子代理
- skills/    技能（含可选脚本）
- rules/     常驻规则
- memories/  知识库

用 LocalClaw 打开本项目即可看到并使用这些能力；也可导出为 zip 分享给他人导入。
`;

const PLUGIN_JSON = (name: string) =>
  JSON.stringify({ name, description: "", version: "0.1.0", author: "" }, null, 2) + "\n";

/** 五类目录（空骨架必建）。 */
export const SCAFFOLD_DIRS = ["commands", "agents", "skills", "rules", "memories"];

/** 生成骨架文件清单。includeExamples=false 时只回 plugin.json + README。 */
export function scaffoldFiles(name: string, includeExamples: boolean): TemplateFile[] {
  const files: TemplateFile[] = [
    { rel: ".claude-plugin/plugin.json", content: PLUGIN_JSON(name) },
    { rel: "README.md", content: README(name) },
  ];
  if (includeExamples) {
    files.push(
      { rel: "commands/example.md", content: COMMAND_EXAMPLE },
      { rel: "agents/example.md", content: AGENT_EXAMPLE },
      { rel: "skills/example-skill/SKILL.md", content: SKILL_EXAMPLE },
      { rel: "rules/example.md", content: RULE_EXAMPLE },
      { rel: "memories/example.yaml", content: MEMORY_EXAMPLE },
    );
  }
  return files;
}
