# Single Conversation PDF Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为当前打开的单个 chat 会话提供一键导出 PDF 的能力，直接下载文件，并只保留适合人阅读的对话正文。

**Architecture:** 前端从当前 active session 的消息数组构建一个导出专用 transcript view model，过滤掉工具输出和执行痕迹，再通过独立的 PDF transcript 组件渲染到隐藏容器。导出动作由 App 中的按钮触发，调用客户端 PDF 生成工具把该容器转换为 PDF 并下载，同时通过现有 toast 反馈结果。

**Tech Stack:** React 19 + TypeScript, react-dom/server-style rendering patterns, html2canvas, jsPDF, node:test, existing Toast + i18n infrastructure

---

## 文件变更清单

### 新建文件
- `packages/client/src/export/conversation-export.ts` — 过滤当前会话消息，生成导出 transcript entries，并负责 PDF 文件名生成
- `packages/client/src/export/conversation-export.test.ts` — 覆盖消息过滤、附件保留与 PDF 文件名生成的纯逻辑测试
- `packages/client/src/export/generate-pdf.ts` — 将指定 DOM 容器导出为多页 PDF 并触发下载
- `packages/client/src/components/ConversationPdfDocument.tsx` — PDF 专用 transcript 渲染组件，只负责可打印内容
- `packages/client/src/components/ConversationPdfDocument.test.tsx` — 服务端静态渲染测试，验证导出组件输出结构

### 修改文件
- `packages/client/package.json` — 添加 `html2canvas` 和 `jspdf` 依赖
- `packages/client/src/App.tsx` — 增加“导出 PDF”按钮、导出状态、隐藏导出容器和点击处理逻辑
- `packages/client/src/i18n/locales.ts` — 新增 PDF 导出按钮与 toast 文案，修正导出成功文案避免复用 zip 描述

---

## Task 1: 导出 view model 与文件名逻辑

**Files:**
- Create: `packages/client/src/export/conversation-export.ts`
- Create: `packages/client/src/export/conversation-export.test.ts`

- [ ] **Step 1: 先写失败测试，锁定导出边界**

创建 `packages/client/src/export/conversation-export.test.ts`：

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import type { StreamMessage } from "@local-claw/shared/src/types";
import {
  buildConversationExportEntries,
  buildConversationPdfFilename,
} from "./conversation-export.js";

test("buildConversationExportEntries keeps user prompts and assistant final text only", () => {
  const messages = [
    {
      type: "user_prompt",
      prompt: "请总结下面内容",
      attachments: [
        { name: "arch.png", mimeType: "image/png", base64: "abc", size: 12 },
        { name: "prd.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", base64: "def", size: 34 },
      ],
    },
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "internal" },
          { type: "text", text: "## 总结\n\n这是最终答复。" },
          { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "README.md" } },
        ],
      },
    },
    {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", content: "hidden" }],
      },
    },
  ] as StreamMessage[];

  const entries = buildConversationExportEntries(messages);

  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.role, "user");
  assert.equal(entries[1]?.role, "assistant");
  assert.match(entries[1]?.markdown ?? "", /最终答复/);
  assert.equal(entries[0]?.attachments?.[0]?.kind, "image");
  assert.equal(entries[0]?.attachments?.[1]?.kind, "file");
});

test("buildConversationPdfFilename sanitizes title and falls back safely", () => {
  assert.equal(
    buildConversationPdfFilename("需求分析/主链路", new Date("2026-05-19T08:00:00Z")),
    "需求分析-主链路-2026-05-19.pdf",
  );

  assert.equal(
    buildConversationPdfFilename("   ", new Date("2026-05-19T08:00:00Z")),
    "session-2026-05-19.pdf",
  );
});
```

- [ ] **Step 2: 跑测试，确认先红灯**

Run:

```powershell
pnpm exec tsc --pretty false --module nodenext --target es2022 --moduleResolution nodenext --outDir .tmp-tests packages/client/src/export/conversation-export.test.ts
```

Expected: FAIL，提示 `./conversation-export.js` 不存在。

- [ ] **Step 3: 写最小实现，让过滤与文件名逻辑可用**

创建 `packages/client/src/export/conversation-export.ts`：

```typescript
import type { Attachment, StreamMessage } from "@local-claw/shared/src/types";

export type ConversationExportAttachment = {
  kind: "image" | "file";
  name: string;
  mimeType: string;
  base64?: string;
};

export type ConversationExportEntry = {
  role: "user" | "assistant";
  markdown: string;
  attachments?: ConversationExportAttachment[];
};

function toExportAttachment(attachment: Attachment): ConversationExportAttachment {
  return attachment.mimeType.startsWith("image/")
    ? { kind: "image", name: attachment.name, mimeType: attachment.mimeType, base64: attachment.base64 }
    : { kind: "file", name: attachment.name, mimeType: attachment.mimeType };
}

function normalizeAssistantText(content: Array<Record<string, unknown>>): string {
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text ?? ""))
    .filter(Boolean)
    .join("\n\n");
}

function formatDateLabel(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function sanitizeTitle(title: string): string {
  return title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/^[-\s]+|[-\s]+$/g, "");
}

export function buildConversationExportEntries(messages: StreamMessage[]): ConversationExportEntry[] {
  const entries: ConversationExportEntry[] = [];

  for (const message of messages) {
    if (message.type === "user_prompt") {
      entries.push({
        role: "user",
        markdown: message.prompt,
        attachments: (message.attachments ?? []).map(toExportAttachment),
      });
      continue;
    }

    if (message.type === "assistant" && Array.isArray(message.message.content)) {
      const markdown = normalizeAssistantText(message.message.content as Array<Record<string, unknown>>);
      if (markdown.trim()) {
        entries.push({ role: "assistant", markdown });
      }
    }
  }

  return entries;
}

export function buildConversationPdfFilename(title: string | undefined, now = new Date()): string {
  const safeTitle = sanitizeTitle(title ?? "") || "session";
  return `${safeTitle}-${formatDateLabel(now)}.pdf`;
}
```

- [ ] **Step 4: 再跑测试，确认转绿**

Run:

```powershell
pnpm exec tsc --pretty false --module nodenext --target es2022 --moduleResolution nodenext --outDir .tmp-tests packages/client/src/export/conversation-export.ts packages/client/src/export/conversation-export.test.ts
node --test .tmp-tests/conversation-export.test.js
```

Expected: PASS，2 个测试通过。

- [ ] **Step 5: 提交这一小步**

```powershell
git add packages/client/src/export/conversation-export.ts packages/client/src/export/conversation-export.test.ts
git commit -m "feat: add conversation pdf export model"
```

## Task 2: PDF transcript 组件

**Files:**
- Create: `packages/client/src/components/ConversationPdfDocument.tsx`
- Create: `packages/client/src/components/ConversationPdfDocument.test.tsx`
- Modify: `packages/client/src/render/markdown.tsx`

- [ ] **Step 1: 先写组件静态渲染测试**

创建 `packages/client/src/components/ConversationPdfDocument.test.tsx`：

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ConversationPdfDocument } from "./ConversationPdfDocument.js";

test("ConversationPdfDocument renders markdown, image previews and file cards", () => {
  const html = renderToStaticMarkup(
    <ConversationPdfDocument
      title="需求分析"
      entries={[
        {
          role: "user",
          markdown: "请看附件",
          attachments: [
            { kind: "image", name: "arch.png", mimeType: "image/png", base64: "abc" },
            { kind: "file", name: "prd.docx", mimeType: "application/docx" },
          ],
        },
        { role: "assistant", markdown: "## 输出\n\n这是最终回复" },
      ]}
    />,
  );

  assert.match(html, /需求分析/);
  assert.match(html, /最终回复/);
  assert.match(html, /data:image\/png;base64,abc/);
  assert.match(html, /prd\.docx/);
});
```

- [ ] **Step 2: 跑测试，确认先红灯**

Run:

```powershell
pnpm exec tsc --pretty false --module nodenext --target es2022 --moduleResolution nodenext --jsx react-jsx --outDir .tmp-tests packages/client/src/components/ConversationPdfDocument.test.tsx
```

Expected: FAIL，提示 `ConversationPdfDocument.js` 不存在。

- [ ] **Step 3: 写 PDF 专用 transcript 组件**

创建 `packages/client/src/components/ConversationPdfDocument.tsx`：

```tsx
import MDContent from "../render/markdown";
import type { ConversationExportEntry } from "../export/conversation-export";

export function ConversationPdfDocument(
  { title, entries }: { title: string; entries: ConversationExportEntry[] },
) {
  return (
    <article className="w-[794px] bg-white px-10 py-12 text-slate-900">
      <header className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-semibold">{title}</h1>
      </header>
      <section className="mt-8 space-y-6">
        {entries.map((entry, index) => (
          <section key={`${entry.role}-${index}`} className="rounded-2xl border border-slate-200 px-5 py-4">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              {entry.role === "user" ? "User" : "Assistant"}
            </div>
            {entry.attachments?.length ? (
              <div className="mt-3 flex flex-wrap gap-3">
                {entry.attachments.map((attachment, attachmentIndex) => (
                  attachment.kind === "image"
                    ? <img key={attachmentIndex} src={`data:${attachment.mimeType};base64,${attachment.base64}`} className="max-h-64 rounded-xl border border-slate-200" />
                    : <div key={attachmentIndex} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{attachment.name}</div>
                ))}
              </div>
            ) : null}
            <div className="mt-3 text-sm leading-7 text-slate-800">
              <MDContent text={entry.markdown} />
            </div>
          </section>
        ))}
      </section>
    </article>
  );
}
```

在 `packages/client/src/render/markdown.tsx` 的 `components` 中补一组可打印约束，避免 PDF 中表格与代码块撑坏页面：

```tsx
pre: (props) => (
  <pre
    className="mt-3 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-bg-200 p-3 text-sm text-text-200"
    {...props}
  />
),
code: (props) => {
  // 维持现有逻辑，仅保证 block code 在 export 视图里可换行
}
```

- [ ] **Step 4: 再跑测试，确认组件输出转绿**

Run:

```powershell
pnpm exec tsc --pretty false --module nodenext --target es2022 --moduleResolution nodenext --jsx react-jsx --outDir .tmp-tests packages/client/src/render/markdown.tsx packages/client/src/export/conversation-export.ts packages/client/src/components/ConversationPdfDocument.tsx packages/client/src/components/ConversationPdfDocument.test.tsx
node --test .tmp-tests/ConversationPdfDocument.test.js
```

Expected: PASS，组件静态渲染测试通过。

- [ ] **Step 5: 提交这一小步**

```powershell
git add packages/client/src/components/ConversationPdfDocument.tsx packages/client/src/components/ConversationPdfDocument.test.tsx packages/client/src/render/markdown.tsx
git commit -m "feat: add printable conversation transcript"
```

## Task 3: PDF 生成器与 App 集成

**Files:**
- Create: `packages/client/src/export/generate-pdf.ts`
- Modify: `packages/client/package.json`
- Modify: `packages/client/src/App.tsx`
- Modify: `packages/client/src/i18n/locales.ts`

- [ ] **Step 1: 安装 PDF 依赖**

Run:

```powershell
pnpm --filter @local-claw/client add html2canvas jspdf
```

Expected: `packages/client/package.json` 增加依赖项，锁文件自动更新。

- [ ] **Step 2: 写 PDF 生成工具**

创建 `packages/client/src/export/generate-pdf.ts`：

```typescript
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

export async function generatePdfFromElement(element: HTMLElement, filename: string): Promise<void> {
  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
  });

  const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imageWidth = pageWidth;
  const imageHeight = canvas.height * imageWidth / canvas.width;
  const imageData = canvas.toDataURL("image/png");

  let remainingHeight = imageHeight;
  let offsetY = 0;

  pdf.addImage(imageData, "PNG", 0, offsetY, imageWidth, imageHeight);
  remainingHeight -= pageHeight;

  while (remainingHeight > 0) {
    offsetY = remainingHeight - imageHeight;
    pdf.addPage();
    pdf.addImage(imageData, "PNG", 0, offsetY, imageWidth, imageHeight);
    remainingHeight -= pageHeight;
  }

  pdf.save(filename);
}
```

- [ ] **Step 3: 在 App 中接入按钮、隐藏导出容器和点击逻辑**

在 `packages/client/src/App.tsx` 中：

1. 增加导入：

```tsx
import { ConversationPdfDocument } from "./components/ConversationPdfDocument";
import {
  buildConversationExportEntries,
  buildConversationPdfFilename,
} from "./export/conversation-export";
import { generatePdfFromElement } from "./export/generate-pdf";
```

2. 在组件状态区增加：

```tsx
const exportPdfRef = useRef<HTMLDivElement | null>(null);
const [isExportingPdf, setIsExportingPdf] = useState(false);
const exportEntries = activeSession ? buildConversationExportEntries(activeSession.messages) : [];
```

3. 添加点击处理：

```tsx
const handleExportPdf = useCallback(async () => {
  if (!activeSession || !exportPdfRef.current) {
    return;
  }

  const filename = buildConversationPdfFilename(activeSession.title);
  setIsExportingPdf(true);
  try {
    await generatePdfFromElement(exportPdfRef.current, filename);
    showToast("success", t("toast.exportedPdf", { name: filename }));
  } catch (error) {
    console.error(error);
    showToast("error", t("toast.exportPdfFail", { name: filename }));
  } finally {
    setIsExportingPdf(false);
  }
}, [activeSession, t]);
```

4. 在当前会话顶部按钮区加入导出按钮：

```tsx
<button
  onClick={() => { void handleExportPdf(); }}
  disabled={isExportingPdf || exportEntries.length === 0}
  className="rounded-md border border-border-300 bg-white px-3 py-1.5 text-xs text-text-200 hover:bg-bg-200 disabled:cursor-not-allowed disabled:opacity-50"
>
  {isExportingPdf ? t("app.exportingPdf") : t("app.exportPdf")}
</button>
```

5. 在主界面末尾放置隐藏导出容器：

```tsx
<div className="pointer-events-none fixed -left-[99999px] top-0 opacity-0">
  <div ref={exportPdfRef}>
    <ConversationPdfDocument
      title={activeSession?.title || "session"}
      entries={exportEntries}
    />
  </div>
</div>
```

- [ ] **Step 4: 更新中英文文案**

在 `packages/client/src/i18n/locales.ts` 增加：

```typescript
"app.exportPdf": "导出 PDF",
"app.exportingPdf": "导出中...",
"toast.exportPdfFail": "导出 PDF 失败: {name}",
"toast.exportedPdf": "已导出 PDF: {name}",
```

对应英文：

```typescript
"app.exportPdf": "Export PDF",
"app.exportingPdf": "Exporting...",
"toast.exportPdfFail": "PDF export failed: {name}",
"toast.exportedPdf": "Exported PDF: {name}",
```

- [ ] **Step 5: 运行构建，确认集成可打包**

Run:

```powershell
pnpm build
```

Expected: PASS，前端构建完成，`dist/` 更新成功。

- [ ] **Step 6: 提交这一小步**

```powershell
git add packages/client/package.json packages/client/src/export/generate-pdf.ts packages/client/src/App.tsx packages/client/src/i18n/locales.ts pnpm-lock.yaml
git commit -m "feat: export single conversation as pdf"
```

## Task 4: 端到端验证与清理

**Files:**
- Modify: `packages/client/src/App.tsx`
- Modify: `packages/client/src/components/ConversationPdfDocument.tsx`
- Modify: `packages/client/src/export/generate-pdf.ts`

- [ ] **Step 1: 运行聚焦验证命令**

Run:

```powershell
pnpm exec tsc --pretty false --module nodenext --target es2022 --moduleResolution nodenext --jsx react-jsx --outDir .tmp-tests packages/client/src/export/conversation-export.ts packages/client/src/export/conversation-export.test.ts packages/client/src/components/ConversationPdfDocument.tsx packages/client/src/components/ConversationPdfDocument.test.tsx
node --test .tmp-tests/conversation-export.test.js .tmp-tests/ConversationPdfDocument.test.js
pnpm build
```

Expected: PASS，测试和构建全部通过。

- [ ] **Step 2: 手动验证单会话 PDF 导出**

在本地开发环境中确认：

```text
1. 打开一个已有 active session
2. 点击“导出 PDF”
3. 浏览器立即下载 .pdf
4. PDF 中包含用户消息、助手最终回复、图片附件预览
5. PDF 中不包含 tool output、查看结果按钮、thinking 状态、输入框与右侧结果面板
```

- [ ] **Step 3: 清理临时测试产物**

Run:

```powershell
if (Test-Path .tmp-tests) { Remove-Item .tmp-tests -Recurse -Force }
```

Expected: `.tmp-tests` 被清理，工作区不残留验证产物。

- [ ] **Step 4: 最终提交**

```powershell
git add packages/client/src/App.tsx packages/client/src/components/ConversationPdfDocument.tsx packages/client/src/export/conversation-export.ts packages/client/src/export/conversation-export.test.ts packages/client/src/export/generate-pdf.ts packages/client/src/components/ConversationPdfDocument.test.tsx packages/client/src/i18n/locales.ts packages/client/package.json pnpm-lock.yaml
git commit -m "feat: support single conversation pdf export"
```

## Self-Review

- Spec coverage: 已覆盖按钮入口、只导出当前会话、过滤工具输出、保留图片附件、非图片附件文件名卡片、客户端 PDF 生成、文件名规则、测试与构建验证。
- Placeholder scan: 计划中的文件、命令、测试代码、依赖名、提交命令均已明确，没有 `TODO` 或泛化描述。
- Type consistency: 导出数据统一使用 `ConversationExportEntry` / `ConversationExportAttachment`，App、组件与 PDF 生成器围绕同一导出模型接线。