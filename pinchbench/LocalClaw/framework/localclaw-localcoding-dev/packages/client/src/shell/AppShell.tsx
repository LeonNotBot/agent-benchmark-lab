import { useCallback, useEffect } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useWebSocket } from "../hooks/useWebSocket";
import { useSessionHistory } from "../hooks/useSessionHistory";
import { useCwdProbe } from "../hooks/useCwdProbe";
import { useQueueFlush } from "../hooks/useQueueFlush";
import { useAppStore } from "../store/useAppStore";
import { useWorkbenchStore } from "../workbench/store";
import { apiListSessions, apiListEndpoints } from "../api";
import { apiListChannels } from "../api/channel";
import { apiListMCPServers } from "../api/mcp";
import { useAuiRuntime } from "../runtime/useAuiRuntime";
import { usePartialStream } from "../runtime/usePartialStream";
import { AuiBridgeProvider } from "../runtime/AuiBridge";
import { EditSummaryProvider } from "../thread/EditSummaryContext";
import { useEditSummaryData } from "../thread/useEditSummaryData";
import { useGlobalScrollbar } from "../hooks/useGlobalScrollbar";
import { useAppFocus } from "../hooks/useAppFocus";
import { useAppHandlers } from "../hooks/useAppHandlers";
import { SettingsContent } from "../settings";
import { EndpointSettingsSection } from "../settings/sections";
import { SkillManager, SkillEditor } from "../skills";
import { AutomationPage } from "../automation";
import { ConnectorsPage } from "../connectors";
import { SearchPanel } from "./SearchPanel";
import { ChannelPanel } from "../channels";
import { SecretsPanel } from "../secrets";
import { PanelSurface } from "./PanelSurface";
import {
  BashToolUI, ReadToolUI, WriteToolUI, EditToolUI,
  GlobToolUI, GrepToolUI, WebFetchToolUI, AskUserQuestionToolUI,
  TaskCreateToolUI, TaskUpdateToolUI, TaskListToolUI, TaskGetToolUI,
} from "../thread/tools";
import { TopBar } from "./TopBar";
import { ThreadSidebar } from "../sidebar";
import { ThreadPane } from "../thread";
import { Workbench } from "../workbench";
import { RightPanelToggle } from "../workbench/RightPanelToggle";
import { ConfirmContainer } from "../components/ConfirmDialog";
import { ToastContainer } from "../components/Toast";
import { workspaceFileEventBus } from "../events/workspaceFileEventBus";
import { forwardServerEvent } from "../vscode/bridge";
import type { ServerEvent } from "@lenovo/agent-protocol";

export default function AppShell() {
  const handleServerEvent = useAppStore((s) => s.handleServerEvent);
  const setChannels = useAppStore((s) => s.setChannels);
  const settingsPanelOpen = useAppStore((s) => s.settingsPanelOpen);
  const currentView = useAppStore((s) => s.currentView);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const workbenchFullscreen = useWorkbenchStore((s) => s.workbenchFullscreen);

  const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
  const workDir = activeSession?.cwd || activeSession?.generatedFilesDir || "";

  useGlobalScrollbar();
  useAppFocus();

  const { partial, onEvent: onPartialEvent } = usePartialStream(activeSessionId);

  const onEvent = useCallback((event: ServerEvent) => {
    handleServerEvent(event);
    onPartialEvent(event);
    // 工作区文件变更事件分发到总线，供 FileBrowserTab 增量更新文件树
    if (
      event.type === "workspace.file.added" ||
      event.type === "workspace.file.deleted" ||
      event.type === "workspace.file.changed"
    ) {
      workspaceFileEventBus.dispatch(event);
    }
    // VSCode 桥接:把宿主关心的事件转发上去(原生 diff/文件树等)。
    // 避开高频 stream.message;非 VSCode 环境 forwardServerEvent 内部 no-op。
    if (
      event.type === "session.diff" ||
      event.type === "workspace.file.added" ||
      event.type === "workspace.file.deleted" ||
      event.type === "workspace.file.changed"
    ) {
      forwardServerEvent(event);
    }
  }, [handleServerEvent, onPartialEvent]);

  const { connected, sendEvent } = useWebSocket(onEvent);

  useEffect(() => {
    if (!connected) return;
    apiListSessions()
      .then((sessions) => handleServerEvent({ type: "session.list", payload: { sessions } } as any))
      .catch(() => {});
    // 加载 endpoints（模型选择器数据源）。此前只有设置页 EndpointSection 局部加载，
    // 全局 store.endpoints 一直空 → ModelChip 无可选项。
    apiListEndpoints()
      .then((endpoints) => handleServerEvent({ type: "endpoint.list", payload: { endpoints } } as any))
      .catch(() => {});
    // 加载渠道列表。此前唯一加载入口是 ChannelPanel 挂载时的 useEffect，
    // 导致重启后未打开「Channel 管理」页之前 store.channels 一直为空 →
    // CHANNELS 分组被隐藏、渠道会话(kind=chat)无法被排除而误入「对话」分组。
    // 改为启动连接成功即加载，渠道分组与会话归类无需手动打开管理页。
    apiListChannels().then(setChannels).catch(() => {});
    // 加载 MCP server 列表灌入全局 store。订阅常驻于此（非 ConnectorsPage），
    // 即使未打开连接器页，后端重启后台探活的终态推送也能落 store，
    // 打开页面时已是最新 → 消除「卡验证中」竞态。
    apiListMCPServers()
      .then((servers) => handleServerEvent({ type: "mcp.server.list", payload: { servers } } as ServerEvent))
      .catch(() => {});
  }, [connected, handleServerEvent]);

  const runtime = useAuiRuntime(sendEvent);
  const editSummary = useEditSummaryData();
  useSessionHistory(connected, sendEvent);
  useCwdProbe(connected);
  useQueueFlush(sendEvent);

  // 预热：聚焦到某个已存在、非运行中的会话 tab 时，提示后端提前 spawn CLI 进程到就绪态，
  // 把冷启动（加载 30MB bundle + init，~5s）藏到用户发消息之前。
  // 去抖 400ms：快速切多个 tab 时只对最终停留的那个发，避免反复 spawn 又被后端 LRU 回收。
  useEffect(() => {
    if (!connected || !activeSessionId) return;
    const s = sessions[activeSessionId];
    // 仅对「已存在于服务端、当前空闲」的会话预热；新会话(无 status)/运行中的不预热。
    if (!s || s.status === "running") return;
    const timer = setTimeout(() => {
      // 在定时器触发时读取实时状态而非闭包快照（deps 故意不含 sessions 以避免状态流转反复
      // 触发，但 400ms 内用户可能已切换了 model/smartHybrid，读快照会用馊配置预热）。
      const fresh = useAppStore.getState().sessions[activeSessionId];
      if (!fresh || fresh.status === "running") return;
      sendEvent({
        type: "session.prewarm",
        payload: {
          sessionId: activeSessionId,
          model: fresh.model,
          endpointId: fresh.endpointId,
          smartHybrid: fresh.smartHybrid,
          permissionMode: fresh.permissionMode,
        },
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [connected, activeSessionId, sendEvent]); // 故意不依赖 sessions：只在切换会话时触发，避免状态流转反复发

  // 把「全局当前模型 + 路由偏好」同步到服务端 RoutingService。
  // 拆成两个关注点——"选了哪个模型"与"路由偏好/smartHybridConfig"是正交的：
  //   • modelOverride 依赖用户选过的模型，无模型时不发（guard 保留）。
  //   • preference / smartHybridConfig 应立即同步（如新装用户只配了 smart-hybrid
  //     但还没选模型），不被 !model 守卫挡住。
  const selectedModel = useAppStore((s) => s.selectedModel);
  const draftRunConfig = useAppStore((s) => s.draftRunConfig);
  const routingPreference = useAppStore((s) => s.routingPreference);
  const smartHybridConfig = useAppStore((s) => s.smartHybridConfig);

  // Effect A：有模型时同步完整 payload（含 modelOverride）。
  useEffect(() => {
    if (!connected) return;
    const model = draftRunConfig.model ?? selectedModel.model;
    const endpointId = draftRunConfig.endpointId ?? selectedModel.endpointId;
    if (!model) return; // 未选过模型：等 endpoint.list 回落后再触发
    sendEvent({
      type: "routing.preference",
      payload: {
        preference: routingPreference,
        modelOverride: model,
        endpointId: endpointId || undefined,
        smartHybridConfig: smartHybridConfig ?? undefined,
      },
    });
  }, [connected, selectedModel.model, selectedModel.endpointId, draftRunConfig.model, draftRunConfig.endpointId, routingPreference, smartHybridConfig, sendEvent]);

  // Effect B：仅当【无模型】时同步偏好/config——覆盖"新装用户只配了 smart-hybrid 但还没选
  // 模型"的场景。有模型时由 Effect A 发完整 payload，此处必须 return，否则会以
  // modelOverride=undefined 重发，覆盖 Effect A 刚写入后端的模型选择（setPreference 无条件赋值）。
  useEffect(() => {
    if (!connected) return;
    const model = draftRunConfig.model ?? selectedModel.model;
    if (model) return; // 有模型：Effect A 已负责同步，避免双发覆盖 modelOverride
    sendEvent({
      type: "routing.preference",
      payload: {
        preference: routingPreference,
        smartHybridConfig: smartHybridConfig ?? undefined,
      },
    });
  }, [connected, draftRunConfig.model, selectedModel.model, routingPreference, smartHybridConfig, sendEvent]);

  const {
    skillEditorOpen, setSkillEditorOpen, skillEditorData,
    handleCreateSkill, handleCloneSkill, handleEditSkill, handleSaveSkill,
    handleExportSkill, handleImportSkill,
  } = useAppHandlers(sendEvent);

  // 覆盖视图：所有非 chat 的面板都走 PanelSurface（统一圆角 + 左边框）
  const overlayContent = settingsPanelOpen ? (
    <SettingsContent />
  ) : currentView === "skills" ? (
    <PanelSurface>
      <SkillManager
        embedded
        sendEvent={sendEvent}
        onCreateSkill={handleCreateSkill}
        onEditSkill={handleEditSkill}
        onExportSkill={handleExportSkill}
        onImportSkill={handleImportSkill}
        onCloneSkill={handleCloneSkill}
      />
    </PanelSurface>
  ) : currentView === "automation" ? (
    <PanelSurface><AutomationPage /></PanelSurface>
  ) : currentView === "connectors" ? (
    <PanelSurface><ConnectorsPage /></PanelSurface>
  ) : currentView === "search" ? (
    <PanelSurface><SearchPanel /></PanelSurface>
  ) : currentView === "channels" ? (
    <PanelSurface><ChannelPanel /></PanelSurface>
  ) : currentView === "endpoints" ? (
    <PanelSurface>
      <div className="flex-1 overflow-y-auto px-8 pt-7 pb-10">
        <EndpointSettingsSection />
      </div>
    </PanelSurface>
  ) : currentView === "secrets" ? (
    <PanelSurface><SecretsPanel /></PanelSurface>
  ) : null;

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AuiBridgeProvider value={{ sendEvent, activeSessionId }}>
       <EditSummaryProvider value={editSummary}>
        <BashToolUI /><ReadToolUI /><WriteToolUI /><EditToolUI />
        <GlobToolUI /><GrepToolUI /><WebFetchToolUI /><AskUserQuestionToolUI />
        <TaskCreateToolUI /><TaskUpdateToolUI /><TaskListToolUI /><TaskGetToolUI />
        <div className="flex h-screen flex-col bg-bg-100">
          <TopBar />
          {/* chrome-surface：让中间面板 rounded-l 圆角缺口透出的底色与相邻侧栏一致，
              否则深色模式切前台时侧栏渐变到深绿、缺口仍是 bg-100，圆角会「跳」出色差。 */}
          <div className="chrome-surface relative flex flex-1 min-h-0 overflow-hidden">
            <ThreadSidebar />
            {overlayContent ?? (
              <>
                <ThreadPane partial={partial} sendEvent={sendEvent} hidden={workbenchFullscreen} />
                <Workbench sendEvent={sendEvent} workDir={workDir} />
                <RightPanelToggle />
              </>
            )}
          </div>
        </div>
        {skillEditorOpen && (
          <SkillEditor
            open={skillEditorOpen}
            onClose={() => setSkillEditorOpen(false)}
            onSave={handleSaveSkill}
            initialData={skillEditorData}
          />
        )}
        <ConfirmContainer />
        <ToastContainer />
       </EditSummaryProvider>
      </AuiBridgeProvider>
    </AssistantRuntimeProvider>
  );
}
