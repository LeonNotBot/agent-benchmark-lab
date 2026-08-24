// 新建会话页的项目选择条：等宽背景条紧贴输入框下方。
// 未选 → 左下角「选择项目」按钮；已选 → [项目图标|项目名]，图标悬浮变关闭按钮
// （tooltip「不使用项目」，点击清空）。下拉：搜索 + 最近目录 + 添加新项目。
// 选中值复用 store.defaultWorkspace（Composer 发送时已读取它作为 cwd）
import { useEffect, useMemo, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useAppStore } from "../store/useAppStore";
import { useLocale } from "../i18n";
import { NewProjectDialog } from "./NewProjectDialog";
import { PickerBody } from "./PickerBody";
import { ProjectIcon, CloseCircleIcon } from "./pickerIcons";

function dirName(p: string): string {
  if (!p) return "";
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

export function ProjectPicker() {
  const current = useAppStore((s) => s.defaultWorkspace);
  const setCurrent = useAppStore((s) => s.setDefaultWorkspace);
  const registerProject = useAppStore((s) => s.registerProject);
  const projectHidden = useAppStore((s) => s.projectHidden);
  const { t } = useLocale();

  const [recent, setRecent] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    fetch("/api/sessions/recent-cwd?limit=8")
      .then((r) => r.json())
      .then((d) => setRecent(Array.isArray(d?.cwds) ? d.cwds : []))
      .catch(() => setRecent([]));
  }, []);

  // 当前工作区若被移除(隐藏)，清空选中，避免新建会话仍用已移除项目
  useEffect(() => {
    if (current && current in projectHidden) setCurrent("");
  }, [current, projectHidden, setCurrent]);

  // 选定一个项目：设为当前工作区 + 登记到项目列表（左侧栏据此显示项目）
  const chooseProject = (path: string) => {
    setCurrent(path);
    registerProject(path);
  };

  // 当前目录并入列表去重；已移除(隐藏)的项目从最近列表剔除，与侧栏一致
  const items = useMemo(() => {
    const all = current ? [current, ...recent] : recent;
    const seen = new Set<string>();
    const uniq = all.filter(
      (p) => p && !seen.has(p) && seen.add(p) && (p === current || !(p in projectHidden)),
    );
    const q = query.trim().toLowerCase();
    return q ? uniq.filter((p) => p.toLowerCase().includes(q)) : uniq;
  }, [current, recent, query, projectHidden]);

  const browseFolder = async () => {
    try {
      const api = (window as any).electronAPI;
      if (api?.openFolderDialog) {
        const folder = await api.openFolderDialog();
        if (folder) chooseProject(folder);
      } else {
        const res = await fetch("/api/system/browse-folder", { method: "POST" });
        const data = await res.json();
        if (data?.path) chooseProject(data.path);
      }
    } catch { /* ignore */ }
  };

  const createBlank = async (name: string) => {
    setDialogOpen(false);
    try {
      const res = await fetch("/api/workspace/new-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (data?.path) {
        chooseProject(data.path);
        setRecent((prev) => [data.path, ...prev.filter((p) => p !== data.path)]);
      }
    } catch { /* ignore */ }
  };

  const dropdown = (
    <DropdownMenu.Portal>
      <DropdownMenu.Content align="start" side="top" sideOffset={6}
        className="z-50 max-h-[60vh] w-[300px] overflow-y-auto rounded-xl border border-border-300 bg-bg-000 p-1 shadow-elevated">
        <PickerBody
          items={items}
          current={current}
          query={query}
          onQuery={setQuery}
          onPick={chooseProject}
          onNewBlank={() => setDialogOpen(true)}
          onBrowse={browseFolder}
          // 仅已选项目时传 onClear → 菜单底部显示「不使用项目」；未选则不显示。
          onClear={current ? () => setCurrent("") : undefined}
        />
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );

  // 等宽背景条：紧贴输入框下方（外层负 margin 抵消输入框圆角内边距，见 Homepage 布局）。
  // 未选：「选择项目」按钮，点击开菜单（菜单无「不使用项目」）。
  // 已选：一体按钮 [图标 项目名]，点击开菜单（菜单底部有「不使用项目」）；悬浮时图标变关闭图标做视觉提示。
  return (
    <div className="w-full rounded-b-2xl bg-bg-200 px-4 pb-[10px] pt-[15px]">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          {current ? (
            <button className="group relative flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] text-text-200 transition-colors hover:bg-bg-300">
              <span className="group-hover:hidden"><ProjectIcon /></span>
              <span className="hidden text-text-100 group-hover:inline-flex"><CloseCircleIcon /></span>
              <span className="max-w-[220px] truncate">{dirName(current)}</span>
            </button>
          ) : (
            <button className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] text-text-300 transition-colors hover:bg-bg-300 hover:text-text-200">
              <ProjectIcon />
              <span>{t("picker.chooseProject")}</span>
            </button>
          )}
        </DropdownMenu.Trigger>
        {dropdown}
      </DropdownMenu.Root>
      {dialogOpen && (
        <NewProjectDialog onCancel={() => setDialogOpen(false)} onConfirm={createBlank} />
      )}
    </div>
  );
}
