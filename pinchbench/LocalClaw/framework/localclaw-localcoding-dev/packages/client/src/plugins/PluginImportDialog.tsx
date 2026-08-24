// 插件(.claude plugin)导入弹窗：选 zip → 选作用域 → 预检 → (冲突确认) → 安装。
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import type { PluginPreflight, PluginScope } from "@lenovo/agent-protocol";
import { apiPreflightPlugin, apiInstallPlugin } from "../api/plugin";
import { useSidebarStore } from "../sidebar/store";
import { useLocale } from "../i18n";
import { showToast } from "../components/Toast";
import { PluginPreflightView } from "./PluginPreflightView";
import { invalidateCapabilityCache } from "../sidebar/ProjectCapabilityPanel";

export function PluginImportDialog({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const registeredProjects = useSidebarStore((s) => s.registeredProjects);
  const registerProject = useSidebarStore((s) => s.registerProject);
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState("");
  const [scope, setScope] = useState<PluginScope>("global");
  const [projectCwd, setProjectCwd] = useState<string>(registeredProjects[0] ?? "");
  const [preflight, setPreflight] = useState<PluginPreflight | null>(null);
  const [includeLocalPerms, setIncludeLocalPerms] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setBuffer(null); setFileName(""); setPreflight(null); setBusy(false);
    setScope("global"); setProjectCwd(registeredProjects[0] ?? ""); setIncludeLocalPerms(false);
  };
  const close = () => { reset(); onOpenChange(false); };

  const pickFile = async (f: File) => {
    if (!f.name.endsWith(".zip")) { showToast("warning", t("plugin.zipOnly")); return; }
    setFileName(f.name);
    setBuffer(await f.arrayBuffer());
    setPreflight(null);
  };

  const doPreflight = async () => {
    if (!buffer) return;
    if (scope === "project" && !projectCwd) { showToast("warning", t("plugin.pickProject")); return; }
    setBusy(true);
    try {
      const pf = await apiPreflightPlugin(buffer.slice(0), scope, scope === "project" ? projectCwd : undefined);
      setPreflight(pf);
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const doInstall = async (overwrite: boolean) => {
    if (!buffer) return;
    setBusy(true);
    try {
      const r = await apiInstallPlugin(buffer.slice(0), scope, scope === "project" ? projectCwd : undefined, overwrite, includeLocalPerms);
      // 项目级导入：失效该项目能力缓存（否则"查看能力"读到导入前的空缓存），
      // 并确保目标项目已登记到侧边栏，用户才能看到分组与能力入口。
      if (scope === "project" && projectCwd) {
        invalidateCapabilityCache(projectCwd);
        registerProject(projectCwd);
      }
      showToast("success", t("plugin.installed", { n: r.installed.length }));
      close();
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[300] bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[301] w-[460px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border-300 bg-bg-000 p-5 shadow-elevated">
          <Dialog.Title className="mb-1 text-[15px] font-semibold text-text-100">{t("plugin.importTitle")}</Dialog.Title>
          <Dialog.Description className="mb-3 text-[13px] text-text-400">{t("plugin.importHint")}</Dialog.Description>
          <PluginPreflightView
            fileName={fileName} scope={scope} setScope={setScope}
            projectCwd={projectCwd} setProjectCwd={setProjectCwd}
            registeredProjects={registeredProjects}
            preflight={preflight} busy={busy}
            includeLocalPerms={includeLocalPerms} setIncludeLocalPerms={setIncludeLocalPerms}
            onPickFile={pickFile} onPreflight={doPreflight}
            onInstall={doInstall} onCancel={close}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
