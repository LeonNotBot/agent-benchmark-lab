import * as vscode from "vscode";

/** 会话树项数据(由 webview 经 sessionsList 推来)。 */
export interface SessionItem {
  id: string;
  title: string;
  status: string;
  updatedAt: number;
}

/**
 * 会话列表原生 TreeView 的数据源。数据单一来源 = webview store(经 bridge
 * sessionsList 推来),此处仅镜像渲染。点击树项触发 localcoding.openSession 命令。
 */
export class SessionTreeProvider implements vscode.TreeDataProvider<SessionItem> {
  private sessions: SessionItem[] = [];
  private activeId: string | null = null;
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  /** 由 ChatViewProvider 收到 webview 的 sessionsList 时调用,刷新树。 */
  setSessions(sessions: SessionItem[], activeId: string | null): void {
    this.sessions = sessions;
    this.activeId = activeId;
    this._onDidChange.fire();
  }

  getChildren(): SessionItem[] {
    return this.sessions;
  }

  getTreeItem(s: SessionItem): vscode.TreeItem {
    const item = new vscode.TreeItem(s.title, vscode.TreeItemCollapsibleState.None);
    item.id = s.id;
    item.description = relativeTime(s.updatedAt);
    item.contextValue = "localcoding.session"; // 供右键菜单 when 条件
    // 运行中转圈图标,当前会话高亮,其余普通对话图标。
    if (s.status === "running") item.iconPath = new vscode.ThemeIcon("loading~spin");
    else if (s.id === this.activeId) item.iconPath = new vscode.ThemeIcon("comment-discussion", new vscode.ThemeColor("charts.blue"));
    else item.iconPath = new vscode.ThemeIcon("comment");
    // 点击 → 切换到该会话。
    item.command = { command: "localcoding.openSession", title: "打开会话", arguments: [s.id] };
    return item;
  }
}

/** 相对时间描述(刚刚/分钟/小时/天前)。 */
function relativeTime(ts: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}
