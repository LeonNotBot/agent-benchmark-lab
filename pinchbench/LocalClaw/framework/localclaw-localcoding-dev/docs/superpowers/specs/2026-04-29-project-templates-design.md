# 项目模板系统设计文档

## 概述

为 Local Claw 添加「项目模板」系统，让用户在创建新会话时可以选择预设模板快速开始。模板包含 CLAUDE.md 预设、推荐 Skills、初始提示词和路由/模型偏好。用户也可以将自定义配置保存为模板。

## 需求摘要

- **入口时机：** 应用启动或无活跃会话时，主区域显示模板选择欢迎页
- **模板内容：** CLAUDE.md 预设、推荐 Skills 列表、初始提示词、路由/模型偏好
- **模板来源：** 内置模板 + 用户本地自定义模板（不涉及在线市场）
- **保存方式：** 用户手动填写表单保存为自定义模板

## 1. 数据结构与存储

### 1.1 存储方案

采用文件系统存储，与现有技能系统（`~/.localclaw/skills/`）模式一致。

### 1.2 目录结构

```
~/.localclaw/templates/
├── web-fullstack/
│   └── TEMPLATE.md
├── data-analysis/
│   └── TEMPLATE.md
├── tech-writing/
│   └── TEMPLATE.md
├── ai-development/
│   └── TEMPLATE.md
└── my-custom-template/      # 用户自定义
    └── TEMPLATE.md
```

内置模板打包在 `resources/builtin-templates/` 中，应用启动时同步到用户目录。

### 1.3 TEMPLATE.md 格式

采用 frontmatter + markdown 格式：

```markdown
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
initialPrompt: "我正在开发一个全栈 Web 应用，请帮我..."
builtin: false
---

# CLAUDE.md 预设内容

这里是模板的 CLAUDE.md 内容，创建会话时会应用到工作目录。
```

### 1.4 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 模板显示名称 |
| description | string | 是 | 一句话描述 |
| icon | string | 是 | emoji 图标 |
| category | string | 是 | 分类：development / writing / data / devops / other |
| routingPreference | string | 是 | 路由偏好：auto / cloud / local |
| modelOverride | string | 否 | 模型覆盖，留空使用默认 |
| skills | string[] | 否 | 推荐安装的技能名称列表 |
| initialPrompt | string | 否 | 初始提示词，创建会话时自动填入输入框 |
| builtin | boolean | 是 | 是否为内置模板（内置模板不可删除） |

markdown 正文部分即为 CLAUDE.md 的预设内容。

### 1.5 TypeScript 类型定义

```typescript
interface Template {
  slug: string;              // 目录名，唯一标识
  name: string;
  description: string;
  icon: string;
  category: 'development' | 'writing' | 'data' | 'devops' | 'other';
  routingPreference: 'auto' | 'cloud' | 'local';
  modelOverride?: string;
  skills: string[];
  initialPrompt?: string;
  builtin: boolean;
  claudeMdContent: string;   // CLAUDE.md 正文内容
}

// 列表接口返回（不含 claudeMdContent，减少传输）
type TemplateSummary = Omit<Template, 'claudeMdContent'>;
```

## 2. 后端服务

### 2.1 模块结构

新增 `packages/server/src/modules/template/` 模块：

```
template/
├── template.module.ts
├── template.service.ts
└── template.types.ts
```

### 2.2 TemplateService 核心方法

| 方法 | 说明 |
|------|------|
| `listTemplates(): TemplateSummary[]` | 扫描 `~/.localclaw/templates/`，解析所有 TEMPLATE.md 的 frontmatter |
| `getTemplate(slug): Template` | 读取完整模板内容，包括 CLAUDE.md 正文 |
| `saveTemplate(data): Template` | 将模板数据写入 `~/.localclaw/templates/{slug}/TEMPLATE.md` |
| `deleteTemplate(slug): void` | 删除自定义模板目录（内置模板拒绝删除） |
| `syncBuiltinTemplates(): void` | 启动时将 `resources/builtin-templates/` 同步到用户目录，仅补充缺失的 |
| `applyTemplate(slug, sessionId)` | 将路由偏好和模型覆盖应用到会话上下文 |

### 2.3 内置模板同步策略

`syncBuiltinTemplates()` 在应用启动时由 `TemplateModule.onModuleInit()` 调用：

1. 扫描 `resources/builtin-templates/` 下所有模板目录
2. 对比 `~/.localclaw/templates/` 中已有模板
3. 仅复制用户目录中不存在的模板（不覆盖用户修改过的同名模板）
4. 复制时标记 `builtin: true`

## 3. WebSocket 协议扩展

### 3.1 客户端 → 服务器

| 事件 | Payload | 说明 |
|------|---------|------|
| `template.list` | `{}` | 请求模板列表 |
| `template.detail` | `{ slug: string }` | 请求单个模板详情（含 CLAUDE.md 正文） |
| `template.save` | `{ template: TemplateData }` | 保存自定义模板 |
| `template.delete` | `{ slug: string }` | 删除自定义模板 |

### 3.2 服务器 → 客户端

| 事件 | Payload | 说明 |
|------|---------|------|
| `template.list` | `{ templates: TemplateSummary[] }` | 返回模板列表 |
| `template.detail` | `{ template: Template }` | 返回模板详情 |
| `template.saved` | `{ template: TemplateSummary }` | 保存成功 |
| `template.deleted` | `{ slug: string }` | 删除成功 |
| `template.error` | `{ message: string }` | 操作失败 |

### 3.3 会话创建流程变更

现有 `session.start` 事件 payload 扩展可选字段 `templateSlug: string`。

当传入 `templateSlug` 时，后端在创建会话后额外执行：
1. 读取模板的 `routingPreference` 和 `modelOverride`
2. 应用到当前会话的路由上下文
3. 读取模板的 `claudeMdContent`，写入会话工作目录 `{cwd}/.localclaw/CLAUDE.md`（若该文件已存在则追加模板内容到末尾，避免覆盖用户已有配置）
4. CLAUDE.md 写入由后端的 `applyTemplate()` 方法完成；skills 列表返回给前端提示用户安装

## 4. 前端 UI 设计

### 4.1 欢迎页（模板选择界面）

**触发条件：** 应用启动或无活跃会话时，主区域显示欢迎页。

**布局结构：**
- 顶部居中：欢迎语 + 副标题引导文案
- 中间：3 列模板卡片网格
  - 每张卡片：emoji 图标 + 名称 + 一句话描述 + 推荐 skills 标签
  - 最后一张：虚线边框「管理模板」入口
- 底部：保留现有输入框

**交互流程：**
1. 点击模板卡片 → 展开模板详情弹层（完整描述、CLAUDE.md 预览、推荐 skills 列表）
2. 点击「使用此模板」 → 初始提示词填入输入框、路由偏好切换、提示安装未安装的推荐 skills
3. 用户可忽略模板，直接在底部输入框输入，行为与当前一致

### 4.2 新增组件

| 组件 | 位置 | 说明 |
|------|------|------|
| `WelcomePage.tsx` | `packages/client/src/components/` | 欢迎页主容器，包含模板卡片网格 |
| `TemplateCard.tsx` | `packages/client/src/components/` | 单个模板卡片组件 |
| `TemplateDetail.tsx` | `packages/client/src/components/` | 模板详情弹层 |
| `TemplateManager.tsx` | `packages/client/src/components/` | 模板管理面板（在设置页中） |
| `TemplateForm.tsx` | `packages/client/src/components/` | 保存/编辑模板的表单组件 |

### 4.3 状态管理

在 `useAppStore` 中新增：

```typescript
// state
templates: Template[];
selectedTemplate: Template | null;
showTemplateManager: boolean;

// actions
setTemplates(templates: Template[]): void;
selectTemplate(template: Template | null): void;
setShowTemplateManager(show: boolean): void;
```

### 4.4 保存为模板

在设置页（SettingsPanel）中新增「模板管理」tab：

**保存新模板表单字段：**
- 模板名称（slug，英文，作为目录名）
- 显示名称
- 描述
- 图标（emoji）
- 分类（下拉：development / writing / data / devops / other）
- CLAUDE.md 内容（多行文本编辑器）
- 推荐 Skills（从已安装 skills 中多选）
- 初始提示词
- 路由偏好（下拉：auto / cloud / local）
- 模型覆盖（可选下拉）

**已有模板列表：**
- 卡片形式展示，内置模板带「内置」标签且不可删除
- 自定义模板支持编辑和删除

## 5. 内置模板清单

首批内置 4 个模板：

| slug | 图标 | 名称 | 描述 | 路由偏好 | 推荐 Skills |
|------|------|------|------|----------|-------------|
| web-fullstack | 🌐 | Web 全栈开发 | React + Node.js 全栈项目开发 | auto | brainstorming, code-review |
| data-analysis | 📊 | 数据分析 | Python 数据科学与可视化 | cloud | brainstorming |
| tech-writing | ✍️ | 技术写作 | 文档、博客、技术方案撰写 | auto | writing-clearly-and-concisely |
| ai-development | 🤖 | AI 应用开发 | LLM 应用与 Agent 开发 | cloud | brainstorming |

每个内置模板的 CLAUDE.md 正文包含对应领域的最佳实践指引和编码规范。

## 6. 涉及的现有文件变更

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `packages/shared/src/types.ts` | 修改 | 新增 Template 相关类型和 WebSocket 事件类型 |
| `packages/server/src/app.module.ts` | 修改 | 注册 TemplateModule |
| `packages/server/src/modules/websocket/websocket.gateway.ts` | 修改 | 添加 template.* 事件处理 |
| `packages/client/src/store/useAppStore.ts` | 修改 | 新增 template 相关 state 和 actions |
| `packages/client/src/hooks/useWebSocket.ts` | 修改 | 添加 template.* 事件监听 |
| `packages/client/src/components/PromptInput.tsx` | 修改 | 无活跃会话时渲染 WelcomePage |
| `packages/client/src/components/SettingsPanel.tsx` | 修改 | 新增「模板管理」tab |
| `packages/client/src/i18n/` | 修改 | 添加模板相关的中英文翻译 |

## 7. 不在范围内

- 在线模板市场/分享功能
- 模板版本管理
- 模板导入/导出（文件形式天然支持手动复制）
- 模板内嵌文件（如 .eslintrc 等项目配置文件）
