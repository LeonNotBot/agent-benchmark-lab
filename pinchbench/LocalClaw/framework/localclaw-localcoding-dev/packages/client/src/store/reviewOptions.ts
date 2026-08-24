// 审查选项持久化模块（localStorage，跨会话记忆）
import { SK } from "./storageKeys";

export interface ReviewOptions {
  /** 禁用自动换行（代码区 fixed-width） */
  noWrap: boolean;
  /** 禁用富文本预览，强制纯文本代码展示 */
  plainText: boolean;
  /** 不加载完整文件内容，仅显示 diff 行（性能优化） */
  lazyLoad: boolean;
}

const DEFAULT_OPTIONS: ReviewOptions = {
  noWrap: false,
  plainText: false,
  lazyLoad: false,
};

function loadOptions(): ReviewOptions {
  try {
    const raw = localStorage.getItem(SK.REVIEW_OPTIONS);
    if (raw) return { ...DEFAULT_OPTIONS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_OPTIONS };
}

export function getReviewOptions(): ReviewOptions {
  return loadOptions();
}

export function saveReviewOptions(patch: Partial<ReviewOptions>): void {
  try {
    const next = { ...loadOptions(), ...patch };
    localStorage.setItem(SK.REVIEW_OPTIONS, JSON.stringify(next));
  } catch { /* ignore */ }
}