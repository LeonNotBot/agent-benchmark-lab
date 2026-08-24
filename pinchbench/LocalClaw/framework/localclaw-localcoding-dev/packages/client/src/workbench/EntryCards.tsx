// 右面板入口卡片页：Files / Browser / 部署 三张大卡片（对应 home2）
import { useLocale } from "../i18n";
import type { WorkbenchTab } from "./types";

interface CardDef {
  id: Exclude<WorkbenchTab, null>;
  titleKey: string;
  subtitleKey: string;
  icon: React.ReactNode;
}

const CARDS: CardDef[] = [
  {
    id: "files", titleKey: "workbench.tabFiles", subtitleKey: "workbench.subFiles",
    icon: (<><path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" /></>),
  },
  {
    id: "browser", titleKey: "workbench.tabBrowser", subtitleKey: "workbench.subBrowser",
    icon: (<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></>),
  },
  {
    id: "review", titleKey: "workbench.tabReview", subtitleKey: "workbench.subReview",
    icon: (<><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" /></>),
  },
  {
    id: "deploy", titleKey: "workbench.tabDeploy", subtitleKey: "workbench.subDeploy",
    icon: (<><path d="M4 13a8 8 0 0 1 8-8 8 8 0 0 1 8 8" /><path d="M12 5v8l4 2" /><path d="M4 17h16" /></>),
  },
];

interface Props {
  onOpen: (tab: Exclude<WorkbenchTab, null>) => void;
}

export function EntryCards({ onOpen }: Props) {
  const { t } = useLocale();
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      {CARDS.map((c) => (
        <button
          key={c.id}
          onClick={() => onOpen(c.id)}
          className="group flex flex-col items-center gap-2 rounded-2xl bg-bg-200 px-4 py-8 text-center transition-colors hover:bg-bg-300"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-bg-000 text-text-300 group-hover:text-text-100">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              {c.icon}
            </svg>
          </span>
          <span className="text-sm font-medium text-text-100">{t(c.titleKey)}</span>
          <span className="text-xs text-text-400">{t(c.subtitleKey)}</span>
        </button>
      ))}
    </div>
  );
}
