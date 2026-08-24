---
name: "AI 应用开发"
description: "LLM 应用与 Agent 开发"
icon: "🤖"
category: "development"
routingPreference: "cloud"
modelOverride: ""
skills:
  - brainstorming
initialPrompt: "我正在开发一个 AI 应用，请帮我设计架构并实现核心功能。"
builtin: true
---

# AI 应用开发最佳实践

## Claude SDK 使用

- 使用官方 SDK（如 Python `anthropic` 或 JavaScript `@anthropic-ai/sdk`）
- 合理设置温度（temperature）和最大 token 数，平衡创意与确定性
- 使用系统提示（system prompt）设置上下文和行为约束

## 提示词工程

- Prompt 要清晰具体，避免歧义和过度解释
- 使用示例（few-shot）引导模型理解预期的输出格式
- 关键指令用大写或结构化标记突出，重要信息放在开头

## 流式处理与优化

- 对于长响应使用流式输出（streaming），提升用户体验
- 实现 Token 计数和配额管理，监控 API 成本
- 缓存相同的系统提示和重复查询以降低开销

## Agent 开发

- 设计清晰的工具接口和函数签名
- 为每个工具提供准确的描述和参数说明
- 实现容错机制和重试逻辑，处理模型的中间错误

## 错误处理与测试

- 监控 API 错误、超时和速率限制，实现指数退避重试
- 为不同输入场景编写测试，包括边界情况和异常输入
- 记录模型的推理过程便于调试和改进

## 安全与伦理

- 验证和过滤用户输入，防止 prompt injection
- 定期审查输出内容，确保符合安全和伦理标准
- 使用日志追踪所有 API 调用，便于审计
