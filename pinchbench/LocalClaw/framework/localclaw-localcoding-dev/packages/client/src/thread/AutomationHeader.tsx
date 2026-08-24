// cron(定时任务)会话：在消息列表顶部渲染 Automation 元信息块 + prompt 正文。
// 数据来源：全部执行记录(sessionId→taskId 映射) + raw task(取 prompt)。
// cron 执行不记录 user_prompt 消息，故 prompt 正文也在此块内展示。
import { useEffect, useState } from "react";
import {
  apiListAllExecutions,
  apiGetRawAutomation,
  type RawScheduledTask,
} from "../api/automation";
import { useAppStore } from "../store/useAppStore";
import { useLocale } from "../i18n";

interface Props {
  sessionId: string;
  /** 兜底：未匹配到执行记录时用会话标题(去掉「[定时] 」前缀)。 */
  fallbackTitle?: string;
}

interface Meta {
  name: string;
  taskId: string;
  lastRunAt: number;
  prompt: string;
  /** conversation 类型不显示卡片（改走消息徽标），此处用于让组件返回 null。 */
  isConversation: boolean;
}

export function AutomationHeader({ sessionId, fallbackTitle }: Props) {
  const { t } = useLocale();
  const [meta, setMeta] = useState<Meta | null>(null);
  const setSessionRunConfig = useAppStore((s) => s.setSessionRunConfig);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const execs = await apiListAllExecutions().catch(() => []);
      const exec = execs.find((e) => e.sessionId === sessionId);
      let raw: RawScheduledTask | null = null;
      if (exec?.taskId) raw = await apiGetRawAutomation(exec.taskId).catch(() => null);
      if (!alive) return;
      const name = raw?.name ?? exec?.taskName
        ?? (fallbackTitle ?? "").replace(/^\[定时\]\s*/, "") ?? t("auto.fallbackName");
      setMeta({
        name,
        taskId: exec?.taskId ?? raw?.id ?? "—",
        lastRunAt: exec?.startTime ?? raw?.lastRunAt ?? 0,
        prompt: raw?.prompt ?? "",
        isConversation: raw?.taskType === "conversation",
      });
      // cron 会话用的模型存在任务记录里，后端不随会话持久化，故进 store 时 model 为空，
      // 输入框 ModelChip 会回退成全局默认。此处把任务配置的 model/endpointId 同步回会话，
      // 使继续对话沿用该模型。仅在会话尚无 model 时写，避免覆盖用户手动选择。
      if (raw?.model) {
        const cur = useAppStore.getState().sessions[sessionId];
        if (cur && !cur.model) setSessionRunConfig(sessionId, { model: raw.model, endpointId: raw.endpointId });
      }
    })();
    return () => { alive = false; };
  }, [sessionId, fallbackTitle, setSessionRunConfig, t]);

  if (!meta || meta.isConversation) return null;
  return <HeaderView meta={meta} />;
}

function HeaderView({ meta }: { meta: Meta }) {
  const lastRun = meta.lastRunAt
    ? `${new Date(meta.lastRunAt).toISOString()} (${meta.lastRunAt})`
    : "—";
  return (
    <div className="mb-4 rounded-xl border border-border-300 bg-bg-100 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-accent-brand/15 px-1.5 py-0.5 text-[11px] font-medium text-accent-brand">
          Automation
        </span>
        <span className="text-sm font-medium text-text-100">{meta.name}</span>
      </div>
      <dl className="space-y-1 font-mono text-[11px] leading-relaxed text-text-400">
        <Row label="Automation ID" value={meta.taskId} />
        <Row label="Last run" value={lastRun} />
      </dl>
      {meta.prompt && (
        <div className="mt-3 whitespace-pre-wrap border-t border-border-300 pt-3 text-sm text-text-200">
          {meta.prompt}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-text-300">{label}:</dt>
      <dd className="min-w-0 break-all text-text-400">{value}</dd>
    </div>
  );
}

