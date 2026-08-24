// 设置页右侧内容区：复用首页中间面板的圆角/边框样式，按左栏选中的导航项渲染对应分区
import { useAppStore } from "../store/useAppStore";
import {
  AccountSection, GeneralSection, TechStackSettingsSection,
  AboutSection, DeveloperSection,
} from "./sections";

export function SettingsContent() {
  const nav = useAppStore((s) => s.settingsNav);

  return (
    <main className="relative flex flex-1 flex-col min-w-0 overflow-hidden rounded-l-2xl border-l border-y border-border-200 bg-bg-000 shadow-[-4px_0_16px_rgba(0,0,0,0.04)]">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-10 py-10">
          {nav === "account"   && <AccountSection />}
          {nav === "general"   && <GeneralSection />}
          {nav === "techstack" && <TechStackSettingsSection />}
          {nav === "developer" && <DeveloperSection />}
          {nav === "about"     && <AboutSection />}
        </div>
      </div>
    </main>
  );
}
