---
name: "Web 全栈开发"
description: "适用于 React + Node.js 全栈项目的开发模板"
icon: "🌐"
category: "development"
routingPreference: "auto"
modelOverride: ""
skills:
  - brainstorming
  - code-review
initialPrompt: "我正在开发一个全栈 Web 应用，请帮我分析项目结构并提供开发建议。"
builtin: true
---

# Web 全栈开发最佳实践

## 代码规范

- 使用 TypeScript 严格模式（`strict: true`），确保类型安全
- 优先使用函数式组件和 React Hooks，避免 Class 组件
- 后端使用 RESTful API 设计规范，合理划分资源和操作
- 代码中使用英文命名，注释和文档可用中文
- 提交前确保 lint（ESLint）和类型检查（tsc）通过

## 命名与文件组织

- 组件文件使用 PascalCase（如 `UserProfile.tsx`）
- 工具函数和常量使用 camelCase（如 `formatDate.ts`）
- 按功能模块组织目录结构，避免过度嵌套

## 前后端协作

- 使用类型共享库保持 API 契约一致
- API 文档使用 OpenAPI/Swagger 规范
- 异常处理必须包含明确的错误码和消息

## 测试与质量

- 单元测试覆盖率目标 ≥ 80%
- 关键业务逻辑必须有集成测试
- 代码变更需要经过 Code Review 和自动化测试
