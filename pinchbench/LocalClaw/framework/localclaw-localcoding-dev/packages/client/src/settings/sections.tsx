// 设置页各分区内容组件，从原 SettingsPanel 抽取，供 SettingsShell 右侧渲染
import { useState, useEffect } from "react";
import { useAppStore } from "../store/useAppStore";
import { useLocale } from "../i18n";
import { TechStackSection } from "../components/TechStackSection";
import { EndpointSection } from "../components/EndpointSection";
import { isReleaseBuild, getConsent, setTelemetryConsent } from "../telemetry/client";

export { DeveloperSection } from "./DeveloperSection";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold text-text-100 mb-3">{children}</h2>;
}

export function AccountSection() {
  const { t } = useLocale();
  return (
    <div>
      <SectionTitle>{t("settings.account")}</SectionTitle>
      <div className="flex items-center gap-4 rounded-xl border border-border-300 bg-bg-000 p-4 shadow-soft">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-brand text-sm font-semibold text-white">U</div>
        <div>
          <div className="text-sm font-medium text-text-100">User</div>
          <div className="text-xs text-text-400">user@example.com</div>
        </div>
      </div>
      <p className="mt-2 text-xs text-text-500">{t("settings.accountPlaceholder")}</p>
    </div>
  );
}

export function TechStackSettingsSection() {
  return <TechStackSection />;
}

export function EndpointSettingsSection() {
  return <EndpointSection />;
}

export function AboutSection() {
  const { t } = useLocale();
  const [appVersion, setAppVersion] = useState("0.1.0");

  useEffect(() => {
    // 动态获取版本号：优先从服务端 /api/app-info（经环境变量注入，在 standalone
    // 和整合壳两种模式下分别返回各自 package.json 的 version），失败时保持默认。
    fetch("/api/app-info")
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => {
        if (info?.version) setAppVersion(info.version);
      })
      .catch(() => {});
  }, []);

  return (
    <div>
      <SectionTitle>{t("settings.about")}</SectionTitle>
      <div className="rounded-xl border border-border-300 bg-bg-000 p-5 text-center space-y-2 shadow-soft">
        <div className="text-lg font-bold text-text-100">{t("settings.aboutApp")}</div>
        <div className="text-xs text-text-400">{t("settings.version")} {appVersion}</div>
        <p className="text-xs text-text-500">{t("settings.aboutDesc")}</p>
      </div>
    </div>
  );
}

function OptionBtn({ children, active, onClick }: { children: React.ReactNode; active?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-4 py-2 text-xs font-medium transition-colors ${
        active ? "border-accent-brand bg-purple-light2 text-accent-text" : "border-border-300 text-text-400 hover:border-accent-brand/30 hover:bg-purple-light2 hover:text-text-200"
      }`}
    >
      {children}
    </button>
  );
}

function WorkspaceInput() {
  const workspace = useAppStore((s) => s.defaultWorkspace);
  const setWorkspace = useAppStore((s) => s.setDefaultWorkspace);
  const { t } = useLocale();
  const [browsing, setBrowsing] = useState(false);

  const handleBrowse = async () => {
    if (browsing) return;
    setBrowsing(true);
    try {
      const api = (window as any).electronAPI;
      if (api?.openFolderDialog) {
        const folder = await api.openFolderDialog();
        if (folder) setWorkspace(folder);
      } else {
        const res = await fetch("/api/system/browse-folder", { method: "POST" });
        const data = await res.json();
        if (data.path) setWorkspace(data.path);
      }
    } catch { /* ignore */ }
    setBrowsing(false);
  };

  return (
    <button
      onClick={handleBrowse}
      disabled={browsing}
      className="w-full flex items-center gap-2 rounded-lg border border-border-300 bg-bg-000 px-3 py-2 text-xs text-text-200 hover:border-accent-brand/30 hover:bg-purple-light2 transition-colors text-left shadow-soft"
    >
      <svg className="h-4 w-4 shrink-0 text-text-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
      </svg>
      <span className="flex-1 truncate">
        {browsing ? "..." : (workspace || t("settings.workspacePlaceholder"))}
      </span>
      {workspace && (
        <svg className="h-3 w-3 shrink-0 text-text-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 6l6 6-6 6" />
        </svg>
      )}
    </button>
  );
}

// 隐私:匿名使用统计开关。仅 release 态显示(dev 本就不采集)。
function TelemetryToggle() {
  const { t } = useLocale();
  const [enabled, setEnabled] = useState(getConsent());
  const [show, setShow] = useState(false);

  useEffect(() => {
    // release 态才显示开关;dev 态不采集,无需暴露。
    setShow(isReleaseBuild());
    setEnabled(getConsent());
  }, []);

  if (!show) return null;

  const toggle = async (value: boolean) => {
    setEnabled(value);
    await setTelemetryConsent(value);
  };

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-text-400">{t("settings.telemetry")}</label>
      <div className="flex gap-2">
        <OptionBtn active={enabled} onClick={() => toggle(true)}>{t("settings.telemetryOn")}</OptionBtn>
        <OptionBtn active={!enabled} onClick={() => toggle(false)}>{t("settings.telemetryOff")}</OptionBtn>
      </div>
      <p className="text-xs text-text-500">{t("settings.telemetryDesc")}</p>
    </div>
  );
}

export function GeneralSection() {
  const { t, locale, setLocale } = useLocale();
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const themes = [
    { id: "system" as const, label: t("settings.themeSystem") },
    { id: "claude-light" as const, label: t("settings.themeLight") },
    { id: "claude-dark" as const, label: t("settings.themeDark") },
    { id: "console-dark" as const, label: t("settings.themeConsole") },
  ];
  return (
    <div>
      <SectionTitle>{t("settings.general")}</SectionTitle>
      <div className="space-y-5">
        <div className="space-y-2">
          <label className="text-xs font-medium text-text-400">{t("settings.theme")}</label>
          <div className="flex flex-wrap gap-2">
            {themes.map((th) => (
              <OptionBtn key={th.id} active={theme === th.id} onClick={() => setTheme(th.id)}>
                {th.label}
              </OptionBtn>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium text-text-400">{t("settings.language")}</label>
          <div className="flex gap-2">
            {(["zh", "en"] as const).map((lang) => (
              <OptionBtn key={lang} active={locale === lang} onClick={() => setLocale(lang)}>
                {lang === "zh" ? "中文" : "English"}
              </OptionBtn>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium text-text-400">{t("settings.workspace")}</label>
          <WorkspaceInput />
        </div>
        <TelemetryToggle />
      </div>
    </div>
  );
}
