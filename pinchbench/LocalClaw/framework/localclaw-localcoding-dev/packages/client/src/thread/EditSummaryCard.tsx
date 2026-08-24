// 对话流汇总卡片（1.png / 5.png）：「已编辑 N 个文件 +X -Y」+ 文件列表 + 撤销/重新应用/审核。
// 撤销依赖 git（4.png）：非 git 仓库弹提示。撤销↔重新应用可逆 toggle。
import { useState } from "react";
import { useLocale } from "../i18n";
import { useWorkbenchStore } from "../workbench/store";
import { useEditSummaryStore } from "./editSummaryStore";
import { NeedGitDialog } from "./NeedGitDialog";
import { SummaryHeader } from "./EditSummaryParts";
import { apiGitCheck, apiRevertRound, apiReapplyRound } from "../api/session";
import type { RoundSummary } from "./EditSummaryContext";

interface Props {
  sessionId: string;
  summary: RoundSummary;
}

export function EditSummaryCard({ sessionId, summary }: Props) {
  const { t } = useLocale();
  const setRightPanelOpen = useWorkbenchStore((s) => s.setRightPanelOpen);
  const openTab = useWorkbenchStore((s) => s.openWorkbenchTab);
  const revertState = useEditSummaryStore((s) => s.byRound[summary.roundKey]) ?? { status: "applied" };
  const setState = useEditSummaryStore((s) => s.setState);
  const [needGit, setNeedGit] = useState(false);
  const [needGitReason, setNeedGitReason] = useState<"not-git" | "no-head">("not-git");

  const files = summary.diffs;
  const totalAdded = files.reduce((s, d) => s + (d.linesAdded ?? 0), 0);
  const totalRemoved = files.reduce((s, d) => s + (d.linesRemoved ?? 0), 0);
  const busy = revertState.status === "reverting" || revertState.status === "reapplying";
  const reverted = revertState.status === "reverted";

  const onReview = () => {
    setRightPanelOpen(true);
    openTab("review");
  };

  const onRevert = async () => {
    if (busy) return;
    // 4.png：撤销前置校验，非 git 仓库弹提示
    const isGit = await apiGitCheck(sessionId);
    if (!isGit) { setNeedGitReason("not-git"); setNeedGit(true); return; }
    setState(summary.roundKey, { status: "reverting" });
    // 快照落服务端（按 roundKey 隔离），前端只需传 roundKey + 本轮文件路径。
    const res = await apiRevertRound(sessionId, summary.roundKey, files.map((d) => d.path));
    if (res.ok) {
      setState(summary.roundKey, { status: "reverted" });
    } else if (res.reason === "not-git" || res.reason === "no-head") {
      // not-git（非 git 仓库）与 no-head（无 commit/无可恢复基线）文案不同，按 reason 区分提示。
      setState(summary.roundKey, { status: "applied" });
      setNeedGitReason(res.reason);
      setNeedGit(true);
    } else {
      setState(summary.roundKey, { status: "applied" });
    }
  };

  const onReapply = async () => {
    if (busy) return;
    setState(summary.roundKey, { status: "reapplying" });
    // 后端按 roundKey 从服务端快照目录读回写盘。
    const ok = await apiReapplyRound(sessionId, summary.roundKey);
    setState(summary.roundKey, { status: ok ? "applied" : "reverted" });
  };

  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-border-200 bg-bg-000 shadow-card">
      <SummaryHeader
        fileCount={files.length}
        firstFile={files[0]?.path}
        totalAdded={totalAdded}
        totalRemoved={totalRemoved}
        reverted={reverted}
        busy={busy}
        onRevert={onRevert}
        onReapply={onReapply}
        onReview={onReview}
        t={t}
      />
      {/* 文件列表 */}
      <div className="divide-y divide-border-100 border-t border-border-100">
        {files.map((d) => (
          <div key={d.path} className="flex items-center gap-2 px-4 py-2 text-xs">
            <span className="flex-1 truncate font-mono text-text-300">{d.path}</span>
            <span className="shrink-0 text-green-600">+{d.linesAdded ?? 0}</span>
            <span className="shrink-0 text-red-600">-{d.linesRemoved ?? 0}</span>
          </div>
        ))}
      </div>
      <NeedGitDialog open={needGit} reason={needGitReason} onClose={() => setNeedGit(false)} />
    </div>
  );
}
