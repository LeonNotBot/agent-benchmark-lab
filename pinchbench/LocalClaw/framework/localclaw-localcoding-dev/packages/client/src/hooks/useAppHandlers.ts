import { useCallback, useState } from "react";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionRequest } from "../store/useAppStore";
import { useAppStore } from "../store/useAppStore";
import { buildConversationExportEntries } from "../export/conversation-export";
import { showToast } from "../components/Toast";
import { useLocale } from "../i18n";

export function useAppHandlers(sendEvent: (event: any) => void) {
  const { t } = useLocale();
  const setPrompt = useAppStore((s) => s.setPrompt);
  const setCwd = useAppStore((s) => s.setCwd);
  const openView = useAppStore((s) => s.openView);
  const resolvePermissionRequest = useAppStore((s) => s.resolvePermissionRequest);
  const setRightPanelOpen = useAppStore((s) => s.setRightPanelOpen);
  const setChannels = useAppStore((s) => s.setChannels);
  const activeSessionId = useAppStore((s) => s.activeSessionId);

  const [skillEditorOpen, setSkillEditorOpen] = useState(false);
  const [skillEditorData, setSkillEditorData] = useState<any>(null);
  const [channelEditorOpen, setChannelEditorOpen] = useState(false);
  const [channelEditorData, setChannelEditorData] = useState<any>(null);
  const [printTitle, setPrintTitle] = useState("");
  const [printEntries, setPrintEntries] = useState<ReturnType<typeof buildConversationExportEntries>>([]);

  const handleNewSessionClick = () => {
    openView("chat", { sessionId: null });
    setPrompt("");
    setCwd("");
    setRightPanelOpen(false);
  };

  const handleExportPdf = useCallback((activeSession: any) => {
    if (!activeSession) return;
    const title = activeSession.title || "session";
    const entries = buildConversationExportEntries(activeSession.messages);
    setPrintTitle(title);
    setPrintEntries(entries);

    requestAnimationFrame(() => {
      const container = document.getElementById("print-container");
      if (!container) return;

      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        showToast("error", "Please allow popups for PDF export");
        return;
      }

      printWindow.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: system-ui, -apple-system, sans-serif; }
        @page { size: A4; margin: 10mm; }
      </style></head><body>${container.innerHTML}</body></html>`);
      printWindow.document.close();
      printWindow.onload = () => {
        printWindow.print();
        printWindow.onafterprint = () => printWindow.close();
      };
    });
  }, []);

  const handlePermissionResponse = useCallback((
    request: PermissionRequest,
    result: PermissionResult
  ) => {
    if (!activeSessionId) return;
    sendEvent({
      type: "permission.response",
      payload: {
        sessionId: activeSessionId,
        toolUseId: request.toolUseId,
        result
      }
    });
    resolvePermissionRequest(activeSessionId, request.toolUseId);
  }, [activeSessionId, sendEvent, resolvePermissionRequest]);

  const handleCreateSkill = () => {
    setSkillEditorData(null);
    setSkillEditorOpen(true);
  };

  const handleCloneSkill = (data: any) => {
    // 克隆：预填来源技能数据，但以新建态打开（name 可编辑、保存走 POST）
    setSkillEditorData({ ...data, __clone: true });
    setSkillEditorOpen(true);
  };

  const handleEditSkill = async (name: string) => {
    try {
      const res = await fetch(`/api/skills/${name}`);
      const data = await res.json();
      if (data.skill) {
        setSkillEditorData(data.skill);
        setSkillEditorOpen(true);
      }
    } catch { /* ignore */ }
  };

  const handleSaveSkill = async (skill: any) => {
    const isEdit = !!skillEditorData?.name && !skillEditorData?.__clone;
    const url = isEdit ? `/api/skills/${skill.name}` : "/api/skills";
    const method = isEdit ? "PUT" : "POST";
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(skill),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast("error", data.message || t("skill.installFailed"));
        return;
      }
      setSkillEditorOpen(false);
      showToast("success", t("skill.toastInstalled"));
      const list = await fetch("/api/skills").then((r) => r.json()).catch(() => null);
      if (list) useAppStore.getState().setSkills(list.skills ?? []);
    } catch (e: any) {
      showToast("error", e?.message || t("skill.installFailed"));
    }
  };

  const handleExportSkill = async (name: string) => {
    try {
      const res = await fetch(`/api/skills/${name}/export`);
      if (!res.ok) {
        showToast("error", t("toast.exportFail", { name }));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("success", t("toast.exported", { name }));
    } catch {
      showToast("error", t("toast.exportFail", { name }));
    }
  };

  const handleImportSkill = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip";
    input.multiple = true;
    input.onchange = async () => {
      const files = input.files;
      if (!files || files.length === 0) return;
      const total = files.length;
      let successCount = 0;
      let failCount = 0;
      for (let i = 0; i < total; i++) {
        const file = files[i];
        if (total > 1) {
          showToast("success", t("toast.importing", { current: String(i + 1), total: String(total), file: file.name }));
        }
        try {
          const buffer = await file.arrayBuffer();
          const res = await fetch("/api/skills/import-zip", {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: buffer,
          });
          const data = await res.json();
          if (!res.ok) {
            failCount++;
            showToast("error", t("toast.importFail", { file: file.name }) + "\n" + (data.message || ""));
            continue;
          }
          successCount++;
          let msg = t("toast.importSuccess", { name: data.name });
          if (data.warnings?.length) {
            msg += "\n" + data.warnings.map((w: string) => `· ${w}`).join("\n");
          }
          showToast(data.warnings?.length ? "warning" : "success", msg);
        } catch (e: any) {
          failCount++;
          showToast("error", t("toast.importFail", { file: file.name }) + "\n" + (e.message || e));
        }
      }
      if (total > 1) {
        showToast("success", t("toast.batchDone", { success: String(successCount), fail: String(failCount) }));
      }
      fetch("/api/skills").then(r => r.json()).then(d => {
        useAppStore.getState().setSkills(d.skills ?? []);
      }).catch(() => {});
    };
    input.click();
  };

  const handleAddChannel = () => {
    setChannelEditorData(null);
    setChannelEditorOpen(true);
  };

  const handleEditChannel = (channel: any) => {
    setChannelEditorData(channel);
    setChannelEditorOpen(true);
  };

  const handleSaveChannel = (data: any) => {
    import("../api").then(({ apiSaveChannel }) => {
      apiSaveChannel(data).then(({ channel }) => {
        if (channel) {
          const prev = useAppStore.getState().channels;
          const exists = prev.some((ch) => ch.id === channel.id);
          setChannels(
            exists ? prev.map((ch) => ch.id === channel.id ? channel : ch) : [channel, ...prev]
          );
        }
      }).catch(() => {});
    });
    setChannelEditorOpen(false);
  };

  return {
    skillEditorOpen, setSkillEditorOpen, skillEditorData,
    channelEditorOpen, setChannelEditorOpen, channelEditorData,
    printTitle, setPrintTitle, printEntries,
    handleNewSessionClick,
    handleExportPdf,
    handlePermissionResponse,
    handleCreateSkill,
    handleCloneSkill,
    handleEditSkill,
    handleSaveSkill,
    handleExportSkill,
    handleImportSkill,
    handleAddChannel,
    handleEditChannel,
    handleSaveChannel,
  };
}
