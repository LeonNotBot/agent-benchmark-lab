# 集成 Open Design 内置设计功能 —— 评估与集成建议

> 目标：评估把 open-design（OD，Apache-2.0）的设计能力吸收进 Local Claw 的可行性与路径，
> 将其扩展为"设计 + 编码 all-in-one"的本地 AI 工作台——用户在同一个聊天框里，既能编码，
> 也能选品牌、选技能、描述需求、即时预览、导出、并直接转成真实代码项目。
>
> 本文是一份评估参考 + 分阶段建议，供团队排期与取舍决策使用。

---

## 背景与关键判断

### 两个项目的契合点
- **两边 skill 都遵循 Claude Code 原生 `SKILL.md` 约定**。Local Claw 底层 spawn claude-cli，
  skill 放 `~/.localclaw/skills/`，CLI 自动扫描加载——**不需要实现执行引擎，只管理文件**。
- OD 的设计能力 90% 装在"文件"里（163 个 skills、150 套 `DESIGN.md`、113 套 design-templates），
  而非引擎里。所以正确姿势是**把 OD 降维成 Local Claw 的"资产 + 品味层"**，让 claude-cli 做唯一执行引擎。

### 架构定位：Local Claw 是 filesystem 模式（非 text_artifact）
OD 文档区分两种执行剖面：
- **filesystem**：CLI agent 有文件工具，直接把 HTML 写进项目目录，daemon 靠文件监听广播变化。
- **text_artifact**：纯文本流（BYOK）无文件工具，只能把工件内联在 `<artifact>` 标签里。

**Local Claw 自带 claude-cli（有文件工具）→ 属于 filesystem 模式**，且现有链路已跑通：
`模型写文件 → 输出「预览文件：/预览地址：」标记 → webview 加载 file:///localhost → file-watch 热重载`。

### 已评估、不建议采用的方向
- **单页 `<artifact>` 流式实时预览**：即让模型把单页 HTML 内联在 `<artifact>` 标签里、逐 token
  流式渲染到沙箱 iframe（OD 的 text_artifact 路径）。
  评估结论：**不建议**。它是 text_artifact 模式的产物，与 Local Claw 的 filesystem 架构相悖。
  claude-cli 写单页 HTML 是一次 `Write` 工具整块到达（非逐 token），若要"逐 token 长出来"，
  必须强制模型改用 `<artifact>` 内联输出，代价（平行 srcdoc 渲染管线 + prompt 改造 +
  写盘与内联并存时的回声去重 + 聊天区源码剥离）远大于收益（预览从"落盘后约 0.5s 出现"提前到"实时"）。
  现有"写盘 + webview + 自动打开预览"已是更强的路径。
- **原地点选编辑 / inspect / palette（OD 的 srcdoc bridge 系列）**：同样强依赖向 srcdoc 注入
  bridge 脚本 + host↔iframe postMessage，与 filesystem 架构相悖。编辑回环更适合走
  "对话里说改哪 → agent 改文件 → 热重载"，而非在预览画布上鼠标点选。

### 护城河提醒
OD 是纯设计工具（产出 HTML 后要交付给外部 Cursor/Codex 继续编码，用户需切应用）。
**Local Claw 的差异化是 all-in-one 闭环**：设计稿 → 同一个 agent 直接落地成真实代码项目，不切窗口。
资源应砸向闭环顺滑度，而非追平 OD 的功能清单。

---

## 现状盘点（已就绪的基础设施）

| 能力 | 状态 | 实现位置 |
|---|---|---|
| claude-cli 底层 agent（有文件工具） | ✅ | `packages/sdk/capability/runner` |
| 右面板 webview 预览（file:// + localhost） | ✅ | `workbench/browser/BrowserTab.tsx` |
| 写完自动打开预览（`预览文件：`/`预览地址：`） | ✅ | `store/slices/sessionHandlers.ts`（maybeAutoPreview）+ `runner/preview-guard.service.ts` |
| file-watch 热重载（增量编辑即时刷新） | ✅ | `BrowserTab.tsx`（workspace.watch） |
| 技能管理 UI + SKILL.md 落盘 | ✅ | `client/skills` + `sdk` skill 模块 |
| Pencil MCP 设计模式（产出 .pen） | ✅（有框架） | `runner/design-mode-prompt.ts` |
| 一键部署 | ✅ | `workbench/deploy` |

**结论：核心渲染/预览/热重载/skill 管理全部就绪。缺的不是渲染管线，是设计"弹药"（skill + DESIGN.md）
和一句保证产出自包含的 prompt。**

---

## 阶段 0：搬资产 + 转码闭环（最快出效果，MVP 起点）

不写核心逻辑，主要是搬文件 + 改 prompt + frontmatter 适配。

| # | 任务 | 工作量 | 效果 |
|---|---|---|---|
| 0.1 | 搬 OD 核心设计 skill（`web-prototype`/`mobile-app`/`dashboard`/`saas-landing` 等）到 `~/.localclaw/skills/`，适配/忽略 OD 的 `od:` frontmatter 扩展字段 | 0.5 天 | Skill 选择器里出现"Web 原型/移动端/仪表盘"等设计技能 |
| 0.2 | 挑 10–20 套品牌 `DESIGN.md`（Stripe/Linear/Vercel/Apple 等）搬进 resources 或 skills | 0.5 天 | 产出具备品牌一致性 |
| 0.3 | `preview-guard.service.ts` 注入规约加一句"设计类 skill 产出的 HTML 自包含（CSS/JS 内联）" | 1h | 保证 HTML 在 webview file:// 下正确渲染 |
| 0.4 | 搬 OD 转码 skill（`od-react-export`/`od-nextjs-export`/`od-vue-export`） | 1 天 | 预览设计稿后，对话说"转成 Next.js"→ 同一 claude-cli 拆组件写进项目 |

**验证**：选设计 skill → "做一个 Stripe 风格 SaaS 落地页" → 右面板 webview 自动渲染 →
"转成 Next.js 代码" → 同一会话产出项目 → 自动启 dev server 预览。**全程一个窗口。**

许可：OD 为 Apache-2.0，移植保留归属注释；个别打包 skill（如 guizang-ppt 为 MIT）保留其 LICENSE。

---

## 阶段 1：必做（补齐 MVP 完整闭环，不做会明显残缺）

| # | 任务 | 工作量 | 收益 |
|---|---|---|---|
| 1.1 | **设计系统选择器**：Composer/skill 选择器旁加"设计系统"选择器（仿现有 `ModelChip`），选中后把对应 `DESIGN.md` 作为会话上下文注入（拼 prompt 或作 skill 参数） | 1–2 天 | OD "默认品牌级"的核心。没有它每次风格漂移，设计功能是半成品 |
| 1.2 | **产出自包含性保障 + 预览可靠性**：prompt 强约束自包含（CSS/JS 内联、图片 data-uri/placeholder），或预览层资源兜底，避免 file:// 下裂图/白屏 | 1 天 | 直接决定"预览能不能看"，体验地基 |
| 1.3 | **导出 HTML/ZIP**：搬 OD `exports.ts` 纯浏览器档（HTML 单文件、ZIP 含 DESIGN-HANDOFF.md）。不依赖 Electron 改造 | 1 天 | 设计工具没导出=残废；ZIP 里的 handoff 正好是转码交付接口 |

**完成后即达 MVP 完整形态**：选品牌 → 选技能 → 描述需求 → 预览 → 导出/转码。

---

## 阶段 2：值得做（提质，按反馈迭代）

| # | 任务 | 工作量 | 收益 |
|---|---|---|---|
| 2.1 | **质量门控（critique/lint）**：搬 OD 五维自评 skill，产出前/后拦截低质设计 | 1–2 天 | AI 设计最大痛点是"看着像但细节垃圾"，能明显提质 |
| 2.2 | **资产同步脚本**：`scripts/sync-design-*` 定期拉取 OD 上游 skill/DESIGN.md 更新 | 1 天 | 长期维护性，短期不急 |
| 2.3 | **Deck/PPT 品类**：搬 deck skill，webview 预览翻页 + 后续 PPTX 导出 | 2–3 天 | 扩品类，看产品是否覆盖"做 PPT" |
| 2.4 | **PDF/PPTX 高保真导出**：依赖 Electron off-screen 渲染改造（复用现有 electron 主进程实现 printToPDF/capturePage） | 3–5 天 | 高保真交付，较重 |

---

## 阶段 3：谨慎评估（收益存疑，需结合产品定位判断）

| # | 任务 | 判断 |
|---|---|---|
| 3.1 | **原地点选编辑 / inspect / palette** | ⚠️ 优先级最低。强依赖向 srcdoc 注入 bridge，与 filesystem 架构相悖。编辑回环建议走"对话改文件 + 热重载"，本项**建议不采用** |
| 3.2 | **图片生成（gpt-image 等）** | ⚠️ 需接外部模型服务，独立大工程。除非产品明确要覆盖，否则不做 |
| 3.3 | **视频 / HyperFrames（HTML→MP4）** | ⚠️ 需 headless Chrome + FFmpeg 渲染管线，投入巨大。看产品野心 |

---

## 优先级速览

```
阶段 0（起点）        阶段 1（必做/地基）      阶段 2（提质）           阶段 3（谨慎）
─────────────        ──────────────────      ─────────────           ─────────────
搬设计 skill      →   设计系统选择器       →   质量门控 critique     →  原地点选编辑(架构相悖,建议不采用)
搬 DESIGN.md      →   自包含性保障         →   资产同步脚本          →  图片生成(大工程)
自包含 prompt     →   HTML/ZIP 导出        →   Deck/PPT 品类         →  视频/HyperFrames(大工程)
搬转码 skill                                    PDF/PPTX 导出
```

## 整体建议
1. **先做阶段 0 + 阶段 1**，即得完整闭环 MVP：选品牌→选技能→需求→预览→导出/转码。
2. 阶段 2 按用户反馈迭代。
3. 阶段 3 中原地编辑建议不采用；图片/视频看产品定位。
4. **避免陷入"OD 有的都要有"**。护城河是 all-in-one 闭环（设计稿→同一 agent 落地真实代码），
   资源砸向闭环顺滑度，而非追平 OD 功能清单。

---

## 关键文件索引（Local Claw 侧）

| 主题 | 文件 |
|---|---|
| 预览自动打开逻辑 | `packages/client/src/store/slices/sessionHandlers.ts`（maybeAutoPreview） |
| CLAUDE.md 预览规约注入 | `packages/sdk/src/capability/runner/preview-guard.service.ts` |
| 设计模式 prompt | `packages/sdk/src/capability/runner/design-mode-prompt.ts` |
| webview 预览 + 热重载 | `packages/client/src/workbench/browser/BrowserTab.tsx` |
| 右面板壳 / 标签 | `packages/client/src/workbench/Workbench.tsx`、`types.ts`、`store/workbenchSlice.ts` |
| 模型选择器（选择器 UX 参考） | `packages/client/src/thread/ModelChip.tsx`、`ModeChip.tsx` |
| skill 管理 | `packages/client/src/skills`、`packages/sdk` skill 模块 |
| 部署 | `packages/client/src/workbench/deploy` |

## 参考（OD 侧可移植资产）
| 资产 | OD 路径 |
|---|---|
| 设计 skill | `skills/`、`design-templates/` |
| 品牌设计系统 | `design-systems/<brand>/DESIGN.md` |
| 转码 scenario | `plugins/_official/scenarios/od-{react,nextjs,vue}-export/` |
| 纯浏览器导出（HTML/ZIP/handoff） | `apps/web/src/runtime/exports.ts` |
| 质量门控 | `design-templates/critique/`、`apps/daemon/src/lint-artifact.ts` |
