# localclaw-core SDK 官方文档

> 包名:`@lenovo/agent-sdk` ｜ 支持语言:TypeScript ｜ 版本:`0.1.0`(2026-06-09)

面向 AI Coding Agent 的 TypeScript SDK,通过编排底层 Claude CLI 进程,提供会话管理、智能模型路由、工作区隔离、定时任务与渠道接入等核心能力。

## 文档导航

| 章节 | 内容 |
| --- | --- |
| [1. 文档总览](./01-overview.md) | SDK 简介、[多包结构与依赖关系](./01-overview.md#12-sdk-包家族与依赖关系)、核心能力、适用场景、重要公告 |
| [2. 快速上手](./02-getting-started.md) | 环境依赖、安装指引、鉴权配置、首个示例 |
| [3. 核心能力详解](./03-core-capabilities.md) | 按 SDK 模块逐条成章(11 个模块,统一结构) |
| [4. 代码示例专区](./04-examples.md) | 基础对话、多轮续接、路由、权限、定时任务、NestJS 集成 |
| [5. 功能配置说明](./05-configuration.md) | 配置路径、文件规则、自定义指令/插件/内存/日志 |
| [6. 辅助模块](./06-resources.md) | 版本更新日志、Bug 反馈渠道 |
| [7. 补充指引](./07-guides.md) | 下一步学习建议、常见问题 FAQ |
| [8. 维护者指南](./08-maintaining-public-api.md) | 如何修改对外接口:分层、api-check 护栏、changeset 发布流程 |
| [9. 兼容性与升级承诺](./09-compatibility.md) | 面向接入方:稳定性分层、semver 读法、跨版本行为保证、不保证的边界、升级 checklist |
| [10. 质量保障与接入准入](./10-quality-and-onboarding.md) | 质量门禁、测试金字塔、覆盖率基线、接入方准入清单与五分钟验证 |

## 两种接入入口

- **`createAgent()`** — 框架无关,任意 Node 环境,返回异步消息流。
- **`AgentModule.forRoot({ db })`** — NestJS 宿主一站式装配全部能力。

详见[快速上手](./02-getting-started.md)。

> 本 SDK 由 4 个包组成(`agent-sdk` / `claude-cli` / `agent-protocol` / `agent-sdk-channel`),整体结构与依赖关系见 [1.2 SDK 包家族与依赖关系](./01-overview.md#12-sdk-包家族与依赖关系)。
