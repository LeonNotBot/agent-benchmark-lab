# 设计模式开关 — 技术设计文档

> 在现有对话框界面下方添加"设计模式"开关，开启后用户输入的提示词将通过 Claude CLI 调用 Pencil MCP 工具，实现 UI 设计生成流程。

## 一、概述

### 目标

为 LocalClaw 添加"设计模式"能力：用户通过一个开关切换，开启后输入自然语言描述即可生成 UI 设计稿（.pen 文件 + PNG 预览），复用现有 Claude CLI Runner 架构。

### 核心约束

- Pencil MCP 已注册在 `~/.localclaw/settings.json` 的 `mcpServers` 中，Claude CLI 启动后天然可用
- 通过 `--append-system-prompt` 注入设计工作流指令（与知识库检索注入方式一致）
- 不引入独立 Agent 循环、不改动 template/skill 机制

---

## 二、架构

```
┌─────────────────────────────────────────────────────────────────┐
│  前端 (React)                                                    │
│  PromptInput 底部工具栏左侧 → DesignModeToggle 组件              │
│  useAppStore.designMode → payload.designMode                     │
└──────────────────────────────┬──────────────────────────────────┘
                               │ WebSocket (ClientEvent)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  后端 (NestJS)                                                   │
│  websocket.gateway.ts → runner-spawn.service.ts                  │
│  buildCliArgs: designMode=true → --append-system-prompt          │
└──────────────────────────────┬──────────────────────────────────┘
                               │ spawn Claude CLI
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Claude CLI                                                      │
│  系统提示词中包含 Pencil MCP 工具使用规范                          │
│  自动调用 pencil MCP 工具 (open_document, batch_design, etc.)     │
└──────────────────────────────┬──────────────────────────────────┘
                               │ stdio
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Pencil MCP Server (已注册)                                      │
│  C:\Users\sunlt3\.pencil\mcp\visual_studio_code\out\             │
│  mcp-server-windows-x64.exe                                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、前端实现

### 3.1 Store 扩展

文件：`packages/client/src/store/useAppStore.ts`

新增状态字段：

```typescript
designMode: boolean;          // 设计模式开关状态
setDesignMode: (v: boolean) => void;
```

持久化到 localStorage key `cc-webui:designMode`，默认值 `false`。

### 3.2 DesignModeToggle 组件

位置：底部工具栏左侧（WorkspaceIndicator、ImageButton、QuickPhraseButton 之后）

视觉规格：
- 关闭状态：灰色图标 + "设计" 文字，与其他工具栏按钮风格一致（`text-[11px] text-text-400`）
- 开启状态：品牌色背景高亮（`bg-accent-brand/10 text-accent-brand`），图标为画笔/调色板
- 点击切换状态，带 transition 动画

### 3.3 事件 payload 扩展

`session.start` 和 `session.continue` 的 payload 中新增 `designMode?: boolean` 字段。

文件：`packages/shared/src/types.ts`

```typescript
// ClientEvent session.start payload
{ title: string; prompt: string; cwd?: string; ...; designMode?: boolean }

// ClientEvent session.continue payload
{ sessionId: string; prompt: string; ...; designMode?: boolean }
```

### 3.4 PromptInput 修改

文件：`packages/client/src/components/PromptInput.tsx`

- `usePromptActions` hook 中读取 `designMode`，在 `handleSend` 时将其加入 payload
- 底部工具栏左侧 div 中添加 `<DesignModeToggle />`

---

## 四、后端实现

### 4.1 WebSocket Gateway

文件：`packages/server/src/modules/websocket/websocket.gateway.ts`

- `onSessionStart` 和 `onSessionContinue` 中提取 `payload.designMode`
- 传递给 `startRunner` 调用

### 4.2 Runner 接口扩展

文件：`packages/server/src/modules/runner/runner-query.service.ts`

`RunnerOptions` 接口新增：

```typescript
designMode?: boolean;
```

### 4.3 Runner Spawn Service

文件：`packages/server/src/modules/runner/runner-spawn.service.ts`

`buildCliArgs` 方法新增 `designMode` 参数处理：

```typescript
if (opts.designMode) {
  const instruction = buildDesignModePrompt();
  args.push("--append-system-prompt", instruction);
}
```

### 4.4 设计模式系统提示词

新建文件：`packages/server/src/modules/runner/design-mode-prompt.ts`

导出 `buildDesignModePrompt()` 函数，返回设计工作流指令字符串。

内容参考 LocalDesign 的 `MCP_AGENT_PROMPT`，核心要点：

1. **可用工具列表**：open_document, get_editor_state, batch_get, batch_design, snapshot_layout, get_screenshot, get_variables, set_variables, find_empty_space_on_canvas, search_all_unique_properties, export_nodes
2. **工作流程**：
   - MODE A（新建）：open_document → get_editor_state → get_variables → batch_design → snapshot_layout → export_nodes
   - MODE B（编辑）：open_document → get_editor_state → batch_get → batch_design → snapshot_layout → export_nodes
3. **设计规则**：
   - 根 frame 必须有明确 width/height（移动端 390×844，桌面端 1440×900）
   - 文本节点必须有 fill 颜色
   - 最终步骤强制调用 export_nodes 导出 PNG
4. **输出目录**：使用 session 的 cwd 或默认工作空间下的 `uiDesigns/` 子目录
5. **文件命名**：`<sessionId>.pen` / `<sessionId>.png`

---

## 五、Shared Types 修改

文件：`packages/shared/src/types.ts`

ClientEvent 的 `session.start` 和 `session.continue` payload 类型中添加 `designMode?: boolean`。

---

## 六、文件存储

设计模式生成的文件存放在：

```
<session.cwd>/uiDesigns/
├── <timestamp>.pen      # 设计文件
└── <timestamp>.png      # 导出预览图
```

如果 session 没有 cwd，则使用默认工作空间。

输出目录路径通过系统提示词告知 Claude CLI，由 Claude 在调用 `open_document` 和 `export_nodes` 时使用。

---

## 七、错误处理

| 场景 | 处理方式 |
|------|----------|
| Pencil MCP 未注册 | 系统提示词中包含 fallback 说明，Claude 会在文本中告知用户需要安装 Pencil 扩展 |
| VSCode 未打开 | Pencil MCP 工具调用失败，Claude CLI 会将错误信息返回给用户 |
| 导出 PNG 失败 | Claude 会在对话中报告错误，用户可重试 |
| 设计模式 + 知识库同时开启 | 两个 `--append-system-prompt` 参数同时生效，互不冲突 |

---

## 八、涉及文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/shared/src/types.ts` | 修改 | ClientEvent payload 添加 designMode 字段 |
| `packages/client/src/store/useAppStore.ts` | 修改 | 添加 designMode 状态 |
| `packages/client/src/components/PromptInput.tsx` | 修改 | 添加 DesignModeToggle 组件、payload 传递 |
| `packages/server/src/modules/websocket/websocket.gateway.ts` | 修改 | 传递 designMode 给 runner |
| `packages/server/src/modules/runner/runner-query.service.ts` | 修改 | RunnerOptions 添加 designMode |
| `packages/server/src/modules/runner/runner-spawn.service.ts` | 修改 | buildCliArgs 处理 designMode |
| `packages/server/src/modules/runner/design-mode-prompt.ts` | 新建 | 设计模式系统提示词 |

---

## 九、测试计划

1. **开关状态切换**：点击开关，验证视觉状态变化和 localStorage 持久化
2. **payload 传递**：开启设计模式后发送消息，验证 WebSocket 消息中包含 `designMode: true`
3. **系统提示词注入**：验证 CLI spawn 时 args 中包含 `--append-system-prompt` 和设计指令
4. **Pencil MCP 调用**：开启设计模式，输入"设计一个移动端登录页面"，验证 Claude 调用 pencil 工具
5. **关闭状态**：关闭设计模式后发送消息，验证不注入设计提示词
6. **与知识库共存**：同时开启设计模式和知识库，验证两个 append-system-prompt 都生效
7. **多轮对话**：在同一 session 中先关闭后开启设计模式，验证 continue 时正确传递状态
