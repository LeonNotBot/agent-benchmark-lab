// Sidebar 域的状态切片（从 uiSlice 抽出，S1）。
// 仍挂在全局 useAppStore 上，组件通过 useSidebarStore selector 访问。
import { SK } from "../../store/storageKeys";
import type { GroupedSession } from "../groupSessions";

// 从 uiSlice 移植过来的辅助函数
function loadStringArray(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function loadAliases(): Record<string, string> {
  return loadAliasesFrom(SK.PROJECT_ALIASES);
}

function loadAliasesFrom(key: string): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function loadHidden(): Record<string, number> {
  return loadHiddenFrom(SK.PROJECT_HIDDEN);
}

function loadHiddenFrom(key: string): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "{}");
    // 兼容旧格式 string[]：迁移为 {path: 0}
    if (Array.isArray(v)) {
      const m: Record<string, number> = {};
      for (const p of v) m[p] = 0;
      return m;
    }
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export const SIDEBAR_MIN_WIDTH = 252;
export const SIDEBAR_MAX_WIDTH = 480;
export const SIDEBAR_DEFAULT_WIDTH = 252;

function readSidebarWidth(): number {
  const saved = parseInt(localStorage.getItem(SK.SIDEBAR_WIDTH) || "", 10);
  if (Number.isFinite(saved)) {
    return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, saved));
  }
  return SIDEBAR_DEFAULT_WIDTH;
}

function readSidebarOpen(): boolean {
  return localStorage.getItem(SK.SIDEBAR_OPEN) !== "false";
}

export interface SidebarSlice {
  // 左侧栏展开状态 + 宽度
  sidebarOpen: boolean;
  sidebarWidth: number;
  // 项目管理：置顶路径 / 别名 / 隐藏 / 已登记项目
  projectPins: string[];
  projectAliases: Record<string, string>;
  projectHidden: Record<string, number>;
  registeredProjects: string[];
  // 会话置顶：被置顶的会话 id 列表
  sessionPins: string[];
  // 渠道分组：置顶 channelId / 别名 / 隐藏 / 每渠道会话列表（异步拉取）
  channelPins: string[];
  channelAliases: Record<string, string>;
  channelHidden: Record<string, number>;
  channelSessions: Record<string, GroupedSession[]>;

  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
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
  setChannelSessions: (channelId: string, sessions: GroupedSession[]) => void;
  mergeChannelSessions: (channelId: string, sessions: GroupedSession[]) => void;
}

export function createSidebarSlice(set: any): SidebarSlice {
  return {
    sidebarOpen: readSidebarOpen(),
    sidebarWidth: readSidebarWidth(),
    projectPins: loadStringArray(SK.PROJECT_PINS),
    projectAliases: loadAliases(),
    projectHidden: loadHidden(),
    registeredProjects: loadStringArray(SK.REGISTERED_PROJECTS),
    sessionPins: loadStringArray(SK.SESSION_PINS),
    channelPins: loadStringArray(SK.CHANNEL_PINS),
    channelAliases: loadAliasesFrom(SK.CHANNEL_ALIASES),
    channelHidden: loadHiddenFrom(SK.CHANNEL_HIDDEN),
    channelSessions: {},

    setSidebarOpen: (sidebarOpen) => {
      localStorage.setItem(SK.SIDEBAR_OPEN, String(sidebarOpen));
      set({ sidebarOpen });
    },
    setSidebarWidth: (width) => {
      const clamped = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width));
      localStorage.setItem(SK.SIDEBAR_WIDTH, String(clamped));
      set({ sidebarWidth: clamped });
    },
    toggleProjectPin: (path) =>
      set((s: any) => {
        const has = s.projectPins.includes(path);
        const next = has
          ? s.projectPins.filter((p: string) => p !== path)
          : [...s.projectPins, path];
        localStorage.setItem(SK.PROJECT_PINS, JSON.stringify(next));
        return { projectPins: next };
      }),
    toggleSessionPin: (id) =>
      set((s: any) => {
        const has = s.sessionPins.includes(id);
        const next = has
          ? s.sessionPins.filter((x: string) => x !== id)
          : [...s.sessionPins, id];
        localStorage.setItem(SK.SESSION_PINS, JSON.stringify(next));
        return { sessionPins: next };
      }),
    renameProject: (path, alias) =>
      set((s: any) => {
        const next = { ...s.projectAliases };
        const name = alias.trim();
        if (name) next[path] = name;
        else delete next[path];
        localStorage.setItem(SK.PROJECT_ALIASES, JSON.stringify(next));
        return { projectAliases: next };
      }),
    removeProject: (path) =>
      set((s: any) => {
        const reg = s.registeredProjects.filter((p: string) => p !== path);
        localStorage.setItem(SK.REGISTERED_PROJECTS, JSON.stringify(reg));
        const next = { ...s.projectHidden, [path]: Date.now() };
        localStorage.setItem(SK.PROJECT_HIDDEN, JSON.stringify(next));
        const pins = s.projectPins.filter((p: string) => p !== path);
        if (pins.length !== s.projectPins.length)
          localStorage.setItem(SK.PROJECT_PINS, JSON.stringify(pins));
        return { registeredProjects: reg, projectHidden: next, projectPins: pins };
      }),
    unhideProject: (path) =>
      set((s: any) => {
        if (!(path in s.projectHidden)) return {};
        const next = { ...s.projectHidden };
        delete next[path];
        localStorage.setItem(SK.PROJECT_HIDDEN, JSON.stringify(next));
        return { projectHidden: next };
      }),
    registerProject: (path) =>
      set((s: any) => {
        const p = (path || "").trim();
        if (!p || s.registeredProjects.includes(p)) return {};
        const next = [...s.registeredProjects, p];
        localStorage.setItem(SK.REGISTERED_PROJECTS, JSON.stringify(next));
        if (p in s.projectHidden) {
          const hid = { ...s.projectHidden };
          delete hid[p];
          localStorage.setItem(SK.PROJECT_HIDDEN, JSON.stringify(hid));
          return { registeredProjects: next, projectHidden: hid };
        }
        return { registeredProjects: next };
      }),
    unregisterProject: (path) =>
      set((s: any) => {
        const next = s.registeredProjects.filter((p: string) => p !== path);
        if (next.length === s.registeredProjects.length) return {};
        localStorage.setItem(SK.REGISTERED_PROJECTS, JSON.stringify(next));
        return { registeredProjects: next };
      }),
    toggleChannelPin: (channelId) =>
      set((s: any) => {
        const has = s.channelPins.includes(channelId);
        const next = has
          ? s.channelPins.filter((x: string) => x !== channelId)
          : [...s.channelPins, channelId];
        localStorage.setItem(SK.CHANNEL_PINS, JSON.stringify(next));
        return { channelPins: next };
      }),
    renameChannel: (channelId, alias) =>
      set((s: any) => {
        const next = { ...s.channelAliases };
        const name = alias.trim();
        if (name) next[channelId] = name;
        else delete next[channelId];
        localStorage.setItem(SK.CHANNEL_ALIASES, JSON.stringify(next));
        return { channelAliases: next };
      }),
    hideChannel: (channelId) =>
      set((s: any) => {
        const next = { ...s.channelHidden, [channelId]: Date.now() };
        localStorage.setItem(SK.CHANNEL_HIDDEN, JSON.stringify(next));
        const pins = s.channelPins.filter((x: string) => x !== channelId);
        if (pins.length !== s.channelPins.length)
          localStorage.setItem(SK.CHANNEL_PINS, JSON.stringify(pins));
        return { channelHidden: next, channelPins: pins };
      }),
    unhideChannel: (channelId) =>
      set((s: any) => {
        if (!(channelId in s.channelHidden)) return {};
        const next = { ...s.channelHidden };
        delete next[channelId];
        localStorage.setItem(SK.CHANNEL_HIDDEN, JSON.stringify(next));
        return { channelHidden: next };
      }),
    setChannelSessions: (channelId, sessions) =>
      set((s: any) => ({
        channelSessions: { ...s.channelSessions, [channelId]: sessions },
      })),
    // 合并而非替换：拉取结果与已有 live 条目(实时 session.status upsert 进来的)按 id 并集，
    // 同 id 取 updatedAt 更新者。解决「新建渠道首拉返回空/旧数据，覆盖掉刚到达的 IM 会话」竞态。
    mergeChannelSessions: (channelId, sessions) =>
      set((s: any) => {
        const existing: GroupedSession[] = s.channelSessions[channelId] ?? [];
        const byId = new Map<string, GroupedSession>();
        for (const e of existing) byId.set(e.id, e);
        for (const n of sessions) {
          const prev = byId.get(n.id);
          if (!prev || (n.updatedAt ?? 0) >= (prev.updatedAt ?? 0)) byId.set(n.id, n);
        }
        const merged = [...byId.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        return { channelSessions: { ...s.channelSessions, [channelId]: merged } };
      }),
  };
}
