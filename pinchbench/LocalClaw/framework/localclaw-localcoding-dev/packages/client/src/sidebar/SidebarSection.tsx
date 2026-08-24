// 渚ф爮鍒嗙粍锛氭爣棰?+ 鎶樺彔/灞曞紑鎸夐挳 + 鍐呭
import { useState, type ReactNode } from "react";
import { useLocale } from "../i18n";
import { Collapsible } from "./Collapsible";

interface Props {
  title: string;
  children: ReactNode;
  defaultCollapsed?: boolean;
}

export function SidebarSection({ title, children, defaultCollapsed = false }: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const { t } = useLocale();

  return (
    <div className="mt-6 first:mt-5">
      {/* 鏁磋鍙偣鍑绘姌鍙?灞曞紑锛屼笉鍐嶅眬闄愪簬鍙充晶绠ご */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-label={collapsed ? t("sidebar.sectionExpand") : t("sidebar.sectionCollapse")}
        title={collapsed ? t("sidebar.sectionExpand") : t("sidebar.sectionCollapse")}
        className="group flex w-full items-center justify-between rounded-sm px-3 pb-1.5 pt-0.5 text-left transition-colors hover:bg-[#ECE6E2] dark:hover:bg-[#242424]"
      >
        <span className="text-[13px] font-semibold uppercase tracking-wider text-text-400">{title}</span>
        <span className="rounded p-0.5 text-text-400 opacity-0 transition-opacity group-hover:opacity-100">
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5 transition-transform duration-200"
            style={{ transform: collapsed ? "rotate(0deg)" : "rotate(-180deg)" }}
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            {/* 涓嬬澶达細collapsed 鏃舵湞涓?0掳)锛屽睍寮€鏃舵棆杞垚鏈濅笂(-180掳) */}
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>
      <Collapsible open={!collapsed}>
        <div className="flex flex-col gap-0.5">{children}</div>
      </Collapsible>
    </div>
  );
}
