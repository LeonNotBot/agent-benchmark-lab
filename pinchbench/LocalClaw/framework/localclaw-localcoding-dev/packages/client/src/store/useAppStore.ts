import { create } from "zustand";
import { SK } from "./storageKeys";
import { createUISlice } from "./slices/uiSlice";
import { createSessionSlice } from "./slices/sessionSlice";
import { createRoutingSlice } from "./slices/routingSlice";
import { createSkillSlice } from "./slices/skillSlice";
import { createChannelSlice } from "./slices/channelSlice";
import { createMcpSlice } from "./slices/mcpSlice";
import { createTemplateSlice } from "./slices/templateSlice";
import { createWorkbenchSlice } from "../workbench/store/workbenchSlice";
import { createThreadSlice } from "../thread/store/threadSlice";
import { createSidebarSlice } from "../sidebar/store/sidebarSlice";
import { handleSessionEvents } from "./slices/sessionHandlers";
import { handleRoutingEvents } from "./slices/routingHandlers";
import { handleChannelEvents } from "./slices/channelHandlers";
import { handleMcpEvents } from "./slices/mcpHandlers";
import { handleSkillEvents } from "./slices/skillHandlers";
import { handleTemplateEvents } from "./slices/templateHandlers";
import { handleSpeechEvents } from "./slices/uiHandlers";
import { handleWorkspaceEvents } from "./slices/workspaceHandlers";
import { streamDebugRecorder } from "../debug/StreamDebugRecorder";
import type { AppView, QuickPhrase, PermissionRequest, SessionView, TodoItem } from "./slices/types";
import type { Locale } from "../i18n/locales";
import { applyTheme, watchSystemTheme } from "./slices/uiSlice";
import type { ThemeId } from "./slices/uiSlice";
import type { WorkbenchTab, WorkbenchTabId } from "../workbench/types";
import type { Attachment, RoutingPreference, SmartHybridConfig, SelectedModel, SkillMeta, ChannelConfig, TemplateSummary, Template, ServerEvent, EndpointInfo, MCPServer, EscalationHistoryEntry } from "@lenovo/agent-protocol";

// ── Cross-slice state that doesn't belong to any single slice ──────────────────

const SESSION_MODES_KEY = "lc:sessionModes";
function loadSessionModes(): Record<string, "daily" | "code"> {
  try { return JSON.parse(localStorage.getItem(SESSION_MODES_KEY) || "{}"); }
  catch { return {}; }
}
function saveSessionModes(modes: Record<string, "daily" | "code">) {
  localStorage.setItem(SESSION_MODES_KEY, JSON.stringify(modes));
}

// ── Navigation history (browser-like back/forward) ─────────────────────────────
export type NavEntry = { view: AppView; sessionId: string | null; settingsOpen?: boolean; automationDetailId?: string | null };
const NAV_STACK_MAX = 50;

// 把 view 映射到对应的面板开关状态（前进/后退与 openView 共用）
function panelFlags(view: AppView) {
  return {
    historyPanelOpen: view === "history",
    skillManagerOpen: view === "skills",
    secretsPanelOpen: view === "secrets",
    searchPanelOpen: view === "search",
    channelManagerOpen: view === "channels",
    agentPageOpen: view === "agents",
    memoryPanelOpen: view === "memory",
    knowledgePageOpen: view === "knowledge",
    modelRoutingPageOpen: view === "model-routing",
    settingsPageOpen: view === "settings",
  };
}

function persistSessionId(sessionId: string | null) {
  if (sessionId) localStorage.setItem(SK.LAST_SESSION_ID, sessionId);
  else localStorage.removeItem(SK.LAST_SESSION_ID);
}

// 压入一条导航记录：截断「前进」分支、对栈顶去重、限制长度
function pushNav(stack: NavEntry[], index: number, entry: NavEntry): { navStack: NavEntry[]; navIndex: number } {
  const cur = stack[index];
  if (cur && cur.view === entry.view && cur.sessionId === entry.sessionId
      && !!cur.settingsOpen === !!entry.settingsOpen
      && (cur.automationDetailId ?? null) === (entry.automationDetailId ?? null)) {
    return { navStack: stack, navIndex: index };
  }
  const next = stack.slice(0, index + 1);
  next.push(entry);
  const capped = next.slice(-NAV_STACK_MAX);
  return { navStack: capped, navIndex: capped.length - 1 };
}

// 应用某条导航记录对应的完整页面状态（不改动 navStack/navIndex）
function navStatePatch(entry: NavEntry) {
  persistSessionId(entry.sessionId);
  return {
    currentView: entry.view,
    activeSessionId: entry.sessionId,
    globalError: null,
    settingsPanelOpen: !!entry.settingsOpen,
    // 自动化详情页是覆盖页，纳入导航项快照，使前进/后退能恢复"在详情页"的状态。
    automationDetailId: entry.automationDetailId ?? null,
    ...panelFlags(entry.view),
  };
}

// ── AppState ──────────────────────────────────────────────────────────────────

interface AppState {
  // ── Cross-slice ─────────────────────────────────────────────────────────────
  pendingSessionMode: "daily" | "code" | null;
  setPendingSessionMode: (mode: "daily" | "code" | null) => void;

  // ── Navigation history (browser-like back/forward) ──────────────────────────
  navStack: NavEntry[];
  navIndex: number;
  goBack: () => void;
  goForward: () => void;

  // ── Panel / Page open states (managed by useAppStore to avoid cross-slice deps) ──
  historyPanelOpen: boolean;
  skillManagerOpen: boolean;
  secretsPanelOpen: boolean;
  searchPanelOpen: boolean;
  channelManagerOpen: boolean;
  agentPageOpen: boolean;
  memoryPanelOpen: boolean;
  knowledgePageOpen: boolean;
  modelRoutingPageOpen: boolean;
  settingsPageOpen: boolean;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setHistoryPanelOpen: (open: boolean) => void;
  setSkillManagerOpen: (open: boolean) => void;
  setSecretsPanelOpen: (open: boolean) => void;
  setSearchPanelOpen: (open: boolean) => void;
  setChannelManagerOpen: (open: boolean) => void;
  setAgentPageOpen: (open: boolean) => void;
  setMemoryPanelOpen: (open: boolean) => void;
  setKnowledgePageOpen: (open: boolean) => void;
  setModelRoutingPageOpen: (open: boolean) => void;
  setSettingsPageOpen: (open: boolean) => void;

  // ── Delegated from slices ───────────────────────────────────────────────────
  // (These are spread in at store creation; TypeScript sees them via AppState interface)

  // UI Slice
  prompt: string;
  attachments: Attachment[];
  cwd: string;
  defaultWorkspace: string;
  currentView: AppView;
  locale: Locale;
  theme: ThemeId;
  settingsPanelOpen: boolean;
  settingsNav: string;
  speechStatus: "idle" | "recording" | "processing";
  speechBasePrompt: string;
  quickPhrases: QuickPhrase[];
  rightPanelOpen: boolean;
  rightPanelTab: "resources" | "files" | "changes" | "deploy";
  sidebarOpen: boolean;
  sidebarWidth: number;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  workbenchTabs: WorkbenchTabId[];
  workbenchTab: WorkbenchTab;
  workbenchFullscreen: boolean;
  workbenchUrl: string;
  deployReqToken: number;
  projectPins: string[];
  projectAliases: Record<string, string>;
  projectHidden: Record<string, number>;
  registeredProjects: string[];
  sessionPins: string[];
  channelPins: string[];
  channelAliases: Record<string, string>;
  channelHidden: Record<string, number>;
  channelSessions: Record<string, import("../sidebar/groupSessions").GroupedSession[]>;
  toggleProjectPin: (path: string) => void;
  toggleSessionPin: (id: string) => void;
  renameProject: (path: string, alias: string) => void;
  removeProject: (path: string) => void;
  unhideProject: (path: string) => void;
  registerProject: (path: string) => void;
  unregisterProject: (path: string) => void;
  toggleChannelPin: (channelId: string) => void;
  renameChannel: (channelId: string, alias: string) => void;
  hideChannel: (channelId: string) => void;
  unhideChannel: (channelId: string) => void;
  setChannelSessions: (channelId: string, sessions: import("../sidebar/groupSessions").GroupedSession[]) => void;
  mergeChannelSessions: (channelId: string, sessions: import("../sidebar/groupSessions").GroupedSession[]) => void;
  designMode: boolean;
  designPromptEnhance: boolean;
  selectedKnowledgeBase: string;
  sessionMode: "daily" | "code";
  // 自动化编辑页（覆盖在 automation 列表之上的局部页）。非 null 时显示详情/编辑页。
  // 提升到 store 是为了让顶栏后退按钮(goBack)能先关闭它再退视图。
  automationDetailId: string | null;
  setAutomationDetailId: (id: string | null) => void;

  // Session Slice
  sessions: Record<string, any>;
  activeSessionId: string | null;
  pendingStart: boolean;
  composerDraft: string;
  draftBySession: Record<string, string>;
  queuedBySession: Record<string, import("../thread/store/threadSlice").QueuedMessage[]>;
  pendingClientSessionId: string | undefined;
  globalError: string | null;
  sessionsLoaded: boolean;
  historyRequested: Set<string>;

  // Routing Slice
  routingPreference: RoutingPreference;
  selectedModelOverride: string | null;
  smartHybridConfig: SmartHybridConfig | null;
  selectedModel: SelectedModel;
  lastRoutingDecision: any | null;
  deviceCapabilities: any | null;
  routingStatus: string | null;
  endpoints: EndpointInfo[];
  /** app 级升级日志（最多 50 条）。当前升级态是会话级的，见 SessionView.escalationModel。 */
  escalationHistory: EscalationHistoryEntry[];

  // Skill Slice
  skills: SkillMeta[];
  disabledSkills: string[];

  // Channel Slice
  channels: ChannelConfig[];
  wechatQrUrl: string | null;
  wechatQrWarning: string | null;
  channelPanelMode: "list" | "add" | "edit";
  selectedChannelId: string | null;
  setWechatQrWarning: (warning: string | null) => void;
  setChannelPanelMode: (mode: "list" | "add" | "edit") => void;
  setSelectedChannelId: (id: string | null) => void;

  // Template Slice
  templates: TemplateSummary[];
  selectedTemplate: Template | null;
  showTemplateManager: boolean;
  pendingTemplateSlug: string | null;

  // MCP Slice
  mcpServers: MCPServer[];
  setMcpServers: (servers: MCPServer[]) => void;

  // ── Actions ─────────────────────────────────────────────────────────────────
  setPrompt: (prompt: string) => void;
  openView: (view: AppView, options?: { sessionId?: string | null }) => void;
  addAttachment: (attachment: Attachment) => void;
  removeAttachment: (index: number) => void;
  clearAttachments: () => void;
  setCwd: (cwd: string) => void;
  setDefaultWorkspace: (path: string) => void;
  closeAllPanels: () => void;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: ThemeId) => void;
  setSettingsPanelOpen: (open: boolean) => void;
  setSettingsNav: (nav: string) => void;
  setSpeechStatus: (status: "idle" | "recording" | "processing") => void;
  setSpeechBasePrompt: (base: string) => void;
  addQuickPhrase: (phrase: Omit<QuickPhrase, "id">) => void;
  updateQuickPhrase: (id: string, patch: Partial<Omit<QuickPhrase, "id">>) => void;
  removeQuickPhrase: (id: string) => void;
  setRightPanelOpen: (open: boolean) => void;
  setRightPanelTab: (tab: AppState["rightPanelTab"]) => void;
  setWorkbenchTab: (tab: WorkbenchTab) => void;
  openWorkbenchTab: (tab: WorkbenchTabId) => void;
  closeWorkbenchTab: (tab: WorkbenchTabId) => void;
  setWorkbenchFullscreen: (v: boolean) => void;
  openInBrowser: (url: string) => void;
  clearWorkbenchUrl: () => void;
  requestDeploy: () => void;
  setDesignMode: (v: boolean) => void;
  setDesignPromptEnhance: (v: boolean) => void;
  setSelectedKnowledgeBase: (value: string) => void;
  setSessionMode: (mode: "daily" | "code") => void;

  // Session actions
  setPendingStart: (pending: boolean) => void;
  setComposerDraft: (draft: string) => void;
  setDraftForSession: (sessionId: string, draft: string) => void;
  enqueueMessage: (sessionId: string, msg: import("../thread/store/threadSlice").QueuedMessage) => void;
  dequeueMessage: (sessionId: string) => import("../thread/store/threadSlice").QueuedMessage | undefined;
  clearQueue: (sessionId: string) => void;
  setGlobalError: (error: string | null) => void;
  setActiveSessionId: (id: string | null) => void;
  markHistoryRequested: (sessionId: string) => void;
  resolvePermissionRequest: (sessionId: string, toolUseId: string) => void;
  appendToolResult: (sessionId: string, toolUseId: string, result: unknown) => void;
  setSessionDiffs: (sessionId: string, diffs: any[]) => void;
  setSessionFiles: (sessionId: string, dir: string, files: any[]) => void;
  setDiffStatus: (sessionId: string, status: "pending" | "applied" | "discarded") => void;
  setSelectedPreviewFile: (sessionId: string, path: string | null) => void;
  setSessionLoadingHistory: (sessionId: string, loading: boolean) => void;
  removeErrorMessages: (sessionId: string) => void;

  // Routing actions
  setRoutingPreference: (preference: RoutingPreference) => void;
  setSelectedModelOverride: (model: string | null) => void;
  setSmartHybridConfig: (config: SmartHybridConfig | null) => void;
  setSelectedModel: (model: SelectedModel) => void;
  setEndpoints: (endpoints: EndpointInfo[]) => void;
  draftRunConfig: import("./slices/routingSlice").SessionRunConfig;
  setDraftRunConfig: (config: Partial<import("./slices/routingSlice").SessionRunConfig>) => void;
  setSessionRunConfig: (sessionId: string, config: { model?: string; endpointId?: string; smartHybrid?: import("@lenovo/agent-protocol").SmartHybridConfig; permissionMode?: import("@lenovo/agent-protocol").PermissionMode }) => void;

  // Skill actions
  setSkills: (skills: SkillMeta[]) => void;

  // Channel actions
  setChannels: (channels: ChannelConfig[]) => void;
  setWechatQrUrl: (url: string | null) => void;
  updateChannelStatus: (id: string, status: any, error?: string) => void;

  // Template actions
  setTemplates: (templates: TemplateSummary[]) => void;
  selectTemplate: (template: Template | null) => void;
  setShowTemplateManager: (show: boolean) => void;
  setPendingTemplateSlug: (slug: string | null) => void;

  // Event handling (delegates to handler files)
  handleServerEvent: (event: ServerEvent) => void;
}

// ── Store creation ────────────────────────────────────────────────────────────

export const useAppStore = create<AppState>((set, get) => {
  // Build slices first (they capture set/get)
  const ui = createUISlice(set);
  const session = createSessionSlice(set, get);
  const routing = createRoutingSlice(set);
  const skill = createSkillSlice(set);
  const channel = createChannelSlice(set);
  const mcp = createMcpSlice(set);
  const template = createTemplateSlice(set);
  const workbench = createWorkbenchSlice(set);
  const thread = createThreadSlice(set, get);
  const sidebar = createSidebarSlice(set);

  // 导航到某视图（保留当前 sessionId），并记录前进/后退历史
  const navTo = (view: AppView) =>
    set((s: any) => ({
      currentView: view,
      globalError: null,
      settingsPanelOpen: false,
      automationDetailId: null,
      ...panelFlags(view),
      ...pushNav(s.navStack, s.navIndex, { view, sessionId: s.activeSessionId, settingsOpen: false }),
    }));

  // Compute initial state from all slices
  const sessionState = {
    sessions: session.sessions,
    activeSessionId: session.activeSessionId,
    globalError: session.globalError,
    sessionsLoaded: session.sessionsLoaded,
    historyRequested: session.historyRequested,
  };

  const routingState = {
    routingPreference: routing.routingPreference,
    selectedModelOverride: routing.selectedModelOverride,
    smartHybridConfig: routing.smartHybridConfig,
    selectedModel: routing.selectedModel,
    lastRoutingDecision: routing.lastRoutingDecision,
    deviceCapabilities: routing.deviceCapabilities,
    routingStatus: routing.routingStatus,
    endpoints: routing.endpoints,
    draftRunConfig: routing.draftRunConfig,
    escalationHistory: routing.escalationHistory,
  };

  const uiState = {
    prompt: ui.prompt,
    cwd: ui.cwd,
    defaultWorkspace: ui.defaultWorkspace,
    currentView: ui.currentView,
    locale: ui.locale,
    theme: ui.theme,
    settingsPanelOpen: ui.settingsPanelOpen,
    settingsNav: ui.settingsNav,
    speechStatus: ui.speechStatus,
    speechBasePrompt: ui.speechBasePrompt,
    quickPhrases: ui.quickPhrases,
    rightPanelTab: ui.rightPanelTab,
    designMode: ui.designMode,
    designPromptEnhance: ui.designPromptEnhance,
    selectedKnowledgeBase: ui.selectedKnowledgeBase,
    sessionMode: ui.sessionMode,
  };

  const workbenchState = {
    rightPanelOpen: workbench.rightPanelOpen,
    workbenchTabs: workbench.workbenchTabs,
    workbenchTab: workbench.workbenchTab,
    workbenchFullscreen: workbench.workbenchFullscreen,
    workbenchUrl: workbench.workbenchUrl,
    deployReqToken: workbench.deployReqToken,
  };

  const sidebarState = {
    sidebarOpen: sidebar.sidebarOpen,
    sidebarWidth: sidebar.sidebarWidth,
    projectPins: sidebar.projectPins,
    projectAliases: sidebar.projectAliases,
    projectHidden: sidebar.projectHidden,
    registeredProjects: sidebar.registeredProjects,
    sessionPins: sidebar.sessionPins,
    channelPins: sidebar.channelPins,
    channelAliases: sidebar.channelAliases,
    channelHidden: sidebar.channelHidden,
    channelSessions: sidebar.channelSessions,
  };

  const threadState = {
    attachments: thread.attachments,
    pendingStart: thread.pendingStart,
    composerDraft: thread.composerDraft,
    draftBySession: thread.draftBySession,
    queuedBySession: thread.queuedBySession,
    pendingClientSessionId: undefined as string | undefined,
  };

  return {
    // Cross-slice
    pendingSessionMode: null,

    // ── Navigation history ──────────────────────────────────────────────────
    navStack: [{ view: uiState.currentView, sessionId: sessionState.activeSessionId, settingsOpen: false }],
    navIndex: 0,
    automationDetailId: null,
    setAutomationDetailId: (id: string | null) =>
      set((s: any) => {
        // 同步写入当前导航项快照，使离开后(打开会话)再后退能恢复"在详情页"状态。
        const navStack = s.navStack.slice();
        const cur = navStack[s.navIndex];
        if (cur) navStack[s.navIndex] = { ...cur, automationDetailId: id };
        return { automationDetailId: id, navStack };
      }),
    goBack: () =>
      set((s: any) => {
        // 在自动化详情页(覆盖页)：后退先关闭详情回到列表，而非退出整个视图。
        // 同步把当前导航项的 detail 清空，保持快照一致。
        if (s.automationDetailId) {
          const navStack = s.navStack.slice();
          const cur = navStack[s.navIndex];
          if (cur) navStack[s.navIndex] = { ...cur, automationDetailId: null };
          return { automationDetailId: null, navStack };
        }
        if (s.navIndex <= 0) return {};
        const navIndex = s.navIndex - 1;
        return { navIndex, ...navStatePatch(s.navStack[navIndex]) };
      }),
    goForward: () =>
      set((s: any) => {
        if (s.navIndex >= s.navStack.length - 1) return {};
        const navIndex = s.navIndex + 1;
        return { navIndex, ...navStatePatch(s.navStack[navIndex]) };
      }),

    // Panel / Page open states (not in any slice)
    historyPanelOpen: false,
    skillManagerOpen: false,
    secretsPanelOpen: false,
    searchPanelOpen: false,
    channelManagerOpen: false,
    agentPageOpen: false,
    memoryPanelOpen: false,
    knowledgePageOpen: false,
    modelRoutingPageOpen: false,
    settingsPageOpen: false,
    sidebarCollapsed: false,

    toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

    // 面板开关：打开 → 导航到对应视图；关闭 → 回到 chat。统一走 navTo 以记录前进/后退历史。
    setHistoryPanelOpen: (open) => navTo(open ? "history" : "chat"),
    setSkillManagerOpen: (open) => navTo(open ? "skills" : "chat"),
    setSecretsPanelOpen: (open) => navTo(open ? "secrets" : "chat"),
    setSearchPanelOpen: (open) => navTo(open ? "search" : "chat"),
    setChannelManagerOpen: (open) => navTo(open ? "channels" : "chat"),
    setAgentPageOpen: (open) => navTo(open ? "agents" : "chat"),
    setMemoryPanelOpen: (open) => navTo(open ? "memory" : "chat"),
    setKnowledgePageOpen: (open) => navTo(open ? "knowledge" : "chat"),
    setModelRoutingPageOpen: (open) => navTo(open ? "model-routing" : "chat"),
    setSettingsPageOpen: (open) => navTo(open ? "settings" : "chat"),

    // ── From session slice ──────────────────────────────────────────────────
    ...sessionState,
    setPendingStart: thread.setPendingStart,
    setGlobalError: session.setGlobalError,
    setActiveSessionId: (id) => {
      persistSessionId(id);
      set((s: any) => {
        // 选择会话时若处于插件/定时任务等覆盖页，回到 chat 视图
        const view = s.currentView === "chat" ? s.currentView : "chat";
        return {
          activeSessionId: id,
          currentView: view,
          ...panelFlags(view),
          globalError: null,
          settingsPanelOpen: false,
          ...pushNav(s.navStack, s.navIndex, { view, sessionId: id, settingsOpen: false }),
        };
      });
    },
    markHistoryRequested: session.markHistoryRequested,
    resolvePermissionRequest: session.resolvePermissionRequest,
    appendToolResult: session.appendToolResult,
    setSessionDiffs: session.setSessionDiffs,
    setSessionFiles: session.setSessionFiles,
    setDiffStatus: session.setDiffStatus,
    setSelectedPreviewFile: session.setSelectedPreviewFile,
    setSessionLoadingHistory: session.setSessionLoadingHistory,
    removeErrorMessages: session.removeErrorMessages,
    setSessionRunConfig: session.setSessionRunConfig,

    // ── From routing slice ───────────────────────────────────────────────────
    ...routingState,
    setRoutingPreference: routing.setRoutingPreference,
    setSelectedModelOverride: routing.setSelectedModelOverride,
    setSmartHybridConfig: routing.setSmartHybridConfig,
    setSelectedModel: routing.setSelectedModel,
    setEndpoints: routing.setEndpoints,
    setDraftRunConfig: routing.setDraftRunConfig,

    // ── From skill slice ────────────────────────────────────────────────────
    skills: skill.skills,
    setSkills: skill.setSkills,
    disabledSkills: skill.disabledSkills,

    // ── From channel slice ──────────────────────────────────────────────────
    channels: channel.channels,
    wechatQrUrl: channel.wechatQrUrl,
    wechatQrWarning: channel.wechatQrWarning,
    channelPanelMode: channel.channelPanelMode,
    selectedChannelId: channel.selectedChannelId,
    setChannels: channel.setChannels,
    setWechatQrUrl: channel.setWechatQrUrl,
    setWechatQrWarning: channel.setWechatQrWarning,
    setChannelPanelMode: channel.setChannelPanelMode,
    setSelectedChannelId: channel.setSelectedChannelId,
    updateChannelStatus: channel.updateChannelStatus,

    // ── From mcp slice ──────────────────────────────────────────────────────
    mcpServers: mcp.mcpServers,
    setMcpServers: mcp.setMcpServers,

    // ── From template slice ──────────────────────────────────────────────────
    templates: template.templates,
    selectedTemplate: template.selectedTemplate,
    showTemplateManager: template.showTemplateManager,
    pendingTemplateSlug: template.pendingTemplateSlug,
    setTemplates: template.setTemplates,
    selectTemplate: template.selectTemplate,
    setShowTemplateManager: template.setShowTemplateManager,
    setPendingTemplateSlug: template.setPendingTemplateSlug,

    // ── From ui slice ───────────────────────────────────────────────────────
    ...uiState,
    // ── From workbench slice ────────────────────────────────────────────────
    ...workbenchState,
    // ── From thread slice ───────────────────────────────────────────────────
    ...threadState,
    // ── From sidebar slice ──────────────────────────────────────────────────
    ...sidebarState,
    setPrompt: ui.setPrompt,
    openView: (view, options) => {
      const hasSession = !!(options && "sessionId" in options);
      if (hasSession) persistSessionId(options!.sessionId ?? null);
      set((state: any) => {
        const sessionId = hasSession ? (options!.sessionId ?? null) : state.activeSessionId;
        return {
          currentView: view,
          globalError: null,
          settingsPanelOpen: false,
          automationDetailId: null,
          ...panelFlags(view),
          ...(hasSession ? { activeSessionId: sessionId } : {}),
          ...pushNav(state.navStack, state.navIndex, { view, sessionId, settingsOpen: false, automationDetailId: null }),
        };
      });
    },
    addAttachment: thread.addAttachment,
    removeAttachment: thread.removeAttachment,
    clearAttachments: thread.clearAttachments,
    setComposerDraft: thread.setComposerDraft,
    setDraftForSession: thread.setDraftForSession,
    enqueueMessage: thread.enqueueMessage,
    dequeueMessage: thread.dequeueMessage,
    clearQueue: thread.clearQueue,
    setCwd: ui.setCwd,
    setDefaultWorkspace: ui.setDefaultWorkspace,
    closeAllPanels: () =>
      set((s: any) => ({
        settingsPanelOpen: false,
        ...panelFlags("chat"),
        currentView: "chat",
        ...pushNav(s.navStack, s.navIndex, { view: "chat", sessionId: s.activeSessionId, settingsOpen: false }),
      })),
    setLocale: ui.setLocale,
    setTheme: ui.setTheme,
    setSettingsPanelOpen: (open) =>
      set((s: any) => ({
        settingsPanelOpen: open,
        ...pushNav(s.navStack, s.navIndex, { view: s.currentView, sessionId: s.activeSessionId, settingsOpen: open }),
      })),
    setSettingsNav: ui.setSettingsNav,
    setSpeechStatus: ui.setSpeechStatus,
    setSpeechBasePrompt: ui.setSpeechBasePrompt,
    addQuickPhrase: ui.addQuickPhrase,
    updateQuickPhrase: ui.updateQuickPhrase,
    removeQuickPhrase: ui.removeQuickPhrase,
    setRightPanelOpen: workbench.setRightPanelOpen,
    setRightPanelTab: ui.setRightPanelTab,
    setSidebarOpen: sidebar.setSidebarOpen,
    setSidebarWidth: sidebar.setSidebarWidth,
    setWorkbenchTab: workbench.setWorkbenchTab,
    openWorkbenchTab: workbench.openWorkbenchTab,
    closeWorkbenchTab: workbench.closeWorkbenchTab,
    setWorkbenchFullscreen: workbench.setWorkbenchFullscreen,
    openInBrowser: workbench.openInBrowser,
    clearWorkbenchUrl: workbench.clearWorkbenchUrl,
    requestDeploy: workbench.requestDeploy,
    toggleProjectPin: sidebar.toggleProjectPin,
    toggleSessionPin: sidebar.toggleSessionPin,
    renameProject: sidebar.renameProject,
    removeProject: sidebar.removeProject,
    unhideProject: sidebar.unhideProject,
    registerProject: sidebar.registerProject,
    unregisterProject: sidebar.unregisterProject,
    toggleChannelPin: sidebar.toggleChannelPin,
    renameChannel: sidebar.renameChannel,
    hideChannel: sidebar.hideChannel,
    unhideChannel: sidebar.unhideChannel,
    setChannelSessions: sidebar.setChannelSessions,
    mergeChannelSessions: sidebar.mergeChannelSessions,
    setDesignMode: ui.setDesignMode,
    setDesignPromptEnhance: ui.setDesignPromptEnhance,
    setSelectedKnowledgeBase: ui.setSelectedKnowledgeBase,
    setSessionMode: (mode) => {
      const id = get().activeSessionId;
      if (id) {
        const stored = loadSessionModes();
        stored[id] = mode;
        saveSessionModes(stored);
      }
      set({ sessionMode: mode });
    },

    // ── Cross-slice actions ─────────────────────────────────────────────────
    setPendingSessionMode: (mode) => set({ pendingSessionMode: mode }),

    // ── handleServerEvent — delegates to handler files ──────────────────────
    handleServerEvent: (event) => {
      // ── 调试录制探针 1：处理前录原始事件（enabled=false 时仅一次布尔判断，零开销）──
      if (streamDebugRecorder.enabled) streamDebugRecorder.recordRawEvent(event);

      handleSessionEvents(event, set, get) ||
      handleRoutingEvents(event, set, get) ||
      handleChannelEvents(event, set) ||
      handleMcpEvents(event, set) ||
      handleSkillEvents(event, set) ||
      handleTemplateEvents(event, set) ||
      handleWorkspaceEvents(event) ||
      handleSpeechEvents(event, set, get);

      // ── 调试录制探针 2：处理后录状态快照（仅 stream.message/session.history 有意义）──
      if (streamDebugRecorder.enabled) {
        const type = (event as any).type as string;
        const sessionId = (event as any).payload?.sessionId as string | undefined;
        if (sessionId && (type === "stream.message" || type === "session.history")) {
          const sess = get().sessions?.[sessionId];
          if (sess) {
            streamDebugRecorder.recordStateSnapshot({
              sessionId,
              messages: sess.messages ?? [],
              sessionStatus: sess.status ?? "idle",
              timestamp: Date.now(),
            });
          }
        }
      }
    },
  };
});

// Re-export types and utilities
export type { ThemeId, AppView, QuickPhrase, PermissionRequest, SessionView, TodoItem };
export { applyTheme, watchSystemTheme };
