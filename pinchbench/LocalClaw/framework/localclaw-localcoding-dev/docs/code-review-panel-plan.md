# 代码审查面板 + 汇总卡片 + 整轮撤销 实现方案

## 需求（对应参考图）
- **1.png**：对话流里出现「已编辑 N 个文件 +X -Y」汇总卡片，右侧「撤销 ↩」「审核」两个按钮，下方列出被编辑文件及各自 +/-。
- **2.png**：点「审核」→ 打开右侧 workbench 的 review 面板。顶栏左侧「上一轮 ▾」版本选择器 + 统计，右侧只保留「收起弹出」按钮。文件列表=被编辑文件；点文件展示 side-by-side diff，未变更行折叠成「N unmodified lines」灰条可展开。
- **3.png**：「上一轮 ▾」弹出菜单（未暂存/已暂存/提交/分支/上一轮），仅「上一轮」可用并打勾，其余项渲染但点击不实现。
- **4.png**：非 git 仓库时点撤销 → 弹「撤销需要使用 Git 代码仓库」错误框，不执行。
- **5.png**：撤销后卡片变「重新应用 ↻」，可切回。撤销/重新应用是可逆 toggle。

## 已确认的关键决策
1. 汇总卡片粒度：**每轮 assistant 回复后一个**，聚合该轮的 Edit/Write/MultiEdit。
2. 「上一轮」数据 = **本会话工具调用累计 diff**（`ToolDiffService.buildSessionDiff`）。
3. 撤销范围：**整轮一起撤销**，可逆（撤销↔重新应用）。
4. 撤销**依赖 git**：非 git 仓库不允许（4.png）。
5. 撤销锚点：**撤销那一刻用 git 记录** —— before = `git show HEAD:<file>`，after = 撤销前的磁盘内容快照。
   语义后果已接受：恢复到 HEAD 而非"本轮前"，若文件有本轮之外的未提交改动会一并回退。
6. 折叠未变更行：**默认折叠，显示「N unmodified lines」条，可点击展开**。

## 现有地基（复用，不重写）
- `ToolDiffService.buildSessionDiff(sessionId)`：从会话 Write/Edit/MultiEdit 重建 FileDiff[]（带 oldContent/newContent/hunks/linesAdded/linesRemoved/opCount/modifiedAt）。**已存在，未从包根导出**。
- `ReviewTab` / `ReviewDiff` / `ReviewSource` / `ReviewMenu` / `SplitFileLayout`：review 面板骨架齐全。
- `reviewDiffModel.buildFullSideBySide`：已生成 side-by-side 行（含 context 行），只差"折叠 context"。
- `workbenchStore.openWorkbenchTab("review")` + `setRightPanelOpen(true)`：打开面板动作现成。
- `EditToolUI` 的 `lineDiff.ts`（本次前序工作已建）：逐行 LCS。

## 分阶段实现

### 阶段 1：后端 —— 会话累计 diff 端点改造 + 撤销/重做能力
**1a. 新增「本会话工具累计 diff」端点**
- SDK：在 `index.ts` 以 `/** @internal */` 导出 `ToolDiffService`（仿 `FileChangeService` 先例）。
- server：`session.controller.ts` 注入 `ToolDiffService`，新增 `GET /sessions/:id/session-diff` 返回 `buildSessionDiff` 结果。
  （保留原 `/diff` 走 getWorkingDiff 不动，避免影响其它调用方。）

**1b. 新增撤销/重新应用端点**（新建 `revert.service.ts` 或挂到 workspace 模块）
- `GET /sessions/:id/git-check?cwd=` → 是否 git 仓库（4.png 前置校验）。
- `POST /sessions/:id/revert-round`，body `{ files: string[] }`：
  1. 校验 git 仓库，否则返回 `{ ok:false, reason:"not-git" }`。
  2. 对每个文件：读当前磁盘内容存为 after 快照（返回给前端持有）；`git show HEAD:<file>` 取 before；before 写回磁盘。新建文件（HEAD 无）→ 删除。
  3. 返回 `{ ok:true, snapshots: {path: afterContent}[] }`。
- `POST /sessions/:id/reapply-round`，body `{ snapshots: {path,content}[] }`：把 after 写回磁盘。
- 安全：路径必须在 cwd 内（防越界写），复用现有 path 归一化。

### 阶段 2：前端 —— 对话流汇总卡片（1.png / 5.png）
**注入策略（架构决策）**：不改 `buildThreadMessages`（它是纯数据转换），而是像 `PlanCard` 那样在 **`AssistantMessage` 末尾**按需渲染。
- 新建 `EditSummaryCard.tsx`：一个 assistant 消息渲染完后，扫描该消息的 tool-call parts 里的 Edit/Write/MultiEdit，收集本轮涉及文件；非空则在消息底部渲染汇总卡。
- 数据：文件列表 + 每文件 +/- 从 `apiGetSessionDiff`（session-diff 端点）按 path 匹配取；卡片总计=各文件求和。
- 状态机（per-card，用 sessionId+轮次 key 存在 workbench store 或本地）：`applied ↔ reverted`。
  - applied：显示「撤销 ↩」「审核」→ 点撤销调 revert-round，成功存 after 快照、转 reverted。
  - reverted：显示「重新应用 ↻」「审核」→ 点重新应用调 reapply-round，转 applied。
  - 非 git：点撤销先 git-check，false → 弹 4.png 错误框（复用现有 Dialog）。
- 「审核」按钮：`setRightPanelOpen(true)` + `openWorkbenchTab("review")`，并把 review 数据源切到 session-diff。

### 阶段 3：前端 —— review 面板顶栏 + 折叠（2.png / 3.png）
**3a. 数据源切换**：`ReviewTab` 的 `loadDiffs` 从 `/api/git/diff` 改为 `apiGetSessionDiff`（session-diff 端点），使"上一轮"= 会话累计。
**3b. 顶栏版本选择器**：新建 `ReviewVersionMenu.tsx`（DropdownMenu，仿 ReviewMenu 样式）——「未暂存/已暂存/提交/分支/上一轮」，仅「上一轮」打勾+可用，其余 disabled 占位。左侧显示总 +X -Y（全部文件求和）。接到 SplitFileLayout 的 headerExtra。
**3c. 顶栏右侧**：只保留「收起弹出」按钮（复用 RightPanelToggle 逻辑），其余按钮本次不做。
**3d. 折叠未变更行**：
- `reviewDiffModel` 新增 `foldContext(left,right)`：把连续 >N 行的 context 段折叠为一个 `fold` 行（记录折叠行数与范围），保留变更行附近少量上下文。
- `ReviewDiff` 新增 `fold` 行类型渲染：「N unmodified lines」灰条，点击展开该段（本地 expanded set 控制）。

### 阶段 4：i18n + 验证
- 补 zh/en：`review.summary.editedN` / `revert` / `reapply` / `needGitRepo` / `unmodifiedLines` / 版本菜单各项等。
- typecheck（client + server + sdk）；跑现有 tool-diff / git service 单测；给 revert.service 补最小单测（git 仓库回滚 + 非 git 拒绝 + 越界拒绝）。
- 前端构建产物验证。

## 风险与取舍
- **撤销语义**：HEAD 锚点，本轮外未提交改动会连带回退（已接受）。
- **Write 覆盖**：由 git 兜底（before 来自 HEAD），不再依赖 buildSessionDiff 的近似 rollback，可靠。
- **轮次 key**：汇总卡片状态需稳定 key（用该 assistant 消息 uuid）。
- **重新应用后再撤销**：after 快照始终持有，可反复 toggle。
