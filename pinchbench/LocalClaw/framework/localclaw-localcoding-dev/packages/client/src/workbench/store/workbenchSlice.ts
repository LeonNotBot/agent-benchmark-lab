// Workbench 域的状态切片（从 uiSlice 抽出，S1）。
// 仍挂在全局 useAppStore 上，组件通过 useWorkbenchStore selector 访问。
// 注意：rightPanelTab 属于 legacy 旧右面板，不在此切片，保留在 uiSlice。
import type { WorkbenchTab, WorkbenchTabId } from "../types";

export interface WorkbenchSlice {
  // 右面板「侧开/收起」开关（420px ↔ 0）
  rightPanelOpen: boolean;
  // 已打开的标签列表（有序，每种类型最多一个）
  workbenchTabs: WorkbenchTabId[];
  // 当前激活标签；null = 入口卡片页
  workbenchTab: WorkbenchTab;
  workbenchFullscreen: boolean;
  // 浏览器待加载 URL
  workbenchUrl: string;
  // 「一键部署」请求令牌：单调递增
  deployReqToken: number;

  setRightPanelOpen: (open: boolean) => void;
  openWorkbenchTab: (tab: WorkbenchTabId) => void;
  closeWorkbenchTab: (tab: WorkbenchTabId) => void;
  setWorkbenchTab: (tab: WorkbenchTab) => void;
  setWorkbenchFullscreen: (v: boolean) => void;
  openInBrowser: (url: string) => void;
  clearWorkbenchUrl: () => void;
  requestDeploy: () => void;
}

export function createWorkbenchSlice(set: any): WorkbenchSlice {
  return {
    rightPanelOpen: false,
    workbenchTabs: [],
    workbenchTab: null,
    workbenchFullscreen: false,
    workbenchUrl: "",
    deployReqToken: 0,

    setRightPanelOpen: (rightPanelOpen) => set({ rightPanelOpen }),

    openWorkbenchTab: (tab) =>
      set((s: any) => ({
        workbenchTabs: s.workbenchTabs.includes(tab)
          ? s.workbenchTabs
          : [...s.workbenchTabs, tab],
        workbenchTab: tab,
      })),

    closeWorkbenchTab: (tab) =>
      set((s: any) => {
        const idx = s.workbenchTabs.indexOf(tab);
        if (idx === -1) return {};
        const nextTabs = s.workbenchTabs.filter(
          (t: WorkbenchTabId) => t !== tab,
        );
        let nextActive = s.workbenchTab;
        if (s.workbenchTab === tab) {
          nextActive = nextTabs[idx] ?? nextTabs[idx - 1] ?? null;
        }
        return { workbenchTabs: nextTabs, workbenchTab: nextActive };
      }),

    setWorkbenchTab: (workbenchTab) => set({ workbenchTab }),
    setWorkbenchFullscreen: (workbenchFullscreen) => set({ workbenchFullscreen }),

    openInBrowser: (url) =>
      set((s: any) => ({
        rightPanelOpen: true,
        workbenchTabs: s.workbenchTabs.includes("browser")
          ? s.workbenchTabs
          : [...s.workbenchTabs, "browser"],
        workbenchTab: "browser",
        workbenchUrl: url,
      })),

    clearWorkbenchUrl: () => set({ workbenchUrl: "" }),

    requestDeploy: () =>
      set((s: any) => ({
        rightPanelOpen: true,
        workbenchTabs: s.workbenchTabs.includes("deploy")
          ? s.workbenchTabs
          : [...s.workbenchTabs, "deploy"],
        workbenchTab: "deploy",
        deployReqToken: s.deployReqToken + 1,
      })),
  };
}
