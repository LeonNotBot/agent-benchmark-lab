// 璁剧疆妯″紡涓嬶紝宸﹁竟鏍忓鐢?ThreadSidebar 鐨勫鍣紝鍐呭鏇挎崲涓猴細杩斿洖搴旂敤 + 璁剧疆瀵艰埅椤?
import { useAppStore } from "../store/useAppStore";
import { useLocale } from "../i18n";
import { SETTINGS_NAV } from "./nav";

export function SettingsSidebarContent() {
  const setSettingsPanelOpen = useAppStore((s) => s.setSettingsPanelOpen);
  const settingsNav = useAppStore((s) => s.settingsNav);
  const setSettingsNav = useAppStore((s) => s.setSettingsNav);
  const { t } = useLocale();

  return (
    <div className="flex h-full flex-col">
      {/* 椤堕儴锛氳繑鍥炲簲鐢?*/}
      <div className="px-2 pt-3">
        <button
          onClick={() => setSettingsPanelOpen(false)}
          className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm font-medium text-text-200 transition-colors hover:bg-[#ECE6E2] dark:hover:bg-[#242424]"
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {t("settings.back")}
        </button>
      </div>

      {/* 璁剧疆瀵艰埅椤?*/}
      <nav className="flex-1 overflow-y-auto px-2 pt-2 pb-2 [scrollbar-gutter:stable]">
        {SETTINGS_NAV.map((item) => (
          <button
            key={item.id}
            onClick={() => setSettingsNav(item.id)}
            className={`mb-0.5 flex w-full items-center gap-2.5 rounded px-3 py-2 text-left text-sm transition-colors ${
              settingsNav === item.id
                ? "bg-[#ECE6E2] font-medium text-text-100 dark:bg-[#242424]"
                : "text-text-300 hover:bg-[#ECE6E2] hover:text-text-200 dark:hover:bg-[#242424]"
            }`}
          >
            {item.icon}
            {t(item.label)}
          </button>
        ))}
      </nav>
    </div>
  );
}
