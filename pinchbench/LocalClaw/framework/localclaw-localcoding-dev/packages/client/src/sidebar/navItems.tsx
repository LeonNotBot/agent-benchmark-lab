// 渚ц竟鏍忋€屾悳绱?/ 鎻掍欢 / 鑷姩鍖栥€嶅鑸」锛?
// 鏁版嵁涓?NavRow 缁勪欢鍏变韩缁欏璇濆垪琛ㄨ鍥?ThreadSidebar)鍜岄潰鏉胯鍥?PanelSidebarContent)锛岄伩鍏嶅浘鏍?璺敱閲嶅瀹氫箟銆?
import type { ReactNode } from "react";
import type { AppView } from "../store/slices/types";

export interface PanelNavItem {
  view: Extract<AppView, "search" | "skills" | "automation" | "connectors" | "channels" | "endpoints" | "secrets">;
  labelKey: string;
  icon: ReactNode;
}

// 鎼滅储鏆傛椂闅愯棌锛屼繚鐣欏畾涔変互渚垮悗缁仮澶嶃€傛彃浠?/ 杩炴帴鍣?/ 鑷姩鍖?/ 娓犻亾 / 妯″瀷鏈嶅姟宸插惎鐢ㄣ€?
// labelKey 鍦ㄦ覆鏌撳缁?t() 瑙ｆ瀽锛屼繚璇佽窡闅忚瑷€鍒囨崲銆?
export const PANEL_NAV_ITEMS: PanelNavItem[] = [
  // {
  //   view: "search",
  //   labelKey: "search.title",
  //   icon: (<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>),
  // },
  {
    view: "skills",
    labelKey: "nav.skills",
    icon: (<path d="M4 7h16M4 12h16M4 17h10" />),
  },
  {
    view: "connectors",
    labelKey: "nav.connectors",
    icon: (<><path d="M9 2v6M15 2v6" /><path d="M7 8h10v3a5 5 0 0 1-10 0z" /><path d="M12 16v6" /></>),
  },
  {
    view: "automation",
    labelKey: "nav.automation",
    icon: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  },
  {
    view: "channels",
    labelKey: "nav.channels",
    icon: (<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />),
  },
  {
    view: "endpoints",
    labelKey: "nav.endpoints",
    icon: (<><rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /><path d="M7 7h.01M7 17h.01" /></>),
  },
  {
    view: "secrets",
    labelKey: "nav.secrets",
    icon: (<><circle cx="8" cy="15" r="4" /><path d="M10.85 12.15 19 4M18 5l2 2M15 8l2 2" /></>),
  },
];

export function NavRow({ label, active, onClick, children }: {
  label: string; active?: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded px-3 py-1.5 text-[13px] transition-colors ${
        active
          ? "bg-[#ECE6E2] font-medium text-text-100 dark:bg-[#242424]"
          : "text-text-200 hover:bg-[#ECE6E2] hover:text-text-100 dark:hover:bg-[#242424]"
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
      {label}
    </button>
  );
}
