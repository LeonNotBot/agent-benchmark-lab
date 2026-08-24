# assistant-ui 调研报告与 LocalClaw 优化建议

> 调研日期：2026-05-28  
> 调研目标：https://github.com/assistant-ui/assistant-ui  
> 应用场景：LocalClaw AI Coding Agent 界面交互优化

---

## 一、项目核心定位对比

| 维度 | assistant-ui | LocalClaw |
|------|-------------|-----------|
| **定位** | 通用 AI 对话 UI 库 | AI Coding Agent（代码生成+执行） |
| **架构** | 分层设计（适配器→协议→核心） | 扁平化，事件驱动 |
| **状态管理** | LocalRuntime + Zustand | Zustand + 事件卡片 |
| **组件设计** | 原语组合（Primitive） | 事件卡片（EventCard） |

**关键差异**：assistant-ui 是通用的，LocalClaw 是垂直的——需要更专业的代码展示和操作能力。

---

## 二、assistant-ui 核心特性

### 2.1 分层架构

```
┌─────────────────────────────────────────────┐
│         框架适配层 (Framework Adapters)      │
│  react-ai-sdk │ react-langgraph │ react-a2a │
├─────────────────────────────────────────────┤
│         协议层 (Protocol Layer)              │
│     DataStream    │    AssistantTransport    │
├─────────────────────────────────────────────┤
│         核心运行时 (Core Runtimes)            │
│    LocalRuntime    │   ExternalStoreRuntime   │
└─────────────────────────────────────────────┘
```

- **LocalRuntime**：内部维护消息、线程、分支、编辑等状态
- **ExternalStoreRuntime**：将状态管理委托给外部库（Redux、Zustand）
- **DataStream**：统一的消息流协议（文本增量、工具调用）

### 2.2 原语组件体系

| 组件 | 功能 |
|------|------|
| **Thread** | 聊天记录、消息列表、视口状态、建议、输入框 |
| **Message** | 助手/用户回合、消息部分、附件、操作、编辑、分支控制 |
| **MessagePart** | 文本、工具调用、数据部分、推理、来源内容 |
| **Composer** | 提示输入、发送控制、取消、附件 |
| **ChainOfThought** | 渲染推理过程、步骤列表、可折叠展开 |
| **BranchPicker** | 导航重生成响应或消息替代路径 |
| **ActionBar** | 消息操作（复制、编辑、重试、语音、反馈） |

### 2.3 消息部分（MessagePart）结构

```typescript
type MessagePart =
  | { type: "text"; content: string }
  | { type: "tool-call"; id: string; name: string; args: object }
  | { type: "tool-result"; toolCallId: string; result: any }
  | { type: "reasoning"; steps: ReasoningStep[] }
  | { type: "generative-ui"; spec: UIComponentSpec };
```

### 2.4 生成式 UI

将 AI 生成的 JSON spec 直接渲染为 React 组件，通过白名单机制保证安全：

```typescript
const componentsAllowlist = {
  Card: true,
  Button: true,
  Chart: true,
};

function GenerativeUI({ spec }) {
  const Component = componentsAllowlist[spec.type];
  return Component ? <Component {...spec.props} /> : <Fallback />;
}
```

### 2.5 Monorepo 包结构（38 个包）

| 类别 | 包名 | 说明 |
|------|------|------|
| **React 核心** | react | 核心 UI 组件 |
| | react-ai-sdk | Vercel AI SDK 集成 |
| | react-langgraph | LangGraph 集成 |
| **渲染** | react-markdown | Markdown 渲染 |
| | react-syntax-highlighter | 语法高亮 |
| | react-streamdown | 高级流式渲染（Shiki + KaTeX + Mermaid） |
| **工具** | react-devtools | 开发工具 |
| **MCP** | mcp-app-studio | 应用工作室 |

---

## 三、LocalClaw 现状分析

### 3.1 流式消息展示（StreamingMessageArea.tsx）

**现状**：
```tsx
// 只有简单的流式文本 + 光标动画
<MDContent text={partialMessage} streaming={showPartialMessage} />
{showPartialMessage && (
  <span className="inline-block w-2 h-4 bg-accent-brand/60 animate-pulse" />
)}
```

**问题**：
- 流式状态下降级为纯文本（无语法高亮）
- 没有工具调用的实时状态展示
- 没有推理过程的流式展示

### 3.2 代码块展示（markdown.tsx）

**现状**：
- 使用 `rehype-highlight` 做语法高亮
- 流式时降级为 `<pre>` 纯文本
- 没有复制按钮
- 没有文件名/语言标签

### 3.3 工具调用展示（ToolUseCard.tsx）

**现状**：
- 简单的图标 + 工具名 + 参数摘要
- 状态：pending / success / error
- 没有工具调用链的视觉连接

### 3.4 工具结果展示（ToolResultCard.tsx）

**现状**：
- 可折叠的输出展示
- 简单的 Markdown 检测
- 没有 JSON/Diff/SVG 的差异化展示

### 3.5 代码变更展示（ChangesTab.tsx）

**现状（已有）**：
- ✅ Side-by-side diff 展示
- ✅ 行号同步滚动
- ✅ Git 操作（commit、push、add-remote）
- ✅ 文件状态标记（A/M/D）

**缺失**：
- ❌ 快速应用/撤销变更
- ❌ 批量文件操作
- ❌ 文件预览集成
- ❌ 一键部署

---

## 四、优化建议

### 4.1 代码块增强（高优先级）

在 `markdown.tsx` 的 `pre/code` 组件中添加复制按钮和文件名标签：

```tsx
// 增强的 CodeBlock 组件
function CodeBlock({ code, language, filename }) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  return (
    <div className="relative group mt-3 rounded-xl bg-bg-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-bg-300 border-b border-border-200">
        <span className="text-xs text-text-400 font-mono">{filename || language}</span>
        <button 
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-text-400 hover:text-text-200"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-sm">
        <code>{code}</code>
      </pre>
    </div>
  );
}
```

**建议替换 rehype-highlight 为 Shiki**，支持更多语言和主题，且流式时也能高亮。

### 4.2 工具调用链视觉连接（高优先级）

将 ToolUseCard 和 ToolResultCard 在视觉上串联：

```tsx
// 工具调用链组件
function ToolChain({ toolCalls }) {
  return (
    <div className="tool-chain space-y-0.5 border-l-2 border-border-100/20 pl-3 ml-1">
      {toolCalls.map((tool) => (
        <div key={tool.id} className="relative">
          {/* 连接线上的圆点 */}
          <div className="absolute -left-4 top-2 w-2 h-2 rounded-full bg-border-200" />
          <ToolUseCard messageContent={tool} />
          {tool.result && <ToolResult messageContent={tool.result} />}
        </div>
      ))}
    </div>
  );
}
```

### 4.3 智能内容检测（高优先级）

在 `ToolResultCard.tsx` 中增加内容类型检测：

```tsx
type ContentType = "text" | "json" | "diff" | "svg" | "markdown";

function detectContentType(content: string): ContentType {
  if (content.startsWith("{") || content.startsWith("[")) {
    try { JSON.parse(content); return "json"; } catch {}
  }
  if (content.includes("--- a/") && content.includes("+++ b/")) return "diff";
  if (content.trim().startsWith("<svg")) return "svg";
  if (/^#{1,6}\s|```/.test(content)) return "markdown";
  return "text";
}

// 差异化展示
{switch (contentType) {
  case "json": return <JsonViewer data={parsedJson} />;
  case "diff": return <InlineDiff content={content} />;
  case "svg": return <SvgPreview markup={content} />;
  case "markdown": return <MDContent text={content} />;
  default: return <pre>{content}</pre>;
}}
```

### 4.4 文件变更预览（中优先级）

在 `ChangesTab.tsx` 中添加预览功能：

```tsx
// 预览按钮
<button 
  onClick={() => openPreview(diff.path)}
  className="text-xs px-2 py-0.5 rounded border border-border-200 hover:bg-bg-200"
>
  预览
</button>

// 预览面板（iframe 或新窗口）
function FilePreview({ path, sessionId }) {
  return (
    <iframe 
      src={`/api/preview?path=${encodeURIComponent(path)}&session=${sessionId}`}
      className="w-full h-full border-0"
    />
  );
}
```

### 4.5 一键部署（中优先级）

新增 `DeployCard` 组件，集成常见部署平台：

```tsx
function DeployCard({ files, cwd }) {
  const platforms = [
    { name: "Vercel", icon: "▲", url: "https://vercel.com/new" },
    { name: "Netlify", icon: "◆", url: "https://app.netlify.com/start" },
    { name: "GitHub Pages", icon: "⬡", action: deployToGitHubPages },
  ];
  
  return (
    <div className="rounded-xl border border-border-200 p-3 space-y-2">
      <div className="text-xs font-semibold text-text-300">部署到</div>
      <div className="flex gap-2">
        {platforms.map(p => (
          <button key={p.name} onClick={() => p.action?.() || window.open(p.url)}>
            {p.icon} {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}
```

### 4.6 消息聚合（中优先级）

参考 assistant-ui 的 ChainOfThought，将推理过程、工具调用、文本输出分组展示：

```tsx
function MessageGroup({ events }) {
  const reasoning = events.filter(e => e.type === "thinking");
  const toolCalls = events.filter(e => e.type === "tool_use");
  const textBlocks = events.filter(e => e.type === "text");
  
  return (
    <div className="message-group">
      {reasoning.length > 0 && (
        <ThinkingBlock events={reasoning} />  // 可折叠
      )}
      {toolCalls.length > 0 && (
        <ToolChain tools={toolCalls} />  // 串联展示
      )}
      {textBlocks.map(block => (
        <AssistantBlockCard key={block.id} {...block} />
      ))}
    </div>
  );
}
```

### 4.7 版本历史（低优先级）

参考 assistant-ui 的 BranchPicker，记录 AI 操作快照：

```tsx
// 每次重要操作后生成快照
const snapshots = [
  { id: 1, description: "创建了基础结构", files: [...], timestamp: "10:30" },
  { id: 2, description: "添加了样式", files: [...], timestamp: "10:35" },
  { id: 3, description: "修复了 bug", files: [...], timestamp: "10:40" },
];

function VersionHistory({ snapshots, onRestore }) {
  return (
    <div className="version-history">
      {snapshots.map(s => (
        <div key={s.id} className="flex items-center justify-between py-1">
          <span className="text-xs text-text-300">{s.description}</span>
          <button onClick={() => onRestore(s.id)}>恢复</button>
        </div>
      ))}
    </div>
  );
}
```

---

## 五、推荐架构调整

参考 assistant-ui 的分层设计，建议 LocalClaw 增加一个消息聚合层：

```
┌─────────────────────────────────────────────┐
│              UI Layer (EventCard)           │
│  CodeBlock │ ToolChain │ DiffView │ Deploy  │
├─────────────────────────────────────────────┤
│           Message Aggregator                 │
│  聚合 reasoning / tool_calls / results       │
│  智能内容检测 / 消息分组 / 版本快照           │
├─────────────────────────────────────────────┤
│              Tool Executor                    │
│  工具调用状态管理 / 结果缓存 / 错误处理       │
├─────────────────────────────────────────────┤
│           Code Intelligence                   │
│  Diff 计算 / 语法高亮 / 预览 / 部署          │
└─────────────────────────────────────────────┘
```

---

## 六、优先级汇总

| 优先级 | 改进项 | 涉及文件 | 预计工作量 |
|--------|--------|---------|-----------|
| 🔴 高 | 代码块添加复制按钮 + 语言标签 | `markdown.tsx` | 2h |
| 🔴 高 | 工具调用链视觉连接 | `EventCard.tsx` | 3h |
| 🔴 高 | 智能内容检测（JSON/Diff/SVG） | `ToolResultCard.tsx` | 4h |
| 🟡 中 | 文件变更预览（iframe） | `ChangesTab.tsx` | 6h |
| 🟡 中 | 一键部署（Vercel/Netlify） | 新增 `DeployCard.tsx` | 8h |
| 🟡 中 | 消息聚合分组 | `EventCard.tsx` | 5h |
| 🟢 低 | 分支版本历史 | 新增 `VersionHistory.tsx` | 4h |

---

## 七、可直接复用的代码

### 7.1 Shiki 语法高亮替换

```bash
pnpm add shiki
```

```tsx
import { codeToHtml } from "shiki";

async function highlight(code: string, lang: string) {
  return codeToHtml(code, {
    lang,
    theme: "github-dark",
  });
}
```

### 7.2 工具调用状态机

参考 assistant-ui 的 `makeAssistantToolUI` 模式：

```tsx
type ToolState = "streaming" | "pending" | "running" | "success" | "error";

function useToolState(toolId: string): ToolState {
  const status = useToolStatusStore(s => s.statuses[toolId]);
  const isStreaming = useStreamingStore(s => s.activeToolId === toolId);
  if (isStreaming) return "streaming";
  return status ?? "pending";
}
```

### 7.3 消息部分类型定义

参考 assistant-ui 的 MessagePart 结构，扩展 LocalClaw 的事件类型：

```typescript
type LocalClawEvent =
  | { type: "text"; content: string; streaming?: boolean }
  | { type: "thinking"; content: string; collapsed?: boolean }
  | { type: "tool_use"; id: string; name: string; input: object; state: ToolState }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
  | { type: "file_change"; path: string; status: "added" | "modified" | "deleted" }
  | { type: "session_result"; duration_ms: number; cost_usd: number; usage: TokenUsage };
```

---

## 八、参考资源

| 资源 | URL |
|------|-----|
| GitHub | https://github.com/assistant-ui/assistant-ui |
| 官网 | https://www.assistant-ui.com/ |
| 文档 | https://www.assistant-ui.com/docs |
| 工具调用指南 | https://www.assistant-ui.com/docs/guides/tools |
| 生成式 UI | https://www.assistant-ui.com/docs/guides/generative-ui |
| 架构设计 | https://www.assistant-ui.com/docs/runtimes/concepts/architecture |
