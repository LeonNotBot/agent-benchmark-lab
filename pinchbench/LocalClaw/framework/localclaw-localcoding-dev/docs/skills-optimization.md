# Skills 插件模块优化 — 功能对比与实现文档

> 版本：2026-06-19 ｜ 范围：`packages/client` 前端 Skills 模块（功能增强 / 用户体验 / 样式）
> 兼容性：完全沿用现有技术栈（React 19 + TypeScript + Tailwind v4 + Radix UI + Zustand），后端 API 零改动。

## 一、优化总览

本轮优化聚焦前端 Skills 模块，共落地 **3 大类 / 16 项** 改进，全部向后兼容，未改动任何后端接口与数据结构。

| 类别 | 项数 | 关键产出 |
|---|---|---|
| 功能增强 | 6 | 卡片菜单补全（编辑/克隆/导出）、真实排序、启用状态持久化 |
| 用户体验 | 7 | 全局 Toast、错误反馈、加载态、搜索防抖、快捷键、拖拽上传 |
| 样式优化 | 3 | markdown 富渲染、空态重设计、图标与激活色统一 |

## 二、改动文件清单

| 文件 | 改动性质 | 说明 |
|---|---|---|
| `src/skills/SkillManager.tsx` | 重构 | 主面板：菜单/排序/Toast/加载/防抖/快捷键/拖拽/空态 |
| `src/skills/SkillEditor.tsx` | 增强 | 工具选项扩展为 pill 多选、克隆态、Esc 关闭、焦点样式 |
| `src/skills/skillFilter.ts` | 新增 | 纯函数：搜索/过滤/排序逻辑（可测试，组件复用） |
| `src/skills/skillFilter.spec.ts` | 新增 | 10 条单元测试，覆盖搜索/过滤/三种排序 |
| `src/store/slices/skillSlice.ts` | 增强 | 新增 `disabledSkills` + `toggleSkillEnabled`（localStorage 持久化） |
| `src/store/useAppStore.ts` | 接线 | AppState 暴露新 slice 成员 |
| `src/hooks/useAppHandlers.ts` | 增强 | 新增 `handleCloneSkill`；保存增加成功/失败 Toast 与 clone 分支 |
| `src/shell/AppShell.tsx` | 接线 | 传入 `onCloneSkill` |
| `src/i18n/locales.ts` | 增量 | 中英各新增 16 个文案 key |
| `packages/client/package.json` | 增量 | 新增 test / test:watch / typecheck 脚本 |
| `packages/client/tsconfig.json` | 增量 | 排除 spec 文件参与生产类型检查 |

## 三、功能增强（优化前 → 优化后）

### 1. 我的技能卡片操作菜单补全
- **前**：卡片 `⋯` 菜单仅有「启用/停用」「移除」两项；编辑与导出虽在 handler 中实现，但 UI 无入口。
- **后**：菜单扩展为「启用/停用 → 编辑 → 克隆 → 导出 → 移除」五项，打通完整 CRUD 闭环。
- **实现**：`SkillManager.tsx` 卡片 context menu 增加三个按钮，分别调用 `onEditSkill`/`handleClone`/`onExportSkill`。

### 2. 技能克隆
- **前**：无。重复利用一个技能需手动重建。
- **后**：菜单「克隆」→ 拉取详情 → 以 `<name>-copy` 预填新建表单，名称可编辑，保存走 POST。
- **实现**：`handleClone` → `apiGetSkill` → `onCloneSkill`；`useAppHandlers.handleCloneSkill` 注入 `__clone` 标记；
  `SkillEditor` 与 `handleSaveSkill` 据此把克隆视为「新建」而非「编辑」，避免误触发 PUT 覆盖原技能。

### 3. 真实排序
- **前**：`sort` 状态存在但从未参与计算，三个排序选项点了无效果。
- **后**：「推荐」（官方 > 已安装 > 下载量）、「最新」（按 `installedAt`）、「热门」（按 `downloads`）均生效。
- **实现**：逻辑抽离至 `skillFilter.ts#filterAndSortSkills`，组件与测试共用同一实现。

### 4. 启用/停用状态持久化
- **前**：`enabledIds` 仅为组件内 `useState`，刷新即丢失。
- **后**：状态存入 `localStorage(lc:skill-disabled)`，跨会话保留；停用卡片显示「已停用」徽标。
- **实现**：`skillSlice` 新增 `disabledSkills` + `toggleSkillEnabled`，读写 localStorage。
- **说明**：当前为 UI 层标记（后端尚不消费），已为后续「真实禁用」预留状态源，属规划项。

### 5. AI 对话创建占位反馈
- **前**：点击「AI 对话创建」无任何反应（`onSelect={() => {}}`）。
- **后**：点击弹出 warning Toast「功能开发中」，并阻止菜单误关，交互预期明确。

### 6. SkillEditor 工具选项扩展
- **前**：硬编码 7 个工具（Bash/Read/Write/Edit/Grep/Glob/Agent），复选框样式。
- **后**：扩展至 12 个（新增 TodoWrite/WebSearch/WebFetch/NotebookEdit/Skill），改为 pill 多选，与全局激活色统一。

## 四、用户体验优化

| # | 项 | 优化前 | 优化后 |
|---|---|---|---|
| 1 | 错误反馈 | 所有 API `.catch(()=>{})` 静默吞掉 | 列表/市场/安装/移除/克隆/导入全部走 `showToast("error",…)` + `console.error` |
| 2 | 全局 Toast | 自建简陋 toast（纯文本、2s、无类型） | 复用 `components/Toast`，区分 success/error/warning，错误停留 6s |
| 3 | 加载态 | 有 `loading` 状态但无 UI | 市场加载时显示居中旋转指示器 + 文案 |
| 4 | 搜索防抖 | 每次按键即发请求 | `useDeferredValue` 延迟触发市场请求，输入即时反映、请求合并 |
| 5 | 快捷键 | 无 | `Esc` 逐层关闭弹窗/菜单/搜索；`Ctrl/⌘+N` 新建；`Ctrl/⌘+F` 搜索 |
| 6 | 菜单关闭 | 外层监听不可靠，点空白处菜单不消失 | 基于 `data-skill-menu`/`-trigger` 精准判定外部点击，可靠关闭 |
| 7 | 拖拽上传 | 拖拽区点击即触发文件框，不支持真正拖拽 | 支持拖拽 `.zip` 落盘导入 + 拖拽高亮反馈 + 逐文件结果 Toast |

补充：卡片描述区增加 `select-text`，正文可被选中复制，其余区域 `select-none` 不干扰点击进入详情。

## 五、样式优化

### 1. 详情弹窗 Markdown 富渲染
- **前**：手写 `MarkdownPreview`，仅识别 `**加粗**`，代码块/列表/表格/链接全部不支持。
- **后**：复用项目成熟的 `render/markdown.tsx`（`MDContent`），支持 GFM、代码高亮、表格、可点击链接，且自带 LocalClaw 主题色，深浅色一致。
- **收益**：删除 ~40 行重复手写解析逻辑。

### 2. 空态重设计
- **前**：单行灰字「当前筛选条件下暂无技能」。
- **后**：图标 + 标题 + 引导副文案；「我的技能」空态附带「＋ 编写技能」行动按钮，区分市场/本地两种语境。

### 3. 视觉一致性
- 激活/选中态统一：`bg-purple-light2` → `bg-accent-brand/10`（来源筛选、分类、排序、工具 pill、安装态）。
- 修正一批非规范 Tailwind 类（`min-w-[120px]`→`min-w-30`、`w-[500px]`→`w-125` 等），消除 lint 告警。
- 详情弹窗加 `max-w-[92vw]`，窄屏不溢出。

## 六、质量保障

### 单元测试
- 新增 `skillFilter.spec.ts`，10 条用例，全绿：
  - 搜索：名称/描述匹配（大小写不敏感）、无匹配、不可变性（不改入参）。
  - 过滤：按 tag 分类、按 source 来源。
  - 排序：热门（下载量）、最新（时间）、推荐（官方→已安装→下载量）三档。
- 运行：`pnpm --filter @local-claw/client test`（底层 `vitest run --root ../..`）。

### 构建与类型
- `node scripts/build-frontend.cjs` 通过（CSS + JS 打包成功）。
- `tsc --noEmit -p packages/client/tsconfig.json` 0 错误（spec 文件已排除，由 vitest 单独跑）。

## 七、兼容性与后续规划

- **零破坏**：后端 API、`SKILL.md` 格式、protocol 类型均未改动；仅前端新增 props 与 store 字段。
- **响应式**：卡片网格 `grid-cols-1 / md:2 / lg:3` 自适应；弹窗 `max-w` 约束适配窄屏。
- **规划项（需后端配合，本轮未做）**：
  1. AI 对话创建技能 —— 需后端生成接口；当前为占位反馈。
  2. 启用/停用真实生效 —— 需 runner 侧消费 `disabledSkills`；当前为持久化 UI 标记。
  3. 工具选项动态化 —— 需 `GET /api/tools`；当前为扩展后的前端常量。
