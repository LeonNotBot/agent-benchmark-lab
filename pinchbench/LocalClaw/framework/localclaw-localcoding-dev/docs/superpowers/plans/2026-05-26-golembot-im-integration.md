# GolemBot IM Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 GolemBot SDK 替换 Local Claw 现有 4 个自研 IM channel MCP server（飞书/钉钉/Telegram/Discord），保留 wechat 自研路径；用户在 ChannelManager 配置 IM → 手机 IM 发指令 → 桌面 Local Claw ClaudeRunner 执行。

**Architecture:** In-process 嵌入 GolemBot SDK。NestJS 进程内 import 各 `*Adapter` 类 + `handleMessage()` 函数；实现 `LocalClawAssistant`（GolemBot `Assistant` 接口子集）桥接到 Local Claw `RunnerService.createRunner()`；每个 IM `chat_id` 绑定一个常驻 Local Claw Session（kind="channel"）+ 工作目录。WeChat 走 legacy（保留 `wechat-channel-server.mjs` 与 `ChannelDaemonService`）。

**Tech Stack:** golembot ^0.47.1 (深度路径导入 `golembot/dist/channels/*.js` 与 `golembot/dist/gateway.js`), NestJS, better-sqlite3, React 18, Zustand, TypeScript.

**Spec:** [docs/superpowers/specs/2026-05-26-golembot-im-integration-design.md](../specs/2026-05-26-golembot-im-integration-design.md)

---

## File Map

**新增（Server）：**
- `packages/server/src/modules/channel/golem-channel-manager.ts` — Adapter 生命周期管理 + onMessage 路由
- `packages/server/src/modules/channel/local-claw-assistant.ts` — GolemBot Assistant 接口桥接 RunnerService
- `packages/server/src/modules/channel/chat-session.service.ts` — chat_id ↔ workspaceDir ↔ Local Claw Session 映射
- `packages/server/src/modules/channel/golem-config.ts` — 构造 `handleMessage()` 需要的 GolemConfig 默认值
- `packages/server/src/modules/channel/migration.ts` — 一次性迁移：channels.engine 字段补齐

**修改（Server）：**
- `packages/shared/src/channel-types.ts` — 扩 `ChannelEngine`、`workspaceDir` 字段
- `packages/server/src/modules/channel/channel.service.ts` — engine 分支：legacy 走 daemon，golembot 走 GolemChannelManager
- `packages/server/src/modules/channel/channel-rest.controller.ts` — 加 `POST /api/channels/migrate` 端点
- `packages/server/src/modules/channel/channel.module.ts` — 注册新 service
- `packages/server/package.json` — 加 `golembot` 依赖

**修改（Client）：**
- `packages/client/src/components/ChannelManager.tsx` — 加 engine badge 显示
- `packages/client/src/components/ChannelEditor.tsx`（或对应表单） — 加 `workspaceDir` 字段
- `packages/client/src/api.ts` — 加 `apiMigrateChannels()`

**删除（最后一步，确认无回归后）：**
- `packages/server/src/modules/channel/mcp-servers/discord-channel-server.mjs`
- 对应 `dist-server/mcp-servers/*` 同名文件

**保留：**
- `packages/server/src/modules/channel/mcp-servers/wechat-channel-server.mjs`
- `packages/server/src/modules/channel/channel-daemon.service.ts`（仅 wechat 在用）

---

## Task 1: 安装 golembot 依赖

**Files:**
- Modify: `packages/server/package.json`

- [ ] **Step 1: 加 dependency**

`packages/server/package.json` 的 `dependencies` 字段下加一行：

```json
"golembot": "^0.47.1",
```

注意：GolemBot 的 IM SDK 是 `optionalPeerDependencies`，需要单独声明。把以下也加入 `dependencies`：

```json
"@larksuiteoapi/node-sdk": "^1.24.0",
"grammy": "^1.41.0",
"@slack/bolt": "^4.6.0",
"dingtalk-stream": "^2.0.0"
```

（Discord 用 grammy 的同等替代或 GolemBot 自带，先按需加；如果 install 后报缺包，回头补。）

- [ ] **Step 2: 安装**

```bash
cd d:/wwwroot/localclaw && pnpm install
```

Expected: golembot 与 peer deps 安装成功，无 ERESOLVE 错误。

- [ ] **Step 3: 验证导入路径可用**

新建临时文件 `packages/server/src/__verify-golembot.ts`：

```typescript
import { handleMessage } from "golembot/dist/gateway.js";
import { FeishuAdapter } from "golembot/dist/channels/feishu.js";
import { TelegramAdapter } from "golembot/dist/channels/telegram.js";
import type { ChannelAdapter, ChannelMessage } from "golembot";
console.log(typeof handleMessage, typeof FeishuAdapter, typeof TelegramAdapter);
```

运行：`cd packages/server && npx tsx src/__verify-golembot.ts`

Expected: 输出 `function function function`。验证完删除该文件。

- [ ] **Step 4: 提交**

```bash
git add packages/server/package.json pnpm-lock.yaml
git commit -m "feat(channel): add golembot dependency"
```

---

## Task 2: 扩展 ChannelConfig 类型与数据库 schema

**Files:**
- Modify: `packages/shared/src/channel-types.ts`
- Modify: `packages/server/src/modules/channel/channel.service.ts:33-46` (initialize)

- [ ] **Step 1: 写测试**

新建 `packages/server/src/modules/channel/__tests__/channel-types.spec.ts`：

```typescript
import { describe, it, expect } from "vitest";
import type { ChannelConfig, ChannelEngine } from "@local-claw/shared/src/types";

describe("ChannelConfig 扩展字段", () => {
  it("engine 字段应支持 golembot/legacy", () => {
    const a: ChannelEngine = "golembot";
    const b: ChannelEngine = "legacy";
    expect([a, b]).toEqual(["golembot", "legacy"]);
  });

  it("ChannelConfig 应允许 engine 与 workspaceDir", () => {
    const cfg: ChannelConfig = {
      id: "x", type: "feishu", name: "n", enabled: true,
      credentials: {}, status: "disconnected",
      createdAt: 0, updatedAt: 0,
      engine: "golembot", workspaceDir: "/work",
    };
    expect(cfg.engine).toBe("golembot");
    expect(cfg.workspaceDir).toBe("/work");
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd packages/server && pnpm vitest run src/modules/channel/__tests__/channel-types.spec.ts
```

Expected: FAIL，类型 `ChannelEngine` 不存在。

- [ ] **Step 3: 修改 channel-types.ts**

替换 `packages/shared/src/channel-types.ts` 全文：

```typescript
export type ChannelType = "feishu" | "telegram" | "discord" | "wechat" | "dingtalk";

export type ChannelStatus = "disconnected" | "connecting" | "connected" | "error";

export type ChannelEngine = "golembot" | "legacy";

export type ChannelConfig = {
  id: string;
  type: ChannelType;
  name: string;
  enabled: boolean;
  credentials: Record<string, string>;
  status: ChannelStatus;
  createdAt: number;
  updatedAt: number;
  errorMessage?: string;
  engine?: ChannelEngine;
  workspaceDir?: string;
};

export type ChannelField = {
  key: string;
  label: string;
  placeholder: string;
  secret: boolean;
  required: boolean;
};
```

`packages/shared/src/types.ts` 把 `ChannelEngine` 加入 re-export：

```typescript
export type {
  ChannelConfig,
  ChannelType,
  ChannelStatus,
  ChannelField,
  ChannelEngine,
} from "./channel-types";
```

- [ ] **Step 4: 修改数据库 initialize**

替换 `packages/server/src/modules/channel/channel.service.ts:33-46` 的 `initialize()`：

```typescript
private initialize(): void {
  this.db.exec(
    `CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      credentials TEXT NOT NULL,
      status TEXT DEFAULT 'disconnected',
      engine TEXT DEFAULT 'golembot',
      workspace_dir TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`
  );
  // 兼容已存在表：补列
  try { this.db.exec(`ALTER TABLE channels ADD COLUMN engine TEXT DEFAULT 'golembot'`); } catch { /* ignore */ }
  try { this.db.exec(`ALTER TABLE channels ADD COLUMN workspace_dir TEXT DEFAULT ''`); } catch { /* ignore */ }

  this.db.exec(
    `CREATE TABLE IF NOT EXISTS chat_sessions (
      chat_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      workspace_dir TEXT NOT NULL,
      session_key TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (chat_id, channel_id)
    )`
  );
}
```

- [ ] **Step 5: 修改 rowToConfig 与 saveChannel**

`packages/server/src/modules/channel/channel.service.ts` 中 `rowToConfig` 加映射：

```typescript
private rowToConfig(row: any): ChannelConfig {
  return {
    id: row.id, type: row.type, name: row.name,
    enabled: row.enabled === 1,
    credentials: JSON.parse(row.credentials || "{}"),
    status: "disconnected",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    engine: (row.engine as "golembot" | "legacy") || "golembot",
    workspaceDir: row.workspace_dir || "",
  };
}
```

`saveChannel` 中构造 `config` 时加：

```typescript
engine: data.engine ?? (data.type === "wechat" ? "legacy" : "golembot"),
workspaceDir: data.workspaceDir ?? "",
```

INSERT 与 UPDATE 都增加 `engine` 与 `workspace_dir` 列。完整 INSERT：

```typescript
this.db.prepare(
  `INSERT INTO channels (id, type, name, enabled, credentials, status, engine, workspace_dir, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
).run(
  config.id, config.type, config.name,
  config.enabled ? 1 : 0,
  JSON.stringify(config.credentials),
  config.status, config.engine, config.workspaceDir,
  config.createdAt, config.updatedAt,
);
```

UPDATE 类似，加 `engine=?, workspace_dir=?` 字段。

- [ ] **Step 6: 测试通过**

```bash
cd packages/server && pnpm vitest run src/modules/channel/__tests__/channel-types.spec.ts
pnpm tsc --noEmit
```

Expected: PASS + 类型检查通过。

- [ ] **Step 7: 提交**

```bash
git add packages/shared/src/channel-types.ts packages/shared/src/types.ts \
        packages/server/src/modules/channel/channel.service.ts \
        packages/server/src/modules/channel/__tests__/channel-types.spec.ts
git commit -m "feat(channel): add engine and workspaceDir fields"
```

---

## Task 3: ChatSessionService — chat_id ↔ workspace ↔ Local Claw Session 映射

**Files:**
- Create: `packages/server/src/modules/channel/chat-session.service.ts`
- Test: `packages/server/src/modules/channel/__tests__/chat-session.service.spec.ts`

- [ ] **Step 1: 写测试**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { ChatSessionService } from "../chat-session.service";

describe("ChatSessionService", () => {
  let db: Database.Database;
  let svc: ChatSessionService;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE chat_sessions (
      chat_id TEXT NOT NULL, channel_id TEXT NOT NULL,
      workspace_dir TEXT NOT NULL, session_key TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (chat_id, channel_id)
    )`);
    svc = new ChatSessionService(db);
  });

  it("首次 resolve 返回 null（未绑定）", () => {
    expect(svc.resolve("chat1", "ch1")).toBeNull();
  });

  it("bind 后 resolve 返回正确数据", () => {
    svc.bind("chat1", "ch1", "/work");
    expect(svc.resolve("chat1", "ch1")).toMatchObject({
      chatId: "chat1", channelId: "ch1", workspaceDir: "/work", sessionKey: null,
    });
  });

  it("setSessionKey 持久化", () => {
    svc.bind("chat1", "ch1", "/work");
    svc.setSessionKey("chat1", "ch1", "sess-123");
    expect(svc.resolve("chat1", "ch1")?.sessionKey).toBe("sess-123");
  });

  it("不同 channel 同一 chat_id 互不干扰", () => {
    svc.bind("c", "ch1", "/a");
    svc.bind("c", "ch2", "/b");
    expect(svc.resolve("c", "ch1")?.workspaceDir).toBe("/a");
    expect(svc.resolve("c", "ch2")?.workspaceDir).toBe("/b");
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd packages/server && pnpm vitest run src/modules/channel/__tests__/chat-session.service.spec.ts
```

Expected: FAIL with "Cannot find module"。

- [ ] **Step 3: 实现 ChatSessionService（部分 1：基础结构）**

新建 `packages/server/src/modules/channel/chat-session.service.ts`：

```typescript
import { Injectable } from "@nestjs/common";
import type Database from "better-sqlite3";

export type ChatSession = {
  chatId: string;
  channelId: string;
  workspaceDir: string;
  sessionKey: string | null;
};

@Injectable()
export class ChatSessionService {
  constructor(private readonly db: Database.Database) {}

  resolve(chatId: string, channelId: string): ChatSession | null {
    const row = this.db.prepare(
      "SELECT chat_id, channel_id, workspace_dir, session_key FROM chat_sessions WHERE chat_id = ? AND channel_id = ?"
    ).get(chatId, channelId) as any;
    if (!row) return null;
    return {
      chatId: row.chat_id, channelId: row.channel_id,
      workspaceDir: row.workspace_dir, sessionKey: row.session_key,
    };
  }

  bind(chatId: string, channelId: string, workspaceDir: string): void {
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO chat_sessions (chat_id, channel_id, workspace_dir, session_key, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)
       ON CONFLICT(chat_id, channel_id) DO UPDATE SET workspace_dir=excluded.workspace_dir, updated_at=excluded.updated_at`
    ).run(chatId, channelId, workspaceDir, now, now);
  }

  setSessionKey(chatId: string, channelId: string, sessionKey: string): void {
    this.db.prepare(
      `UPDATE chat_sessions SET session_key=?, updated_at=? WHERE chat_id=? AND channel_id=?`
    ).run(sessionKey, Date.now(), chatId, channelId);
  }
}
```

- [ ] **Step 4: 测试通过**

```bash
cd packages/server && pnpm vitest run src/modules/channel/__tests__/chat-session.service.spec.ts
```

Expected: 4 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/modules/channel/chat-session.service.ts \
        packages/server/src/modules/channel/__tests__/chat-session.service.spec.ts
git commit -m "feat(channel): add ChatSessionService for chat_id<->workspace mapping"
```

---

## Task 4: GolemConfig 默认值构造器

GolemBot `handleMessage()` 接收一个 `GolemConfig`（含 group/streaming/maxTurns 等策略）。Local Claw 不写 `golem.yaml`，因此用代码构造默认值。

**Files:**
- Create: `packages/server/src/modules/channel/golem-config.ts`
- Test: `packages/server/src/modules/channel/__tests__/golem-config.spec.ts`

- [ ] **Step 1: 写测试**

```typescript
import { describe, it, expect } from "vitest";
import { buildDefaultGolemConfig } from "../golem-config";

describe("buildDefaultGolemConfig", () => {
  it("返回的 config 有 name/engine 必填字段", () => {
    const cfg = buildDefaultGolemConfig({ botName: "local-claw" });
    expect(cfg.name).toBe("local-claw");
    expect(cfg.engine).toBe("claude-code");
  });

  it("有合理的 group/streaming 默认", () => {
    const cfg = buildDefaultGolemConfig({ botName: "x" });
    expect(cfg.groupChat?.enabled).toBe(true);
    expect(cfg.streaming).toBeDefined();
  });

  it("可覆盖 botName 用于 @mention 检测", () => {
    const cfg = buildDefaultGolemConfig({ botName: "my-bot" });
    expect(cfg.name).toBe("my-bot");
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd packages/server && pnpm vitest run src/modules/channel/__tests__/golem-config.spec.ts
```

Expected: FAIL with "Cannot find module"。

- [ ] **Step 3: 实现**

新建 `packages/server/src/modules/channel/golem-config.ts`：

```typescript
import type { GolemConfig } from "golembot";

export function buildDefaultGolemConfig(opts: { botName: string }): GolemConfig {
  return {
    name: opts.botName,
    engine: "claude-code",
    channels: {} as any,
    groupChat: {
      enabled: true,
      maxTurns: 30,
      historyLimit: 20,
      onlyOnMention: true,
    },
    streaming: {
      enabled: false,
      flushIntervalMs: 1000,
      minLength: 50,
    },
  } as unknown as GolemConfig;
}
```

注意：`channels` 字段我们不通过 GolemConfig 配置（adapter 由 GolemChannelManager 单独 new），但 `handleMessage` 可能读取，留空对象兜底。`as unknown as GolemConfig` 是因 GolemConfig 内部字段较多，我们只填关键的几个。

- [ ] **Step 4: 测试通过**

```bash
cd packages/server && pnpm vitest run src/modules/channel/__tests__/golem-config.spec.ts
```

Expected: 3 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/modules/channel/golem-config.ts \
        packages/server/src/modules/channel/__tests__/golem-config.spec.ts
git commit -m "feat(channel): add GolemConfig default builder"
```

---

## Task 5: LocalClawAssistant — GolemBot Assistant 接口实现

桥接 GolemBot `Assistant.chat()` 到 Local Claw `RunnerService.createRunner()`。

**Files:**
- Create: `packages/server/src/modules/channel/local-claw-assistant.ts`
- Test: `packages/server/src/modules/channel/__tests__/local-claw-assistant.spec.ts`

- [ ] **Step 1: 写测试（mock RunnerService）**

```typescript
import { describe, it, expect, vi } from "vitest";
import { LocalClawAssistant } from "../local-claw-assistant";

describe("LocalClawAssistant", () => {
  function makeMocks() {
    const runnerService = {
      createRunner: vi.fn(async (opts: any) => {
        opts.onEvent({ type: "stream.message", payload: { text: "hello" } });
        opts.onEvent({ type: "stream.completed", payload: { result: "done" } });
        return { handle: { abort: vi.fn() }, envOverrides: {} };
      }),
    };
    const sessionService = {
      createSession: vi.fn(() => ({
        id: "sess-1", title: "ch", status: "idle", kind: "channel",
        pendingPermissions: new Map(),
      })),
      getSession: vi.fn(() => null),
    };
    const chatSessionService = {
      resolve: vi.fn(() => ({ chatId: "c", channelId: "ch", workspaceDir: "/w", sessionKey: null })),
      setSessionKey: vi.fn(),
    };
    return { runnerService, sessionService, chatSessionService };
  }

  it("chat() 应该 yield stream events 并最终 complete", async () => {
    const m = makeMocks();
    const a = new LocalClawAssistant(m.runnerService as any, m.sessionService as any, m.chatSessionService as any);
    const events: any[] = [];
    for await (const e of a.chat("hi", { sessionKey: "c::ch" })) events.push(e);
    expect(events.length).toBeGreaterThan(0);
    expect(m.runnerService.createRunner).toHaveBeenCalledOnce();
  });

  it("缺少绑定时抛出 NotBoundError", async () => {
    const m = makeMocks();
    m.chatSessionService.resolve = vi.fn(() => null);
    const a = new LocalClawAssistant(m.runnerService as any, m.sessionService as any, m.chatSessionService as any);
    const iter = a.chat("hi", { sessionKey: "c::ch" })[Symbol.asyncIterator]();
    await expect(iter.next()).rejects.toThrow(/not bound/i);
  });

  it("cancel() 调用 RunnerHandle.abort", async () => {
    const m = makeMocks();
    const a = new LocalClawAssistant(m.runnerService as any, m.sessionService as any, m.chatSessionService as any);
    const iter = a.chat("hi", { sessionKey: "c::ch" });
    for await (const _e of iter) break;
    const ok = await a.cancel("c::ch");
    expect(ok).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd packages/server && pnpm vitest run src/modules/channel/__tests__/local-claw-assistant.spec.ts
```

Expected: FAIL with "Cannot find module"。

- [ ] **Step 3: 实现 LocalClawAssistant — 部分 1（构造器与 chat 框架）**

新建 `packages/server/src/modules/channel/local-claw-assistant.ts`：

```typescript
import { Injectable } from "@nestjs/common";
import type { Assistant, ChatOpts, StreamEvent } from "golembot";
import { RunnerService } from "../runner/runner.service";
import { SessionService } from "../session/session.service";
import { ChatSessionService } from "./chat-session.service";

const activeHandles = new Map<string, { abort: () => void }>();

@Injectable()
export class LocalClawAssistant implements Pick<Assistant, "chat" | "cancel" | "resetSession"> {
  constructor(
    private readonly runner: RunnerService,
    private readonly sessions: SessionService,
    private readonly chatSessions: ChatSessionService,
  ) {}

  async *chat(message: string, opts?: ChatOpts): AsyncIterable<StreamEvent> {
    const sessionKey = opts?.sessionKey ?? "default::default";
    const [chatId, channelId] = sessionKey.split("::");
    const binding = this.chatSessions.resolve(chatId, channelId);
    if (!binding || !binding.workspaceDir) {
      throw new Error(`Chat ${sessionKey} is not bound to a workspace. Use /bind <path> in IM first.`);
    }

    let session = binding.sessionKey ? this.sessions.getSession(binding.sessionKey) : undefined;
    if (!session) {
      session = this.sessions.createSession({
        cwd: binding.workspaceDir,
        title: `IM ${chatId}`,
        kind: "channel",
      });
      this.chatSessions.setSessionKey(chatId, channelId, session.id);
    }

    const queue: StreamEvent[] = [];
    let done = false;
    let resolveNext: (() => void) | null = null;
    const onEvent = (event: any) => {
      const mapped = this.mapServerEvent(event);
      if (mapped) {
        queue.push(mapped);
        resolveNext?.();
      }
    };

    const result = await this.runner.createRunner({
      prompt: message,
      session,
      resumeSessionId: session.claudeSessionId,
      onEvent,
    });
    activeHandles.set(sessionKey, result.handle);

    try {
      while (!done) {
        if (queue.length) yield queue.shift()!;
        else await new Promise<void>((r) => { resolveNext = () => { resolveNext = null; r(); }; });
        if (queue.length === 0 && session.status !== "running") done = true;
      }
    } finally {
      activeHandles.delete(sessionKey);
    }
  }

  async cancel(sessionKey?: string): Promise<boolean> {
    if (!sessionKey) return false;
    const handle = activeHandles.get(sessionKey);
    if (!handle) return false;
    handle.abort();
    activeHandles.delete(sessionKey);
    return true;
  }

  async resetSession(sessionKey?: string): Promise<void> {
    if (!sessionKey) return;
    const [chatId, channelId] = sessionKey.split("::");
    this.chatSessions.setSessionKey(chatId, channelId, "");
  }

  private mapServerEvent(serverEvent: any): StreamEvent | null {
    if (!serverEvent?.type) return null;
    if (serverEvent.type === "stream.message") {
      const text = serverEvent.payload?.text ?? "";
      return { type: "text", content: text } as unknown as StreamEvent;
    }
    if (serverEvent.type === "stream.completed") {
      return { type: "completion", content: serverEvent.payload?.result ?? "" } as unknown as StreamEvent;
    }
    return null;
  }
}
```

注意：`StreamEvent` 的精确字段需对照 GolemBot v0.47.1 `engine.d.ts`。如果实际字段不同，调整 `mapServerEvent`。运行 tsc 时若类型不匹配，把 `as unknown as StreamEvent` 改成正确字段。

- [ ] **Step 4: 测试通过**

```bash
cd packages/server && pnpm vitest run src/modules/channel/__tests__/local-claw-assistant.spec.ts
```

Expected: 3 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/modules/channel/local-claw-assistant.ts \
        packages/server/src/modules/channel/__tests__/local-claw-assistant.spec.ts
git commit -m "feat(channel): add LocalClawAssistant bridging GolemBot to RunnerService"
```

---

## Task 6: GolemChannelManager — Adapter 生命周期与 onMessage 路由

**Files:**
- Create: `packages/server/src/modules/channel/golem-channel-manager.ts`
- Test: `packages/server/src/modules/channel/__tests__/golem-channel-manager.spec.ts`

- [ ] **Step 1: 写测试（mock adapter）**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GolemChannelManager } from "../golem-channel-manager";

describe("GolemChannelManager", () => {
  function makeMocks() {
    const adapterMock = {
      name: "feishu",
      start: vi.fn(async (cb: any) => { adapterMock._cb = cb; }),
      stop: vi.fn(async () => {}),
      reply: vi.fn(),
      _cb: null as any,
    };
    return {
      assistant: { chat: vi.fn(async function* () { yield { type: "text", content: "ok" }; }) },
      chatSessions: { resolve: vi.fn(() => ({ workspaceDir: "/w" })), bind: vi.fn() },
      adapterFactory: vi.fn(() => adapterMock),
      adapterMock,
    };
  }

  it("startChannel 创建 adapter 并 start", async () => {
    const m = makeMocks();
    const mgr = new GolemChannelManager(m.assistant as any, m.chatSessions as any, m.adapterFactory as any);
    await mgr.startChannel({ id: "c1", type: "feishu", credentials: {}, enabled: true } as any);
    expect(m.adapterFactory).toHaveBeenCalledOnce();
    expect(m.adapterMock.start).toHaveBeenCalled();
  });

  it("stopChannel 调用 adapter.stop", async () => {
    const m = makeMocks();
    const mgr = new GolemChannelManager(m.assistant as any, m.chatSessions as any, m.adapterFactory as any);
    await mgr.startChannel({ id: "c1", type: "feishu", credentials: {}, enabled: true } as any);
    await mgr.stopChannel("c1");
    expect(m.adapterMock.stop).toHaveBeenCalled();
  });

  it("不支持的 type 跳过", async () => {
    const m = makeMocks();
    m.adapterFactory = vi.fn(() => null);
    const mgr = new GolemChannelManager(m.assistant as any, m.chatSessions as any, m.adapterFactory as any);
    await mgr.startChannel({ id: "c1", type: "wechat", credentials: {}, enabled: true } as any);
    expect(m.adapterMock.start).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd packages/server && pnpm vitest run src/modules/channel/__tests__/golem-channel-manager.spec.ts
```

Expected: FAIL with "Cannot find module"。

- [ ] **Step 3: 实现 GolemChannelManager**

新建 `packages/server/src/modules/channel/golem-channel-manager.ts`：

```typescript
import { Injectable, Inject, Logger } from "@nestjs/common";
import type { ChannelAdapter, ChannelMessage } from "golembot";
import { handleMessage } from "golembot/dist/gateway.js";
import type { ChannelConfig, ChannelType } from "@local-claw/shared/src/types";
import { homedir } from "os";
import { join } from "path";
import { LocalClawAssistant } from "./local-claw-assistant";
import { ChatSessionService } from "./chat-session.service";
import { buildDefaultGolemConfig } from "./golem-config";

export type AdapterFactory = (channel: ChannelConfig) => ChannelAdapter | null;

@Injectable()
export class GolemChannelManager {
  private readonly logger = new Logger(GolemChannelManager.name);
  private readonly adapters = new Map<string, ChannelAdapter>();

  constructor(
    @Inject(LocalClawAssistant) private readonly assistant: LocalClawAssistant,
    @Inject(ChatSessionService) private readonly chatSessions: ChatSessionService,
    @Inject("ADAPTER_FACTORY") private readonly factory: AdapterFactory,
  ) {}

  async startChannel(channel: ChannelConfig): Promise<void> {
    if (channel.engine === "legacy") return;
    if (this.adapters.has(channel.id)) await this.stopChannel(channel.id);
    const adapter = this.factory(channel);
    if (!adapter) {
      this.logger.warn(`No adapter factory for type=${channel.type}`);
      return;
    }
    const golemConfig = buildDefaultGolemConfig({ botName: channel.name });
    const dir = join(homedir(), ".localclaw");

    await adapter.start(async (msg: ChannelMessage) => {
      // 首次收到消息：若未绑定 workspaceDir，且 channel.workspaceDir 有值，则自动绑定
      const binding = this.chatSessions.resolve(msg.chatId, channel.id);
      if (!binding && channel.workspaceDir) {
        this.chatSessions.bind(msg.chatId, channel.id, channel.workspaceDir);
      } else if (!binding && msg.text.trim().startsWith("/bind ")) {
        const path = msg.text.trim().slice(6).trim();
        this.chatSessions.bind(msg.chatId, channel.id, path);
        await adapter.reply(msg, `Workspace bound: ${path}`);
        return;
      } else if (!binding) {
        await adapter.reply(msg, "请先用 `/bind <绝对路径>` 绑定工作目录");
        return;
      }

      const sessionKey = `${msg.chatId}::${channel.id}`;
      try {
        await handleMessage(
          { ...msg, raw: { ...((msg.raw as object) || {}), sessionKey } },
          golemConfig,
          this.assistant as any,
          adapter,
          channel.type,
          false,
          dir,
        );
      } catch (err) {
        this.logger.error(`handleMessage failed: ${err}`);
        await adapter.reply(msg, `处理失败：${String(err)}`).catch(() => {});
      }
    });

    this.adapters.set(channel.id, adapter);
    this.logger.log(`Adapter started: ${channel.type} (${channel.id})`);
  }

  async stopChannel(channelId: string): Promise<void> {
    const adapter = this.adapters.get(channelId);
    if (!adapter) return;
    try { await adapter.stop(); } catch (err) { this.logger.warn(`stop failed: ${err}`); }
    this.adapters.delete(channelId);
  }

  async restartChannel(channel: ChannelConfig): Promise<void> {
    await this.stopChannel(channel.id);
    if (channel.enabled) await this.startChannel(channel);
  }

  async stopAll(): Promise<void> {
    for (const id of Array.from(this.adapters.keys())) await this.stopChannel(id);
  }

  isRunning(channelId: string): boolean {
    return this.adapters.has(channelId);
  }
}
```

- [ ] **Step 4: 测试通过**

```bash
cd packages/server && pnpm vitest run src/modules/channel/__tests__/golem-channel-manager.spec.ts
```

Expected: 3 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/modules/channel/golem-channel-manager.ts \
        packages/server/src/modules/channel/__tests__/golem-channel-manager.spec.ts
git commit -m "feat(channel): add GolemChannelManager for adapter lifecycle and routing"
```

---

## Task 7: Adapter Factory — 按 ChannelType 实例化对应 GolemBot Adapter

**Files:**
- Create: `packages/server/src/modules/channel/adapter-factory.ts`
- Test: `packages/server/src/modules/channel/__tests__/adapter-factory.spec.ts`

- [ ] **Step 1: 写测试**

```typescript
import { describe, it, expect } from "vitest";
import { createAdapterFromChannel } from "../adapter-factory";

describe("createAdapterFromChannel", () => {
  it("feishu type 返回 FeishuAdapter 实例", () => {
    const adapter = createAdapterFromChannel({
      id: "x", type: "feishu", name: "n", enabled: true,
      credentials: { appId: "a", appSecret: "b" },
      status: "disconnected", createdAt: 0, updatedAt: 0,
    } as any);
    expect(adapter).not.toBeNull();
    expect(adapter?.name).toBe("feishu");
  });

  it("wechat type 返回 null（legacy 路径）", () => {
    const adapter = createAdapterFromChannel({
      id: "x", type: "wechat", name: "n", enabled: true,
      credentials: {}, status: "disconnected", createdAt: 0, updatedAt: 0,
    } as any);
    expect(adapter).toBeNull();
  });

  it("缺少必填字段不抛但返回 null", () => {
    const adapter = createAdapterFromChannel({
      id: "x", type: "feishu", name: "n", enabled: true,
      credentials: {}, status: "disconnected", createdAt: 0, updatedAt: 0,
    } as any);
    expect(adapter).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd packages/server && pnpm vitest run src/modules/channel/__tests__/adapter-factory.spec.ts
```

Expected: FAIL with "Cannot find module"。

- [ ] **Step 3: 实现 adapter-factory**

新建 `packages/server/src/modules/channel/adapter-factory.ts`：

```typescript
import type { ChannelAdapter } from "golembot";
import type { ChannelConfig } from "@local-claw/shared/src/types";
import { FeishuAdapter } from "golembot/dist/channels/feishu.js";
import { TelegramAdapter } from "golembot/dist/channels/telegram.js";
import { DiscordAdapter } from "golembot/dist/channels/discord.js";
import { DingtalkAdapter } from "golembot/dist/channels/dingtalk.js";

export function createAdapterFromChannel(channel: ChannelConfig): ChannelAdapter | null {
  const c = channel.credentials || {};
  switch (channel.type) {
    case "feishu": {
      if (!c.appId || !c.appSecret) return null;
      return new FeishuAdapter({ appId: c.appId, appSecret: c.appSecret } as any);
    }
    case "telegram": {
      if (!c.botToken) return null;
      return new TelegramAdapter({ botToken: c.botToken } as any);
    }
    case "discord": {
      if (!c.botToken) return null;
      return new DiscordAdapter({ botToken: c.botToken, botName: channel.name } as any);
    }
    case "dingtalk": {
      if (!c.appKey || !c.appSecret) return null;
      return new DingtalkAdapter({ appKey: c.appKey, appSecret: c.appSecret } as any);
    }
    case "wechat":
      return null; // legacy 路径
    default:
      return null;
  }
}
```

- [ ] **Step 4: 测试通过**

```bash
cd packages/server && pnpm vitest run src/modules/channel/__tests__/adapter-factory.spec.ts
```

Expected: 3 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/modules/channel/adapter-factory.ts \
        packages/server/src/modules/channel/__tests__/adapter-factory.spec.ts
git commit -m "feat(channel): add adapter factory for GolemBot channels"
```

---

## Task 8: 接入 ChannelService 与 Module 注册

**Files:**
- Modify: `packages/server/src/modules/channel/channel.module.ts`
- Modify: `packages/server/src/modules/channel/channel.service.ts`
- Modify: `packages/server/src/modules/channel/channel-daemon.service.ts:26-31` (onModuleInit)
- Modify: `packages/server/src/modules/channel/channel-daemon.service.ts:88-98` (restart)

- [ ] **Step 1: ChannelModule 注册新 service**

修改 `packages/server/src/modules/channel/channel.module.ts`，在 `providers` 中添加：

```typescript
import { ChatSessionService } from "./chat-session.service";
import { LocalClawAssistant } from "./local-claw-assistant";
import { GolemChannelManager } from "./golem-channel-manager";
import { createAdapterFromChannel } from "./adapter-factory";
import Database from "better-sqlite3";
import { join } from "path";

const adapterFactoryProvider = {
  provide: "ADAPTER_FACTORY",
  useValue: createAdapterFromChannel,
};

const chatSessionDbProvider = {
  provide: ChatSessionService,
  useFactory: () => {
    const dbPath = process.env.DB_PATH ?? join(process.cwd(), "webui.db");
    return new ChatSessionService(new Database(dbPath));
  },
};

// providers: [..., chatSessionDbProvider, LocalClawAssistant, GolemChannelManager, adapterFactoryProvider]
```

注意：`ChatSessionService` 需要复用 `ChannelService` 已经创建的 db 实例。最佳做法是把 db 提取成一个共享 provider。这一步先用 useFactory 创建一个独立连接（SQLite 支持多连接），下一步再做共享 db provider 优化。

- [ ] **Step 2: ChannelService 加 GolemChannelManager 注入与分支逻辑**

`channel.service.ts` 构造器加注入：

```typescript
constructor(
  @Inject(forwardRef(() => GolemChannelManager))
  private readonly golemManager: GolemChannelManager,
) { /* ... */ }
```

`onModuleInit` 改为：

```typescript
onModuleInit(): void {
  const channels = this.listChannels().filter((c) => c.enabled);
  for (const ch of channels) {
    if (ch.engine === "legacy" || ch.type === "wechat") {
      try { this.syncChannelToSettings(ch); } catch { /* ignore */ }
    } else {
      this.golemManager.startChannel(ch).catch((err) =>
        console.error(`[channel] start failed for ${ch.id}:`, err)
      );
    }
  }
}
```

`saveChannel` 末尾改为：

```typescript
const saved = /* ... existing logic returning ChannelConfig ... */;
if (saved.engine === "legacy" || saved.type === "wechat") {
  this.syncChannelToSettings(saved);
} else {
  this.golemManager.restartChannel(saved).catch((err) =>
    console.error(`[channel] restart failed: ${err}`)
  );
}
return saved;
```

`deleteChannel` 改为：

```typescript
deleteChannel(id: string): boolean {
  const channel = this.getChannel(id);
  if (!channel) return false;
  if (channel.engine === "legacy" || channel.type === "wechat") {
    this.removeChannelFromSettings(channel.type);
  } else {
    this.golemManager.stopChannel(id).catch(() => {});
  }
  const result = this.db.prepare("DELETE FROM channels WHERE id = ?").run(id);
  return result.changes > 0;
}
```

`testConnection` 加分支：legacy 走原逻辑，golembot 走 `this.golemManager.isRunning(id) ? { ok: true } : { ok: false, error: "Adapter 未启动" }`。

- [ ] **Step 3: ChannelDaemonService 只为 legacy（wechat）启动**

修改 `channel-daemon.service.ts:26-31`：

```typescript
onModuleInit(): void {
  const legacy = this.channelService.listChannels()
    .filter((c) => c.enabled && (c.engine === "legacy" || c.type === "wechat"));
  if (legacy.length) {
    setTimeout(() => this.start(), 2000);
  }
}
```

`getEnabledChannelArgs()` 在 ChannelService 中改为只返回 legacy/wechat：

```typescript
getEnabledChannelArgs(): string[] {
  return this.listChannels()
    .filter((c) => c.enabled && (c.engine === "legacy" || c.type === "wechat"))
    .map((c) => `server:${c.type}-channel`);
}
```

- [ ] **Step 4: 编译检查**

```bash
cd packages/server && pnpm tsc --noEmit
```

Expected: 0 errors。如果有循环依赖错误，把 `forwardRef` 加到两个 service 的注入处。

- [ ] **Step 5: 跑全部测试**

```bash
cd packages/server && pnpm vitest run src/modules/channel
```

Expected: ALL PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/server/src/modules/channel/channel.module.ts \
        packages/server/src/modules/channel/channel.service.ts \
        packages/server/src/modules/channel/channel-daemon.service.ts
git commit -m "feat(channel): wire GolemChannelManager into ChannelService and split legacy/golembot paths"
```

---

## Task 9: 迁移脚本与 REST 端点

**Files:**
- Create: `packages/server/src/modules/channel/migration.ts`
- Modify: `packages/server/src/modules/channel/channel-rest.controller.ts`

- [ ] **Step 1: 写测试**

新建 `packages/server/src/modules/channel/__tests__/migration.spec.ts`：

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { migrateChannels } from "../migration";

describe("migrateChannels", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE channels (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL,
      enabled INTEGER, credentials TEXT NOT NULL, status TEXT,
      engine TEXT, workspace_dir TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`);
  });

  it("non-wechat 行的 engine 为 NULL 时设为 golembot", () => {
    db.prepare("INSERT INTO channels VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      "a", "feishu", "n", 1, "{}", "disconnected", null, null, 0, 0
    );
    const result = migrateChannels(db);
    expect(result.updated).toBe(1);
    const row = db.prepare("SELECT engine FROM channels WHERE id='a'").get() as any;
    expect(row.engine).toBe("golembot");
  });

  it("wechat 行 engine 设为 legacy", () => {
    db.prepare("INSERT INTO channels VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      "w", "wechat", "n", 1, "{}", "disconnected", null, null, 0, 0
    );
    migrateChannels(db);
    const row = db.prepare("SELECT engine FROM channels WHERE id='w'").get() as any;
    expect(row.engine).toBe("legacy");
  });

  it("已有 engine 的行不变", () => {
    db.prepare("INSERT INTO channels VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      "b", "feishu", "n", 1, "{}", "disconnected", "legacy", "", 0, 0
    );
    migrateChannels(db);
    const row = db.prepare("SELECT engine FROM channels WHERE id='b'").get() as any;
    expect(row.engine).toBe("legacy");
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd packages/server && pnpm vitest run src/modules/channel/__tests__/migration.spec.ts
```

Expected: FAIL with "Cannot find module"。

- [ ] **Step 3: 实现 migration.ts**

新建 `packages/server/src/modules/channel/migration.ts`：

```typescript
import type Database from "better-sqlite3";

export function migrateChannels(db: Database.Database): { updated: number } {
  const rows = db.prepare(
    "SELECT id, type, engine FROM channels WHERE engine IS NULL OR engine = ''"
  ).all() as Array<{ id: string; type: string; engine: string | null }>;

  const update = db.prepare("UPDATE channels SET engine=?, updated_at=? WHERE id=?");
  const now = Date.now();
  let updated = 0;
  for (const row of rows) {
    const engine = row.type === "wechat" ? "legacy" : "golembot";
    update.run(engine, now, row.id);
    updated++;
  }
  return { updated };
}
```

- [ ] **Step 4: 加 REST 端点**

修改 `channel-rest.controller.ts`：

```typescript
@Post("channels/migrate")
@HttpCode(200)
async migrate() {
  return this.channelService.migrate();
}
```

`channel.service.ts` 加一个方法：

```typescript
import { migrateChannels } from "./migration";

migrate(): { updated: number } {
  const result = migrateChannels(this.db);
  // 重启相关 adapters
  for (const ch of this.listChannels().filter((c) => c.enabled)) {
    if (ch.engine === "golembot") {
      this.golemManager.restartChannel(ch).catch(() => {});
    }
  }
  return result;
}
```

- [ ] **Step 5: 测试通过**

```bash
cd packages/server && pnpm vitest run src/modules/channel/__tests__/migration.spec.ts
```

Expected: 3 PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/server/src/modules/channel/migration.ts \
        packages/server/src/modules/channel/__tests__/migration.spec.ts \
        packages/server/src/modules/channel/channel-rest.controller.ts \
        packages/server/src/modules/channel/channel.service.ts
git commit -m "feat(channel): add migration for engine field with REST endpoint"
```

---

## Task 10: 前端 — ChannelManager 显示 engine + 工作目录字段

**Files:**
- Modify: `packages/client/src/api.ts`
- Modify: `packages/client/src/components/ChannelManager.tsx`
- 寻找并修改 channel 编辑表单（用 grep 找 ChannelEditor 或 ChannelForm 等）

- [ ] **Step 1: 找编辑表单文件**

```bash
cd d:/wwwroot/localclaw && grep -rln "credentials" packages/client/src/components/ | grep -i "channel"
```

预期得到 channel 编辑表单文件路径，记为 `<form-file>`。

- [ ] **Step 2: 加 apiMigrateChannels**

`packages/client/src/api.ts` 末尾加：

```typescript
export async function apiMigrateChannels(): Promise<{ updated: number }> {
  const res = await fetch("/api/channels/migrate", { method: "POST" });
  if (!res.ok) throw new Error(`Migration failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 3: ChannelManager.tsx 显示 engine badge**

修改 `ChannelCard` 函数，在 `<div className="text-xs text-text-400">{typeLabel}</div>` 之后插入：

```tsx
{channel.engine === "legacy" && (
  <span className="ml-1 inline-block rounded bg-warning-100 px-1.5 py-0.5 text-[10px] text-warning-700">
    legacy
  </span>
)}
```

工作目录 `workspaceDir` 在卡片底部追加（仅有值时显示）：

```tsx
{channel.workspaceDir && (
  <div className="text-xs text-text-400 break-all">
    工作目录: {channel.workspaceDir}
  </div>
)}
```

- [ ] **Step 4: 加迁移按钮**

`ChannelManager` 的 `<button>+ 添加</button>` 同级位置加：

```tsx
<button
  className="w-full rounded-xl border border-border-300 bg-bg-200 px-4 py-2 text-xs text-text-400 hover:bg-bg-300"
  onClick={async () => {
    const r = await apiMigrateChannels();
    alert(`迁移完成：${r.updated} 个 channel`);
    apiListChannels().then(setChannels);
  }}
>
  迁移旧 channel 到 GolemBot
</button>
```

- [ ] **Step 5: 编辑表单加 workspaceDir 字段**

在 Step 1 找到的 `<form-file>` 中，在 credentials 字段下方加：

```tsx
<label className="block text-sm">
  <span className="text-text-200">工作目录（绝对路径，留空则用 IM 中 /bind 命令）</span>
  <input
    type="text"
    className="mt-1 w-full rounded border border-border-300 px-3 py-2"
    value={form.workspaceDir ?? ""}
    onChange={(e) => setForm({ ...form, workspaceDir: e.target.value })}
    placeholder="/path/to/project"
  />
</label>
```

`form` state 类型扩 `workspaceDir?: string`。表单提交时 `body.channel.workspaceDir = form.workspaceDir`。

- [ ] **Step 6: 编译检查**

```bash
cd packages/client && pnpm tsc --noEmit
```

Expected: 0 errors。

- [ ] **Step 7: 提交**

```bash
git add packages/client/src/api.ts packages/client/src/components/
git commit -m "feat(channel-ui): show engine badge, workspaceDir field, migrate button"
```

---

## Task 11: 端到端验证（人工）

**Files:** 无代码改动，只验证。

- [ ] **Step 1: 启动 Local Claw**

```bash
cd d:/wwwroot/localclaw && pnpm dev
```

打开桌面 UI，进入 Channel 菜单。

- [ ] **Step 2: 点击"迁移旧 channel 到 GolemBot"**

Expected: 弹出"迁移完成：N 个 channel"。已配置过的 channel 卡片：
- wechat 显示 `legacy` 标记
- 其它（feishu/telegram/discord/dingtalk）无 legacy 标记

- [ ] **Step 3: Telegram 端到端**

前提：已有 Telegram bot token。在 ChannelManager 编辑 telegram channel，填 `工作目录` 为一个真实存在的目录（如 `d:/wwwroot/localclaw`），保存。

打开手机 Telegram，给 bot 发消息：`列出当前目录的文件`

Expected:
1. Telegram 立即收到 typing 状态
2. 几秒后 bot 回复 ls 结果
3. 桌面 UI 的"会话"列表新增一个 kind=channel 的 session
4. 该 session 的 cwd 为配置的工作目录

- [ ] **Step 4: 多轮对话验证**

继续在 Telegram 发：`再列一遍`

Expected: bot 知道"再列一遍"指上一条消息，输出同样的 ls 结果（说明同一 chat_id 复用了 session）。

- [ ] **Step 5: WeChat（legacy）回归测试**

如果有微信 channel，发一条消息验证 legacy 路径仍工作。

Expected: 同 GolemBot 改动前的行为。

- [ ] **Step 6: 删除旧 .mjs 文件**

确认 GolemBot 路径稳定后：

```bash
cd d:/wwwroot/localclaw && \
  rm packages/server/src/modules/channel/mcp-servers/discord-channel-server.mjs \
     dist-server/mcp-servers/discord-channel-server.mjs
```

- [ ] **Step 7: 编译 + 重启 + 复测**

```bash
cd d:/wwwroot/localclaw && pnpm dev
```

重做 Step 3 的验证一遍，确认删除文件后无回归。

- [ ] **Step 8: 提交**

```bash
git add -u packages/server/src/modules/channel/mcp-servers/ dist-server/mcp-servers/
git commit -m "chore(channel): remove legacy MCP servers replaced by GolemBot"
```

---

## Final Validation

- [ ] **Step 1: 全套测试**

```bash
cd d:/wwwroot/localclaw && pnpm test
pnpm tsc --noEmit
```

Expected: 全绿。

- [ ] **Step 2: 总结**

确认所有任务完成，迁移按钮、IM 端到端、wechat 回归全部 OK。

---

## Self-Review

**Spec coverage**：
- §2 架构 → Task 6（GolemChannelManager + handleMessage）
- §3 数据模型 → Task 2（types + schema）+ Task 3（chat_sessions 表）
- §4 核心组件 → Task 3-7
- §5 typing+汇总策略 → 由 `handleMessage` 内部承担（GolemBot 提供）
- §6 迁移脚本 → Task 9
- §7 前端改动 → Task 10
- §8 wechat legacy → Task 8（`engine === "legacy"` 分支）
- §9 错误处理 → Task 6（try/catch + adapter.reply error）

**Placeholder 扫描**：无 TBD/TODO/"实现细节"。每个 step 有可运行的命令或代码块。

**类型一致性**：
- `ChannelEngine` 在 Task 2/8/9 一致使用 `"golembot" | "legacy"`
- `LocalClawAssistant.chat()` 的 sessionKey 在 Task 5/6 一致使用 `${chatId}::${channelId}` 格式
- `ChatSession.workspaceDir` / `ChannelConfig.workspaceDir` 命名统一

**潜在风险与应对**：
1. GolemBot StreamEvent 结构未在文档中确认 → Task 5 Step 3 注释了"若类型不匹配，调整 mapServerEvent"
2. 循环依赖 ChannelService ↔ GolemChannelManager → Task 8 Step 4 提到用 `forwardRef`
3. `handleMessage` 的 reply 行为依赖 `assistant.chat()` 的 yield 顺序 → Task 5 测试覆盖了基本流

