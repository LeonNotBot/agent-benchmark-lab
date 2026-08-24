// Run mode selector (aligned with claude-code CLI permissionMode enum).
// 4 options: Plan / Default / Accept Edits / Bypass — single mutually-exclusive permissionMode.
// Layout: current selection on top, divider, then the other selectable options below.
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { PermissionMode } from "@lenovo/agent-protocol";
import { useLocale } from "../i18n";

type ModeOption = {
  id: PermissionMode;
  labelKey: string;
  descKey: string;
};

// Descriptions reflect localcoding's ACTUAL behavior: the server auto-allows every tool
// except AskUserQuestion/ExitPlanMode, so Default/Accept both execute directly without
// per-tool prompts (we don't claim it "prompts", to avoid misleading users).
// Plan = read-only research + plan for approval; Bypass = explicit full access.
// Per-tool confirmation is backlog (needs forwarding more can_use_tool to the frontend).
const OPTIONS: ModeOption[] = [
  { id: "plan", labelKey: "mode.plan", descKey: "mode.planDesc" },
  { id: "default", labelKey: "mode.default", descKey: "mode.defaultDesc" },
  { id: "acceptEdits", labelKey: "mode.acceptEdits", descKey: "mode.acceptEditsDesc" },
  { id: "bypassPermissions", labelKey: "mode.bypass", descKey: "mode.bypassDesc" },
];

interface Props {
  mode: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  /**
   * 是否展示 Full(bypassPermissions) 选项。默认 true：CLI 侧
   * isBypassPermissionsModeAvailable 恒为 true，运行时可直接 set_permission_mode
   * 热切到 bypass，不再依赖启动 flag。保留此开关以便未来按策略隐藏。
   */
  fullAvailable?: boolean;
}

export function ModeChip({ mode, onChange, fullAvailable = true }: Props) {
  const { t } = useLocale();
  const current = OPTIONS.find((o) => o.id === mode) ?? OPTIONS[1];
  const isPlan = mode === "plan";
  const isFull = mode === "bypassPermissions";
  const all = fullAvailable ? OPTIONS : OPTIONS.filter((o) => o.id !== "bypassPermissions");
  // current selection first, then the rest below the divider
  const rest = all.filter((o) => o.id !== current.id);

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium outline-none transition-colors focus:outline-none focus-visible:outline-none ${
            isPlan
              ? "text-accent-brand hover:bg-accent-brand/10"
              : isFull
                ? "text-warning-100 hover:bg-warning-100/10"
                : "text-text-400 hover:bg-bg-200 hover:text-text-200"
          }`}
        >
          <span>{t(current.labelKey)}</span>
          <svg viewBox="0 0 24 24" className="h-3 w-3 opacity-60" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          side="top"
          sideOffset={8}
          className="z-[200] min-w-[260px] rounded-xl border border-border-300 bg-bg-000 p-1.5 shadow-elevated"
        >
          <ModeItem option={current} active onSelect={onChange} t={t} />
          <div className="my-1.5 h-px bg-border-200" />
          {rest.map((o) => (
            <ModeItem key={o.id} option={o} active={false} onSelect={onChange} t={t} />
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ModeItem({ option, active, onSelect, t }: {
  option: ModeOption;
  active: boolean;
  onSelect: (m: PermissionMode) => void;
  t: (k: string) => string;
}) {
  return (
    <DropdownMenu.Item
      onSelect={() => onSelect(option.id)}
      className={`flex cursor-pointer items-start justify-between gap-3 rounded-lg px-3 py-2 outline-none transition-colors ${
        active ? "bg-bg-100" : "hover:bg-bg-200"
      }`}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] font-medium leading-none text-text-100">{t(option.labelKey)}</span>
        <span className="text-[11px] leading-tight text-text-400">{t(option.descKey)}</span>
      </div>
      {active && (
        <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-accent-brand" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M5 12l5 5L20 7" />
        </svg>
      )}
    </DropdownMenu.Item>
  );
}
