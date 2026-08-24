// 正文里可预览链接渲染成卡片：地球图标 + 标题/域名 + 右侧「打开方式」下拉。
// 打开方式：在右侧浏览器预览 / 用系统浏览器打开。
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Globe, ChevronDown } from "lucide-react";
import { openBrowserPreview } from "../../utils/browserPreview";

interface Props {
  href: string;
  label: string;
  openInBrowser?: (url: string) => void;
  workDir?: string;
}

export function LinkPreviewCard({ href, label, openInBrowser, workDir }: Props) {
  const openExternal = () => window.electronAPI?.browserOpenExternal?.(href);
  const openPreview = () => openBrowserPreview(href, openInBrowser, workDir);

  return (
    <span className="my-2 flex items-center gap-3 rounded-xl border border-border-200 bg-bg-000 px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bg-100">
        <Globe className="h-5 w-5 text-sky-400" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] font-semibold text-text-100">{label}</span>
        <span className="truncate text-[12px] text-text-400">{href}</span>
      </span>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="flex shrink-0 items-center gap-1 rounded-lg border border-border-300 px-3 py-1.5 text-[13px] text-text-200 transition-colors hover:bg-bg-200">
            打开方式
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="z-50 min-w-[160px] rounded-lg border border-border-300 bg-bg-000 p-1 shadow-elevated"
          >
            <MenuItem onSelect={openPreview}>在右侧预览</MenuItem>
            <MenuItem onSelect={openExternal}>用系统浏览器打开</MenuItem>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </span>
  );
}

function MenuItem({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className="cursor-pointer rounded px-2.5 py-1.5 text-[13px] text-text-200 outline-none data-[highlighted]:bg-bg-200"
    >
      {children}
    </DropdownMenu.Item>
  );
}
