import type { Locale } from "../../i18n/locales";
import type { AppView, QuickPhrase } from "./types";
import { SK } from "../storageKeys";

function loadQuickPhrases(): QuickPhrase[] {
  try { return JSON.parse(localStorage.getItem(SK.QUICK_PHRASES) || "[]"); }
  catch { return []; }
}
function saveQuickPhrases(phrases: QuickPhrase[]) {
  localStorage.setItem(SK.QUICK_PHRASES, JSON.stringify(phrases));
}

export type ThemeId = "system" | "claude-light" | "claude-dark" | "console-dark";

const VALID_THEME_IDS: ThemeId[] = ["system", "claude-light", "claude-dark", "console-dark"];

// 把任意存储值（含历史遗留 / 非法值）归一化为合法 ThemeId，避免解构崩溃。
function normalizeThemeId(raw: string | null): ThemeId {
  return raw && (VALID_THEME_IDS as string[]).includes(raw) ? (raw as ThemeId) : "system";
}

const THEME_MAP: Record<Exclude<ThemeId, "system">, { theme: string; mode: string }> = {
  "claude-light": { theme: "claude", mode: "light" },
  "claude-dark": { theme: "claude", mode: "dark" },
  "console-dark": { theme: "console", mode: "dark" },
};

// 系统是否处于深色模式
function systemPrefersDark(): boolean {
  return typeof window !== "undefined"
    && window.matchMedia
    && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// 把主题选项解析为实际生效的 {theme, mode}。
// "system" → 跟随操作系统：深色用 claude-dark，浅色用 claude-light。
function resolveTheme(id: ThemeId): { theme: string; mode: string } {
  if (id === "system") {
    return systemPrefersDark() ? THEME_MAP["claude-dark"] : THEME_MAP["claude-light"];
  }
  return THEME_MAP[id] ?? THEME_MAP["claude-light"];
}

export function applyTheme(id: ThemeId): void {
  const { theme, mode } = resolveTheme(id);
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.setAttribute("data-mode", mode);
}

// 监听系统配色变化：仅当用户选择「跟随系统」时，OS 切换深/浅色会自动重渲染。
// 返回取消监听的函数。getTheme 用于在回调触发时读取最新主题选项。
export function watchSystemTheme(getTheme: () => ThemeId): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    if (getTheme() === "system") applyTheme("system");
  };
  // 兼容老版本 Safari 的 addListener
  if (mql.addEventListener) mql.addEventListener("change", handler);
  else mql.addListener(handler);
  return () => {
    if (mql.removeEventListener) mql.removeEventListener("change", handler);
    else mql.removeListener(handler);
  };
}

export interface UISlice {
  prompt: string;
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
  // rightPanelTab 属 legacy 旧右面板（resources/files/changes/deploy），与 workbench 标签无关
  rightPanelTab: "resources" | "files" | "changes" | "deploy";
  // sidebar 域状态已迁移至 sidebar/store/sidebarSlice.ts
  designMode: boolean;
  designPromptEnhance: boolean;
  selectedKnowledgeBase: string;
  sessionMode: "daily" | "code";
  setPrompt: (prompt: string) => void;
  setCwd: (cwd: string) => void;
  setDefaultWorkspace: (path: string) => void;
  openView: (view: AppView, options?: { sessionId?: string | null }) => void;
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
  setRightPanelTab: (tab: UISlice["rightPanelTab"]) => void;
  // sidebar 域 actions 已迁移至 sidebar/store/sidebarSlice.ts
  setDesignMode: (v: boolean) => void;
  setDesignPromptEnhance: (v: boolean) => void;
  setSelectedKnowledgeBase: (value: string) => void;
  setSessionMode: (mode: "daily" | "code") => void;
}

export function createUISlice(set: any): UISlice {
  return {
    prompt: "",
    cwd: "",
    defaultWorkspace: localStorage.getItem(SK.WORKSPACE) || "",
    currentView: "chat",
    locale: (localStorage.getItem(SK.LOCALE) as Locale) || "zh",
    theme: normalizeThemeId(localStorage.getItem(SK.THEME)),
    settingsPanelOpen: false,
    settingsNav: "general",
    speechStatus: "idle",
    speechBasePrompt: "",
    quickPhrases: loadQuickPhrases(),
    rightPanelTab: "resources",
    designMode: localStorage.getItem(SK.DESIGN_MODE) === "true",
    designPromptEnhance: localStorage.getItem(SK.DESIGN_PROMPT_ENHANCE) !== "false",
    selectedKnowledgeBase: "__none__",
    sessionMode: "daily",

    setPrompt: (prompt) => set({ prompt }),
    setCwd: (cwd) => set({ cwd }),
    setDefaultWorkspace: (path) => {
      localStorage.setItem(SK.WORKSPACE, path);
      set({ defaultWorkspace: path });
    },
    openView: (view, options) => {
      if (options && "sessionId" in options) {
        if (options.sessionId) localStorage.setItem(SK.LAST_SESSION_ID, options.sessionId);
        else localStorage.removeItem(SK.LAST_SESSION_ID);
      }
      set((state: any) => ({
        currentView: view,
        globalError: null,
        automationDetailId: null,
        ...(options && "sessionId" in options
          ? { activeSessionId: options.sessionId ?? null }
          : {}),
      }));
    },
    closeAllPanels: () => set({ settingsPanelOpen: false, currentView: "chat" }),
    setLocale: (locale) => {
      localStorage.setItem(SK.LOCALE, locale);
      set({ locale });
    },
    setTheme: (theme) => {
      localStorage.setItem(SK.THEME, theme);
      applyTheme(theme);
      set({ theme });
    },
    setSettingsPanelOpen: (settingsPanelOpen) => set({ settingsPanelOpen }),
    setSettingsNav: (settingsNav) => set({ settingsNav }),
    setSpeechStatus: (speechStatus) => set({ speechStatus }),
    setSpeechBasePrompt: (speechBasePrompt) => set({ speechBasePrompt }),
    addQuickPhrase: (phrase) =>
      set((state: any) => {
        const next = [...state.quickPhrases, { ...phrase, id: crypto.randomUUID() }];
        saveQuickPhrases(next);
        return { quickPhrases: next };
      }),
    updateQuickPhrase: (id, patch) =>
      set((state: any) => {
        const next = state.quickPhrases.map((p: QuickPhrase) => p.id === id ? { ...p, ...patch } : p);
        saveQuickPhrases(next);
        return { quickPhrases: next };
      }),
    removeQuickPhrase: (id) =>
      set((state: any) => {
        const next = state.quickPhrases.filter((p: QuickPhrase) => p.id !== id);
        saveQuickPhrases(next);
        return { quickPhrases: next };
      }),
    setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),
    setDesignMode: (v) => {
      localStorage.setItem(SK.DESIGN_MODE, String(v));
      set({ designMode: v });
    },
    setDesignPromptEnhance: (v) => {
      localStorage.setItem(SK.DESIGN_PROMPT_ENHANCE, String(v));
      set({ designPromptEnhance: v });
    },
    setSelectedKnowledgeBase: (value) => set({ selectedKnowledgeBase: value }),
    setSessionMode: (mode) => set({ sessionMode: mode }),
  };
}
