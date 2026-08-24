// 设置页外壳：左侧导航 + 右侧内容区，点击左边栏"设置"按钮触发
import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useLocale } from "../i18n";
import { SETTINGS_NAV, type SettingsNavId } from "./nav";
import {
  AccountSection, GeneralSection, TechStackSettingsSection,
  AboutSection,
} from "./sections";

export function SettingsShell() {
  const open = useAppStore((s) => s.settingsPanelOpen);
  const setOpen = useAppStore((s) => s.setSettingsPanelOpen);
  const { t } = useLocale();
  const [activeId, setActiveId] = useState<SettingsNavId>("general");

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex bg-bg-100">
      {/* 左侧导航栏 */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-border-300 bg-bg-000 pt-4">
        {/* 返回按钮 */}
        <button
          onClick={() => setOpen(false)}
          className="mx-3 mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-text-300 transition-colors hover:bg-bg-200 hover:text-text-200"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {t("settings.back")}
        </button>

        <div className="px-2 pb-1">
          <span className="px-3 text-[10px] font-semibold uppercase tracking-widest text-text-400">{t("settings.title")}</span>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pt-1">
          {SETTINGS_NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveId(item.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                activeId === item.id
                  ? "bg-bg-300 font-medium text-text-100"
                  : "text-text-300 hover:bg-bg-200 hover:text-text-200"
              }`}
            >
              {item.icon}
              {t(item.label)}
            </button>
          ))}
        </nav>
      </aside>

      {/* 右侧内容区 */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-xl px-8 py-8">
          {activeId === "account"    && <AccountSection />}
          {activeId === "general"    && <GeneralSection />}
          {activeId === "techstack"  && <TechStackSettingsSection />}
          {activeId === "about"      && <AboutSection />}
        </div>
      </main>
    </div>
  );
}
