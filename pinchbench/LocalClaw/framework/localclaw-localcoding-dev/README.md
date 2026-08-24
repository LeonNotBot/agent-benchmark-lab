# LocalCoding

**LocalCoding** 是一款可本地部署、支持本地模型的 AI 编程工作台（AI Coding Agent），产品形态类似 Codex / Claude Code，但落地为一个开箱即用的桌面应用（Electron，覆盖 Windows / macOS / Linux）。它的一个核心价值是**让数据可以不上云**：平台优先支持对接本地/私有部署的模型，让代码、对话、工作区文件留在本机；同时支持按任务智能切换模型，敏感任务交给本地模型处理，需要更强能力时再切到其他后端——把"数据边界"的控制权交回用户手里。在此基础上，它把"AI 帮你写代码"从命令行里的单点能力，升级为一条从**对话编程 → 应用获取 → 二次开发 → 自动部署**的完整闭环，让非专业开发者也能在本地把一个想法直接跑成可访问的线上应用。

平台以对话为中心组织工作流。内置 AI Coding Agent 支持多会话隔离、计划模式（Plan Mode 写保护）、任务快照、技能（Skills）与技能工坊、MCP 工具接入、记忆（Memory）与知识库，以及权限模式热切换等能力。会话与项目工作区一一绑定，Agent 直接在本地目录读写代码、跑命令、装依赖、做验证，配套右侧工作台提供文件浏览、内置浏览器预览、代码评审（Review）等面板，形成"边聊边看边改"的编程体验。同时支持多渠道接入（钉钉 / 飞书 / 微信）和定时任务（Cron），既是个人编程助手，也可作为长驻的自动化 Agent。

### 特色一：本地模型 + 智能路由

平台支持对接本地/私有部署的模型，并能按任务智能切换（smart-hybrid 路由）：敏感或本地可胜任的任务走本地模型、数据不出本机，需要更强能力时再切到其他端点。模型端点与服务商可自由配置、带预设，兼顾数据安全与效果。

### 特色二：自动部署（Auto Deploy）

会话把当前工作区打成代码包后，通过统一的部署面板一键提交到自动部署系统，并以 SSE 实时回流进度——分阶段（building / running / failed 等）展示 stage 历史、百分比进度、终端尾部日志，直至拿到可访问的 publishedUrl。部署失败时会带诊断信息（失败阶段、错误、修复建议），支持自动修复与一键重新部署；表单与"进行中/最近成功/最近失败"记录均按会话隔离持久化，切走再回来现场不丢。用户不用碰 CI/CD、不用写部署脚本，说一句"部署上线"即可。

### 特色三：应用工坊（App Studio / App Market）

平台提供一批预制应用源码模板（抽奖系统、电商、官网等），从远端拉取列表（走 CDN 直链下载 + sha256 校验），本地完成解压、依赖安装，全过程 SSE 实时反馈；采用 SWR 缓存（先展示磁盘缓存不白屏、后台 revalidate）保证列表秒开。安装完成后点"开始开发"，自动把该目录设为工作区并新建会话，直接进入 AI 二次开发——压缩包内置的 `README.ai.md` 作为改造引导喂给 Agent，配合建议提示词，用户拿到的不是空模板而是一个能立刻改、改完能立刻上线的起点。工坊与自动部署天然衔接：**选应用 → AI 改造 → 一键部署**。

### 特色四：VSCode 插件

除桌面应用外，平台提供 VSCode 原生插件（路线 B 原生集成），把 AI 编程能力直接嵌入开发者最熟悉的编辑器：原生 Webview UI（非 iframe 套壳）、按工作区过滤的原生会话列表（TreeView）、当前文件/选区自动上下文注入（免手动 @），复用同一套后端能力。让重度 IDE 用户无需切换环境即可获得同样的对话编程与工作区绑定体验。

### 技术形态

pnpm monorepo，分为 client（React 前端工作台）、server（NestJS 服务）、sdk（`@lenovo/agent-sdk`，一站式提供会话/Runner/路由/工作区/Git/Deploy 等能力的动态模块）、channel（多渠道适配）、protocol（共享类型）等包；内嵌 claude-cli 与最小化 git-bash 工具集，并接入线上监控（仅 release 包生效）。核心追求是：**AI 写代码、人做决策**——把编程、获取、改造、上线这几件原本割裂的事，收敛进同一个本地应用里，同时把数据留在你能掌控的地方。

## 快速开始

### 前置条件

- Node.js 22 LTS（推荐）
- Corepack / pnpm

> 这是一个 pnpm workspace 仓库，不要用 npm 安装依赖。

```bash
git clone https://gitlab.xpaas.lenovo.com/agenticai/localclaw.git
cd localclaw
corepack enable
pnpm install
```

如果安装过程中出现 native 依赖脚本被阻止的提示，可以执行：

```bash
pnpm approve-builds
```

### 开发模式

最常用的启动方式是：

```bash
pnpm dev
```

它会依次：

- 构建前端到 `dist/`
- 构建服务端到 `dist-server/`
- 启动 Node 服务，默认监听 `http://127.0.0.1:10086/`

### 分步运行

```bash
pnpm build          # 只构建前端
pnpm build:server   # 只构建服务端
pnpm start:node     # 启动已构建的服务端
```

`pnpm start:node` 当前会先检测 `better-sqlite3` 是否与当前 Node ABI 兼容；如果不兼容，会尝试自动执行 `prebuild-install` 或 `node-gyp rebuild`。如果仍然失败，优先切换到 Node 22 LTS 再重试。

### Electron

```bash
pnpm electron:dev
pnpm electron:build:win
pnpm electron:build:mac
pnpm electron:build:linux
```

## 当前目录结构

```text
localcoding/
├── packages/
│   ├── client/          # React 前端工作台
│   ├── server/          # NestJS 服务端
│   ├── sdk/             # @lenovo/agent-sdk：会话/Runner/路由/工作区/Git/Deploy 等核心能力
│   ├── protocol/        # 前后端共享类型
│   ├── channel/         # 多渠道适配（钉钉 / 飞书 / 微信）
│   ├── claude-cli/      # 内置 CLI runner
│   └── vscode-ext/      # VSCode 原生插件
├── electron/            # Electron 主进程
├── scripts/             # 构建与启动脚本
├── resources/           # 内置 skills / templates 等资源
├── dist/                # 前端构建产物
└── dist-server/         # 服务端构建产物
```

## 技术栈

### 前端

- React 19
- TypeScript
- Zustand
- Tailwind CSS 4
- WebSocket 实时通信

### 后端

- NestJS
- `ws` WebSocket 适配器
- REST + WebSocket 混合接口
- SQLite（`better-sqlite3`）
- `@lenovo/agent-sdk`（会话 / Runner / 路由 / 工作区 / Git / Deploy 一站式动态模块）
- Claude Agent SDK / CLI runner

### 桌面端

- Electron
- electron-builder

## 模型路由网关

所有 CLI 的 API 请求通过本地网关（`localhost:10086/v1`）路由到正确的上游端点：

```
CLI → POST localhost:10086/v1/chat/completions { model: "deepseek/deepseek-v4-flash" }
    ↓
Gateway → 按 model name 查找 endpoint registry → 转发到 OpenRouter/Sky/Ollama
    ↓
上游 → 返回响应 → Gateway → CLI
```

新增供应商 = 在 `settings.json` 的 `endpoints` 中增加一条配置，无需改代码。

### Smart Hybrid（智能模型升级）

- **Default model**: 处理普通任务（如 deepseek-v4-flash）
- **Upgrade model**: 自动用于关键任务（如 claude-opus-4-7）
- 支持跨供应商升级（如 OpenRouter → Sky）

## 配置文件与数据目录

### 用户级目录

- `~/.localcoding/settings.json`

所有配置集中在此文件（首次启动时自动创建）。

#### Endpoint 配置（供应商 + 模型）

在 `settings.json` 中添加 `endpoints` 数组，定义可用的模型供应商和模型列表。前端 ModelSelector 和 SmartHybrid 均从此配置读取。

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "<Sky API Key>",
    "ANTHROPIC_BASE_URL": "https://sky.tinyandbeautiful.com",
    "OPENAI_API_KEY": "<OpenRouter API Key>",
    "OPENAI_BASE_URL": "https://openrouter.ai/api/v1"
  },
  "endpoints": [
    {
      "id": "sky",
      "label": "Sky",
      "apiType": "openai-compatible",
      "baseUrl": "https://sky.tinyandbeautiful.com/v1",
      "apiKey": "<Sky API Key>",
      "enabled": true,
      "models": [
        { "id": "claude-sonnet-4-6", "label": "Sonnet 4.6", "tags": ["smart", "coding"] },
        { "id": "claude-opus-4-7", "label": "Opus 4.7", "tags": ["reasoning", "critical"] }
      ]
    },
    {
      "id": "openrouter",
      "label": "OpenRouter",
      "apiType": "openai-compatible",
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "<OpenRouter API Key>",
      "enabled": true,
      "models": [
        { "id": "deepseek/deepseek-v4-flash", "label": "DeepSeek V4 Flash", "tags": ["fast"] },
        { "id": "deepseek/deepseek-v4-pro", "label": "DeepSeek V4 Pro", "tags": ["smart", "critical"] }
      ]
    },
    {
      "id": "local-ollama",
      "label": "本地 Ollama",
      "apiType": "openai-compatible",
      "baseUrl": "http://127.0.0.1:11434/v1",
      "apiKey": "ollama",
      "enabled": true,
      "models": []
    }
  ]
}
```

**加载优先级：** settings.json `endpoints` 字段 > DB 已有配置 > env vars 自动种子化

**分享配置给同学：** 直接把 `~/.localcoding/settings.json` 发给他们替换，重启 server 即生效。

**只有 env 没有 endpoints？** 首次启动时会从 env vars 自动生成 endpoints 配置并存入 DB。

#### 其他 env vars

```bash
ANTHROPIC_AUTH_TOKEN=        # Sky/Anthropic API Key
ANTHROPIC_BASE_URL=          # Sky/Anthropic base URL
OPENAI_API_KEY=              # OpenRouter API Key
OPENAI_BASE_URL=             # OpenRouter base URL
ANTHROPIC_MODEL=             # 默认模型
API_TIMEOUT_MS=              # API 超时（毫秒）
CLAUDE_RUNNER_MODE=          # CLI 运行模式
CLAUDE_CLI_PATH=             # CLI 路径
CLAUDE_CLI_EXECUTABLE=       # CLI 可执行文件
```

- `~/.localcoding/skills`
- `~/.localcoding/templates`
- `~/.localcoding/projects`
- `~/.localcoding/scheduled_tasks.json`
- `~/.localcoding/scheduled_task_history.json`
- `~/.localcoding/settings.json`

渠道、知识库、定时任务、连接器（MCP）相关 MCP 注册现在会写入 `~/.localcoding/settings.json` 的 `mcpServers`。连接器的整体架构、配置链路与测试方法见 [连接器技术方案](连接器/连接器技术方案.md)。

### 工作区目录

- `<workspace>/.localcoding`

工作区级模板等内容会写入这个目录，而不是旧的 `.claude`。

## 常用环境变量

```bash
PORT=10086
DB_PATH=./webui.db
CORS_ORIGIN=*
CLAUDE_RUNNER_MODE=spawn
CLAUDE_CLI_PATH=
CLAUDE_CLI_EXECUTABLE=node
```

## 服务行为摘要

- 默认端口：`10086`（被占用时自动改用一个空闲端口；桌面应用已加单实例锁，前端经 `location.origin` 自动跟随实际端口）
- WebSocket 路径：`/ws`
- 前端断线重连：1s、2s、5s，之后固定 5s
- 服务端 WebSocket 最大消息载荷：256 MiB
- 启动时会同步内置 skills 和内置 templates

## 主要接口

### REST

- `GET /api/health`
- `GET /api/sessions`
- `GET /api/models`
- `GET /api/endpoints` — 返回已配置的供应商列表（不含 API Key）
- `GET /api/channels`
- `GET /api/templates`
- `GET /api/skills`
- `GET /api/scheduled-tasks`
- `POST /api/deploy-agent/submit` — 自动部署：提交本地代码包
- `GET /api/deploy-agent/events/:deployId` — 自动部署：部署进度（SSE）
- `POST /v1/chat/completions` — 模型路由网关（仅内部 CLI 使用）
- `GET /v1/models` — OpenAI 兼容模型列表

### WebSocket

- `ws://<host>/ws`

前端和服务端通过事件协议传输会话、流式消息、权限响应、路由偏好、附件等数据。
