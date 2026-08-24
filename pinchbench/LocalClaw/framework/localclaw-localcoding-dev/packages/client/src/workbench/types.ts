// 工作台标签：可打开的标签类型（每种类型最多一个），均为项目级标签，用户手动开关。
// 注：步骤/任务清单不再是右面板标签——已迁至 composer 上方的 StepStatusLine（Codex 式当前步骤行）。
export type WorkbenchTabId = "browser" | "files" | "review" | "deploy";

// null = 入口卡片页（无激活标签）
export type WorkbenchTab = WorkbenchTabId | null;

// TAB_LABELS 存 i18n key，渲染时用 t(TAB_LABELS[id]) 解析
export const TAB_LABELS: Record<WorkbenchTabId, string> = {
  browser: "workbench.tabBrowser",
  files: "workbench.tabFiles",
  review: "workbench.tabReview",
  deploy: "workbench.tabDeploy",
};
