// 删除会话守卫：若会话绑定了 conversation 类型定时任务，删除前弹窗告知
// 「关联自动化将被一并删除」，用户确认后才放行。无绑定任务则直接放行。
//
// 实际的任务删除由后端 onSessionDelete 级联完成（见 websocket.gateway），
// 这里只负责「知情同意」，不重复发删除请求。
import { useCallback } from "react";
import { useLocale } from "../i18n";
import { confirmDialog } from "../components/ConfirmDialog";
import { apiListAutomationsBySession } from "../api/automation";

/**
 * 返回一个异步守卫：guard(sessionId) → 是否继续删除。
 * - 无绑定任务：直接 true（不弹窗，保留侧栏原有行内二段式确认体验）。
 * - 有绑定任务：弹窗列出任务名提示一并删除，用户确认 true / 取消 false。
 * - 查询失败：放行 true（不因附带提示失败而阻断主操作）。
 */
export function useDeleteSessionGuard(): (sessionId: string) => Promise<boolean> {
  const { t } = useLocale();

  return useCallback(
    async (sessionId: string): Promise<boolean> => {
      let bound: Array<{ id: string; name: string }> = [];
      try {
        bound = await apiListAutomationsBySession(sessionId);
      } catch {
        return true; // 查询失败不阻断删除
      }
      if (bound.length === 0) return true;

      const names = bound.map((b) => `「${b.name}」`).join("、");
      return confirmDialog({
        title: t("sidebar.deleteWithAutomationTitle"),
        message: t("sidebar.deleteWithAutomationMessage", {
          count: bound.length,
          names,
        }),
        confirmText: t("sidebar.delete"),
        danger: true,
      });
    },
    [t],
  );
}
