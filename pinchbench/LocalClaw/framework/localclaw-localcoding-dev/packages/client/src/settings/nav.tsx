// 设置页左侧导航项定义
import type { ReactNode } from "react";

export type SettingsNavId =
  | "general"
  | "account"
  | "techstack"
  | "developer"
  | "about";

export interface SettingsNavItem {
  id: SettingsNavId;
  /** i18n key，渲染时用 t(label) 解析 */
  label: string;
  icon: ReactNode;
}

const ic = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8">
    {path}
  </svg>
);

export const SETTINGS_NAV: SettingsNavItem[] = [
  {
    id: "general",
    label: "settings.general",
    icon: ic(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></>),
  },
  {
    id: "account",
    label: "settings.navProfile",
    icon: ic(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>),
  },
  {
    id: "techstack",
    label: "settings.navTechstack",
    icon: ic(<><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></>),
  },
  {
    id: "developer",
    label: "settings.navDeveloper",
    icon: ic(<><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /><line x1="12" y1="2" x2="12" y2="22" /></>),
  },
  {
    id: "about",
    label: "settings.navAbout",
    icon: ic(<><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></>),
  },
];
