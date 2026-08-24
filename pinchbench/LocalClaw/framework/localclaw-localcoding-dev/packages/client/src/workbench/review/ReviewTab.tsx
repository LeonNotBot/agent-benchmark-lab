// 审查标签：文件树 + 差异视图 + 工具栏（只展示差异，不再区分源文件）
import { useState, useEffect, useCallback, useMemo } from "react";
import type { FileDiff } from "@lenovo/agent-protocol";
import { useLocale } from "../../i18n";
import { useAppStore } from "../../store/useAppStore";
import { useReviewOptions } from "../../hooks/useReviewOptions";
import { buildFullSideBySide, foldContext } from "./reviewDiffModel";
import type { ReviewLine } from "./reviewDiffModel";
import { buildReviewTree, ReviewFileTreeNode } from "./ReviewFileTree";
import { apiGetSessionToolDiff } from "../../api/session";
import { useEditSummaryStore } from "../../thread/editSummaryStore";
import { ReviewMenu } from "./ReviewMenu";
import { ReviewVersionMenu } from "./ReviewVersionMenu";
import { ReviewDiff } from "./ReviewDiff";
import { SplitFileLayout } from "../SplitFileLayout";

interface Props {
  workDir: string;
  filePath?: string | null;
}

type LoadState = "idle" | "loading" | "done" | "error";

// diff.path 多为相对 workDir 的路径；拼成绝对路径供打开/定位用（已是绝对则原样返回）。
function absPath(workDir: string, p: string): string {
  if (/^([a-zA-Z]:[\\/]|\/)/.test(p)) return p;
  const base = workDir.replace(/[\\/]+$/, "");
  return `${base}/${p}`;
}

export function ReviewTab({ workDir, filePath }: Props) {
  const { opts, toggle } = useReviewOptions();
  const { t } = useLocale();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  // 订阅撤销/重新应用状态变化：卡片撤销改了磁盘文件，需刷新 session-diff（buildSessionDiff 读磁盘）。
  // byRound 引用变化即触发，不需要关心具体哪轮。
  const revertByRound = useEditSummaryStore((s) => s.byRound);
  const [diffs, setDiffs] = useState<FileDiff[]>([]);
  const [loadingDiffs, setLoadingDiffs] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [sideLeft, setSideLeft] = useState<ReviewLine[]>([]);
  const [sideRight, setSideRight] = useState<ReviewLine[]>([]);
  const [expandedFolds, setExpandedFolds] = useState<Set<number>>(new Set());
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [filter, setFilter] = useState("");

  // 「不加载完整文件」(opts.lazyLoad) = 折叠无变更行：变更行附近保留少量上下文，
  // 其余连续未变更区折成「N unmodified lines」可展开条。关闭则展示文件全部行。
  // 作为持久设置，切换后当前预览与新打开文件都遵循。
  const foldUnchanged = opts.lazyLoad;

  // 加载「上一轮」diff：本会话工具调用累计（Write/Edit/MultiEdit 重建），不依赖 git 工作区。
  const loadDiffs = useCallback(async () => {
    if (!activeSessionId) { setDiffs([]); return; }
    setLoadingDiffs(true);
    try {
      setDiffs(await apiGetSessionToolDiff(activeSessionId));
    } catch { setDiffs([]); }
    setLoadingDiffs(false);
  }, [activeSessionId]);

  // loadDiffs 随 activeSessionId 变；revertByRound 变化（撤销/重新应用）也触发重载。
  useEffect(() => { loadDiffs(); }, [loadDiffs, revertByRound]);

  // 选中文件 → 加载差异（只展示 diff，不再加载源文件）
  const selectFile = useCallback((path: string) => {
    setSelectedPath(path);
    setExpandedFolds(new Set());
    setLoadState("loading");

    const diff = diffs.find(d => d.path === path);
    if (diff) {
      const { left, right } = buildFullSideBySide(diff);
      setSideLeft(left);
      setSideRight(right);
    } else {
      setSideLeft([]);
      setSideRight([]);
    }
    setLoadState("done");
  }, [diffs]);

  // diffs 变化后：已有选中则刷新；否则（首次打开/切会话）默认选中第一个文件并打开其 diff。
  useEffect(() => {
    if (diffs.length === 0) {
      // 变更全部消失（如撤销全部/切到无编辑会话）：清空选中与预览，否则会残留上一文件的旧 diff。
      setSelectedPath(null);
      setSideLeft([]);
      setSideRight([]);
      return;
    }
    if (selectedPath && diffs.some(d => d.path === selectedPath)) {
      // 选中的文件仍在新 diffs 里 → 刷新它。
      selectFile(selectedPath);
    } else {
      // 无选中，或选中的文件已不在（如撤销后消失）→ 回落到第一个。
      selectFile(diffs[0].path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffs]);

  // 用系统默认程序打开当前文件
  const openDefaultApp = useCallback(() => {
    if (!selectedPath) return;
    fetch("/api/workspace/open-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: absPath(workDir, selectedPath) }),
    }).catch(() => {});
  }, [selectedPath, workDir]);

  // 打开所在文件夹并选中当前文件
  const revealInFolder = useCallback(() => {
    if (!selectedPath) return;
    fetch("/api/workspace/reveal-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: absPath(workDir, selectedPath) }),
    }).catch(() => {});
  }, [selectedPath, workDir]);

  const selectedDiff = diffs.find(d => d.path === selectedPath);

  // 折叠未变更行（2.png）：foldUnchanged 时折叠连续未变更区，否则展示全部行。
  // useMemo：foldContext 为 O(n)，避免每次 render（filter 输入/展开切换等）都重折大文件。
  const folded = useMemo(
    () => (foldUnchanged ? foldContext(sideLeft, sideRight, expandedFolds) : { left: sideLeft, right: sideRight }),
    [foldUnchanged, sideLeft, sideRight, expandedFolds],
  );

  // 顶栏统计：全部变更文件的 +/- 总和（2.png「+79 -101」）。
  const totalAdded = diffs.reduce((s, d) => s + (d.linesAdded ?? 0), 0);
  const totalRemoved = diffs.reduce((s, d) => s + (d.linesRemoved ?? 0), 0);

  const expandFold = (foldStart: number) =>
    setExpandedFolds(prev => new Set(prev).add(foldStart));

  // 右侧列表：diff 文件树（按 filter 过滤路径后再建树，对齐「文件」tab 树状观感，4.png）
  // 注意：useMemo 必须在任何提前 return 之前调用（Rules of Hooks）。
  const shownDiffs = filter
    ? diffs.filter(d => d.path.toLowerCase().includes(filter.toLowerCase()))
    : diffs;
  const tree = useMemo(() => buildReviewTree(shownDiffs), [shownDiffs]);

  if (!workDir) {
    return <div className="p-4 text-xs text-text-400 text-center">{t("deploy.noWorkDir")}</div>;
  }

  const listNode = (
    <div className="py-1">
      {loadingDiffs ? (
        <div className="px-3 py-2 text-xs text-text-400">{t("review.loading")}</div>
      ) : shownDiffs.length === 0 ? (
        <div className="px-3 py-2 text-xs text-text-400">{t("review.noChanges")}</div>
      ) : tree.map(node => (
        <ReviewFileTreeNode
          key={node.path}
          node={node}
          depth={0}
          onSelectFile={selectFile}
          selectedPath={selectedPath}
        />
      ))}
    </div>
  );

  // 左侧预览：白底顶部条（当前文件路径 + 该文件 +/- 变更行数）+ 差异内容；未选中时空态。
  // 不再区分「差异对比 / 源文件」，只展示差异（1.png）。
  const previewNode = !selectedPath ? (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-text-400">
      <span className="text-sm">{t("review.noFileSelected")}</span>
    </div>
  ) : (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 顶部条：白底 + 文件路径 + 该文件变更行数 */}
      <div className="flex items-center gap-2 border-b border-border-200 bg-white px-3 py-2 shrink-0 dark:bg-zinc-900">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-200">{selectedPath}</span>
        {selectedDiff && (
          <span className="shrink-0 text-xs whitespace-nowrap">
            <span className="text-green-600">+{selectedDiff.linesAdded ?? 0}</span>{" "}
            <span className="text-red-600">-{selectedDiff.linesRemoved ?? 0}</span>
          </span>
        )}
      </div>
      {/* 内容：始终展示差异 */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {loadState === "loading" ? (
          <div className="flex items-center justify-center h-full text-text-400 text-sm">{t("review.loading")}</div>
        ) : sideLeft.length > 0 ? (
          <ReviewDiff left={folded.left} right={folded.right} noWrap={opts.noWrap} onExpandFold={expandFold} />
        ) : (
          <div className="flex items-center justify-center h-full text-text-400 text-sm">
            {selectedDiff ? t("review.hunkOnly") : t("review.noFileSelected")}
          </div>
        )}
      </div>
    </div>
  );

  // 顶栏左侧：版本选择器「上一轮 ▾」+ 总统计（3.png / 2.png）。不显示路径。
  const headerExtra = (
    <div className="flex items-center gap-2">
      <ReviewVersionMenu />
      <span className="text-xs whitespace-nowrap">
        <span className="text-green-600">+{totalAdded}</span>{" "}
        <span className="text-red-600">-{totalRemoved}</span>
      </span>
    </div>
  );

  // 顶栏右侧（显示/隐藏列表按钮左边）：⋮ 选项菜单（刷新 / 换行 / 加载完整文件）。
  const headerRight = (
    <ReviewMenu
      options={opts}
      onToggle={toggle}
      onRefresh={loadDiffs}
    />
  );

  return (
    <SplitFileLayout
      filePath={selectedPath}
      rootDir={workDir}
      preview={previewNode}
      list={listNode}
      filter={filter}
      onFilterChange={setFilter}
      onOpenDefaultApp={openDefaultApp}
      onRevealInFolder={revealInFolder}
      headerExtra={headerExtra}
      headerRight={headerRight}
      hideBreadcrumb
      hideOpenMenu
    />
  );
}