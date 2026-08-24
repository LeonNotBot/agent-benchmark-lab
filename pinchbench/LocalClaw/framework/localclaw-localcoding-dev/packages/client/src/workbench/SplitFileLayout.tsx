// 通用左右分栏外壳：左预览 / 可拖分割线 / 右文件列表。
// Files 与 Review 两个 Tab 复用：预览与列表内容均由 children 注入。
// 顶栏：左显当前文件路径，右显「文件夹开合按钮 + 打开下拉」。
// 分割线向右拖到阈值自动动画收起列表；收起后点文件夹按钮弹回。
import { useState, type ReactNode } from "react";
import { useSplitResize } from "../hooks/useSplitResize";
import { useLocale } from "../i18n";
import { OpenMenu } from "./OpenMenu";
import { FileFilterInput } from "./FileFilterInput";

interface Props {
  // 当前选中文件路径（顶栏展示 + 打开菜单启用判断）
  filePath: string | null;
  // 项目根目录（工作目录）：面包屑以此为起点显示相对路径，不再从盘符开始
  rootDir?: string;
  // 左侧预览区内容
  preview: ReactNode;
  // 右侧列表内容（树 / diff 列表）
  list: ReactNode;
  // 筛选框状态
  filter: string;
  onFilterChange: (v: string) => void;
  // 打开动作
  onOpenDefaultApp: () => void;
  onRevealInFolder: () => void;
  // 顶栏路径左侧的附加内容（如审阅 tab 的项目名/统计），可选
  headerExtra?: ReactNode;
  // 顶栏右侧、「显示/隐藏列表」按钮左边的附加内容（如审阅 tab 的 ⋮ 菜单），可选
  headerRight?: ReactNode;
  // 隐藏路径面包屑（审阅 tab 不显示路径），可选
  hideBreadcrumb?: boolean;
  // 隐藏「打开」下拉（审阅 tab 不需要），可选
  hideOpenMenu?: boolean;
}

export function SplitFileLayout(props: Props) {
  const { filePath, rootDir, preview, list, filter, onFilterChange, onOpenDefaultApp, onRevealInFolder, headerExtra, headerRight, hideBreadcrumb, hideOpenMenu } = props;
  const { t } = useLocale();
  // 列表收起态：由拖拽越阈值触发收起（onCollapse），由文件夹按钮切换。
  // listWidth 始终保存「展开时的宽度」，收起只是把渲染宽度过渡到 0，不改 listWidth，便于弹回。
  const [listCollapsed, setListCollapsed] = useState(false);
  const { listWidth, isDragging, handleDragStart } = useSplitResize(() => setListCollapsed(true));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 顶栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-200 shrink-0">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {headerExtra}
          {!hideBreadcrumb && <Breadcrumb filePath={filePath} rootDir={rootDir} />}
        </div>
        {headerRight}
        <button
          onClick={() => setListCollapsed((v) => !v)}
          aria-label={listCollapsed ? t("files.showList") : t("files.hideList")}
          title={listCollapsed ? t("files.showList") : t("files.hideList")}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border-300 hover:bg-bg-200 ${listCollapsed ? "bg-bg-200 text-text-100" : "text-text-400 hover:text-text-200"}`}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
          </svg>
        </button>
        {!hideOpenMenu && (
          <OpenMenu filePath={filePath} onOpenDefaultApp={onOpenDefaultApp} onRevealInFolder={onRevealInFolder} />
        )}
      </div>

      {/* 主体：左预览 + 分割线 + 右列表 */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* 左预览 */}
        <div className="min-w-0 flex-1 overflow-auto">{preview}</div>

        {/* 分割线（列表收起时隐藏） */}
        {!listCollapsed && (
          <div
            onMouseDown={handleDragStart}
            className="group relative z-10 flex w-1.5 shrink-0 cursor-col-resize justify-center"
          >
            <div className="h-full w-px bg-border-200 transition-colors group-hover:bg-accent-brand/60" />
          </div>
        )}

        {/* 右列表：固定宽度，收起时宽度过渡到 0。左边界线由上面的分割线承担，此处不再加 border-l 以免双线 */}
        <div
          className="flex shrink-0 flex-col overflow-hidden"
          style={{
            width: listCollapsed ? 0 : `${listWidth}px`,
            transition: isDragging ? "none" : "width 220ms ease",
          }}
        >
          <FileFilterInput value={filter} onChange={onFilterChange} />
          <div className="min-h-0 flex-1 overflow-y-auto">{list}</div>
        </div>
      </div>
    </div>
  );
}

// 计算面包屑分段：以项目根目录（rootDir）为起点。
// filePath 在 rootDir 内 → 返回「根目录名 + 其下各级段」；
// 否则（无 rootDir 或不在其内）回退为文件名末段，避免暴露完整绝对路径。
function relativeParts(filePath: string, rootDir?: string): string[] {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const fileSegs = norm(filePath).split("/").filter(Boolean);
  if (!rootDir) return fileSegs.slice(-1);
  const rootSegs = norm(rootDir).split("/").filter(Boolean);
  const rootName = rootSegs[rootSegs.length - 1] ?? "";
  // 逐段比较前缀（大小写不敏感，兼容 Windows 盘符大小写差异）
  const inRoot =
    fileSegs.length >= rootSegs.length &&
    rootSegs.every((s, i) => s.toLowerCase() === fileSegs[i].toLowerCase());
  if (!inRoot) return fileSegs.slice(-1);
  return [rootName, ...fileSegs.slice(rootSegs.length)];
}

// 顶栏路径面包屑：以项目根目录为起点显示（根目录名 + 其下相对段），不从盘符/绝对根开始。
// 用 › 分隔，末段（文件名）加深；段数过多时只保留末尾若干段，前面用省略号占位。
function Breadcrumb({ filePath, rootDir }: { filePath: string | null; rootDir?: string }) {
  if (!filePath) {
    return <span className="truncate text-[13px] text-text-400">/</span>;
  }
  const parts = relativeParts(filePath, rootDir);
  const MAX = 4;
  const shown = parts.length > MAX ? parts.slice(-MAX) : parts;
  const truncated = parts.length > MAX;
  return (
    <div className="flex min-w-0 items-center gap-1 truncate text-[13px]">
      {truncated && <span className="shrink-0 text-text-400">…</span>}
      {truncated && <Sep />}
      {shown.map((seg, i) => {
        const isLast = i === shown.length - 1;
        return (
          <span key={i} className="flex min-w-0 items-center gap-1">
            <span className={`truncate ${isLast ? "font-medium text-text-100" : "text-text-400"}`}>{seg}</span>
            {!isLast && <Sep />}
          </span>
        );
      })}
    </div>
  );
}

function Sep() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-text-400" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
