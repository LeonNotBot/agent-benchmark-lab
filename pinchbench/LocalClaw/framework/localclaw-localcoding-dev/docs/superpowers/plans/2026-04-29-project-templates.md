# Project Templates System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project template system to Local Claw so users can pick a preset template (CLAUDE.md, skills, initial prompt, routing preference) when creating a new session, and save custom templates.

**Architecture:** File-system storage under `~/.localclaw/templates/{slug}/TEMPLATE.md` with frontmatter+markdown format (mirroring the existing skill system). A new NestJS `TemplateModule` exposes CRUD via WebSocket events. The React frontend adds a `WelcomePage` component rendered when no session is active, plus a `TemplateManager` section inside `SettingsPanel`.

**Tech Stack:** NestJS (server module), React + Zustand (frontend), TypeScript shared types, Tailwind CSS, WebSocket events.

**Spec:** `docs/superpowers/specs/2026-04-29-project-templates-design.md`

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `packages/shared/src/template-types.ts` | Template, TemplateSummary, TemplateCategory types |
| `packages/server/src/modules/template/template.module.ts` | NestJS module registration |
| `packages/server/src/modules/template/template.service.ts` | CRUD + builtin sync + frontmatter parse/serialize |
| `resources/builtin-templates/web-fullstack/TEMPLATE.md` | Built-in template |
| `resources/builtin-templates/data-analysis/TEMPLATE.md` | Built-in template |
| `resources/builtin-templates/tech-writing/TEMPLATE.md` | Built-in template |
| `resources/builtin-templates/ai-development/TEMPLATE.md` | Built-in template |
| `packages/client/src/components/WelcomePage.tsx` | Welcome page with template grid + detail modal |
| `packages/client/src/components/TemplateManager.tsx` | Settings panel section: template list + save form |

### Modified files

| File | Change |
|------|--------|
| `packages/shared/src/types.ts` | Add template events to ServerEvent/ClientEvent unions |
| `packages/server/src/app.module.ts` | Import TemplateModule |
| `packages/server/src/modules/websocket/websocket.module.ts` | Import TemplateModule |
| `packages/server/src/modules/websocket/websocket.gateway.ts` | Inject TemplateService, add template.* event handlers |
| `packages/server/src/main.ts` | Call syncBuiltinTemplates on startup |
| `packages/client/src/store/useAppStore.ts` | Add template state + actions + event handlers |
| `packages/client/src/components/PromptInput.tsx` | Import WelcomePage, render it in centered mode |
| `packages/client/src/components/SettingsPanel.tsx` | Add TemplateManager section |
| `packages/client/src/i18n/locales.ts` | Add zh/en template strings |
| `packages/client/src/App.tsx` | Send template.list on connect |

---

### Task 1: Shared Types

**Files:**
- Create: `packages/shared/src/template-types.ts`
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Create template type definitions**

Create `packages/shared/src/template-types.ts`:

```typescript
export type TemplateCategory = "development" | "writing" | "data" | "devops" | "other";

export interface Template {
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: TemplateCategory;
  routingPreference: "auto" | "cloud" | "local";
  modelOverride?: string;
  skills: string[];
  initialPrompt?: string;
  builtin: boolean;
  claudeMdContent: string;
}

export type TemplateSummary = Omit<Template, "claudeMdContent">;
```

- [ ] **Step 2: Add template events to shared types**

In `packages/shared/src/types.ts`:

1. Add import and re-export at top:
```typescript
import type { Template, TemplateSummary } from "./template-types";
export type { Template, TemplateSummary, TemplateCategory } from "./template-types";
```

2. Add to `ServerEvent` union (after the `skill.error` line):
```typescript
  | { type: "template.list"; payload: { templates: TemplateSummary[] } }
  | { type: "template.detail"; payload: { template: Template } }
  | { type: "template.saved"; payload: { template: TemplateSummary } }
  | { type: "template.deleted"; payload: { slug: string } }
  | { type: "template.error"; payload: { message: string } }
```

3. Add to `ClientEvent` union (after the `skill.install` line):
```typescript
  | { type: "template.list" }
  | { type: "template.detail"; payload: { slug: string } }
  | { type: "template.save"; payload: { template: Omit<Template, "builtin"> } }
  | { type: "template.delete"; payload: { slug: string } }
```

4. Extend `session.start` payload — add `templateSlug?: string` to its payload type.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/template-types.ts packages/shared/src/types.ts
git commit -m "feat(shared): add template types and WebSocket events"
```

---

### Task 2: Built-in Templates

**Files:**
- Create: `resources/builtin-templates/web-fullstack/TEMPLATE.md`
- Create: `resources/builtin-templates/data-analysis/TEMPLATE.md`
- Create: `resources/builtin-templates/tech-writing/TEMPLATE.md`
- Create: `resources/builtin-templates/ai-development/TEMPLATE.md`

- [ ] **Step 1: Create all 4 built-in templates**

Each TEMPLATE.md uses frontmatter + markdown. Example for `web-fullstack`:

```markdown
---
name: "Web 全栈开发"
description: "适用于 React + Node.js 全栈项目的开发模板"
icon: "🌐"
category: "development"
routingPreference: "auto"
modelOverride: ""
skills:
  - brainstorming
  - code-review
initialPrompt: "我正在开发一个全栈 Web 应用，请帮我分析项目结构并提供开发建议。"
builtin: true
---

- 使用 TypeScript 严格模式
- 优先使用函数式组件和 React Hooks
- 后端使用 RESTful API 设计规范
- 代码中使用英文命名，注释可用中文
- 提交前确保 lint 和类型检查通过
- 组件文件使用 PascalCase，工具函数使用 camelCase
```

Create similar files for:
- `data-analysis` (icon: 📊, category: data, routing: cloud, skills: [brainstorming])
- `tech-writing` (icon: ✍️, category: writing, routing: auto, skills: [writing-clearly-and-concisely])
- `ai-development` (icon: 🤖, category: development, routing: cloud, skills: [brainstorming])

Each with domain-specific CLAUDE.md best practices in the markdown body.

- [ ] **Step 2: Commit**

```bash
git add resources/builtin-templates/
git commit -m "feat: add 4 built-in project templates"
```

---

### Task 3: TemplateService (Backend)

**Files:**
- Create: `packages/server/src/modules/template/template.service.ts`
- Create: `packages/server/src/modules/template/template.module.ts`

- [ ] **Step 1: Create TemplateService**

Create `packages/server/src/modules/template/template.service.ts` following the same patterns as `SkillService`:

- `@Injectable()` class with methods:
  - `private get templatesDir()` → `join(homedir(), ".localclaw", "templates")`
  - `private ensureDir()` — mkdirSync if not exists
  - `private parseFrontmatter(raw)` — parse YAML-like frontmatter (handle multi-line `skills:` arrays with `  - item` syntax)
  - `private buildTemplateMd(data)` — serialize Template to frontmatter+markdown
  - `private metaToSummary(slug, meta)` — convert parsed meta to TemplateSummary
  - `listTemplates(): TemplateSummary[]` — scan dirs, parse each TEMPLATE.md frontmatter
  - `getTemplate(slug): Template | null` — read full template including markdown body
  - `saveTemplate(data): TemplateSummary` — write TEMPLATE.md, always sets `builtin: false`
  - `deleteTemplate(slug): boolean` — refuse if builtin, otherwise rmSync
  - `syncBuiltinTemplates(builtinDir): { installed, skipped }` — copy missing templates from bundled dir
  - `applyTemplate(slug, cwd?)` — write claudeMdContent to `{cwd}/.localclaw/CLAUDE.md` (append if exists), return routing/skills/prompt info

- [ ] **Step 2: Create TemplateModule**

Create `packages/server/src/modules/template/template.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { TemplateService } from "./template.service";

@Module({
  providers: [TemplateService],
  exports: [TemplateService],
})
export class TemplateModule {}
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/modules/template/
git commit -m "feat(server): add TemplateService with CRUD and builtin sync"
```

---

### Task 4: Wire Template Module into Server

**Files:**
- Modify: `packages/server/src/app.module.ts`
- Modify: `packages/server/src/modules/websocket/websocket.module.ts`
- Modify: `packages/server/src/modules/websocket/websocket.gateway.ts`
- Modify: `packages/server/src/main.ts`

- [ ] **Step 1: Register TemplateModule in AppModule**

In `packages/server/src/app.module.ts`:
- Import `TemplateModule` from `"./modules/template/template.module"`
- Add to the `imports` array

- [ ] **Step 2: Import TemplateModule in WebsocketModule**

In `packages/server/src/modules/websocket/websocket.module.ts`:
- Import `TemplateModule` from `"../template/template.module"`
- Add to the `imports` array

- [ ] **Step 3: Add template event handlers to WebsocketGateway**

In `packages/server/src/modules/websocket/websocket.gateway.ts`:

1. Import `TemplateService` and inject via `@Inject(TemplateService)` in constructor
2. Add cases to `handleClientEvent` switch:
   - `template.list` → call `onTemplateList()`
   - `template.detail` → call `onTemplateDetail(payload)`
   - `template.save` → call `onTemplateSave(payload)`
   - `template.delete` → call `onTemplateDelete(payload)`
3. Implement 4 handler methods (emit results/errors)
4. In `onSessionStart`, after `createSession()` and before `startRunner()`, if `templateSlug` is present, call `templateService.applyTemplate()` and `routingService.setPreference()` with the result

- [ ] **Step 4: Add builtin template sync to main.ts**

In `packages/server/src/main.ts`, after the builtin-skills block:
- Import `TemplateService`
- Get instance via `app.get(TemplateService)`
- Call `syncBuiltinTemplates()` with resolved builtin-templates dir
- Log results

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/
git commit -m "feat(server): wire TemplateModule into WebSocket gateway and startup"
```

---

### Task 5: i18n Strings

**Files:**
- Modify: `packages/client/src/i18n/locales.ts`

- [ ] **Step 1: Add zh template strings**

Add to the `zh` object:

```typescript
  // Templates
  "template.welcome": "欢迎使用 Local Claw",
  "template.welcomeSubtitle": "选择一个模板快速开始，或直接在下方输入",
  "template.manageTemplates": "管理模板",
  "template.useTemplate": "使用此模板",
  "template.skills": "推荐 Skills",
  "template.claudeMd": "CLAUDE.md 预设",
  "template.initialPrompt": "初始提示词",
  "template.routing": "路由偏好",
  "template.builtin": "内置",
  "template.deleteConfirm": "确定删除模板 \"{name}\"？",
  "template.saveTitle": "保存模板",
  "template.editTitle": "编辑模板",
  "template.slug": "模板 ID",
  "template.name": "显示名称",
  "template.description": "描述",
  "template.icon": "图标",
  "template.category": "分类",
  "template.modelOverride": "模型覆盖",
  "template.claudeMdContent": "CLAUDE.md 内容",
  "template.save": "保存",
  "template.cancel": "取消",
  "template.delete": "删除",
  "template.edit": "编辑",
  "template.noTemplates": "暂无模板",
  "settings.templates": "模板管理",
```

- [ ] **Step 2: Add en template strings**

Add equivalent English entries to the `en` object.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/i18n/locales.ts
git commit -m "feat(i18n): add template-related zh/en translations"
```

---

### Task 6: Frontend State — Zustand Store

**Files:**
- Modify: `packages/client/src/store/useAppStore.ts`

- [ ] **Step 1: Add template state**

1. Add `Template, TemplateSummary` to the import from types
2. Add to `AppState` interface:
```typescript
  templates: TemplateSummary[];
  selectedTemplate: Template | null;
  showTemplateManager: boolean;
```
3. Add actions:
```typescript
  setTemplates: (templates: TemplateSummary[]) => void;
  selectTemplate: (template: Template | null) => void;
  setShowTemplateManager: (show: boolean) => void;
```
4. Add initial values and action implementations in the `create` call
5. Add event handlers in `handleServerEvent` switch for `template.list`, `template.detail`, `template.saved`, `template.deleted`

- [ ] **Step 2: Commit**

```bash
git add packages/client/src/store/useAppStore.ts
git commit -m "feat(store): add template state, actions, and event handlers"
```

---

### Task 7: WelcomePage Component

**Files:**
- Create: `packages/client/src/components/WelcomePage.tsx`
- Modify: `packages/client/src/components/PromptInput.tsx`
- Modify: `packages/client/src/App.tsx`

- [ ] **Step 1: Create WelcomePage component**

Create `packages/client/src/components/WelcomePage.tsx`:

- Props: `{ sendEvent }`
- Reads `templates` from store, sends `template.list` on mount if empty
- Renders: centered welcome heading + subtitle, 3-col grid of template cards (icon + name + description + skill tags), dashed "manage templates" card
- Click card → open detail modal, fetch full template via `template.detail` event
- Detail modal shows: icon, name, description, skills badges, initialPrompt preview, routingPreference, claudeMdContent preview (pre tag), "Use Template" + "Cancel" buttons
- "Use Template" → `setPrompt(initialPrompt)`, send `routing.preference` event, `setSelectedModelOverride()`, close modal
- "Manage Templates" card → `setSettingsPanelOpen(true)`
- Tailwind classes matching existing app style (bg-bg-000, border-border-100/10, text-text-100, etc.)

- [ ] **Step 2: Integrate into PromptInput centered mode**

In `packages/client/src/components/PromptInput.tsx`:
- Import `WelcomePage`
- In the `if (centered)` branch, change `pt-[25%]` to `pt-[8%]` and add `overflow-y-auto`
- Replace `<h2>Local Claw</h2>` heading with `<WelcomePage sendEvent={sendEvent} />`

- [ ] **Step 3: Send template.list on connect**

In `packages/client/src/App.tsx`, in the `useEffect` that fires on `connected`:
- Add `sendEvent({ type: "template.list" } as any);`

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/components/WelcomePage.tsx packages/client/src/components/PromptInput.tsx packages/client/src/App.tsx
git commit -m "feat(client): add WelcomePage with template selection grid"
```

---

### Task 8: TemplateManager Component (Settings Panel)

**Files:**
- Create: `packages/client/src/components/TemplateManager.tsx`
- Modify: `packages/client/src/components/SettingsPanel.tsx`

- [ ] **Step 1: Create TemplateManager component**

Create `packages/client/src/components/TemplateManager.tsx`:

- Renders in SettingsPanel as a section
- Top half: list of existing templates as compact cards
  - Each card: icon + name + description, builtin badge for built-in templates
  - Custom templates show Edit + Delete buttons
  - Delete sends `template.delete` event (with confirm dialog)
  - Edit opens the form pre-filled (fetches full template via `template.detail` for claudeMdContent)
- Bottom half: collapsible "Save New Template" form
  - Fields: slug (text, disabled when editing), name, description, icon, category (select), routingPreference (select), skills (comma-separated), initialPrompt, modelOverride (optional), claudeMdContent (textarea)
  - Save sends `template.save` event
  - Cancel closes the form
- Uses Tailwind classes consistent with other settings sections (same input styling, SectionTitle pattern)

- [ ] **Step 2: Add TemplateManager to SettingsPanel**

In `packages/client/src/components/SettingsPanel.tsx`:
- Import `TemplateManager`
- Add `<Divider />` + `<TemplateManager sendEvent={sendEvent} />` after `<ModelSection>` and before `<AboutSection>`

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/components/TemplateManager.tsx packages/client/src/components/SettingsPanel.tsx
git commit -m "feat(client): add TemplateManager in settings panel"
```

---

### Task 9: Build and Verify

**Files:** None (verification only)

- [ ] **Step 1: Build the server**

```bash
cd /Users/test/Documents/code/local-claw && npm run build:server
```
Expected: Build succeeds with no errors.

- [ ] **Step 2: Build the frontend**

```bash
cd /Users/test/Documents/code/local-claw && npm run build
```
Expected: Build succeeds with no errors.

- [ ] **Step 3: Start and smoke test**

```bash
cd /Users/test/Documents/code/local-claw && npm run start:node
```
Open `http://localhost:10086`. Verify:
1. Welcome page shows template cards when no session is active
2. Clicking a card opens detail modal with template info
3. "Use Template" fills prompt and applies routing preference
4. Settings → Template Management shows list and save form
5. Can create, edit, and delete custom templates

- [ ] **Step 4: Fix any issues and commit**

```bash
git add -A
git commit -m "fix: address build/integration issues for template system"
```
