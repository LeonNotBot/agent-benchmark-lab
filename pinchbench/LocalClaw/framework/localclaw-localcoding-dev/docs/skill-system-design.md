# Skill 系统设计与实现文档

## 1. 背景

local-claw 是一个基于 Claude Code CLI 的桌面 AI Agent 产品。Claude Code 内部已有完整的 skill 加载机制：

- **用户级 skill**: `~/.localclaw/skills/<skill-name>/SKILL.md`
- **项目级 skill**: `.localclaw/skills/<skill-name>/SKILL.md`
- **内置 skill**: 编译在 CLI 内部（simplify, loop, dream 等）
- **MCP skill**: 通过 MCP 服务器的 `skill://` 资源协议加载

Claude Code 启动时自动扫描上述目录加载 skill，所以 **local-claw 不需要重新实现 skill 执行引擎**，只需要管理 skill 文件即可。

**目标**: 为用户提供可视化的 skill 管理界面 + 外部 skill 市场，让用户可以创建、编辑、导入、分享 skill。

---

## 2. Skill 文件格式

遵循 Claude Code 原生规范：

```
~/.localclaw/skills/
  my-skill/
    SKILL.md          # 主文件（含 frontmatter + prompt 内容）
    helper.sh         # 可选的辅助文件
    template.txt      # 可选的模板文件
```

SKILL.md 格式示例：

```markdown
---
name: 显示名称
description: 一句话描述
when_to_use: 模型什么时候应该自动使用此 skill
allowed-tools: [Bash, Read, Write, Edit]
user-invocable: true
model: sonnet
context: fork
argument-hint: "<file-path>"
arguments: [file]
---

你是一个专业的代码审查助手...
（prompt 内容）
```

### Frontmatter 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 否 | 显示名称，缺省使用目录名 |
| `description` | string | 是 | 一句话描述 |
| `when_to_use` | string | 否 | 模型自动调用的条件描述 |
| `allowed-tools` | string[] | 否 | 允许使用的工具列表 |
| `user-invocable` | boolean | 否 | 是否可由用户通过 `/` 触发，默认 true |
| `model` | string | 否 | 指定模型（sonnet/opus/haiku） |
| `context` | string | 否 | 执行上下文（inline/fork） |
| `argument-hint` | string | 否 | 参数提示 |
| `arguments` | string[] | 否 | 参数名列表 |

---

## 3. 架构设计

### 3.1 后端：SkillModule（NestJS）

**文件结构**：

```
packages/server/src/modules/skill/
  ├── dto/skill.dto.ts        # 数据传输对象
  ├── skill.service.ts         # 核心业务逻辑
  ├── skill.controller.ts      # REST API 控制器
  └── skill.module.ts          # NestJS 模块定义
```

**SkillService 职责**：

- 扫描 `~/.localclaw/skills/` 目录，列出所有已安装 skill
- 读取 SKILL.md 解析 frontmatter 元数据
- 创建 skill（新建目录 + SKILL.md）
- 编辑 skill（更新 SKILL.md）
- 删除 skill（删除目录）
- 从市场安装 skill（下载 → 写入目录）
- 导出 skill（打包为 JSON）

**REST API**：

| Route | Method | 描述 |
|-------|--------|------|
| `/api/skills` | GET | 列出所有本地 skill |
| `/api/skills/:name` | GET | 获取 skill 详情（含完整内容） |
| `/api/skills` | POST | 创建新 skill |
| `/api/skills/:name` | PUT | 更新已有 skill |
| `/api/skills/:name` | DELETE | 删除 skill |

### 3.2 后端：SkillMarketModule

**文件结构**：

```
packages/server/src/modules/skill-market/
  ├── skill-market.service.ts      # 市场业务逻辑
  ├── skill-market.controller.ts   # REST API 控制器
  └── skill-market.module.ts       # NestJS 模块定义
```

**市场数据源设计**：

支持两种数据源模式：

- **GitHub 扫描模式**（`type: "github"`）：通过 GitHub API 扫描仓库目录自动发现 skill，无需 `registry.json`
- **Registry 模式**（`type: "registry"`）：从仓库获取 `registry.json` 索引文件（类似 Homebrew tap）

默认市场源：[everything-claude-code](https://github.com/affaan-m/everything-claude-code)（183 个 skill，Anthropic 黑客松获奖项目），采用 GitHub 扫描模式。

**registry.json 格式**（仅 registry 模式使用）：

```json
{
  "version": 1,
  "skills": [
    {
      "name": "code-review",
      "displayName": "代码审查",
      "description": "自动审查代码质量和安全性",
      "author": "cngaofei",
      "version": "1.0.0",
      "tags": ["review", "quality"],
      "path": "skills/code-review",
      "downloads": 1234
    }
  ]
}
```

**REST API**：

| Route | Method | 描述 |
|-------|--------|------|
| `/api/market/skills` | GET | 搜索市场 skill（支持 `?q=` 关键词、`?tag=` 标签过滤） |
| `/api/market/skills/install` | POST | 从市场安装 skill（body: `{sourceId, name}`） |
| `/api/market/sources` | GET | 列出已配置的市场源 |
| `/api/market/sources` | POST | 添加市场源（body: `{name, url}`） |
| `/api/market/sources/:id` | DELETE | 删除市场源 |
| `/api/market/refresh` | POST | 刷新市场索引缓存 |

### 3.3 共享类型

在 `packages/shared/src/types.ts` 中新增：

```typescript
// Skill 元数据
export type SkillMeta = {
  name: string;
  displayName?: string;
  description: string;
  whenToUse?: string;
  allowedTools: string[];
  userInvocable: boolean;
  model?: string;
  context?: "inline" | "fork";
  argumentHint?: string;
  arguments?: string[];
  source: "user" | "project" | "market";
  installedAt?: number;
};

// Skill 完整数据
export type SkillDetail = SkillMeta & {
  content: string;
  rawMarkdown: string;
  files?: string[];
};

// 市场 Skill（author/version/tags/downloads 可选，GitHub 扫描源缺少这些字段）
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

// 市场源
export type MarketSource = {
  id: string;
  name: string;
  url: string;
  type: "github" | "registry" | "custom";  // github=目录扫描, registry=JSON索引
  skillsPath?: string;  // GitHub 扫描的子目录路径，默认 "skills"
  skillCount: number;
  lastSync?: number;
};
```

WebSocket 事件扩展：

```typescript
// ServerEvent 新增
| { type: "skill.list"; payload: { skills: SkillMeta[] } }
| { type: "skill.detail"; payload: { skill: SkillDetail } }
| { type: "skill.installed"; payload: { skill: SkillMeta } }
| { type: "skill.deleted"; payload: { name: string } }
| { type: "skill.error"; payload: { message: string } }

// ClientEvent 新增
| { type: "skill.list" }
| { type: "skill.install"; payload: { source: string; name: string } }
```

---

## 4. 前端设计

### 4.1 组件结构

| 组件 | 文件 | 说明 |
|------|------|------|
| `SkillManager` | `components/SkillManager.tsx` | 侧滑管理面板，含"我的 Skills"和"市场"两个 Tab |
| `SkillEditor` | `components/SkillEditor.tsx` | 创建/编辑 skill 的表单弹窗 |

### 4.2 UI 布局

- **Sidebar** 底部添加 "Skills" 图标按钮
- 点击打开 `SkillManager` 面板（抽屉式设计，与 ModelManager 同风格）
- 面板内含两个 Tab：
  - **我的 Skills**: 列表展示已安装 skill，支持新建/编辑/删除
  - **市场**: 搜索框 + skill 卡片列表，一键安装

### 4.3 Skill 编辑器

表单字段：名称、显示名称、描述、何时使用、允许的工具（复选框）、模型（下拉）、Prompt 内容（大文本框）

### 4.4 输入框 Skill 快捷触发

在 `PromptInput` 中：

- 输入 `/` 时自动弹出已安装 skill 列表
- 支持关键词过滤
- 支持键盘导航（上/下箭头、Tab/Enter 选择、Esc 关闭）
- 选择后自动填入 `/<skill-name> ` 前缀

### 4.5 状态管理

`useAppStore` 新增：

```typescript
// State
skillManagerOpen: boolean;
skills: SkillMeta[];
marketSkills: MarketSkill[];
editingSkill: SkillMeta | null;

// Actions
setSkillManagerOpen: (open: boolean) => void;
setSkills: (skills: SkillMeta[]) => void;
setMarketSkills: (skills: MarketSkill[]) => void;
setEditingSkill: (skill: SkillMeta | null) => void;
```

---

## 5. 文件清单

### 新增文件

| 文件路径 | 说明 |
|----------|------|
| `packages/server/src/modules/skill/dto/skill.dto.ts` | DTO 类 |
| `packages/server/src/modules/skill/skill.service.ts` | Skill CRUD 服务 |
| `packages/server/src/modules/skill/skill.controller.ts` | REST API |
| `packages/server/src/modules/skill/skill.module.ts` | NestJS 模块 |
| `packages/server/src/modules/skill-market/skill-market.service.ts` | 市场服务 |
| `packages/server/src/modules/skill-market/skill-market.controller.ts` | 市场 API |
| `packages/server/src/modules/skill-market/skill-market.module.ts` | 市场模块 |
| `packages/client/src/components/SkillManager.tsx` | Skill 管理面板 |
| `packages/client/src/components/SkillEditor.tsx` | Skill 编辑器 |

### 修改文件

| 文件路径 | 修改内容 |
|----------|----------|
| `packages/shared/src/types.ts` | 添加 Skill 相关类型和事件定义 |
| `packages/server/src/app.module.ts` | 注册 SkillModule 和 SkillMarketModule |
| `packages/client/src/store/useAppStore.ts` | 添加 skill 状态和事件处理 |
| `packages/client/src/components/Sidebar.tsx` | 添加 Skills 入口按钮 |
| `packages/client/src/components/PromptInput.tsx` | 添加 `/` 触发 skill 选择菜单 |
| `packages/client/src/App.tsx` | 集成 SkillManager 和 SkillEditor |

---

## 6. 核心设计原则

1. **零侵入**: skill 文件完全遵循 Claude Code 原生格式，写入 `~/.localclaw/skills/` 后 CLI 自动识别
2. **模块化**: 后端采用 NestJS 模块化架构，skill 管理和市场功能独立解耦
3. **一致体验**: 前端 UI 风格与现有 ModelManager 保持一致（Tailwind + 抽屉式面板）
4. **可扩展**: 市场支持多源管理，用户可自建 skill 仓库

---

## 7. 验证结果

- TypeScript 编译: **通过**（新增代码无编译错误）
- 后端构建 (`build:server`): **通过** → `dist-server/server.cjs`
- 前端构建 (`build`): **通过** → `dist/`

---

## 8. GitHub 目录扫描方案

### 8.1 背景

社区最大的 Claude Code skill 集合 [everything-claude-code](https://github.com/affaan-m/everything-claude-code) 包含 183 个 skill，采用纯目录结构（`/skills/<name>/SKILL.md`），没有 `registry.json`。为了直接对接该仓库，SkillMarketService 增加了 GitHub API 目录扫描能力。

### 8.2 数据源模式对比

| 特性 | GitHub 扫描模式 | Registry 模式 |
|------|-----------------|---------------|
| 配置 | `type: "github"`, `url` 为 GitHub 仓库地址 | `type: "registry"`, `url` 为 raw 文件基础路径 |
| 发现机制 | GitHub Contents API 扫描目录 | 读取 `registry.json` 索引 |
| 元数据来源 | 逐个获取 SKILL.md frontmatter | registry.json 一次性提供 |
| author/version/tags | 可选（取决于 SKILL.md frontmatter） | 必填（registry.json 定义） |
| 适用场景 | 社区仓库、无索引的 skill 集合 | 自建市场、有完整元数据的仓库 |

### 8.3 GitHub 扫描流程

```
1. 解析 GitHub URL → 提取 owner/repo
2. GET https://api.github.com/repos/{owner}/{repo}/contents/{skillsPath}
   → 获取目录列表，过滤 type=dir 的条目
3. 批量获取 SKILL.md（每批 10 个并发）
   GET https://raw.githubusercontent.com/{owner}/{repo}/main/{skillsPath}/{name}/SKILL.md
   → 解析 frontmatter 提取 name + description
4. 构造 RegistryData 格式（与 registry.json 兼容）
5. 缓存 10 分钟
```

### 8.4 默认市场源

```typescript
const DEFAULT_SOURCE: MarketSource = {
  id: "official",
  name: "Everything Claude Code",
  url: "https://github.com/affaan-m/everything-claude-code",
  type: "github",
  skillsPath: "skills",
  skillCount: 0,
};
```

### 8.5 安装流程

GitHub 模式下安装 skill：

```
1. 从缓存的 registry 中找到目标 skill 的 path
2. GET https://raw.githubusercontent.com/{owner}/{repo}/main/{path}/SKILL.md
3. 调用 skillService.installFromRaw(name, content) 写入 ~/.localclaw/skills/{name}/SKILL.md
```

Claude Code 只读取 SKILL.md 文件，skill 目录下的 `commands/`、`hooks/`、`agents/` 等子目录不会被自动加载，因此仅下载 SKILL.md 即可完成安装。

### 8.6 性能与限制

- **API 速率**: 未认证 GitHub API 限制 60 次/小时，目录扫描使用 1 次 API 调用，SKILL.md 通过 raw.githubusercontent.com CDN 获取（不受 API 限制），10 分钟缓存下每小时最多 6 次 API 调用
- **分支假设**: 默认使用 `main` 分支，使用 `master` 或其他默认分支的仓库需手动适配
- **多行描述截断**: 简化的 frontmatter 解析器按行解析，YAML 多行续行格式的 description 会被截断为首行（cosmetic 问题，不影响功能）

---

## 9. Skill 导入/导出

### 9.1 功能概述

支持将已安装的 skill 导出为 zip 分享给他人，也支持从本地 zip 文件或文件夹导入 skill。导入时智能兼容多种来源格式（标准 Claude Code、ClawHub、嵌套目录），自动验证合法性并提示依赖警告。

### 9.2 API

| Route | Method | 描述 |
|-------|--------|------|
| `/api/skills/:name/export` | GET | 导出 skill 为 zip 下载 |
| `/api/skills/import` | POST | 导入本地路径（JSON body `{ path: "..." }`） |
| `/api/skills/import-zip` | POST | 导入上传的 zip（binary body） |

### 9.3 导出流程

将 `~/.localclaw/skills/<name>/` 整个目录递归打包为 zip，包含 SKILL.md 及所有辅助文件（scripts/、references/、bin/ 等）。使用 `adm-zip` 库。

### 9.4 导入智能检测流程

```
输入（zip 文件或目录路径）
  │
  ├─ 是 .zip 文件？→ 解压到临时目录
  │
  ▼
扫描目录，查找 SKILL.md 位置
  │
  ├─ 根目录有 SKILL.md？→ 标准格式（Claude Code / everything-claude-code）
  │
  ├─ 有 latest/SKILL.md？→ ClawHub 格式
  │     └─ 截取 SKILL.md 中第一个 "---" 开始的内容（去掉非标准元数据头）
  │
  ├─ 唯一子目录含 SKILL.md？→ 嵌套格式（zip 包裹了一层目录），自动解套
  │
  └─ 找不到 SKILL.md → 报错："未找到 SKILL.md 文件，不是有效的 Skill 目录"
  │
  ▼
验证 SKILL.md
  ├─ 无 --- frontmatter → 报错
  ├─ frontmatter 无 name 且无 description → 报错
  │
  ▼
拷贝文件到 ~/.localclaw/skills/<name>/
  ├─ SKILL.md（ClawHub 格式经过清洗）
  ├─ 辅助目录：scripts/、references/、bin/、docs/ 等
  ├─ 辅助文件：*.md、*.py、*.js、*.mjs、*.sh 等
  │
  ▼
生成 warnings 列表
  ├─ 同名 skill 已存在 → "已覆盖同名 Skill: xxx"
  ├─ 有 package.json → "检测到 Node.js 依赖，可能需要运行 npm install"
  ├─ 有 requirements.txt → "检测到 Python 依赖，可能需要运行 pip install"
  ├─ 有 scripts/ 或 bin/ → "包含可执行脚本目录: scripts/"
```

### 9.5 跳过文件清单

导入时自动排除以下文件/目录：

| 文件/目录 | 来源 | 原因 |
|-----------|------|------|
| `manifest.json` | ClawHub | 平台元数据，非 skill 内容 |
| `_meta.json` | ClawHub | 发布元数据 |
| `package-lock.json` | npm | 锁文件，体积大且不需要 |
| `node_modules/` | npm | 依赖目录 |
| `.git/`、`.github/` | Git | 版本控制文件 |
| `agents/` | everything-claude-code | OpenAI 框架配置，与 Claude Code 无关 |

### 9.6 ClawHub 格式兼容

ClawHub (clawhub.ai) 是活跃的 Claude Code skill 市场平台。其 skill 包结构为：

```
skill-name/
  ├── 1.0.0/          # 历史版本
  ├── latest/          # 当前版本
  │   ├── SKILL.md     # 带非标准头信息
  │   ├── manifest.json
  │   ├── scripts/     # 可选
  │   └── references/  # 可选
```

ClawHub 的 SKILL.md 文件在标准 frontmatter 之前有一段纯文本元数据（Summary、Owner、License 等），导入时通过 `cleanClawHubSkillMd()` 方法定位第一个 `\n---\n` 并截取后面的内容。

### 9.7 前端 UI

- **导出按钮**: 每个 SkillCard 上增加「导出」按钮，点击触发浏览器下载 `<name>.zip`
- **导入按钮**: MySkillsTab 顶部与「新建 Skill」并排，点击打开文件选择对话框（.zip）
- **导入结果**: 弹窗显示成功/失败信息及 warnings 列表

### 9.8 修改文件

| 文件 | 修改内容 |
|------|----------|
| `packages/server/src/modules/skill/skill.service.ts` | 新增 exportSkill()、importSkill()、importFromZipBuffer() 及辅助方法 |
| `packages/server/src/modules/skill/skill.controller.ts` | 新增 GET export、POST import、POST import-zip 路由 |
| `packages/client/src/components/SkillManager.tsx` | SkillCard 增加导出按钮，MySkillsTab 增加导入按钮 |
| `packages/client/src/App.tsx` | 新增 handleExportSkill、handleImportSkill |
| `package.json` | 新增依赖 adm-zip、@types/adm-zip |
