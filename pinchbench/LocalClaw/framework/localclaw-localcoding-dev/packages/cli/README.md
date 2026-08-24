# @lenovo/agent-cli

LocalClaw 命令行工具（`lc`）。

薄启动器：在 import 之前布置好隔离配置目录与端点凭据，随后 in-process
import vendored `@lenovo/claude-cli` 点火。**不 spawn 子进程、不改 CLI 源码。**

## 定位

- ✅ 独立命令行工具，无需后端在跑
- ✅ 复用 `~/.localcoding` 配置目录（与桌面版/VSCode 共享会话历史）
- ✅ 从 `~/.localcoding/settings.json` 的 `endpoints` 读启用端点，直连注入凭据
- ✅ 权限确认卡片 / plan / ultraplan / modes —— claude-cli 原生能力，白得
- ⏳ 路由 / 网关省钱 / MCP / 定时任务 —— 依赖 daemon，后续阶段
- ⏳ 首次运行配端点引导 —— 后续在 claude-cli 源码层复用其 ink 登录界面

需要「全能力」（渠道面板、定时任务可视化管理）时，请使用桌面版或 VSCode 插件。

## 凭据来源（优先级）

1. shell 环境变量：`ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`
   （或 openai 兼容：`CLAUDE_CODE_USE_OPENAI=1` + `OPENAI_BASE_URL` + `OPENAI_API_KEY`）
2. `~/.localcoding/settings.json` 里第一个 `enabled` 的端点

两者都没有时给出引导提示，但仍放行（可用于 `--help` / `--version`）。

## 本地开发运行

```bash
pnpm --filter @lenovo/agent-cli build   # tsc → dist/
node packages/cli/bin/lc.js --version   # 验证 in-process import
node packages/cli/bin/lc.js "写个贪吃蛇"  # 直连出结果
node packages/cli/bin/lc.js             # 进入交互 TUI
```

## 构建交付产物（给外部用户）

外部用户访问不了私仓，故打一个「自包含」tarball：把 `@lenovo/claude-cli`
（含全平台 ripgrep + Windows minimal-bash 等 ~72MB 物料）用 `bundleDependencies`
整个打进 tgz，用户安装时零 registry 依赖。

```bash
# 前提：先 pnpm install（让 @lenovo/claude-cli 就位）
cd packages/cli
pnpm pack:standalone        # 自动 tsc 编译 + 实体化依赖 + npm pack
# → 产出 packages/cli/lenovo-agent-cli-<version>.tgz（约 27MB）
```

把生成的 `.tgz` 单个文件发给用户即可，无需其他附件。

## 外部用户安装使用

**前提**：机器已装 Node.js **>= 22**（不内置运行时，与 claude/codex 一致）。

```bash
npm i -g ./lenovo-agent-cli-0.1.0.tgz   # 全局安装
lc --version                             # 验证
lc "写个贪吃蛇"                            # 一次性执行
lc                                       # 进入交互 TUI
```

首次使用需配置端点凭据（二选一）：

```bash
# 方式 1：环境变量
export ANTHROPIC_BASE_URL="https://你的网关地址"
export ANTHROPIC_AUTH_TOKEN="你的 key"

# 方式 2：写 ~/.localcoding/settings.json 的 endpoints（见「凭据来源」）
```

> 配置目录默认 `~/.localcoding`，可用 `CLAUDE_CONFIG_DIR` 环境变量改到别处。

## 文件

| 文件 | 职责 |
|---|---|
| `bin/lc.js` | node 入口，`import ../dist/index.js`（仿 claude-cli 的 cli-node.js） |
| `src/index.ts` | 主启动器：prepareEnv → 凭据引导 → import CLI 点火 |
| `src/prepare-env.ts` | 隔离配置目录 + seed `.claude.json` + 注入凭据 |
| `src/endpoint-env.ts` | 端点配置 → 直连 env（anthropic / openai 兼容分流） |

## 所有传入参数透传给 claude-cli

`lc` 不解析参数，`process.argv` 原样交给 CLI，故 CLI 的全部 flag
（`-p` / `--permission-mode` / `--model` / `--mcp-config` 等）均可直接使用。
