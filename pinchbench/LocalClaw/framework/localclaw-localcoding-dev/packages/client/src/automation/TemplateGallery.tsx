// 模板库视图(图 2/3/4.png)：网格卡片，hover 高亮，点击回填表单。
// 顶部标题「自动化模板」+ 右上「手动设置」返回按钮。文案经 t() 走 i18n；模板正文按 locale 取 zh/en。
import { useLocale } from "../i18n";
import { TEMPLATES, type AutomationTemplate } from "./templates";

// 卡片左上角彩色图标：按索引轮换一组柔和底色，纯装饰。
const ICON_TINTS = [
  "bg-rose-100 text-rose-500", "bg-amber-100 text-amber-500",
  "bg-emerald-100 text-emerald-500", "bg-sky-100 text-sky-500",
  "bg-violet-100 text-violet-500", "bg-cyan-100 text-cyan-500",
  "bg-orange-100 text-orange-500", "bg-indigo-100 text-indigo-500",
];

interface Props {
  onPick: (tpl: AutomationTemplate) => void;
  onBack: () => void;
  onClose: () => void;
}

export function TemplateGallery({ onPick, onBack, onClose }: Props) {
  const { t, locale } = useLocale();
  const isZh = locale !== "en";

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏：标题 + 手动设置(按钮样式) + 关闭 */}
      <div className="flex shrink-0 items-center justify-between px-1 pb-3">
        <h2 className="text-lg font-semibold text-text-100">{t("auto.tplTitle")}</h2>
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="rounded-full border border-border-300 px-3 py-1 text-[13px] font-medium text-text-100 transition-colors hover:bg-bg-200">
            {t("auto.tplManual")}
          </button>
          <button onClick={onClose} aria-label={t("auto.close")} className="flex h-7 w-7 items-center justify-center rounded-lg text-text-400 transition-colors hover:bg-bg-200 hover:text-text-200">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      {/* 卡片网格 */}
      <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto pr-1">
        {TEMPLATES.map((tpl, i) => (
          <button
            key={tpl.id}
            onClick={() => onPick(tpl)}
            className="group flex min-h-[160px] flex-col gap-2 rounded-xl border border-border-300 bg-bg-000 p-3.5 text-left transition-colors hover:border-accent-brand/40 hover:bg-bg-100"
          >
            <div className="flex items-center gap-2">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${ICON_TINTS[i % ICON_TINTS.length]}`}>
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
              </span>
              <span className="truncate text-sm font-medium text-text-100">{isZh ? tpl.title.zh : tpl.title.en}</span>
            </div>
            <p className="whitespace-pre-line text-xs leading-relaxed text-text-100">
              {isZh ? tpl.prompt.zh : tpl.prompt.en}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
