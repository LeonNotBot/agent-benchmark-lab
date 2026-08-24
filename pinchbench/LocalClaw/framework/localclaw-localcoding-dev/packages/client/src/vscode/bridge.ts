/**
 * VSCode 插件桥接(前端侧)。
 *
 * 背景:插件里前端 SPA 跑在 VSCode Webview 内的 <iframe>(origin=127.0.0.1:PORT),
 * 与顶层 Webview(vscode-webview://)跨 origin,只能靠 window.postMessage 通信。
 * 父窗口无法向跨 origin iframe 注入脚本,故桥接必须作为 SPA 自身代码、检测到在
 * iframe 里时自激活。非 VSCode 环境(桌面版/纯浏览器)全程 no-op。
 *
 * 通道:前端 SPA ←postMessage→ 顶层 Webview(relay)←postMessage→ 扩展宿主。
 * 消息统一带 `localcoding:` 命名空间前缀,避免与其它 postMessage 混淆。
 */
import type { ServerEvent } from "@lenovo/agent-protocol";

const NS = "localcoding:";

/** 宿主→前端 的指令类型。 */
export type HostToWebview =
  | { type: "localcoding:handshake" }
  | { type: "localcoding:insertText"; text: string }
  // 原生 diff 审阅门的决策回传:approved=true 放行落盘,false 拒绝。
  | { type: "localcoding:permissionDecision"; toolUseId: string; approved: boolean; message?: string }
  // @文件 QuickPick 选完回传的相对路径(取消则 path 为空串)。
  | { type: "localcoding:filePicked"; path: string }
  // 宿主把当前 VSCode 工作区根目录告知前端,作为新会话默认 cwd。
  | { type: "localcoding:workspaceRoot"; path: string }
  // 宿主实时同步的活动编辑器上下文(文件/选区),供前端发消息时自动注入。
  | { type: "localcoding:editorContext"; ctx: EditorContext | null }
  // 会话树(宿主 TreeView)操作:切换/新建/删除某会话。
  | { type: "localcoding:openSession"; id: string }
  | { type: "localcoding:newSession" }
  | { type: "localcoding:deleteSession"; id: string };

/** 活动编辑器上下文:当前文件相对路径 + 选中代码(可选) + 选区行号范围。 */
export interface EditorContext {
  filePath: string;           // 工作区相对路径
  selectedText?: string;      // 选中的代码(无选区则 undefined)
  startLine?: number;         // 选区起始行(1-based)
  endLine?: number;           // 选区结束行(1-based)
}

/** 前端→宿主 的上报类型。 */
export type WebviewToHost =
  | { type: "localcoding:ready" }
  | { type: "localcoding:serverEvent"; event: ServerEvent }
  // 请求宿主用原生 diff 审阅一次写操作(Write/Edit/MultiEdit)。
  | { type: "localcoding:permissionRequest"; toolUseId: string; toolName: string; input: Record<string, unknown> }
  // @文件:请求宿主弹原生 QuickPick 选文件。
  | { type: "localcoding:pickFile" }
  // 请求宿主在原生编辑器打开文件。
  | { type: "localcoding:openFile"; path: string }
  // webview 把会话列表 + 当前会话推给宿主,供 TreeView 渲染(单一数据源=webview store)。
  | { type: "localcoding:sessionsList"; sessions: SessionBrief[]; activeId: string | null };

/** 会话树项精简数据(webview→宿主)。 */
export interface SessionBrief {
  id: string;
  title: string;
  status: string;
  updatedAt: number;
}

// 原生 Webview 的 VSCode API handle(acquireVsCodeApi 只能调一次,故在此收口)。
// 存在即视为 VSCode 环境;桌面版/浏览器为 null。
type VscodeApi = { postMessage: (msg: unknown) => void };
const _acquire = (globalThis as { acquireVsCodeApi?: () => VscodeApi }).acquireVsCodeApi;
const vscodeApi: VscodeApi | null = typeof _acquire === "function" ? _acquire() : null;

let active = !!vscodeApi;
const listeners = new Set<(msg: HostToWebview) => void>();
// 握手状态订阅者:active 由 false→true 时通知,供 React 组件(useSyncExternalStore)
// 重渲染。关键——active 是模块变量,握手完成不会自动触发 React 更新;不通知的话,
// 首屏(握手前)渲染的组件会永久停留在「非 VSCode」态(如工具卡文件名不可点)。
const activeListeners = new Set<() => void>();
// 宿主实时推送的最新编辑器上下文,发消息时同步读取用于自动注入。
let latestContext: EditorContext | null = null;

/** 是否运行在 VSCode 插件的 iframe 中(握手成功后为 true)。 */
export function isInVscode(): boolean {
  return active;
}

/** 订阅握手状态变化(供 useSyncExternalStore)。返回取消订阅函数。 */
export function subscribeVscodeActive(cb: () => void): () => void {
  activeListeners.add(cb);
  return () => activeListeners.delete(cb);
}

let inited = false;

/**
 * 初始化桥接:监听顶层 Webview 的 postMessage。收到 handshake 即认定运行在
 * VSCode 插件中(active=true),回一个 ready。仅在 iframe 内(window.parent!==window)
 * 才真正挂监听——顶层/桌面版/浏览器直接返回。幂等。
 */
export function initBridge(): void {
  if (inited) return;
  inited = true;
  if (!vscodeApi || typeof window === "undefined") return;

  // 监听宿主 webview.postMessage 发来的消息(host→webview)。
  window.addEventListener("message", (e: MessageEvent) => {
    const msg = e.data as { type?: string } | null;
    if (!msg || typeof msg.type !== "string" || !msg.type.startsWith(NS)) return;
    if (msg.type === "localcoding:editorContext") {
      latestContext = (msg as { ctx: EditorContext | null }).ctx;
    }
    listeners.forEach((cb) => cb(msg as HostToWebview));
  });

  // 告知宿主前端已就绪(宿主据此推首屏 editorContext/workspaceRoot)。
  postToHost({ type: "localcoding:ready" });
}

/** 向宿主发消息(vscodeApi.postMessage)。非 VSCode 环境静默丢弃。 */
function postToHost(msg: WebviewToHost): void {
  vscodeApi?.postMessage(msg);
}

/** 把一个 ServerEvent 转发给宿主。非 VSCode 环境 no-op。 */
export function forwardServerEvent(event: ServerEvent): void {
  if (!active) return;
  postToHost({ type: "localcoding:serverEvent", event });
}

/**
 * 请求宿主用原生 diff 审阅一次写操作。仅 VSCode 环境有效(返回 true 表示已委托宿主,
 * 前端应据此【不】渲染 PermissionConfirmCard);非 VSCode 返回 false,走原有卡片流程。
 */
export function requestNativePermission(
  toolUseId: string,
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  if (!active) return false;
  postToHost({ type: "localcoding:permissionRequest", toolUseId, toolName, input });
  return true;
}

/** @文件:请求宿主弹原生 QuickPick 选择工作区文件。仅 VSCode 环境有效。 */
export function requestPickFile(): boolean {
  if (!active) return false;
  postToHost({ type: "localcoding:pickFile" });
  return true;
}

/** 请求宿主在原生编辑器打开文件。仅 VSCode 环境有效。 */
export function requestOpenFile(path: string): boolean {
  if (!active) return false;
  postToHost({ type: "localcoding:openFile", path });
  return true;
}

/** 订阅宿主下发的指令。返回取消订阅函数。 */
export function onHostMessage(cb: (msg: HostToWebview) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** 同步读取宿主最新推送的编辑器上下文(用于发消息时自动注入)。非 VSCode 返回 null。 */
export function getEditorContext(): EditorContext | null {
  return latestContext;
}

/** 把会话列表 + 当前会话推给宿主(供 TreeView 渲染)。非 VSCode 环境 no-op。 */
export function pushSessionsList(sessions: SessionBrief[], activeId: string | null): void {
  if (!active) return;
  postToHost({ type: "localcoding:sessionsList", sessions, activeId });
}
