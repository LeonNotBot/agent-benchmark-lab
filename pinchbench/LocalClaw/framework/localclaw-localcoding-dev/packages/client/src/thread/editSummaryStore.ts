// 汇总卡片的撤销/重新应用状态（按 roundKey 维度，跨组件持久）。
// 只存「状态」——after 快照由后端按 roundKey 落服务端文件持有，前端不碰文件内容，
// 故 localStorage 每条仅几字节，无配额问题。刷新后恢复「已撤销」态，重新应用走后端快照。
import { create } from "zustand";
import { SK } from "../store/storageKeys";

export type RoundStatus = "applied" | "reverting" | "reverted" | "reapplying";

export type RoundRevertState = { status: RoundStatus };

interface EditSummaryStore {
  // roundKey -> 撤销状态；未出现的 roundKey 视为 applied
  byRound: Record<string, RoundRevertState>;
  setState: (roundKey: string, next: RoundRevertState) => void;
  get: (roundKey: string) => RoundRevertState;
}

const DEFAULT: RoundRevertState = { status: "applied" };

// 仅持久化「已撤销」轮次：磁盘处于 before 态、待重新应用，需跨刷新恢复。
// applied 为默认态无需存；瞬时态(reverting/reapplying)刷新后本就该丢弃。
function load(): Record<string, RoundRevertState> {
  try {
    const raw = localStorage.getItem(SK.EDIT_SUMMARY_REVERTS);
    if (!raw) return {};
    const keys = JSON.parse(raw) as string[];
    const out: Record<string, RoundRevertState> = {};
    for (const key of keys) out[key] = { status: "reverted" };
    return out;
  } catch {
    return {};
  }
}

function persist(byRound: Record<string, RoundRevertState>): void {
  try {
    const reverted = Object.keys(byRound).filter((k) => byRound[k].status === "reverted");
    if (reverted.length === 0) localStorage.removeItem(SK.EDIT_SUMMARY_REVERTS);
    else localStorage.setItem(SK.EDIT_SUMMARY_REVERTS, JSON.stringify(reverted));
  } catch {
    /* 隐私模式等不可写：忽略，运行时内存状态不受影响 */
  }
}

export const useEditSummaryStore = create<EditSummaryStore>((set, get) => ({
  byRound: load(),
  setState: (roundKey, next) =>
    set((s) => {
      const byRound = { ...s.byRound, [roundKey]: next };
      persist(byRound);
      return { byRound };
    }),
  get: (roundKey) => get().byRound[roundKey] ?? DEFAULT,
}));
