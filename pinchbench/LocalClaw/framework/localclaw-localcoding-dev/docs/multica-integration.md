# localclaw 对接 multica 方案

## 背景

multica 是一个托管 Agent 平台，通过本地 Daemon 进程调度 AI Agent 执行任务。
localclaw 需要实现与 multica 内置 `openclaw` provider 相同的 CLI 接口，即可被 multica 识别和管理。

---

## 核心原理

multica Daemon 对 openclaw 的调用流程：

```
1. openclaw config file
   → 返回用户配置文件的绝对路径

2. openclaw config get agents.list --json
   → 返回已注册的 agent 列表（JSON 数组）

3. 写入 per-task wrapper config（JSON）到临时目录
   → 覆盖 agents.defaults.workspace 为任务工作目录
   → 设置环境变量 OPENCLAW_CONFIG_PATH 指向该文件

4. 启动 openclaw <prompt>
   → 读取 OPENCLAW_CONFIG_PATH 获取工作目录
   → 读取工作目录下的 issue_context.md 获取任务描述
   → 执行任务，流式输出结果到 stdout
```

---

## 实现方案

### 新增文件

`bin/multica-agent.js` — openclaw 兼容的 CLI 包装脚本（已创建）

该脚本实现三个功能：

| 调用方式 | 行为 |
|---|---|
| `multica-agent config file` | 输出 `~/.openclaw/openclaw.json` 路径（不存在则自动创建） |
| `multica-agent config get agents.list --json` | 输出 agent 列表 JSON |
| `multica-agent [prompt]` | 连接 localclaw 后端 WebSocket，创建会话执行任务 |

### 任务执行流程

```
multica Daemon
  │ 设置 OPENCLAW_CONFIG_PATH（含任务 workspace 路径）
  │ 写入 {workspace}/issue_context.md（任务描述）
  ▼
multica-agent.js
  │ 读取 OPENCLAW_CONFIG_PATH → 获取 workspace
  │ 读取 issue_context.md → 获取 prompt
  ▼
localclaw 后端 WebSocket (ws://127.0.0.1:10086/ws)
  │ session.start { prompt, cwd: workspace }
  │ 监听 stream.message → 流式输出到 stdout
  │ 监听 session.status(completed/error) → 退出
  ▼
multica Daemon 收集输出，上报进度到 multica 服务端
```

---

## 部署步骤

### 1. 准备配置文件

在运行 multica Daemon 的机器上创建 `~/.openclaw/openclaw.json`：

```json
{
  "agents": {
    "defaults": {
      "workspace": "~/localclaw-workspace"
    },
    "list": [
      {
        "id": "default",
        "model": "claude-sonnet-4-6",
        "workspace": "~/localclaw-workspace"
      }
    ]
  }
}
```

### 2. 确保 localclaw 后端正在运行

localclaw 后端默认监听 `127.0.0.1:10086`，multica-agent.js 通过 `ws://127.0.0.1:10086/ws` 连接。

> ⚠️ 端口说明：桌面应用（Electron）启动时若 `10086` 被占用，会自动改用一个 OS 分配的空闲端口。
> multica-agent.js 用固定的 `LOCALCLAW_PORT`（默认 10086）连接，因此**与桌面应用集成时请显式指定端口**，
> 或确保 `10086` 未被占用，避免桌面应用回退到随机端口后 multica-agent 连不上。
> 独立运行 server（非桌面应用）时端口固定，不受影响。

如需修改端口：
```bash
# multica-agent.js 与 Electron 桌面应用都读 LOCALCLAW_PORT（桌面应用以它作为首选端口）
export LOCALCLAW_PORT=10086
# 独立运行 server（scripts/start-node.cjs / main.ts）读的是 PORT，需另外设置
export PORT=10086
```

### 3. 安装 ws 依赖

`multica-agent.js` 依赖 `ws` 包：

```bash
cd /path/to/localclaw
npm install ws
# 或
pnpm add ws
```

### 4. 在 multica 中注册

在 multica Daemon 机器上设置环境变量，指向 multica-agent.js：

```bash
export MULTICA_OPENCLAW_PATH=/path/to/localclaw/bin/multica-agent.js
```

或者将脚本软链接为 `openclaw` 命令，让 multica 自动检测：

```bash
chmod +x /path/to/localclaw/bin/multica-agent.js
ln -s /path/to/localclaw/bin/multica-agent.js /usr/local/bin/openclaw
```

### 5. 在 multica 控制台创建 Agent

进入 multica Web UI → Settings → Agents，创建一个新 Agent：
- Provider：选择 `openclaw`
- Runtime：选择已注册的本机 Runtime

---

## 环境变量说明

| 变量 | 来源 | 说明 |
|---|---|---|
| `OPENCLAW_CONFIG_PATH` | multica Daemon 注入 | per-task wrapper config 路径，含任务 workspace |
| `OPENCLAW_INCLUDE_ROOTS` | multica Daemon 注入 | 允许跨目录 follow `$include` 链接 |
| `MULTICA_TOKEN` | multica Daemon 注入 | multica 服务端认证 token |
| `MULTICA_TASK_ID` | multica Daemon 注入 | 当前任务 ID |
| `MULTICA_WORKSPACE_ID` | multica Daemon 注入 | 工作区 ID |
| `LOCALCLAW_PORT` | 本地配置 | localclaw 后端端口，默认 10086；multica-agent 与桌面应用据此连接/选首选端口（桌面应用在 10086 被占时会回退到随机空闲端口） |

---

## per-task wrapper config 格式

multica 写入 `OPENCLAW_CONFIG_PATH` 的文件结构：

```json
{
  "$include": ["/Users/xxx/.openclaw/openclaw.json"],
  "agents": {
    "defaults": {
      "workspace": "/path/to/multica/workspaces/{workspace_id}/{task_id_short}/workdir"
    },
    "list": [
      {
        "id": "default",
        "model": "claude-sonnet-4-6",
        "workspace": "/path/to/multica/workspaces/{workspace_id}/{task_id_short}/workdir"
      }
    ]
  }
}
```

multica 还会在 workspace 目录下写入：
- `issue_context.md` — 任务描述（issue 内容 + 触发评论）
- `skills/` — 分配给该 Agent 的 skill 文件

---

## 注意事项

1. **localclaw 必须先启动**：multica-agent.js 依赖 localclaw 后端 WebSocket，执行任务前需确保后端已运行。
2. **单机部署**：当前方案假设 multica Daemon 和 localclaw 运行在同一台机器上。如需跨机器，修改 `multica-agent.js` 中的 `wsUrl` 指向远程地址。
3. **并发限制**：localclaw 后端支持多会话并发，multica 的并发槽位（`MULTICA_TASK_SLOT`）由 Daemon 控制。
4. **会话超时**：multica-agent.js 设置了 2 小时超时保护，可根据实际任务时长调整。
