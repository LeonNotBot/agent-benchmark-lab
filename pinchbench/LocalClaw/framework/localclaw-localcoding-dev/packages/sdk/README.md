# @lenovo/agent-sdk

> 面向 AI Coding Agent 的 TypeScript SDK ｜ 当前版本 `0.1.0`

通过编排底层 Claude CLI 进程,为上层产品提供会话管理、智能模型路由、工作区隔离、定时任务、MCP 集成与 WebSocket 传输等核心能力。框架无关:既可在任意 Node.js 环境用函数式门面 `createAgent()` 快速接入,也可在 NestJS 宿主中用 `AgentModule` 一站式装配。供 `localcoding` / `teamai` / `localclaw` 等多个产品线共用。

## 安装

```bash
# 主包
npm install @lenovo/agent-sdk

# 必装 peerDependency（原生模块，Electron 环境需 electron-rebuild）
npm install better-sqlite3

# 仅 NestJS 宿主集成方式需要
npm install @nestjs/common @nestjs/core reflect-metadata
```

> 私有仓库:本包发布于 `https://registry-smb.lenovo.com`。安装前请在 `.npmrc` 中将 `@lenovo` scope 指向该 registry。

## 鉴权

经底层 CLI 与上游模型通信,鉴权通过环境变量注入:

```bash
export ANTHROPIC_BASE_URL="https://your-gateway.example.com"  # 必填
export ANTHROPIC_AUTH_TOKEN="sk-xxxxxxxx"                      # 必填
export ANTHROPIC_MODEL="claude-sonnet-4-6"                     # 可选，缺省由路由决策
```

> SDK spawn CLI 时使用独立的 `CLAUDE_CONFIG_DIR`,不读取全局 `~/.claude`,确保流量统一经宿主网关。

## 快速上手

两种接入入口,按场景选其一。

### A. `createAgent()` — 框架无关(推荐快速试用)

```typescript
import { createAgent } from "@lenovo/agent-sdk";

const agent = await createAgent({ dbPath: "./localclaw.db" });
for await (const message of agent.run({ prompt: "用 TypeScript 写一个快速排序" })) {
  console.log(message); // 标准 SDKMessage 异步流
}
await agent.dispose();
```

### B. `AgentModule` — NestJS 宿主一站式装配

```typescript
import { AgentModule } from "@lenovo/agent-sdk";

@Module({
  imports: [
    AgentModule.forRoot({ db }), // 一行拿到 Session/Runner/Routing/... 全局可注入
    MyFeatureModule,             // 宿主自己的业务/Controller
  ],
})
export class AppModule {}
```

## 核心能力

| 能力 | 关键导出 | 说明 |
| --- | --- | --- |
| 门面入口 | `createAgent` | 框架无关的极简对话入口,返回标准异步消息流 |
| 聚合模块 | `AgentModule` | NestJS 宿主一站式装配全部能力 |
| 会话管理 | `SessionService` | 创建、续接、历史、用量统计、持久化 |
| 进程编排 | `RunnerService` | Claude CLI 进程的复用、超时、孤儿清理 |
| 智能路由 | `RoutingService` | 按 prompt 复杂度与设备能力在本地/云端间路由 |
| 工作区 | `WorkspaceService` | 会话产物目录、附件落地、文件扫描 |
| 定时任务 | `ScheduledTaskService` | Cron 任务的增删改查与执行历史 |
| 传输内核 | `WebsocketModule` | WebSocket 连接管理、事件广播、宿主扩展点 |
| 路径解析 | `configurePaths` | 多产品配置目录隔离 |
| 日志 | `setSdkLogger` | 可注入、可分级的内部日志 |

接入 IM 渠道(飞书 / 企业微信 / 钉钉 / Slack)请安装子包 [`@lenovo/agent-sdk-channel`](../channel)。

## 稳定性分层

公共出口 `index.ts` 按稳定性分两层,请只依赖 `@public`:

- **`@public`** — 语义稳定,遵循 SemVer。第三方集成只应依赖这一段。
- **`@internal`** — 实现管线(进程 spawn / 路由打分 / env 构造等),**不计入 SemVer**,随时可能改名、收窄或移除。

## 文档

完整文档见仓库 [`docs/sdk/`](../../docs/sdk/README.md):

- [1. 文档总览](../../docs/sdk/01-overview.md) — 简介、能力、适用场景
- [2. 快速上手](../../docs/sdk/02-getting-started.md) — 环境依赖、安装、鉴权、首个示例
- [3. 核心能力详解](../../docs/sdk/03-core-capabilities.md) — 11 个模块逐条成章
- [4. 代码示例专区](../../docs/sdk/04-examples.md) — 多轮续接、路由、权限、定时任务、NestJS 集成
- [5. 功能配置说明](../../docs/sdk/05-configuration.md) — 配置路径、自定义指令/插件/内存/日志
- [7. 补充指引](../../docs/sdk/07-guides.md) — FAQ

## 运行时要求

Node.js ≥ 18(ESM)。宿主须提供 `better-sqlite3` 连接。`@nestjs/*` / `reflect-metadata` / `ws` / `rxjs` 均为 peerDependency,由宿主提供以避免双实例。

## 许可

私有包,仅限 Lenovo 内部产品线使用。
