import { useCallback, useEffect } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useWebSocket } from "../hooks/useWebSocket";
import { useSessionHistory } from "../hooks/useSessionHistory";
import { useCwdProbe } from "../hooks/useCwdProbe";
import { useQueueFlush } from "../hooks/useQueueFlush";
import { useAppStore } from "../store/useAppStore";
import { apiListSessions, apiListEndpoints } from "../api";
import { apiListChannels } from "../api/channel";
import { apiListMCPServers } from "../api/mcp";
import { useAuiRuntime } from "../runtime/useAuiRuntime";
import { usePartialStream } from "../runtime/usePartialStream";
import { AuiBridgeProvider } from "../runtime/AuiBridge";
import {
  BashToolUI, ReadToolUI, WriteToolUI, EditToolUI,
  GlobToolUI, GrepToolUI, WebFetchToolUI, AskUserQuestionToolUI,
  TaskCreateToolUI, TaskUpdateToolUI, TaskListToolUI, TaskGetToolUI,
} from "../thread/tools";
import { ThreadPane } from "../thread";
import { ConfirmContainer } from "../components/ConfirmDialog";
import { ToastContainer } from "../components/Toast";
import { workspaceFileEventBus } from "../events/workspaceFileEventBus";
import { forwardServerEvent, onHostMessage, pushSessionsList, type SessionBrief } from "../vscode/bridge";
import type { ServerEvent, ClientEvent } from "@lenovo/agent-protocol";

/**
 * 原生 Webview 根组件:精简版 AppShell。
 * 保留对话链(runtime/ToolUI/ThreadPane/hooks + 事件转发),剔除桌面外壳。
 * 会话列表/切换/新建/删除由宿主原生 TreeView 承担(经 bridge 双向同步),
 * 替代桌面 ThreadSidebar;本组件只渲染当前会话的对话面板。
 */
/** 路径归一化:小写 + 反斜杠转正斜杠 + 去尾斜杠(跨 Windows/Posix 比较)。 */
function normPath(p: string): string {
  return p.toLowerCase().replace(/\\/g, "/").replace(/\/+$/, "");
}

/** 会话 cwd 是否在当前工作区根目录下(工作区未知时视为通过,不过滤)。 */
function inWorkspace(cwd: string | undefined, root: string): boolean {
  if (!root) return true;
  if (!cwd) return false;
  const c = normPath(cwd);
  const r = normPath(root);
  return c === r || c.startsWith(r + "/");
}

export function WebviewApp() {
  const handleServerEvent = useAppStore((s) => s.handleServerEvent);
  const setChannels = useAppStore((s) => s.setChannels);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const setActiveSessionId = useAppStore((s) => s.setActiveSessionId);
  const defaultWorkspace = useAppStore((s) => s.defaultWorkspace);

  const { partial, onEvent: onPartialEvent } = usePartialStream(activeSessionId);

  const onEvent = useCallback((event: ServerEvent) => {
    handleServerEvent(event);
    onPartialEvent(event);
    if (
      event.type === "workspace.file.added" ||
      event.type === "workspace.file.deleted" ||
      event.type === "workspace.file.changed"
    ) {
      workspaceFileEventBus.dispatch(event);
      forwardServerEvent(event);
    } else if (event.type === "session.diff") {
      forwardServerEvent(event);
    }
  }, [handleServerEvent, onPartialEvent]);

  const { connected, sendEvent } = useWebSocket(onEvent);
  const runtime = useAuiRuntime(sendEvent);
  useSessionHistory(connected, sendEvent);
  useCwdProbe(connected);
  useQueueFlush(sendEvent);

  // 连接后加载基础数据(会话/端点/渠道/MCP),与 AppShell 一致。
  useEffect(() => {
    if (!connected) return;
    apiListSessions().then((s) => handleServerEvent({ type: "session.list", payload: { sessions: s } } as ServerEvent)).catch(() => {});
    apiListEndpoints().then((e) => handleServerEvent({ type: "endpoint.list", payload: { endpoints: e } } as ServerEvent)).catch(() => {});
    apiListChannels().then(setChannels).catch(() => {});
    apiListMCPServers().then((sv) => handleServerEvent({ type: "mcp.server.list", payload: { servers: sv } } as ServerEvent)).catch(() => {});
  }, [connected, handleServerEvent, setChannels]);

  // 收宿主 TreeView 的会话操作:切换/新建/删除。
  useEffect(() => {
    return onHostMessage((msg) => {
      if (msg.type === "localcoding:openSession") setActiveSessionId(msg.id);
      else if (msg.type === "localcoding:newSession") setActiveSessionId(null);
      else if (msg.type === "localcoding:deleteSession") {
        sendEvent({ type: "session.delete", payload: { sessionId: msg.id } } as ClientEvent);
      }
    });
  }, [setActiveSessionId, sendEvent]);

  // 会话列表/当前会话变化 → 推给宿主 TreeView(单一数据源=webview store)。
  useEffect(() => {
    const list: SessionBrief[] = Object.values(sessions)
      // 保留普通对话(kind=chat 或无 kind);排除 cron/channel(定时/渠道会话)。
      // 且只显示 cwd 在当前 VSCode 工作区下的会话(像 Cursor,按项目归属)。
      .filter((s) => (!s.kind || s.kind === "chat") && inWorkspace(s.cwd, defaultWorkspace))
      .map((s) => ({ id: s.id, title: s.title || "未命名会话", status: s.status ?? "", updatedAt: s.updatedAt ?? 0 }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    pushSessionsList(list, activeSessionId);
  }, [sessions, activeSessionId, defaultWorkspace]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AuiBridgeProvider value={{ sendEvent, activeSessionId }}>
        <BashToolUI /><ReadToolUI /><WriteToolUI /><EditToolUI />
        <GlobToolUI /><GrepToolUI /><WebFetchToolUI /><AskUserQuestionToolUI />
        <TaskCreateToolUI /><TaskUpdateToolUI /><TaskListToolUI /><TaskGetToolUI />
        <div className="flex h-screen flex-col bg-bg-100">
          <ThreadPane partial={partial} sendEvent={sendEvent} />
        </div>
        <ConfirmContainer />
        <ToastContainer />
      </AuiBridgeProvider>
    </AssistantRuntimeProvider>
  );
}
