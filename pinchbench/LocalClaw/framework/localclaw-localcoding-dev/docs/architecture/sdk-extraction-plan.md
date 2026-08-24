# SDK 抽取方案

> 目标：将 `packages/server` 的核心能力抽取为可复用 SDK，以**类/接口/函数/类型化参数**对外，
> 通过私仓 `https://registry-smb.lenovo.com` 以 npm 包发布，供三个产品
> （**localcoding / teamai / localclaw** 三个分支）共用。知识库等业务模块**不入 SDK**，留在 server。

## 文档状态

- 创建：2026-06-07
- 阶段：设计已定稿，PR-1（基座层）待实施

## 目录

1. [背景与目标](#1-背景与目标)
2. [模块依赖图](#2-模块依赖图实测)
3. [关键决策](#3-关键决策)
4. [SDK 目录结构](#4-sdk-目录结构)
5. [迁移计划（分批 PR）](#5-迁移计划分批-pr)
6. [破坏性变更同步策略](#6-破坏性变更同步策略)
7. [数据库连接反转 Review 结论](#7-数据库连接反转-review-结论)

---

## 1. 背景与目标

三个产品当前是**同一仓库的三个分支**，共享一份代码但逐渐分叉。SDK 抽取要达成：

- SDK 以**类/接口/函数/类型化参数**对外，不暴露内部实现细节。
- 当前阶段：monorepo 内 `packages/sdk` **源码依赖**，server 通过 TS path alias 引用。
- 目标阶段：SDK 发布到私仓 `registry-smb.lenovo.com`，三个产品各自 `npm install`。
- server 继续保留并开发自己的业务模块（如知识库），业务模块可注入 SDK 提供的能力（如共享数据库连接）。

## 2. 模块依赖图（实测）

通过 grep 实测的模块间 import 关系（单向，无循环）：

```
业务层(留 server)   knowledge   tech-stack
─────────────────────────────────────────────────────────
聚合层              websocket → channel/git/routing/runner/
                              scheduled-task/session/speech/
                              template/workspace
─────────────────────────────────────────────────────────
能力层              channel → database/runner/session
                    scheduled-task → runner/session/workspace
                    routing → session        gateway → routing
                    workspace → git/runner    speech → routing
                    skill-market → skill
─────────────────────────────────────────────────────────
核心层              runner → routing/session/workspace
                    session → database/git
─────────────────────────────────────────────────────────
基座层              database   config   shared(types)
```

关键发现：

- **依赖单向、无循环**，抽取阻力小。
- **`config/` 是隐性基座**：channel/knowledge/routing/scheduled-task/session/tech-stack
  共 6 个模块依赖它（尤其 `localclaw-settings`）。迁移时需去产品化。
- **knowledge 已独立**：不被任何 SDK 模块依赖，留在 server 干净。
- **client 有 35 个文件**依赖 `@local-claw/shared/src/types`，全是纯类型 —— 决定了 shared 必须保持独立包（见决策 3）。

## 3. 关键决策

### 决策 1：websocket 入 SDK，client 协议统一

三个产品 WS 协议相同，`websocket` 模块（含 gateway 编排）入 SDK。协议类型放
`shared`，WS 实现放 SDK，client 读 shared 类型 —— 三端协议一致。

### 决策 2：配置目录与 `~/.claude` 并级，宿主注入

不同产品有**各自独立**的配置目录，与 `~/.claude` **并级**（如 `~/.localcoding`、
`~/.teamai`、`~/.localclaw`），**不是** `~/.claude` 的子目录。

因此 SDK config 层**不写死任何目录名**，由宿主通过环境变量 / 参数注入：

```typescript
// SDK: agent-settings.ts —— 无 homedir()/.claude 硬编码
export function createSettingsStore(configDir: string) { ... }

// 宿主 server：决定自己的目录
const configDir = process.env.AGENT_CONFIG_DIR
  ?? join(homedir(), ".localcoding");   // 各产品填自己的
```

延续 `claude-config-dir-isolation` 的隔离思路，只是参数化。

### 决策 3：shared 保持独立包（硬约束，非偏好）

client 35 个文件依赖 `@local-claw/shared/src/types`，全是纯类型。若 shared 并入 SDK，
client 取类型就得依赖 `@lenovo/agent-sdk` —— 而 SDK 含 `better-sqlite3`/`express`/
`@nestjs/*`/`ssh2` 等 Node 服务端依赖，前端打包（Vite）会被迫处理 node 内置模块，
体积爆炸甚至构建失败。

```
packages/shared/   纯类型，零运行时依赖。client 和 sdk 都依赖它
packages/sdk/      依赖 shared，含 node 运行时
packages/client/   依赖 shared，不碰 sdk
```

SDK `package.json` 的 `dependencies` 加 `@local-claw/shared`，不把类型搬进
`sdk/src/types/`。

## 4. SDK 目录结构

```
packages/sdk/
  package.json              # @lenovo/agent-sdk，依赖 @local-claw/shared
  tsconfig.json
  src/
    index.ts                # 唯一公共出口：导出 Module/Service/类/类型/工厂
    config/                 # ← server/config 迁入，去产品化
      agent-settings.ts     #   (原 localclaw-settings，参数化 configDir)
      claude-settings.ts
      paths.ts
    database/               # ← 已就绪，直接迁入
      database.module.ts
      database.migrations.ts #   只含 SDK_MIGRATIONS + runSdkMigrations
    core/
      session/  runner/  git/
    capability/
      routing/  gateway/  workspace/  skill/  skill-market/
      template/  memory/  speech/  scheduled-task/  channel/  deploy-agent/
    websocket/              # 聚合层（决策 1）
    AgentSdkModule.ts       # 聚合 Module：一次 import 拉起所有 SDK 能力
```

宿主侧 `packages/server` 保留：

```
packages/server/src/
  main.ts
  app.module.ts                # import AgentSdkModule + 业务模块
  database/create-database.ts  # 宿主连接工厂（决定 DB_PATH，不入 SDK）
  modules/
    knowledge/                 # 业务，留下
```

## 5. 迁移计划（分批 PR）

迁移**自底向上**，否则上层 import 会断。用 TS path alias 做软切换：

```jsonc
// server/tsconfig.json
"paths": { "@sdk/*": ["../sdk/src/*"] }   // 将来换成 npm 包名零改动
```

每迁一个模块只改 import 路径，跑三分支编译矩阵验证。

### PR-1：基座层（地基，风险最低）

| 迁入 SDK | 来源 | 备注 |
|---------|------|------|
| `config/` | `server/src/config/*` | 重命名 `localclaw-settings` → `agent-settings`，参数化 configDir |
| `database/database.module.ts` + `database.migrations.ts` | 已优化好 | `create-database.ts` 留 server |

> shared 不动（已是独立包，SDK 加依赖即可）。

### PR-2：核心层

| 迁入 SDK | 依赖 |
|---------|------|
| `core/git` | 无 |
| `core/session` | database、git（已在 SDK） |

> runner 依赖 routing/workspace（PR-3），故 runner 挪到 PR-3。

### PR-3：能力层（其余全部）

routing → workspace → runner → gateway，随后
skill / skill-market / template / memory / speech / scheduled-task /
channel / deploy-agent / websocket。

### 实施进度（截至 2026-06-07）

| 批次 | 内容 | 状态 |
|------|------|------|
| PR-1 | config + database | ✅ |
| PR-2 | core：git + session | ✅ |
| PR-3a | routing + workspace + attachment 工具 | ✅ |
| PR-3b | runner + gateway 工具 | ✅ |
| transport | websocket **内核**进 SDK（依赖反转，见下） | ✅ |
| PR-3d | channel + scheduled-task + deploy-agent（含 mcp-servers 与测试迁移） | ✅ |
| 留 server | skill / skill-market / template / memory / speech / tech-stack / system / knowledge | 业务层，不进 SDK |

**websocket 依赖反转（关键设计）**：websocket 原本依赖 speech/template（留 server），
直接进 SDK 会倒挂。解法是把**通用传输内核**抽进 SDK（`transport/websocket.gateway.ts`），
内核不认识任何宿主业务，宿主通过三个扩展点接入：
- `SessionStartContributor`：参与 session.start 编排（模板）。
- `WsEventHandler`：处理内核不认识的事件（语音）。
- `getEmitter()` + 宿主 `TransportWiring`：把 channel/cron 事件接到内核广播。

接线见 `WebsocketModule.forRoot({ imports, contributors, eventHandlers })`，与
`DatabaseModule.forRoot({ db })` 同源。SDK 对宿主业务零静态引用。

**模式 A 贯穿全程**：所有 HTTP/WS controller 留 server，SDK 只出 Service/Module。
每个迁移模块在 server 侧留 shim（re-export SDK）或薄壳真实模块（挂 controller +
import SDK module），存量调用方零改动。

**mcp-servers 处理（PR-3d）**：channel/scheduled-task 的 `.mjs` MCP 脚本随模块迁入
SDK（`capability/*/mcp-servers/`），build 脚本改为从 SDK 复制到 `dist-server/mcp-servers/`；
knowledge 的 MCP 脚本留 server。路径解析去掉指向 server 的硬编码 dev 路径。

## 6. 破坏性变更同步策略

核心思路：**让破坏性变更在编译期暴露**，而非运行时炸。

### A. 当前（分支 + 源码依赖）阶段

1. **TS 类型是第一道防线（免费）**：SDK 用类/接口/类型化参数对外，签名变更
   消费方一编译就报错，`tsc --noEmit` 精确指出每处。
2. **三分支 CI 编译矩阵**：SDK 改动提 MR 时，CI 自动 checkout 三个产品分支各自
   `tsc --noEmit` + 测试，任一分支挂则拦截合并。
3. **`@deprecated` 废弃期**：改签名时保留旧 API 并标注 `@deprecated`，给迁移窗口，
   切完再删。IDE 自动划删除线提醒。

### B. 未来（npm 私仓）阶段

1. **严格 SemVer**：破坏性变更 → major，`^1.x` 不会被动跳 2.x，产品主动选时机升级。
2. **changesets**：`@changesets/cli` 提交时声明 patch/minor/major + 人话说明，
   自动生成版本号和 CHANGELOG，产品升级时读结构化迁移说明。
3. **codemod（按需）**：大范围机械改写时随 SDK 发 `jscodeshift` 脚本自动改写调用点。

### 组合建议

| 手段 | 阶段 | 自动化 | 投入 |
|------|------|--------|------|
| TS 类型签名暴露 | 现在 | 全自动 | 0 |
| 三分支 CI 编译矩阵 | 分支阶段 | 全自动 | 中 |
| `@deprecated` 废弃期 | 两阶段 | 半自动 | 低 |
| SemVer + changesets | npm 阶段 | 半自动 | 低 |
| codemod | 大破坏时 | 全自动 | 高（按需） |

**TS 类型 + 三分支 CI 矩阵**覆盖约 80% 破坏性变更的自动发现。真正需人工的只剩
「签名没变但语义变了」的少数情况，靠测试和 changelog 提醒。

## 7. 数据库连接反转 Review 结论

commit `2a5dc6b9` 完成了 SDK 抽取的第一块地基 —— **连接反转**，已验收。

**设计**：宿主负责「创建连接 + 决定路径」（`create-database.ts`），SDK 只「用连接 +
建自己的表」（`DatabaseModule.forRoot({ db })` + `runSdkMigrations`）。抽 SDK 时
DatabaseModule + 迁移整体迁出，宿主零改动。

**做对的点**：
- SDK 表 / 业务表用独立版本表（`_sdk_migrations` / `_biz_migrations`）隔离演进。
- 用版本化迁移 + `addColumnIfMissing` 替换 `try{ALTER}catch{}` 反模式，真实错误会抛出。
- 每条迁移 + 版本写入在单事务内，保证原子性。
- 时序正确：`forRoot` 同步建表早于消费 Service 构造；`runBizMigrations` 在其后。
- 消费方（session/channel/chat-session）`new Database` 全部删除，统一 `@Inject(DATABASE)`。

**本次顺手优化**（commit 待提交）：
- P2：`pragma journal_mode = WAL` 从迁移移到 `create-database.ts`（连接级属性归宿主，
  即便产品跳过 SDK 迁移也生效）。
- P4：`channels.error_message` 补进 v1 建表，全新库一步到位；v3 的 `addColumnIfMissing`
  保留作老库兜底。

**保留项**：`migrateChannels`（数据回填，非建表）留在 channel 模块，与 schema 迁移正交。
