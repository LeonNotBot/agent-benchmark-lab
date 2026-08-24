// 能力浮层内容：五段（命令/子代理/技能/规则/知识库）+ 骨架屏 + 空态。
// 命令/技能可点击（→ onRun 预填 /xxx）；规则/知识库为只读参考。
import type { ProjectCapabilities } from "@lenovo/agent-protocol";
import { useLocale } from "../i18n";

interface Props {
  loading: boolean;
  caps: ProjectCapabilities | null;
  onRun: (insert: string) => void;
}

export function CapabilitySections({ loading, caps, onRun }: Props) {
  const { t } = useLocale();

  if (loading && !caps) {
    return (
      <div className="space-y-1 px-3 py-2">
        {[0, 1, 2].map((i) => <div key={i} className="h-6 animate-pulse rounded bg-bg-200" />)}
      </div>
    );
  }
  if (!caps) return <div className="px-3 py-3 text-text-400">{t("projectCapability.loading")}</div>;

  const empty =
    !caps.commands.length && !caps.agents.length && !caps.skills.length &&
    !caps.rules.length && !caps.memories.length;
  if (empty) {
    return <div className="px-3 py-3 text-text-400">{t("projectCapability.noCapabilities")}</div>;
  }

  return (
    <>
      <Section title={t("projectCapability.commands")} items={caps.commands.map((c) => ({
        key: c.name, label: `/${c.name}`, desc: c.description, onClick: () => onRun(c.name),
      }))} />
      <Section title={t("projectCapability.agents")} items={caps.agents.map((a) => ({
        key: a.name, label: `@${a.name}`, desc: a.description,
      }))} />
      <Section title={t("projectCapability.skills")} items={caps.skills.map((s) => ({
        key: s.name, label: s.displayName || s.name, desc: s.description,
        onClick: s.userInvocable !== false ? () => onRun(s.name) : undefined,
      }))} />
      <Section title={t("projectCapability.rules")} items={caps.rules.map((r) => ({
        key: r.name, label: r.title || r.name,
      }))} />
      <Section title={t("projectCapability.memories")} items={caps.memories.map((m) => ({
        key: m.name, label: m.name,
      }))} />
    </>
  );
}

interface RowItem { key: string; label: string; desc?: string; onClick?: () => void }

function Section({ title, items }: { title: string; items: RowItem[] }) {
  if (!items.length) return null;
  return (
    <div className="mb-1 px-1">
      <div className="px-2 pb-0.5 pt-1 text-[11px] font-medium text-text-400/80">{title}</div>
      {items.map((it) => (
        <button
          key={it.key}
          onClick={it.onClick}
          disabled={!it.onClick}
          className={`flex w-full items-baseline gap-2 rounded px-2 py-1 text-left ${
            it.onClick ? "hover:bg-[#ECE6E2] dark:hover:bg-[#242424]" : "cursor-default"
          }`}
        >
          <span className="shrink-0 truncate font-medium text-text-200">{it.label}</span>
          {it.desc && <span className="min-w-0 flex-1 truncate text-text-400/80">{it.desc}</span>}
        </button>
      ))}
    </div>
  );
}
