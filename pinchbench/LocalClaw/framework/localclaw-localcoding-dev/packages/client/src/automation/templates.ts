// 自动化模板数据：每个模板含标题(title) + 提示词(prompt)，均支持中/英文。
// 内容来自设计图 2/3/4.png 的模板库。点击模板后回填到手动创建表单。
export interface AutomationTemplate {
  id: string;
  title: { zh: string; en: string };
  prompt: { zh: string; en: string };
}

// 占位：模板条目分批通过 push 添加（避免单文件单次写入过长）。
export const TEMPLATES: AutomationTemplate[] = [];

TEMPLATES.push(
  {
    "id": "bug-scan",
    "title": {
      "zh": "每日缺陷扫描",
      "en": "Bug scan & fix"
    },
    "prompt": {
      "zh": "扫描最近的 commit（自上次运行以来，或过去 24 小时内），查找可能的 bug 并提出最小修复方案。依据规则：- 只使用仓库中的具体证据（commit SHA、PR、文件路径、diff、失败的测试、CI 信号）。- 不要臆造 bug；如果证据不足，请说明并跳过。- 优先选择最小且安全的修复；避免重构和无关清理。",
      "en": "Scan recent commits (since the last run, or last 24h) for likely bugs and propose minimal fixes. Grounding rules:\n- Use only concrete evidence from repository (commit SHA, PR, file path, diff, failed tests, CI signals).\n- Do not fabricate bugs; state and skip if insufficient evidence.\n- Prioritize minimal & safe fixes; avoid refactoring and unrelated cleanup."
    }
  },
  {
    "id": "release-notes",
    "title": {
      "zh": "每周版本说明",
      "en": "Weekly release notes"
    },
    "prompt": {
      "zh": "根据已合并的 PR 起草每周发布说明（如有链接请附上）。范围与依据：- 严格以该仓库当周历史记录为限；不要添加超出数据支持的额外部分。- 使用 PR 编号 / 标题；除非仓库中的 PR 描述、测试或指标支持，否则避免对影响作出结论。",
      "en": "Draft weekly release notes from merged PRs (include links when available). Scope & grounding rules:\n- Strictly limit to this repository's weekly history; do not add extra content unsupported by data.\n- Reference PR numbers/titles; avoid conclusions about impact unless backed by PR descriptions, tests or metrics in repo."
    }
  },
  {
    "id": "standup-git-summary",
    "title": {
      "zh": "站会Git活动汇总",
      "en": "Daily git summary for standup"
    },
    "prompt": {
      "zh": "为站会总结昨天的 git 活动。依据规则：- 陈述应锚定到 commit/PR/ 文件；不要臆测意图或未来工作。- 保持便于快速浏览，并适合团队同步。",
      "en": "Summarize yesterday’s git activity for standup. Grounding rules:\n- Anchor all statements to commits/PRs/files; do not guess intent or future work.\n- Keep content scannable and suitable for team sync."
    }
  },
  {
    "id": "ci-failure-summary",
    "title": {
      "zh": "CI失败与不稳定测试汇总",
      "en": "CI failure & flaky test summary"
    },
    "prompt": {
      "zh": "总结上一个 CI 窗口中的 CI 失败和不稳定测试；提出首要修复建议。依据规则：- 尽可能引用具体作业、测试、错误信息或日志片段。- 避免过度自信地断言根因；区分 “已观察到” 与 “疑似”。",
      "en": "Summarize CI failures and flaky tests from the last CI window; suggest top fixes. Grounding rules:\n- Reference specific jobs, tests, error messages or log snippets where possible.\n- Avoid overconfident root cause claims; clearly separate \"Observed\" vs \"Suspected\"."
    }
  },
  {
    "id": "mini-classic-game",
    "title": {
      "zh": "极简经典小游戏开发",
      "en": "Minimal classic game creation"
    },
    "prompt": {
      "zh": "创建一个范围尽可能小的经典小游戏。约束：- 除非必要，否则不要添加额外功能、样式系统、内容或新的依赖项。- 复用现有仓库的工具和模式。",
      "en": "Create a small classic game with minimal scope. Constraints:\n- Do not add extra features, styling systems, content or new dependencies unless strictly necessary.\n- Reuse existing repository tooling and patterns."
    }
  },
  {
    "id": "skill-improve-suggest",
    "title": {
      "zh": "团队技能提升建议",
      "en": "Skill improvement recommendations"
    },
    "prompt": {
      "zh": "根据近期 PR 和评审，建议下一步需要深入提升的技能。依据规则：- 每条建议都要锚定具体证据（PR 主题、评审意见、反复出现的问题）。- 避免空泛建议；每条建议都要可执行且具体。",
      "en": "From recent PRs and reviews, suggest next skills to deepen. Grounding rules:\n- Anchor every suggestion to concrete evidence (PR themes, review feedback, recurring issues).\n- Avoid vague advice; all recommendations must be actionable and specific."
    }
  },
  {
    "id": "weekly-team-update",
    "title": {
      "zh": "团队每周工作汇总",
      "en": "Weekly team progress update"
    },
    "prompt": {
      "zh": "将本周的 PR、发布、故障事件和评审汇总成一份每周更新。依据规则：- 不要虚构事件；如果数据缺失，请简要说明。- 在条件允许时，优先使用具体引用（PR 编号、故障事件 ID、发布说明、文件路径）。",
      "en": "Synthesize this week’s PRs, rollouts, incidents, and reviews into a weekly update. Grounding rules:\n- Do not fabricate events; briefly note gaps if data is missing.\n- Prioritize concrete references (PR numbers, incident IDs, release notes, file paths) when available."
    }
  },
  {
    "id": "perf-regression-check",
    "title": {
      "zh": "性能回归检测",
      "en": "Performance regression detection"
    },
    "prompt": {
      "zh": "将最近的更改与基准测试或追踪结果进行比较，并尽早标记回归。依据规则：- 所有判断都应以可测量的信号（基准测试、追踪、耗时、火焰图）为依据。- 如果没有测量数据，请注明 “未找到测量数据”，不要猜测。",
      "en": "Compare recent changes to benchmarks or traces and flag regressions early. Grounding rules:\n- All judgements must rely on measurable signals (benchmarks, traces, latency, flame graphs).\n- Write \"No measurement data found\" instead of guessing if metrics are missing."
    }
  },
  {
    "id": "dependency-sdk-align",
    "title": {
      "zh": "依赖与SDK版本对齐",
      "en": "Dependency & SDK drift alignment"
    },
    "prompt": {
      "zh": "检测依赖项和 SDK 漂移，并提出最小对齐方案。依据规则：- 尽可能从仓库中引用当前版本和目标版本（锁文件、包清单文件）。- 不要猜测版本；如果目标不明确，请提出可选方案并标明为建议。",
      "en": "Detect dependency and SDK drift and propose a minimal alignment plan. Grounding rules:\n- Reference current & target versions from repo lockfiles and package manifests where possible.\n- Do not guess versions; provide labeled alternative options if target version is unclear."
    }
  },
  {
    "id": "untested-path-test",
    "title": {
      "zh": "未覆盖路径补充测试",
      "en": "Add tests for untested code paths"
    },
    "prompt": {
      "zh": "找出近期变更中未测试的路径；补充有针对性的测试，并对草稿 PR 使用 $yeet。约束：- 范围仅限变更区域；避免大范围重构。- 优先编写小而可靠的测试，确保修改前失败、修改后通过。",
      "en": "Identify untested paths from recent changes; add focused tests and use $yeet for draft PRs. Constraints:\n- Scope only modified areas; avoid large-scale refactoring.\n- Prefer small, reliable tests that fail before the fix and pass after changes."
    }
  },
  {
    "id": "pre-tag-verify",
    "title": {
      "zh": "版本标签发布预检",
      "en": "Pre-release tag verification"
    },
    "prompt": {
      "zh": "打标签前，请核对变更日志、迁移、功能开关和测试。依据规则：- 仅报告您能从仓库和 CI 上下文中确认的内容。- 如果某项检查无法验证，请明确标记为 “未知”。",
      "en": "Before tagging, verify changelog, migrations, feature flags, and tests. Grounding rules:\n- Only report items verifiable from repository and CI context.\n- Explicitly mark items as \"Unknown\" if validation cannot be completed."
    }
  },
  {
    "id": "agents-md-update",
    "title": {
      "zh": "AGENTS.md文档更新",
      "en": "Update AGENTS.md workflows"
    },
    "prompt": {
      "zh": "用新发现的工作流程和命令更新 AGENTS.md。约束：- 保持改动最小、准确，并以仓库中的实际用法为依据。- 不要改动无关部分或自动生成的文件。- 如果不确定，优先添加带简短说明的 TODO，而不是编造内容。",
      "en": "Update AGENTS.md with newly discovered workflows and commands. Constraints:\n- Keep edits minimal, accurate, and based on real repo usage.\n- Do not modify unrelated sections or auto-generated files.\n- Prefer adding annotated TODO notes over inventing content when uncertain."
    }
  },
  {
    "id": "weekly-pr-team-summary",
    "title": {
      "zh": "上周PR团队维度汇总",
      "en": "Weekly PR team & theme summary"
    },
    "prompt": {
      "zh": "按团队成员和主题总结上周的 PR，并突出显示风险。依据规则：- 有 PR 编号或标题时请使用。- 避免推测影响；只说明 PR 实际变更的内容。",
      "en": "Summarize last week’s PRs by teammate and theme; highlight risks. Grounding rules:\n- Reference PR numbers/titles where available.\n- Avoid speculative impact statements; only describe actual changes introduced in PRs."
    }
  },
  {
    "id": "issue-triage",
    "title": {
      "zh": "工单问题分诊",
      "en": "New issue triage"
    },
    "prompt": {
      "zh": "分诊断新问题；建议负责人、优先级和标签。依据规则：- 根据问题内容 + 仓库上下文 (CODEOWNERS、涉及区域、以往类似问题) 给出建议。- 没有明确信号时不要猜测负责人；如不明确，请写 “Owner: Unknown”，并改为建议一个团队。",
      "en": "Triage new issues; suggest owner, priority, and labels. Grounding rules:\n- Generate suggestions based on issue content + repo context (CODEOWNERS, affected areas, historical similar tickets).\n- Do not guess owners without clear signals; write \"Owner: Unknown\" and recommend a team instead if ambiguous."
    }
  },
  {
    "id": "ci-root-fix-group",
    "title": {
      "zh": "CI失败根因分组修复",
      "en": "CI failure root cause grouping & fixes"
    },
    "prompt": {
      "zh": "检查 CI 失败；按可能的根本原因分组，并建议最小修复方案。依据规则：- 引用作业、测试、错误和日志证据。- 避免过于自信地断定根本原因；将不确定项标记为 “疑似”。",
      "en": "Check CI failures; group by likely root cause and suggest minimal fixes. Grounding rules:\n- Cite jobs, tests, errors and log evidence.\n- Avoid definitive root cause conclusions; mark ambiguous items as \"Suspected\"."
    }
  },
  {
    "id": "outdated-dep-upgrade",
    "title": {
      "zh": "过时依赖安全升级",
      "en": "Safe outdated dependency upgrades"
    },
    "prompt": {
      "zh": "扫描过时的依赖项；以最小改动提出安全升级方案。规则：- 优先采用最小可行的升级集合。- 明确标出破坏性变更风险和所需迁移。- 在未从仓库识别出当前版本前，不要提出升级建议。",
      "en": "Scan outdated dependencies; propose safe upgrades with minimal changes. Rules:\n- Prioritize the smallest viable upgrade set.\n- Explicitly flag breaking change risks and required migrations.\n- Do not propose upgrades before identifying current installed versions from repo."
    }
  },
  {
    "id": "perf-regression-audit",
    "title": {
      "zh": "性能回归审计优化",
      "en": "Performance regression audit & high-value fixes"
    },
    "prompt": {
      "zh": "审计性能回归，并提出收益最高的修复建议。依据规则：- 有测量数据或跟踪信息时，所有判断都应以其为依据。- 若证据不足，应简要说明不确定性，并建议下一步要测量的内容。",
      "en": "Audit performance regressions and propose highest-leverage fixes. Grounding rules:\n- Base all judgements on measurement data/traces when available.\n- Briefly explain uncertainty and recommend next measurement steps if evidence is insufficient."
    }
  },
  {
    "id": "changelog-update",
    "title": {
      "zh": "更新版本变更日志",
      "en": "Weekly changelog refresh"
    },
    "prompt": {
      "zh": "用本周亮点和关键 PR 链接更新变更日志。约束：- 仅包含有仓库历史支持的条目。- 保持结构简洁，并与现有变更日志格式一致。",
      "en": "Update the changelog with this week’s highlights and key PR links. Constraints:\n- Only include entries backed by repository history.\n- Keep structure concise and consistent with existing changelog formatting."
    }
  }
);



