# LocalClaw 插件化 & 容器化架构设计

> 版本：v1.0  
> 日期：2026-05-14  
> 状态：草案（待团队评审）

---

## 一、现状分析

### 1.1 当前架构

```
Electron 壳
├── electron/main.cjs          # 主进程
└── packages/
    ├── client/                # React 前端
    ├── server/                # NestJS 后端（单体）
    │   └── modules/
    │       ├── session        # 会话管理
    │       ├── runner         # Claude CLI 调度
    │       ├── sandbox        # Git Worktree 沙箱
    │       ├── workspace      # 工作区
    │       ├── routing        # 模型路由
    │       ├── subagent       # 多 Agent 调度
    │       ├── channel        # IM 渠道（飞书/钉钉/微信等）
    │       ├── skill          # Skill 管理
    │       ├── skill-market   # Skill 市场
    │       ├── memory         # 记忆管理
    │       ├── template       # 模板
    │       ├── deploy         # 部署
    │       ├── git            # Git 操作
    │       ├── websocket      # WS 通信
    │       └── system         # 系统配置
    └── shared/                # 共享类型
```

### 1.2 现存问题

| 问题 | 描述 |
|------|------|
| **高度耦合** | 所有业务模块混杂在 server 单体中，无法独立演进 |
| **无扩展协议** | 新业务（知识库、UI 设计工具）只能修改主仓库 |
| **渠道不可插拔** | 新增 IM 渠道需修改核心代码 |
| **无容器隔离** | 沙箱依赖 Git Worktree，不适用无 Git 场景，无法隔离进程资源 |
| **前端无插槽** | UI 无法按需加载插件页面和组件 |
| **横向团队协作难** | 其他团队无法独立开发业务功能再集成进来 |

---

## 二、设计目标

1. **插件化**：业务功能以插件形式独立开发、独立发布、按需加载
2. **容器化**：服务端支持 Docker 化部署；插件沙箱支持容器级隔离
3. **框架沉淀**：提炼稳定的核心框架层，不随业务变动
4. **开放扩展**：定义标准 Plugin Protocol，外部团队可以基于 SDK 开发插件
5. **渐进迁移**：现有功能平滑迁移为内置插件，不大破大立

---

## 三、总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                       Electron Shell / Web App                   │
│                   Plugin UI Router & Shell Layout                │
└───────────────────────────┬─────────────────────────────────────┘
                            │ IPC / HTTP / WebSocket
┌───────────────────────────▼─────────────────────────────────────┐
│                      Core Framework Layer                         │
│                                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ Session  │  │  Runner  │  │ Sandbox  │  │    Routing     │  │
│  │ Manager  │  │  Engine  │  │ Manager  │  │    Engine      │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │Workspace │  │   Git    │  │ WebSocket│  │   Event Bus    │  │
│  │ Manager  │  │ Service  │  │ Gateway  │  │  (内部事件总线) │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                  Plugin Manager                          │    │
│  │  Registry | Lifecycle | Permissions | IPC Bridge        │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                            │ Plugin Protocol (gRPC / HTTP / IPC)
┌───────────────────────────▼─────────────────────────────────────┐
│                       Plugin Ecosystem                            │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ 知识库插件    │  │  UI设计插件  │  │   Agent Builder 插件  │  │
│  │ (KnowledgeBase)│ │  (UIDesign) │  │                      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  Channel 插件 │  │  MCP 插件   │  │    自定义 Skill 包    │  │
│  │  (飞书/钉钉) │  │             │  │                      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 四、核心框架层（Core Framework）

### 4.1 模块划分

拆分原则：**核心 = 不依赖任何具体业务** 的基础能力。

```
packages/core/
├── session/         # 会话 CRUD、状态机
├── runner/          # Claude CLI 调度（spawn/query/ollama）
├── sandbox/         # 沙箱管理（worktree + 容器两种模式）
├── routing/         # 模型路由（cloud/local）
├── workspace/       # 工作区管理
├── git/             # Git 操作封装
├── websocket/       # WS 实时通信网关
├── event-bus/       # 内部事件总线（替代直接 inject 依赖）
└── plugin-manager/  # 插件注册、生命周期、权限管理
```

### 4.2 现有模块归属

| 模块 | 归属 | 说明 |
|------|------|------|
| session | Core | 基础能力 |
| runner | Core | 基础能力 |
| sandbox | Core | 基础能力（新增容器模式） |
| routing | Core | 基础能力 |
| workspace | Core | 基础能力 |
| git | Core | 基础能力 |
| websocket | Core | 基础能力 |
| **skill** | **内置插件** | 迁移为官方插件 |
| **skill-market** | **内置插件** | 迁移为官方插件 |
| **channel** | **内置插件** | 迁移为官方插件（各渠道可单独插件化）|
| **memory** | **内置插件** | 迁移为官方插件 |
| **template** | **内置插件** | 迁移为官方插件 |
| **subagent** | **内置插件** | 迁移为官方插件 |
| **deploy** | **内置插件** | 迁移为官方插件 |
| **system** | Core（配置）| 保留在核心 |

---

## 五、插件协议（Plugin Protocol）

### 5.1 插件 Manifest（plugin.json）

```jsonc
{
  "id": "com.example.knowledge-base",
  "name": "知识库",
  "version": "1.0.0",
  "type": "feature",           // feature | channel | mcp | model | tool
  "minCoreVersion": "1.0.0",
  "permissions": [
    "session:read",
    "session:write",
    "storage:scoped",
    "ui:register-page",
    "ui:register-sidebar-item",
    "skill:register"
  ],
  "contributes": {
    "pages": [{ "path": "/knowledge", "title": "知识库" }],
    "sidebarItems": [{ "icon": "BookOpen", "label": "知识库", "route": "/knowledge" }],
    "skills": ["skills/kb-search.md", "skills/kb-ingest.md"],
    "mcpServers": [{ "name": "kb-mcp", "command": "node", "args": ["mcp-server.js"] }],
    "apiRoutes": "/api/knowledge",
    "events": {
      "subscribe": ["session.message", "session.completed"],
      "publish": ["knowledge.updated"]
    }
  },
  "sandbox": {
    "isolated": false           // true = 在独立进程/容器运行
  },
  "main": "dist/plugin.js",    // 后端入口（NestJS 动态模块）
  "uiEntry": "dist/ui.js"      // 前端入口（Remote Component）
}
```

### 5.2 插件 SDK（Plugin SDK API）

```typescript
// packages/plugin-sdk/index.ts

export interface PluginSDK {
  /** 监听 Agent 会话消息 */
  onSessionMessage(handler: (msg: SessionMessage) => void): () => void;

  /** 向会话注入上下文 */
  injectSessionContext(sessionId: string, context: string): Promise<void>;

  /** 注册 UI 页面（前端 Remote Component URL）*/
  registerPage(route: string, remoteUrl: string): void;

  /** 注册侧边栏入口 */
  registerSidebarItem(item: SidebarItem): void;

  /** 注册 Skill 定义 */
  registerSkill(skill: SkillDefinition): Promise<void>;

  /** 注册 MCP Server */
  registerMCPServer(config: MCPServerConfig): Promise<void>;

  /** 注册 API 路由（Express Router） */
  registerRouter(prefix: string, router: Router): void;

  /** 发布内部事件 */
  emit(eventType: string, payload: unknown): void;

  /** 订阅内部事件 */
  on<T>(eventType: string, handler: (payload: T) => void): () => void;

  /** 插件隔离存储 */
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
  };

  /** 日志（带插件 ID 前缀）*/
  logger: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
}
```

### 5.3 插件运行模式

| 模式 | 适用场景 | 隔离级别 | 性能 |
|------|----------|----------|------|
| **In-Process** | 受信任内置插件 | 模块级 | 最高 |
| **Child-Process** | 第三方插件 | 进程级 | 中等 |
| **Container** | 高风险/资源密集插件 | 容器级 | 较低 |

切换方式由 `plugin.json` 中的 `sandbox.isolated` 和管理员配置共同决定。

---

## 六、容器化方案

### 6.1 运行时容器化

```
docker-compose.yml
├── core-server        # NestJS Core + Plugin Manager
│   └── image: localclaw/core:latest
├── sandbox-runner     # 可选：隔离代码执行环境
│   └── image: localclaw/sandbox:latest
└── plugin-XXX         # 可选：高隔离插件
    └── image: com.example/plugin-xxx:latest
```

### 6.2 沙箱容器化（增强现有 Sandbox）

现有：Git Worktree（只适合 Git 项目）

新增 Docker 沙箱模式：

```
SandboxMode = "worktree" | "docker"

DockerSandbox:
- 基于 alpine + 语言运行时镜像
- 挂载工作目录（只读 + 临时写层）
- 网络隔离（可配置白名单域名）
- 资源限制（CPU/内存）
- 文件 diff 通过卷挂载传回主进程
```

### 6.3 Docker 镜像分层

```
localclaw/base          # Node.js + 基础工具
└── localclaw/core      # NestJS Core Framework
    ├── localclaw/full  # Core + 所有内置插件（桌面版）
    └── localclaw/server-only  # 无 Electron（纯服务器部署）
```

---

## 七、前端插槽系统（UI Slot System）

### 7.1 插槽定义

```typescript
type UISlot =
  | "sidebar.top"          // 侧边栏顶部图标
  | "sidebar.bottom"       // 侧边栏底部图标
  | "session.toolbar"      // 会话工具栏扩展按钮
  | "session.context-menu" // 右键菜单
  | "right-panel.tab"      // 右侧面板 Tab
  | "settings.section"     // 设置页分区
  | "page.*"               // 独立页面路由
```

### 7.2 前端实现方案：Module Federation

- **核心应用**（Shell）：Webpack Module Federation Host，负责插槽注册和路由
- **插件 UI**：作为 Remote，暴露 `PluginPage`、`SidebarIcon` 等组件
- **懒加载**：用户访问插件页面时才加载 Remote Bundle
- **隔离**：插件 UI 运行在 `<iframe sandbox>` 或 Shadow DOM（可配）

```
Shell App (Host)
├── /knowledge  → remoteEntry.js@知识库插件
├── /ui-design  → remoteEntry.js@UI设计插件
└── /agent      → remoteEntry.js@Agent Builder插件
```

---

## 八、Channel 插件化（渠道插件）

当前飞书/钉钉/微信渠道的 MCP Server 脚本已经在 `mcp-servers/` 下半独立，
接下来只需将它们封装为标准 Channel 插件：

```typescript
// Channel Plugin 实现接口
interface ChannelPlugin {
  type: string;              // "feishu" | "telegram" | ...
  name: string;
  configSchema: JSONSchema;  // 凭证配置 schema（用于 UI 渲染表单）
  connect(config: ChannelConfig): Promise<void>;
  disconnect(): Promise<void>;
  send(chatId: string, message: string): Promise<void>;
  onMessage(handler: MessageHandler): void;
}
```

每个渠道独立发布为一个 Channel Plugin，可按需安装。

---

## 九、目录结构（目标态）

```
localclaw/
├── packages/
│   ├── core/                   # 核心框架（从 server 拆分）
│   │   ├── src/
│   │   │   ├── modules/        # session, runner, sandbox...
│   │   │   ├── plugin-manager/ # 插件注册/生命周期
│   │   │   └── event-bus/      # 内部事件总线
│   │   └── package.json
│   │
│   ├── plugin-sdk/             # 插件开发 SDK（类型 + 工具函数）
│   │   └── src/index.ts
│   │
│   ├── client/                 # React Shell（Module Federation Host）
│   │
│   └── shared/                 # 共享类型（维持现状）
│
├── plugins/                    # 官方内置插件（从 server modules 迁移）
│   ├── skill/                  # Skill 管理插件
│   ├── skill-market/           # Skill 市场插件
│   ├── memory/                 # 记忆插件
│   ├── template/               # 模板插件
│   ├── subagent/               # SubAgent 插件
│   ├── deploy/                 # 部署插件
│   ├── channel-feishu/         # 飞书渠道插件
│   ├── channel-dingtalk/       # 钉钉渠道插件
│   ├── channel-telegram/       # Telegram 渠道插件
│   ├── channel-wechat/         # 微信渠道插件
│   └── channel-discord/        # Discord 渠道插件
│
├── docker/
│   ├── core/Dockerfile
│   ├── sandbox/Dockerfile
│   └── docker-compose.yml
│
└── scripts/                    # 构建脚本（维持现状）
```

---

## 十、插件生命周期

```
install → validate(manifest) → checkPermissions
    → load(main.js)
    → onInstall(sdk)          # 初始化 DB Schema、注册路由
    → onEnable(sdk)           # 连接事件总线、激活 MCP
    → [running]
    → onDisable(sdk)          # 取消事件订阅、暂停 MCP
    → onUninstall(sdk)        # 清理数据（可选保留）
    → unload
```

---

## 十一、迁移策略

### 分三阶段迁移，不停服

**Phase 1（框架提取，约 2 周）**
- 在现有 server 内划定边界：Core 模块 vs 业务模块
- 引入 EventBus，解耦 SubagentService、ChannelService 对 SessionService 的直接 inject
- 新建 `plugin-manager` 模块（初期仅管理内部模块注册）
- 输出 `plugin-sdk` 类型定义

**Phase 2（内置插件化，约 3 周）**
- 逐个将 skill、memory、channel、subagent 等迁移到 `plugins/` 目录
- 通过 Plugin Manager 动态加载，而非 app.module.ts 静态 import
- 前端引入 UI Slot 系统（先支持 sidebar + page 两个插槽）

**Phase 3（容器化 + 外部插件，持续迭代）**
- Docker 化 core-server
- 新增 Docker 沙箱模式
- 发布 Plugin SDK 供外部团队使用
- 知识库、UI 设计等新业务按插件协议独立开发接入

---

## 十二、风险评估

| 风险 | 等级 | 应对 |
|------|------|------|
| Phase 1 EventBus 改造引入 bug | 中 | 充分单测，保持原有接口兼容 |
| Module Federation 打包复杂度高 | 中 | Phase 2 先用简单的 React.lazy + CDN URL 代替 |
| Docker 沙箱在 Windows/Mac 桌面版性能差 | 高 | worktree 模式作为默认，Docker 沙箱作为可选 |
| 插件权限审计缺失导致安全问题 | 高 | Phase 2 必须实现权限声明 + 运行时检查 |
| 外部插件 API 稳定性 | 中 | SDK 遵循 SemVer，核心 API 进入稳定期前标注 @experimental |

---

## 十三、待评审问题清单

1. **插件 IPC 协议**：优先选 HTTP（简单）还是 gRPC（性能好）？
2. **前端 Remote Component**：Module Federation vs 简单的动态 import + iframe？
3. **容器沙箱优先级**：桌面版 Docker 依赖用户本地安装，是否推迟到服务端部署版本？
4. **Channel 插件拆分粒度**：各渠道独立 npm 包，还是统一一个 `channel-adapters` 包？
5. **知识库插件的数据存储**：复用主进程 SQLite，还是插件独立数据文件？
6. **插件市场（Plugin Market）**：是否与现有 Skill Market 合并，还是独立模块？
