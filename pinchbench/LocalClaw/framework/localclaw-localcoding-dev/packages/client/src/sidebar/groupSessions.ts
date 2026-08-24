// 侧栏会话分组：项目来源 = 已登记项目(registeredProjects)，与会话 cwd 解耦。
// 会话按 cwd 挂到匹配的已登记项目下；cwd 不属于任何已登记项目(含沙箱目录)的会话 → loose("对话"分组)。

export interface GroupedSession {
  id: string;
  title: string;
  status?: string;
  updatedAt?: number;
}

export interface ProjectGroup {
  path: string;
  name: string;
  sessions: GroupedSession[];
}

export interface ChannelGroupData {
  channelId: string;
  name: string;
  sessions: GroupedSession[];
}

export interface SidebarGroups {
  pinned: ProjectGroup[];
  pinnedSessions: GroupedSession[]; // 会话级置顶
  projects: ProjectGroup[];
  loose: GroupedSession[]; // 不属于任何已登记项目的散会话
  channels: ChannelGroupData[]; // 渠道分组（每渠道一组）
}

function dirName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

// 路径归一化用于分组匹配：统一分隔符为 /、去末尾斜杠、盘符小写。
// 解决 cwd 与「已登记项目」路径在分隔符(\ vs /)/末尾斜杠/盘符大小写上的字面差异，
// 否则 cron 任务等会话因精确匹配失败被误归到「对话」分组。
function normPath(p: string): string {
  let s = p.trim().replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  if (/^[a-zA-Z]:/.test(s)) s = s[0].toLowerCase() + s.slice(1);
  return s;
}

function latestOf(g: ProjectGroup): number {
  return g.sessions.reduce((m, s) => Math.max(m, s.updatedAt ?? 0), 0);
}

export function groupSessions(input: {
  sessions: Record<string, any>;
  registered?: string[];
  pinned?: string[];
  aliases?: Record<string, string>;
  sessionPins?: string[];
  channels?: Array<{ id: string; name: string }>;
  channelSessions?: Record<string, GroupedSession[]>;
  channelPins?: string[];
  channelAliases?: Record<string, string>;
  channelHidden?: Record<string, number>;
}): SidebarGroups {
  const { sessions, registered = [], pinned = [], aliases = {}, sessionPins = [] } = input;
  const { channels = [], channelSessions = {}, channelPins = [], channelAliases = {}, channelHidden = {} } = input;
  const pinnedSet = new Set(pinned);
  const sessionPinSet = new Set(sessionPins);
  const byPath = new Map<string, ProjectGroup>();
  // 归一化路径 → group，用于会话 cwd 的容错匹配（分隔符/末尾斜杠/盘符大小写）。
  const byNormPath = new Map<string, ProjectGroup>();
  const loose: GroupedSession[] = [];

  // 渠道分组：每个渠道一组（即使暂无会话也显示，以便用户看到渠道入口）。
  // 收集所有渠道会话 id，使其从项目/散会话分组中排除，避免重复出现。
  const channelHiddenSet = new Set(Object.keys(channelHidden));
  const channelSessionIds = new Set<string>();
  const channelGroups: ChannelGroupData[] = [];
  for (const ch of channels) {
    if (channelHiddenSet.has(ch.id)) continue;
    const list = channelSessions[ch.id] ?? [];
    for (const s of list) channelSessionIds.add(s.id);
    channelGroups.push({
      channelId: ch.id,
      name: channelAliases[ch.id] || ch.name,
      sessions: [...list].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    });
  }
  // 置顶渠道靠前，其余保持渠道原有顺序
  const channelPinSet = new Set(channelPins);
  const channelsOrdered = [
    ...channelGroups.filter((g) => channelPinSet.has(g.channelId)),
    ...channelGroups.filter((g) => !channelPinSet.has(g.channelId)),
  ];

  // 仅已登记项目进入项目列表（即使暂无会话也显示）
  for (const p of registered) {
    if (p && !byPath.has(p)) {
      const g = { path: p, name: aliases[p] || dirName(p), sessions: [] };
      byPath.set(p, g);
      byNormPath.set(normPath(p), g);
    }
  }

  // 会话归组（chat + cron 定时任务）：cwd 命中已登记项目则挂入，否则归 loose。
  // 已归属某渠道分组的会话跳过，避免在项目/散会话区重复展示。
  for (const s of Object.values(sessions)) {
    if (s && s.kind && s.kind !== "chat" && s.kind !== "cron") continue;
    if (channelSessionIds.has(s.id)) continue;
    const gs: GroupedSession = {
      id: s.id, title: s.title || "(未命名)", status: s.status, updatedAt: s.updatedAt ?? s.createdAt,
    };
    const cwd = (s.cwd as string | undefined)?.trim();
    const g = cwd ? byNormPath.get(normPath(cwd)) : undefined;
    if (g) g.sessions.push(gs);
    else loose.push(gs);
  }

  // 组内会话按时间倒序
  for (const g of byPath.values()) {
    g.sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }
  loose.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  // 从散会话中拆出被置顶的会话（进入「置顶」段，按时间倒序）
  const pinnedSessions = loose.filter((s) => sessionPinSet.has(s.id));
  const looseRest = loose.filter((s) => !sessionPinSet.has(s.id));

  // 拆分置顶 / 普通，各自按组内最近时间倒序（置顶组永远靠前）
  const all = [...byPath.values()].sort((a, b) => latestOf(b) - latestOf(a));
  const pinnedGroups = all.filter((g) => pinnedSet.has(g.path));
  const projects = all.filter((g) => !pinnedSet.has(g.path));

  return { pinned: pinnedGroups, pinnedSessions, projects, loose: looseRest, channels: channelsOrdered };
}
