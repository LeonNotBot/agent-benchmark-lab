// 手动创建弹窗/编辑页底栏的额外控件：已置顶会话下拉(图 32/36)。
// 计划控件已拆分到 ScheduleControl.tsx；模型选择已统一改用 thread/ModelChip（供应商→模型二级菜单）。
import { useLocale } from "../i18n";
import { Dropdown } from "./ManualCreateFooter";

// ── 已置顶会话下拉(图 32.png)。无置顶会话时灰显(图 36.png) ──
export function PinnedConvoDropdown({ convos, value, onChange }: {
  convos: { id: string; title: string; date: string }[]; value: string; onChange: (id: string) => void;
}) {
  const { t } = useLocale();
  const cur = convos.find((c) => c.id === value);
  return (
    <Dropdown label={<span className="max-w-[150px] truncate">{cur ? cur.title : t("auto.selectPinnedConvo")}</span>} disabled={convos.length === 0}>
      {(close) => (
        <div className="max-h-[50vh] w-56 overflow-y-auto">
          <div className="px-3.5 pb-1 pt-0.5 text-[11px] font-medium text-text-400">{t("auto.targetConvo")}</div>
          {convos.map((c) => {
            const active = c.id === value;
            return (
              <button key={c.id} onClick={() => { onChange(c.id); close(); }}
                className="flex w-full items-center gap-2 px-3.5 py-2 text-left transition-colors hover:bg-bg-200">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-text-400" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 4l6 2.5M5 8l3-1.5M5 8l1 11a1 1 0 001 1h10a1 1 0 001-1l1-11M5 8h14" /></svg>
                <span className="min-w-0">
                  <span className={`block truncate text-[13px] ${active ? "text-accent-text font-medium" : "text-text-100"}`}>{c.title}</span>
                  <span className="block text-[11px] text-text-400">{c.date}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Dropdown>
  );
}
