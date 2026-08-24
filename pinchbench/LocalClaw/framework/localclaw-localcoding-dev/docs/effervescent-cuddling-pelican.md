# NestJS Monorepo 重构计划

## Context
将 local-claw 从单包结构（Hono + 手动 WebSocket + 手动 HTTP）重构为 NestJS monorepo 架构。后端用 NestJS 框架替代，前端保持不变（React + Tailwind），共享类型抽到独立包。

**目标**：代码结构规范化，功能和界面完全不变，保持 Electron 打包能力。

## 当前架构 → 目标架构

```
当前:                           目标:
src/                            packages/
├── index.tsx (server+静态)      ├── client/        (React 前端，原样迁移)
├── libs/                        ├── server/        (NestJS 后端)
├── components/ (React)          └── shared/        (共享类型)
├── hooks/                      electron/          (保持不变)
├── store/                      scripts/           (更新构建脚本)
└── types.ts                    package.json       (workspace 根)
```

## 目录结构

```
local-claw/
├── package.json                    # workspace 根
├── tsconfig.json                   # 根 tsconfig
├── electron/                       # 保持不变
│   ├── main.cjs
│   ├── cli-path.cjs
│   └── preload.cjs
├── scripts/
│   ├── build-frontend.cjs          # 更新路径
│   ├── build-server.cjs            # 改为打包 NestJS
│   └── copy-cli.cjs                # 保持不变
├── packages/
│   ├── shared/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── types.ts            # ClientEvent, ServerEvent, StreamMessage 等
│   │
│   ├── client/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tailwind.config.ts
│   │   └── src/
│   │       ├── index.html
│   │       ├── index.css
│   │       ├── frontend.tsx
│   │       ├── App.tsx
│   │       ├── components/         # 原样迁移
│   │       ├── hooks/
│   │       ├── store/
│   │       └── render/
│   │
│   └── server/
│       ├── package.json
│       ├── tsconfig.json
│       ├── nest-cli.json
│       └── src/
│           ├── main.ts                         # NestJS bootstrap
│           ├── app.module.ts                   # 根模块
│           │
│           ├── modules/
│           │   ├── session/
│           │   │   ├── session.module.ts
│           │   │   ├── session.controller.ts   # REST: /api/health, /api/sessions/*
│           │   │   ├── session.service.ts      # SessionStore 逻辑
│           │   │   └── dto/
│           │   │       └── create-session.dto.ts
│           │   │
│           │   ├── runner/
│           │   │   ├── runner.module.ts
│           │   │   ├── runner.service.ts       # createRunner 工厂
│           │   │   ├── runner-query.service.ts  # SDK query 模式
│           │   │   └── runner-spawn.service.ts  # CLI spawn 模式
│           │   │
│           │   └── websocket/
│           │       ├── websocket.module.ts
│           │       └── websocket.gateway.ts    # @WebSocketGateway, handleClientEvent
│           │
│           └── config/
│               └── claude-settings.ts          # 配置加载服务
```

## 实施步骤

### 第一阶段：搭建 Monorepo 骨架

#### 1.1 根 package.json
```json
{
  "name": "local-claw",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": { ... }
}
```

#### 1.2 packages/shared
- 从 `src/types.ts` 迁移所有共享类型
- 导出：`ClientEvent`, `ServerEvent`, `StreamMessage`, `SessionStatus`, `SessionInfo`, `ClaudeSettingsEnv`, `UserPromptMessage`

#### 1.3 packages/client
- 整体迁移前端文件：`frontend.tsx`, `App.tsx`, `components/`, `hooks/`, `store/`, `render/`, `index.html`, `index.css`
- 依赖 `@anthropic-ai/claude-agent-sdk`（类型）和 `packages/shared`
- `tailwind.config.ts` 迁移到 client 包内

#### 1.4 packages/server — NestJS 后端
- 依赖：`@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`, `@nestjs/websockets`, `@nestjs/platform-ws`
- 依赖：`better-sqlite3`, `@anthropic-ai/claude-agent-sdk`, `packages/shared`

### 第二阶段：NestJS 后端实现

#### 2.1 main.ts — 启动入口
```typescript
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableCors({ origin: corsOrigins });

  // 静态文件服务 (dist/)
  if (useDist) {
    app.useStaticAssets(distDir);
  }

  await app.listen(PORT, '0.0.0.0');
}
```

#### 2.2 session.controller.ts — REST API（3个路由）
| 路由 | 方法 | 当前实现位置 | 说明 |
|------|------|-------------|------|
| `/api/health` | GET | index.tsx:272 | 返回 "ok" |
| `/api/sessions/recent-cwd` | GET | index.tsx:276 | 查询最近 CWD |
| `/api/sessions/title` | POST | index.tsx:284 | 生成会话标题 |

#### 2.3 session.service.ts — 数据库层
- 从 `src/libs/session-store.ts` 迁移
- 注入为 NestJS @Injectable() 服务
- 保持 SQLite schema 和所有方法不变：
  - `createSession()`, `getSession()`, `listSessions()`, `listRecentCwds()`
  - `getSessionHistory()`, `updateSession()`, `deleteSession()`
  - `recordMessage()`, `setAbortController()`

#### 2.4 websocket.gateway.ts — WebSocket 网关
- 替代 `index.tsx` 中的手动 WebSocket 逻辑
- 装饰器：`@WebSocketGateway({ path: '/ws' })`
- 处理 `handleClientEvent` 的所有 7 种事件：
  - `session.list`, `session.history`, `session.start`, `session.continue`
  - `session.stop`, `session.delete`, `permission.response`
- `broadcast()` 和 `emit()` 功能保持不变

#### 2.5 runner.service.ts — Runner 工厂
- 从 `runner-factory.ts` 迁移
- 注入 `RunnerQueryService` 和 `RunnerSpawnService`
- `getRunnerMode()` 读取环境变量

#### 2.6 runner-query.service.ts
- 从 `runner.ts` 迁移
- `runClaude()` 逻辑完全保留

#### 2.7 runner-spawn.service.ts
- 从 `runner-spawn.ts` 迁移
- `runClaudeSpawn()` 逻辑完全保留

#### 2.8 config/claude-settings.ts
- 从 `src/claude-settings.ts` 迁移
- 保持 `loadClaudeSettingsEnv()` 逻辑

### 第三阶段：更新构建和 Electron

#### 3.1 scripts/build-frontend.cjs
- 入口路径改为 `packages/client/src/frontend.tsx`
- 输出仍为 `dist/`（根目录）
- Tailwind 扫描路径改为 `packages/client/src/`

#### 3.2 scripts/build-server.cjs
- 入口改为 `packages/server/src/main.ts`
- 仍输出 `dist-server/server.cjs`
- external 保留 `better-sqlite3`
- 需要处理 NestJS 装饰器（esbuild 需配置 decorators）

#### 3.3 electron/main.cjs
- 无需修改（仍然 fork dist-server/server.cjs）

### 第四阶段：清理
- 删除旧 `src/` 目录
- 删除旧 `tailwind.config.ts`（已移到 client）
- 更新 `.gitignore`
- 更新根 `package.json` scripts

## 关键文件映射

| 旧文件 | 新位置 | 变化 |
|--------|--------|------|
| `src/types.ts` | `packages/shared/src/types.ts` | 原样 |
| `src/frontend.tsx` | `packages/client/src/frontend.tsx` | 原样 |
| `src/App.tsx` | `packages/client/src/App.tsx` | import 路径更新 |
| `src/components/*` | `packages/client/src/components/*` | 原样 |
| `src/hooks/*` | `packages/client/src/hooks/*` | 原样 |
| `src/store/*` | `packages/client/src/store/*` | 原样 |
| `src/render/*` | `packages/client/src/render/*` | 原样 |
| `src/index.html` | `packages/client/src/index.html` | 原样 |
| `src/index.css` | `packages/client/src/index.css` | 原样 |
| `src/index.tsx` | `packages/server/src/` (拆分) | 拆为 controller + gateway + main |
| `src/libs/session-store.ts` | `packages/server/src/modules/session/session.service.ts` | 包装为 @Injectable |
| `src/libs/runner-factory.ts` | `packages/server/src/modules/runner/runner.service.ts` | 包装为 @Injectable |
| `src/libs/runner.ts` | `packages/server/src/modules/runner/runner-query.service.ts` | 包装为 @Injectable |
| `src/libs/runner-spawn.ts` | `packages/server/src/modules/runner/runner-spawn.service.ts` | 包装为 @Injectable |
| `src/libs/util.ts` | `packages/server/src/modules/session/session.service.ts` | 合入 |
| `src/claude-settings.ts` | `packages/server/src/config/claude-settings.ts` | 原样 |
| `tailwind.config.ts` | `packages/client/tailwind.config.ts` | 原样 |

## API 契约（不变）

### REST
- `GET /api/health` → `"ok"`
- `GET /api/sessions/recent-cwd?limit=N` → `{ cwds: string[] }`
- `POST /api/sessions/title` → `{ title: string }`

### WebSocket `/ws`
- ClientEvent: 7 种事件类型（session.start/continue/stop/delete/list/history, permission.response）
- ServerEvent: 8 种事件类型（stream.message/user_prompt, session.status/list/history/deleted, permission.request, runner.error）

## NestJS 依赖（packages/server）
```
@nestjs/core
@nestjs/common
@nestjs/platform-express
@nestjs/websockets
@nestjs/platform-ws
reflect-metadata
better-sqlite3
@anthropic-ai/claude-agent-sdk
```

## 验证
1. `npm install` — workspace 依赖安装成功
2. `node scripts/build-frontend.cjs` — 前端构建，dist/ 产物正确
3. `node scripts/build-server.cjs` — NestJS 服务端打包成功
4. `node dist-server/server.cjs` — 服务启动，/api/health 返回 ok
5. 浏览器访问 http://127.0.0.1:10086/ — 页面正常，WebSocket 连接
6. 发送消息 — Claude 响应正常，消息流、权限请求正常
7. `npm run electron:dev` — Electron 窗口正常显示
8. Sidebar、StartSessionModal、PromptInput 等 UI 交互不变
