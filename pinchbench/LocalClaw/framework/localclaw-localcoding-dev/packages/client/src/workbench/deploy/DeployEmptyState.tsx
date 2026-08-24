import { useLocale } from "../../i18n";

type Reason = "noWorkDir" | "emptyDir";

interface Props {
  reason: Reason;
  // emptyDir 时展示具体目录，便于用户确认
  dir?: string;
}

// 部署面板空态：无工作目录 / 目录内没有可打包文件。
// 用图标 + 标题 + 说明的友好版式替代单行灰字。
export function DeployEmptyState({ reason, dir }: Props) {
  const { t } = useLocale();
  const icon = reason === "noWorkDir" ? "📂" : "🗂️";
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="text-3xl opacity-80">{icon}</div>
      <div className="text-sm font-medium text-text-200">
        {t(`deploy.empty.${reason}.title`)}
      </div>
      <div className="max-w-[260px] text-xs leading-relaxed text-text-400">
        {t(`deploy.empty.${reason}.desc`)}
      </div>
      {reason === "emptyDir" && dir && (
        <div className="mt-1 max-w-[260px] truncate rounded bg-bg-100 px-2 py-1 font-mono text-[11px] text-text-400">
          {dir}
        </div>
      )}
    </div>
  );
}
