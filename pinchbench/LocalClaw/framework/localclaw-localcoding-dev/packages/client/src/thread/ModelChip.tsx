// Session-level model selector chip. Radix dropdown (reliable positioning/portal).
// Provider list with nested model submenus. Selection writes the active session (or draft).
// No Smart Hybrid here (that's a global concept handled by the legacy ModelSelector).
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useAppStore } from "../store/useAppStore";
import { useLocale } from "../i18n";
import { isEndpointUsable } from "../utils/endpointUsable";

// 截断显示名。不再 split("/")——公开 model id 不保证以 "/" 编码 provider，
// 截断只为控制长度。优先用 model 的 label（见调用处解析），无 label 才用裸 id。
function truncate(name: string, maxLen = 18): string {
  return name.length > maxLen ? name.slice(0, maxLen - 1) + "…" : name;
}

interface Props {
  endpointId?: string;
  model?: string;
  onSelect: (endpointId: string, model: string) => void;
  /** 未选模型时的占位文案。缺省 "Select model"（保持聊天输入框原行为）。 */
  placeholder?: string;
}

export function ModelChip({ endpointId, model, onSelect, placeholder }: Props) {
  const { t } = useLocale();
  // 只展示可用的 endpoint。可用判定的唯一真源见 utils/endpointUsable——与 routingHandlers
  // 失效校正、后端 isUsable 同口径，避免本地无 key endpoint 被误判失效却仍可路由。
  const endpoints = useAppStore((s) => s.endpoints).filter(isEndpointUsable);
  // 展示名优先用所选模型的 label（在其 endpoint 内查找）。
  // 治 #17 显示侧：model 有值但在可用表里查不到（已删/改名/失效）时，不再把陈旧裸 id
  // 当正常名显示——返回 null，下方渲染为「模型已失效」态引导重选。正常情况下 endpoint.list
  // 已校正会话引用，此态仅作兜底（如校正前的瞬时窗口）。
  const isStale = !!model && !endpoints.some(
    (e) => e.id === endpointId && e.models.some((mm) => mm.id === model),
  );
  const selectedLabel = (() => {
    if (!model || isStale) return null;
    const ep = endpoints.find((e) => e.id === endpointId);
    const m = ep?.models.find((mm) => mm.id === model);
    return m?.label || model;
  })();
  const label = isStale
    ? t("modelChip.staleModel")
    : selectedLabel
      ? truncate(selectedLabel)
      : (placeholder ?? "Select model");

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button className={`flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium outline-none transition-colors hover:bg-bg-200 focus:outline-none focus-visible:outline-none ${isStale ? "text-amber-600 hover:text-amber-700" : "text-text-400 hover:text-text-200"}`}>
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 opacity-70" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z" />
          </svg>
          <span>{label}</span>
          <svg viewBox="0 0 24 24" className="h-3 w-3 opacity-60" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          side="top"
          sideOffset={8}
          className="z-[200] min-w-[220px] rounded-xl border border-border-300 bg-bg-000 p-1.5 shadow-elevated"
        >
          {endpoints.length === 0 && (
            <div className="px-3 py-3 text-xs text-text-500 text-center">No endpoints configured</div>
          )}
          {endpoints.map((ep) => (
            <DropdownMenu.Sub key={ep.id}>
              <DropdownMenu.SubTrigger className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-[13px] text-text-200 outline-none transition-colors hover:bg-bg-200 data-[state=open]:bg-bg-200">
                <span className={endpointId === ep.id ? "font-medium text-accent-brand" : ""}>{ep.label}</span>
                <svg viewBox="0 0 24 24" className="h-3 w-3 text-text-500" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  sideOffset={4}
                  className="z-[201] max-h-[60vh] min-w-[200px] overflow-y-auto rounded-xl border border-border-300 bg-bg-000 p-1.5 shadow-elevated"
                >
                  {ep.models.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-text-500 text-center">No models</div>
                  ) : (
                    ep.models.map((m) => {
                      const active = endpointId === ep.id && model === m.id;
                      return (
                        <DropdownMenu.Item
                          key={m.id}
                          onSelect={() => onSelect(ep.id, m.id)}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-[13px] outline-none transition-colors ${
                            active ? "bg-bg-100 text-accent-brand font-medium" : "text-text-200 hover:bg-bg-200"
                          }`}
                        >
                          <span className={`h-2 w-2 shrink-0 rounded-full border ${active ? "bg-accent-brand border-accent-brand" : "border-border-300"}`} />
                          <span className="truncate">{m.label || m.id}</span>
                          {m.tags?.[0] && <span className="ml-auto text-[9px] text-text-500 shrink-0">{m.tags[0]}</span>}
                        </DropdownMenu.Item>
                      );
                    })
                  )}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
