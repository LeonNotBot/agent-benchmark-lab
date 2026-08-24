# LocalDesign 技术移植文档

> 本文档描述 LocalDesign 项目的核心技术架构与实现细节，供移植到其他项目时参考。

## 一、项目概述

LocalDesign 是一个本地运行的 UI 设计 Agent。用户输入自然语言描述 → 后端调用 Claude API（tool_use 模式）→ Claude 通过 Pencil MCP 工具生成可编辑的 `.pen` 设计文件 + PNG 预览图。

**核心能力**：
- 自然语言生成 UI 设计稿（支持移动端/桌面端/幻灯片等）
- 增量编辑（基于对话历史的多轮修改）
- 撤回/重做
- 导出 HTML / PNG / .pen 文件

---

## 二、整体架构

```
┌─────────────────┐     SSE/REST      ┌──────────────────────┐     stdio      ┌─────────────────┐
│  localdesign-web │ ◄──────────────► │  localdesign-server   │ ◄────────────► │  Pencil MCP     │
│  (React + Vite)  │                   │  (Fastify + Agent)    │                │  (VSCode 扩展)   │
└─────────────────┘                   └──────────────────────┘                └─────────────────┘
                                              │
                                              │ fetch (SSE stream)
                                              ▼
                                      ┌──────────────────┐
                                      │  Anthropic API    │
                                      │  (Claude Model)   │
                                      └──────────────────┘
```

---

## 三、技术栈

| 模块 | 技术 |
|------|------|
| 后端 | Node.js ≥ 20, TypeScript, Fastify ^4, better-sqlite3 ^11 |
| 前端 | Vite ^5, React ^18, TypeScript, Tailwind CSS ^3.4 |
| AI | Anthropic API (原生 fetch 流式调用), Claude claude-sonnet-4-6 |
| MCP | @modelcontextprotocol/sdk ^1.29 (StdioClientTransport) |
| 导出 | localdesign-exporter (节点树 → HTML 转译器) |
| 数据库 | SQLite (better-sqlite3, 内联迁移) |

---

## 四、核心模块详解

### 4.1 Agent Runtime（核心循环）

文件：`localdesign-server/src/agent/runtime.ts`

这是整个项目最核心的文件，实现了 Claude tool_use 循环：

```
构建系统提示词 + 用户消息
    ↓
循环 (turn < AGENT_MAX_TURNS):
    → fetch Anthropic Messages API (stream=true)
    → 解析 SSE 事件流，重建 ContentBlock[]
    → 遇到 text 块 → 通知前端（status 事件）
    → 遇到 tool_use 块 → 调用 Pencil MCP 工具 → 收集结果
    → 将 assistant + tool_result 追加到消息历史
    → 检查是否有 stop_reason="end_turn" 且无 tool_use → 结束
    ↓
保存 conversation_history 到 SQLite
返回 {penPath, pngPath}
```

**关键设计点**：

1. **系统提示词由两部分拼接**：
   - `BASE_DESIGN_PROMPT`：从文件加载的基础设计提示词
   - `MCP_AGENT_PROMPT`：内联定义的 MCP 工具使用规范

2. **两种工作模式**：
   - MODE A（新建）：`open_document` → `get_editor_state` → `batch_design` → `export_nodes`
   - MODE B（编辑）：`open_document` → `get_editor_state` → `batch_get` → `batch_design` → `export_nodes`

3. **对话历史持久化**：每次生成完成后序列化 `MessageParam[]` 存入 SQLite，下次编辑时恢复

4. **PNG 导出三层 fallback**：
   - 解析 `export_nodes` 返回文本中的路径
   - 按 nodeId 猜测文件名
   - 扫描目录中最近 30 秒内创建的 PNG

5. **空白 PNG 检测**：若 PNG < 10KB，自动以 `scale=2` 重试

6. **轮次上限提醒**：最后 3 轮注入提醒消息，强制调用 `export_nodes`

### 4.2 Pencil MCP 客户端

文件：`localdesign-server/src/agent/pencilClient.ts`

```typescript
// 核心接口
interface PencilSession {
  tools: Tool[];           // 可用工具列表（已过滤+脱敏）
  callTool(name, args);    // 调用 MCP 工具
  close();                 // 关闭子进程
}
```

**关键实现**：

1. **自动探测 MCP 二进制**：在 `~/.vscode/extensions/highagency.pencil*` 下按平台查找
   - Windows: `mcp-server-windows-x64.exe`
   - macOS arm64: `mcp-server-darwin-arm64`
   - Linux x64: `mcp-server-linux-x64`

2. **会话隔离**：每次调用创建独立子进程，通过 `-conversation_id` 参数隔离

3. **工具白名单**（11 个）：
   ```
   open_document, batch_get, batch_design, snapshot_layout,
   get_screenshot, get_variables, set_variables,
   find_empty_space_on_canvas, search_all_unique_properties,
   export_nodes, get_editor_state
   ```
   排除 `get_guidelines`（其 schema 会导致某些 API 代理返回空内容）

4. **文本脱敏**：将工具描述中的 "Pencil"/"pencil"/".pen"/"MCP server" 替换为中性词，避免第三方 API 代理过滤

### 4.3 Anthropic API 调用方式

**不使用 SDK，直接用原生 fetch 流式调用**：

```typescript
const response = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: CLAUDE_MODEL,
    max_tokens: 16384,
    stream: true,
    system: systemPrompt,
    messages: messages,
    tools: pencilTools,  // MCP 工具定义
  }),
  signal: abortSignal,
});
```

**SSE 解析**：逐行读取 `event:` 和 `data:` 行，处理以下事件类型：
- `content_block_start` / `content_block_delta` / `content_block_stop`
- `message_delta`（获取 stop_reason）
- `message_stop`

### 4.4 系统提示词结构

```
[BASE_DESIGN_PROMPT - 基础设计能力描述]

---

[MCP_AGENT_PROMPT - 工具使用规范]
包含：
- 可用工具列表及参数说明
- MODE A / MODE B 工作流程
- 设计规则（尺寸、布局、颜色等）
- 强制最终步骤：export_nodes
```

**MCP_AGENT_PROMPT 中的关键规则**：
- 单页面：一个垂直 frame 作为根，`placeholder:true`
- 多页面：多个 frame 水平排列，x 坐标不重叠
- 根 frame 必须有明确 width/height（移动端 390×844，桌面端 1440×900）
- 文本节点必须有 `fill` 颜色
- 最终步骤强制调用 `export_nodes`

---

## 五、数据模型

### SQLite `designs` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| prompt | TEXT | 用户提示词 |
| status | TEXT | pending / running / done / error / cancelled |
| pen_path | TEXT | .pen 文件绝对路径 |
| png_path | TEXT | .png 文件绝对路径 |
| error | TEXT | 错误信息 |
| has_snapshot | INTEGER | 是否有上一版快照（0/1） |
| prev_prompt | TEXT | 上一版提示词（撤回用） |
| cancel_requested | INTEGER | 停止请求标志（0/1） |
| conversation_history | TEXT | JSON 序列化的对话历史 |
| use_system_prompt | INTEGER | 是否使用系统提示词（0/1） |
| created_at / updated_at | INTEGER | 时间戳 |

---

## 六、API 接口

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/designs` | 列出所有设计（最近50条） |
| GET | `/api/designs/:id` | 查询单个设计 |
| POST | `/api/designs` | 创建设计任务 `{prompt, useSystemPrompt}` |
| GET | `/api/designs/:id/stream` | SSE 流式生成 |
| DELETE | `/api/designs/:id/stream` | 停止生成 |
| POST | `/api/designs/:id/regenerate` | 覆盖重跑 |
| POST | `/api/designs/:id/undo` | 撤回到上一版 |
| GET | `/api/designs/:id/preview` | PNG 预览图 |
| POST | `/api/designs/:id/re-export` | 重新导出 PNG |
| GET | `/api/designs/:id/pen` | 下载 .pen 文件 |
| GET | `/api/designs/:id/html` | 下载 HTML |

### SSE 事件类型

| 事件 | 数据 | 说明 |
|------|------|------|
| status | `{message}` | Agent 文本输出 |
| tool_use | `{tool, input}` | 工具调用 |
| tool_result | `{tool, result}` | 工具返回 |
| done | `{designId, previewUrl}` | 生成完成 |
| error | `{message}` | 错误 |
| cancelled | `{}` | 用户取消 |

---

## 七、文件存储

```
uiStore/                          # 项目根目录下
├── <designId>.pen                # 设计文件（加密格式）
├── <designId>.png                # 导出的预览图
├── <designId>.prev.pen           # 快照（撤回用）
└── <designId>.prev.png           # 快照预览图
```

---

## 八、HTML 导出器（localdesign-exporter）

纯函数转译器，将 Pencil 节点树 JSON 转为 HTML + 内联 CSS。

### 支持的节点类型
- `frame` / `group` → `<div>` (flex 布局)
- `text` → `<p>` / `<span>`
- `button` → `<button>` (primary/secondary/ghost)
- `input` → `<input>` (text/email/password/number)
- `image` → `<img>`
- `divider` / `line` → `<hr>`
- 未知类型 → `<div>` 回退

### 调用方式
```typescript
import { emitHtmlFromNodes } from '@localdesign/exporter';
const html = emitHtmlFromNodes(nodes, '页面标题');
```

---

## 九、移植要点

### 9.1 必要依赖

1. **VSCode + Pencil 扩展**：Pencil MCP 服务器是 VSCode 扩展的一部分，必须安装
2. **Anthropic API Key**：需要有效的 Claude API 密钥
3. **Node.js ≥ 20**

### 9.2 最小移植范围

如果只需要 Agent 核心能力（提示词 → 设计稿），最小移植范围：

```
localdesign-server/src/
├── config.ts            # 环境变量（可简化）
├── agent/
│   ├── runtime.ts       # Agent 核心循环（必须）
│   └── pencilClient.ts  # Pencil MCP 客户端（必须）
```

加上系统提示词文件：
```
localdesign-web/public/Claude-Design-Sys-Prompt.txt
```

### 9.3 关键配置项

```env
ANTHROPIC_API_KEY=sk-ant-...          # 必填
ANTHROPIC_BASE_URL=                    # 可选，API 代理地址
CLAUDE_MODEL=claude-sonnet-4-6        # 模型选择
AGENT_MAX_TURNS=25                     # 最大工具循环轮数
PENCIL_BIN=                            # 可选，手动指定 MCP 二进制路径
```

### 9.4 移植注意事项

1. **Pencil MCP 需要 VSCode 窗口活跃**：导出 PNG 时需要 VSCode 编辑器处于前台，否则可能导出空白图片

2. **`.pen` 文件是加密格式**：只能通过 MCP 工具读写，不能直接用文件 I/O 操作

3. **工具描述脱敏**：如果使用第三方 API 代理（如 OpenRouter），需要对工具描述中的 "Pencil" 等关键词进行替换，否则可能被过滤

4. **模板文件**：新建设计时需要从 Pencil 扩展目录复制空白模板 `pencil-new.pen`

5. **对话历史**：增量编辑依赖持久化的对话历史，需要有存储机制

6. **AbortController**：停止生成功能依赖 AbortController 中断 fetch 请求

### 9.5 集成步骤

1. 安装 VSCode + Pencil 扩展
2. 复制 `agent/runtime.ts` 和 `agent/pencilClient.ts`
3. 复制系统提示词文件
4. 配置环境变量
5. 实现调用入口（可以是 REST API、CLI、或直接函数调用）
6. 实现文件存储（.pen / .png 的存放目录）
7. 实现状态管理（至少需要跟踪 pending/running/done/error）

### 9.6 最简调用示例

```typescript
import { createPencilSession } from './agent/pencilClient';
import { runAgent } from './agent/runtime';

const designId = crypto.randomUUID();
const penPath = `/path/to/output/${designId}.pen`;

const result = await runAgent({
  prompt: '设计一个移动端登录页面',
  designId,
  penPath,
  outputDir: '/path/to/output',
  useSystemPrompt: true,
  onEvent: (event) => console.log(event),
  signal: new AbortController().signal,
});

console.log(result.pngPath); // 导出的 PNG 路径
```

---

## 十、Pencil MCP 工具参考

### 工具调用格式（Claude tool_use）

```json
{
  "type": "tool_use",
  "id": "toolu_xxx",
  "name": "open_document",
  "input": {
    "path": "/absolute/path/to/file.pen"
  }
}
```

### 常用工具参数

#### open_document
```json
{ "path": "/absolute/path/to/file.pen" }
```

#### get_editor_state
```json
{ "include_schema": true }
```

#### batch_design
```json
{
  "filePath": "/path/to/file.pen",
  "input": "rootFrame=I(document, {type:\"frame\", name:\"Mobile App\", width:390, height:844, fill:\"#FFFFFF\"})"
}
```

#### export_nodes
```json
{
  "filePath": "/path/to/file.pen",
  "nodeIds": ["node-id-1"],
  "outputDir": "/path/to/output",
  "format": "png",
  "scale": 2
}
```

#### batch_get
```json
{
  "filePath": "/path/to/file.pen",
  "readDepth": 3
}
```

---

## 十一、已知限制

1. Pencil MCP 是 VSCode 扩展的一部分，无法脱离 VSCode 独立运行
2. PNG 导出依赖 VSCode 渲染引擎，无头环境下可能失败
3. `.pen` 文件格式私有且加密，无法自行解析
4. 单次生成最多 25 轮工具调用（可配置）
5. 系统提示词 + 工具定义占用大量 token，建议使用 16K+ max_tokens
6. 并发生成时每个任务独占一个 MCP 子进程

---

## 十二、项目目录结构（完整）

```
localdesign/
├── package.json                    # monorepo 根配置
├── scripts/dev.mjs                 # 并发启动脚本
├── uiStore/                        # .pen/.png 文件存储
├── docs/                           # 文档
│   └── localdesign-技术移植文档.md  # 本文档
├── localdesign-server/
│   ├── package.json
│   └── src/
│       ├── main.ts                 # Fastify 入口
│       ├── config.ts               # 配置
│       ├── db/index.ts             # SQLite 数据层
│       ├── routes/designs.ts       # REST + SSE 路由
│       └── agent/
│           ├── runtime.ts          # Agent 核心循环
│           └── pencilClient.ts     # Pencil MCP 客户端
├── localdesign-web/
│   ├── package.json
│   ├── vite.config.ts
│   ├── public/
│   │   └── Claude-Design-Sys-Prompt.txt  # 基础系统提示词
│   └── src/
│       ├── App.tsx                 # 路由配置
│       ├── pages/
│       │   ├── HomePage.tsx        # 首页（输入提示词）
│       │   └── ProgressPage.tsx    # 进度页（SSE + 预览）
│       ├── lib/sse.ts              # SSE 封装
│       └── data/prompts.ts         # 快捷提示词库
└── localdesign-exporter/
    ├── package.json
    └── src/
        ├── index.ts                # 导出入口
        ├── types.ts                # 节点类型定义
        ├── normalize.ts            # 原始节点 → 标准节点
        └── html.ts                 # 节点 → HTML
```
