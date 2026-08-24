// 右面板外壳：收起 / 侧开(~420px) / 全屏 三态
// 展开默认显示入口卡片页；选中后顶部出现标签栏 + Browser/Files/部署 内容
import type { CSSProperties } from "react";
import type { ClientEvent } from "@lenovo/agent-protocol";
import { useAppStore } from "../store/useAppStore";
import { useWorkbenchStore } from "./store";
import { useRightPanelResize } from "../hooks/useRightPanelResize";
import { EntryCards } from "./EntryCards";
import { WorkbenchTabBar } from "./WorkbenchTabBar";
import { FilesTab } from "./FilesTab";
import { AutoDeployPanel } from "./deploy/AutoDeployPanel";
import { BrowserTab } from "./browser/BrowserTab";
import { ReviewTab } from "./review/ReviewTab";
import type { WorkbenchTab, WorkbenchTabId } from "./types";

interface Props {
  sendEvent: (event: ClientEvent) => void;
  workDir: string; // 当前会话的工作目录，由 Shell 从 session 算好传入
}

export function Workbench({ sendEvent, workDir }: Props) {
  const rightPanelOpen = useWorkbenchStore((s) => s.rightPanelOpen);
  const setRightPanelOpen = useWorkbenchStore((s) => s.setRightPanelOpen);
  const tabs = useWorkbenchStore((s) => s.workbenchTabs);
  const activeTab = useWorkbenchStore((s) => s.workbenchTab);
  const openTab = useWorkbenchStore((s) => s.openWorkbenchTab);
  const closeTab = useWorkbenchStore((s) => s.closeWorkbenchTab);
  const setTab = useWorkbenchStore((s) => s.setWorkbenchTab);
  const fullscreen = useWorkbenchStore((s) => s.workbenchFullscreen);
  const setFullscreen = useWorkbenchStore((s) => s.setWorkbenchFullscreen);

  // 步骤清单已迁至 composer 上方的 StepStatusLine（唯一入口），右面板不再派生注入 tasks 标签。
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const displayTabs: WorkbenchTabId[] = tabs;
  // 有效激活标签：activeTab 不在 displayTabs 时落回首个可用，避免空白。
  const effectiveActiveTab: WorkbenchTab =
    activeTab && displayTabs.includes(activeTab as WorkbenchTabId)
      ? activeTab
      : (displayTabs[0] ?? null);

  const { rightPanelWidth, isDragging, handlePanelDragStart } = useRightPanelResize(
    () => setRightPanelOpen(false)
  );

  // 收起时外层宽度过渡到 0；全屏时 flex-1 占满。内层固定宽度绝对贴右，
  // 使收起动画表现为内容从右向左被裁切滑出，而非压缩重排。
  const collapsed = !rightPanelOpen && !fullscreen;
  const outerStyle: CSSProperties = fullscreen
    ? {}
    : {
        width: rightPanelOpen ? `${rightPanelWidth}px` : "0px",
        minWidth: rightPanelOpen ? "280px" : "0px",
        transition: isDragging ? "none" : "width 260ms ease, min-width 260ms ease",
      };

  return (
    <div
      className={`relative flex shrink-0 flex-col overflow-hidden bg-bg-000 ${
        fullscreen
          ? "flex-1 rounded-l-2xl border-l border-y border-border-200"
          : collapsed
            ? ""
            : "border-l border-t border-border-300"
      }`}
      style={outerStyle}
    >
      {/* 内层：固定宽度，绝对贴右，保证收起时不重排 */}
      <div
        className="flex h-full flex-col"
        style={fullscreen ? { width: "100%" } : { position: "absolute", top: 0, right: 0, bottom: 0, width: `${rightPanelWidth}px`, minWidth: "280px" }}
      >
      {/* 拖拽手柄 */}
      {!fullscreen && rightPanelOpen && (
        <div
          onMouseDown={handlePanelDragStart}
          className="absolute left-0 top-0 z-10 flex h-full w-1.5 cursor-col-resize justify-center group"
        >
          <div className="h-full w-px bg-transparent transition-colors group-hover:bg-accent-brand/60" />
        </div>
      )}

      <WorkbenchTabBar
        tabs={displayTabs}
        activeTab={effectiveActiveTab}
        fullscreen={fullscreen}
        onSelectTab={setTab}
        onOpenTab={openTab}
        onCloseTab={closeTab}
        onToggleFullscreen={() => setFullscreen(!fullscreen)}
      />

      <div className="relative flex flex-1 flex-col overflow-hidden">
        {/* 无标签时显示入口卡片 */}
        {displayTabs.length === 0 && <EntryCards onOpen={openTab} />}
        {/* 已打开的标签全部保持挂载，用 hidden 控制可见，避免浏览器页面被卸载重载 */}
        {displayTabs.map((id) => (
          <div key={id} className={`flex flex-1 flex-col overflow-hidden ${id === effectiveActiveTab ? "" : "hidden"}`}>
            {/* 浏览器按会话 key，切换会话时重新挂载，重置已加载的网页 */}
            {id === "browser" && <BrowserTab key={activeSessionId ?? "__none__"} workDir={workDir} sendEvent={sendEvent} />}
            {id === "files" && <FilesTab workDir={workDir} sendEvent={sendEvent} />}
            {id === "review" && <ReviewTab workDir={workDir} />}
            {id === "deploy" && (
              <div className="flex-1 overflow-y-auto p-3">
                {/* key=会话ID：切走即卸载（断订阅、停展示），切回重建并自动恢复进度 */}
                <div className="rounded-lg border border-border-200">
                  <AutoDeployPanel key={activeSessionId ?? "none"} workDir={workDir} sessionId={activeSessionId ?? ""} />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
