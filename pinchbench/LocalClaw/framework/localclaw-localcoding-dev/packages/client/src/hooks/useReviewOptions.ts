// 审查选项 hook（响应式 localStorage）
import { useState, useCallback } from "react";
import { getReviewOptions, saveReviewOptions } from "../store/reviewOptions";
import type { ReviewOptions } from "../store/reviewOptions";

export function useReviewOptions() {
  const [opts, setOpts] = useState<ReviewOptions>(() => getReviewOptions());

  const toggle = useCallback((key: keyof ReviewOptions) => {
    setOpts(prev => {
      const next = { ...prev, [key]: !prev[key] };
      saveReviewOptions({ [key]: next[key] });
      return next;
    });
  }, []);

  return { opts, toggle };
}