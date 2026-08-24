// 斜杠面板列表主体：分组渲染（命令 / 技能）+ 单行（六边形图标 + 名称 + 描述 + 来源标签）。
// 样式对齐 docs/images/12.png、13.png。
import type { SlashItem } from "./SlashCommandMenu";
import { getSkillIconInfo } from "../skills/skillIconMap";

interface BodyProps {
  loading: boolean;
  items: SlashItem[];
  activeIndex: number;
  onSelect: (item: SlashItem) => void;
  emptyText: string;
  commandTitle: string;
  skillTitle: string;
  sourceProject: string;
}

/** 分组标题（灰色小字，如 12.png 的「技能」）。 */
function GroupTitle({ text }: { text: string }) {
  return (
    <div className="px-3 pb-1 pt-2 text-xs font-medium text-text-400">{text}</div>
  );
}

/** 单行选项。选中态整行浅灰高亮（12.png 的 Skill Installer 行）。 */
function Row({
  item, active, indexInFlat, onSelect, sourceProject,
}: {
  item: SlashItem; active: boolean; indexInFlat: number;
  onSelect: (item: SlashItem) => void; sourceProject: string;
}) {
  const { icon: Icon } = getSkillIconInfo({
    name: item.insert, displayName: item.label, description: item.description,
  });
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      data-slash-index={indexInFlat}
      onMouseDown={(e) => { e.preventDefault(); onSelect(item); }}
      className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
        active ? "bg-[#ECE6E2] dark:bg-[#242424]" : "hover:bg-bg-200"
      }`}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center text-text-300">
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium text-text-100">{item.label}</span>
        {item.description && (
          <span className="ml-2 text-text-400">{item.description}</span>
        )}
      </span>
      <span className="shrink-0 text-xs text-text-400">{sourceProject}</span>
    </button>
  );
}

export function SlashMenuBody({
  loading, items, activeIndex, onSelect, emptyText,
  commandTitle, skillTitle, sourceProject,
}: BodyProps) {
  if (loading && items.length === 0) {
    return (
      <div className="space-y-1 px-3 py-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-7 animate-pulse rounded bg-bg-200" />
        ))}
      </div>
    );
  }
  if (items.length === 0) {
    return <div className="px-3 py-3 text-sm text-text-400">{emptyText}</div>;
  }

  const commands = items.filter((it) => it.kind === "command");
  const skills = items.filter((it) => it.kind === "skill");

  return (
    <>
      {commands.length > 0 && <GroupTitle text={commandTitle} />}
      {commands.map((it) => {
        const flat = items.indexOf(it);
        return (
          <Row key={`c-${it.insert}`} item={it} active={flat === activeIndex}
            indexInFlat={flat} onSelect={onSelect} sourceProject={sourceProject} />
        );
      })}
      {skills.length > 0 && <GroupTitle text={skillTitle} />}
      {skills.map((it) => {
        const flat = items.indexOf(it);
        return (
          <Row key={`s-${it.insert}`} item={it} active={flat === activeIndex}
            indexInFlat={flat} onSelect={onSelect} sourceProject={sourceProject} />
        );
      })}
    </>
  );
}
