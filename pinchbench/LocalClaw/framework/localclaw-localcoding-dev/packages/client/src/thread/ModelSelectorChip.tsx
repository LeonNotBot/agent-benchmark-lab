// Composer 专用模型选择器。在普通 ModelChip 的 endpoint→model 二级菜单基础上，
// 加入「智能升级」(Smart Hybrid) 入口，支持配置基础模型 + 升级模型以及跨协议置灰。
// automation 等其他场景继续使用原 ModelChip，本组件只在 Composer 中使用。
import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useAppStore } from "../store/useAppStore";
import { useLocale } from "../i18n";
import { isEndpointUsable } from "../utils/endpointUsable";
import type { SmartHybridConfig, EndpointInfo } from "@lenovo/agent-protocol";
import type { PermissionMode } from "@lenovo/agent-protocol";

// ── 工具函数 ─────────────────────────────────────────────────────────────────

function truncate(s: string, max = 18): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** 从 endpoint 列表找指定 endpointId 的 apiType；未找到返回 undefined */
function apiTypeOf(
  endpoints: EndpointInfo[],
  endpointId: string | undefined,
): "anthropic" | "openai-compatible" | undefined {
  if (!endpointId) return undefined;
  return endpoints.find((e) => e.id === endpointId)?.apiType;
}

/** 给 endpointId+model 找可读 label；找不到回退 model id */
function resolveLabel(
  endpoints: EndpointInfo[],
  endpointId: string | undefined,
  modelId: string | undefined,
): string | null {
  if (!endpointId || !modelId) return null;
  const ep = endpoints.find((e) => e.id === endpointId);
  if (!ep) return null;
  const m = ep.models.find((mm) => mm.id === modelId);
  return m ? (m.label || m.id) : modelId;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  /** 当前会话选中的 endpointId（单模型模式；来自 Composer 的 curEndpointId） */
  endpointId?: string;
  /** 当前会话选中的 model（单模型模式；来自 Composer 的 curModel） */
  model?: string;
  /** 当前会话的智能升级配置（有值 = 该会话走 SH，与 model/endpointId 互斥） */
  smartHybrid?: SmartHybridConfig;
  /** 选定单模型回调（写会话级，互斥清空 smartHybrid 由 Composer writeConfig 保证） */
  onSelect: (endpointId: string, model: string) => void;
  /** 选定/更新智能升级回调（写会话级，互斥清空 model/endpointId）；选完自动收起面板 */
  onSelectHybrid: (config: SmartHybridConfig) => void;
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

/** step: "main" = 普通端点列表 + 智能升级入口；"hybrid" = 智能升级配置子面板 */
type Step = "main" | "hybrid";

export function ModelSelectorChip({ endpointId, model, smartHybrid, onSelect, onSelectHybrid }: Props) {
  const { t } = useLocale();
  const endpoints = useAppStore((s) => s.endpoints).filter(isEndpointUsable);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("main");
  // 会话级：有 smartHybrid 配置 = 该会话走智能升级（不再读全局 routingPreference）。
  const isHybrid = !!smartHybrid;

  // ── chip 显示文案 ────────────────────────────────────────────────────────
  const isStale =
    !!model &&
    !isHybrid &&
    !endpoints.some((e) => e.id === endpointId && e.models.some((mm) => mm.id === model));

  const chipLabel = (() => {
    if (isHybrid && smartHybrid) {
      const baseLabel =
        truncate(
          resolveLabel(
            endpoints,
            smartHybrid.defaultModel.endpointId,
            smartHybrid.defaultModel.model,
          ) ?? smartHybrid.defaultModel.model,
          12,
        );
      const upLabel =
        truncate(
          resolveLabel(
            endpoints,
            smartHybrid.upgradeModel.endpointId,
            smartHybrid.upgradeModel.model,
          ) ?? smartHybrid.upgradeModel.model,
          12,
        );
      return `${baseLabel} → ${upLabel}`;
    }
    if (isStale) return t("modelChip.staleModel");
    if (!model) return t("composer.model.pickModel") ?? "Select model";
    const ep = endpoints.find((e) => e.id === endpointId);
    return truncate(ep?.models.find((mm) => mm.id === model)?.label || model);
  })();

  // 关闭 dropdown 时重置 step；受控 open 使 onSave 可以主动收起面板。
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setStep("main");
  };

  return (
    <DropdownMenu.Root modal={false} open={open} onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium outline-none transition-colors
            hover:bg-bg-200 focus:outline-none focus-visible:outline-none
            ${isHybrid ? "text-purple-600 dark:text-purple-400" : isStale ? "text-amber-600 hover:text-amber-700" : "text-text-400 hover:text-text-200"}`}
        >
          <span>{chipLabel}</span>
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
          className="z-[200] w-[260px] rounded-xl border border-border-300 bg-bg-000 shadow-elevated overflow-hidden"
        >
          {step === "main" ? (
            <MainStep
              endpoints={endpoints}
              endpointId={endpointId}
              model={model}
              isHybrid={isHybrid}
              onSelectModel={(ep, m) => { onSelect(ep, m); }}
              onOpenHybrid={() => setStep("hybrid")}
              t={t}
            />
          ) : (
            <HybridStep
              endpoints={endpoints}
              initialConfig={smartHybrid ?? null}
              onBack={() => setStep("main")}
              onSave={(cfg) => { onSelectHybrid(cfg); handleOpenChange(false); }}
              t={t}
            />
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// ── Step 1: 普通端点/模型列表 + 智能升级入口 ─────────────────────────────────

function MainStep({
  endpoints,
  endpointId,
  model,
  isHybrid,
  onSelectModel,
  onOpenHybrid,
  t,
}: {
  endpoints: EndpointInfo[];
  endpointId?: string;
  model?: string;
  isHybrid: boolean;
  onSelectModel: (ep: string, m: string) => void;
  onOpenHybrid: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="py-1.5 max-h-[60vh] overflow-y-auto">
      {endpoints.length === 0 && (
        <div className="px-3 py-3 text-xs text-text-500 text-center">No endpoints configured</div>
      )}
      {endpoints.map((ep) => (
        <DropdownMenu.Sub key={ep.id}>
          <DropdownMenu.SubTrigger
            className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg mx-1 px-3 py-2 text-[13px] text-text-200 outline-none transition-colors hover:bg-bg-200 data-[state=open]:bg-bg-200 ${!isHybrid && endpointId === ep.id ? "font-medium text-accent-brand" : ""}`}
          >
            <span>{ep.label}</span>
            <svg viewBox="0 0 24 24" className="h-3 w-3 text-text-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5">
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
                  const active = !isHybrid && endpointId === ep.id && model === m.id;
                  return (
                    <DropdownMenu.Item
                      key={m.id}
                      onSelect={() => onSelectModel(ep.id, m.id)}
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

      {/* 分隔线 + 智能升级入口 */}
      <div className="my-1 mx-2 h-px bg-border-300" />
      <button
        onClick={onOpenHybrid}
        className={`w-full flex items-center gap-2.5 rounded-lg mx-1 px-3 py-2 text-[13px] transition-colors outline-none
          ${isHybrid
            ? "bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-300 font-medium"
            : "text-text-200 hover:bg-bg-200"
          }`}
        style={{ width: "calc(100% - 8px)" }}
      >
        <span>{t("composer.model.smartHybrid")}</span>
        {isHybrid && (
          <span className="ml-auto text-[10px] bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-300 px-1.5 py-0.5 rounded-full shrink-0">
            {t("composer.model.enabled")}
          </span>
        )}
        {!isHybrid && (
          <svg viewBox="0 0 24 24" className="h-3 w-3 ml-auto text-text-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M9 18l6-6-6-6" />
          </svg>
        )}
      </button>
    </div>
  );
}

// ── Step 2: 智能升级配置子面板 ───────────────────────────────────────────────

function HybridStep({
  endpoints,
  initialConfig,
  onBack,
  onSave,
  t,
}: {
  endpoints: EndpointInfo[];
  initialConfig: SmartHybridConfig | null;
  onBack: () => void;
  onSave: (cfg: SmartHybridConfig) => void;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const [defEpId, setDefEpId] = useState(initialConfig?.defaultModel.endpointId ?? "");
  const [defModel, setDefModel] = useState(initialConfig?.defaultModel.model ?? "");
  const [upEpId, setUpEpId] = useState(initialConfig?.upgradeModel.endpointId ?? "");
  const [upModel, setUpModel] = useState(initialConfig?.upgradeModel.model ?? "");

  const defApiType = apiTypeOf(endpoints, defEpId || undefined);
  const upApiType = apiTypeOf(endpoints, upEpId || undefined);

  // 两个 slot 都选定即自动生效——无需额外「启用/更新」按钮。选择任一 slot 后，
  // 若四个字段齐全就立即 onSave；缺一则只更新本地 state，等另一个补齐。
  const autoSave = (
    d: { ep: string; m: string },
    u: { ep: string; m: string },
  ) => {
    if (d.ep && d.m && u.ep && u.m) {
      onSave({
        defaultModel: { endpointId: d.ep, model: d.m },
        upgradeModel: { endpointId: u.ep, model: u.m },
      });
    }
  };

  const selectBase = (ep: string, m: string) => {
    const newApiType = apiTypeOf(endpoints, ep);
    // 协议切换 → 清空对方 slot（防止跨协议锁死）；同协议 → 正常自动保存。
    if (upEpId && newApiType !== upApiType) {
      setDefEpId(ep); setDefModel(m);
      setUpEpId(""); setUpModel("");
    } else {
      setDefEpId(ep); setDefModel(m);
      autoSave({ ep, m }, { ep: upEpId, m: upModel });
    }
  };

  const selectUpgrade = (ep: string, m: string) => {
    const newApiType = apiTypeOf(endpoints, ep);
    // 协议切换 → 清空对方 slot；同协议 → 自动保存。
    if (defEpId && newApiType !== defApiType) {
      setUpEpId(ep); setUpModel(m);
      setDefEpId(""); setDefModel("");
    } else {
      setUpEpId(ep); setUpModel(m);
      autoSave({ ep: defEpId, m: defModel }, { ep, m });
    }
  };

  return (
    <div>
      {/* 返回按钮 */}
      <button
        onClick={onBack}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-xs text-text-400 hover:bg-bg-100 transition-colors border-b border-border-200"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        <span className="font-medium text-text-200">{t("composer.model.smartHybrid")}</span>
      </button>

      {/* 说明 */}
      <div className="px-3 pt-2.5 pb-1">
        <p className="text-[11px] text-text-400 leading-relaxed">{t("composer.model.smartHybridDesc")}</p>
      </div>

      {/* 基础模型 + 升级模型 slot 选择器 */}
      <div className="px-3 pb-3 space-y-3 mt-1">
        <SlotSelector
          label={t("composer.model.baseModel")}
          endpointId={defEpId}
          modelId={defModel}
          endpoints={endpoints}
          onSelect={selectBase}
          t={t}
        />
        <SlotSelector
          label={t("composer.model.upgradeModel")}
          endpointId={upEpId}
          modelId={upModel}
          endpoints={endpoints}
          onSelect={selectUpgrade}
          t={t}
        />
      </div>
    </div>
  );
}

// ── SlotSelector：单个 endpoint→model 下拉选择器 ─────────────
// 所有 endpoint 均可选；跨协议一致性由 HybridStep 的「切协议清空对方 slot」保证，
// 不再置灰——置灰会导致两个 slot 选定后互相锁死、无法切换到另一协议。

function SlotSelector({
  label,
  endpointId,
  modelId,
  endpoints,
  onSelect,
  t,
}: {
  label: string;
  endpointId: string;
  modelId: string;
  endpoints: EndpointInfo[];
  onSelect: (endpointId: string, model: string) => void;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const currentEp = endpoints.find((e) => e.id === endpointId);
  const currentModel = currentEp?.models.find((m) => m.id === modelId);
  const displayLabel = currentModel
    ? truncate(currentModel.label || currentModel.id, 20)
    : `— ${t("composer.model.pickModel")} —`;

  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-text-400">{label}</label>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button className="w-full flex items-center justify-between gap-1 rounded-lg border border-border-300 bg-bg-000 px-2.5 py-1.5 text-[12px] text-text-200 hover:border-accent-brand/40 transition-colors text-left">
            <span className="truncate">{displayLabel}</span>
            <svg viewBox="0 0 24 24" className="h-3 w-3 text-text-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            side="bottom"
            sideOffset={4}
            className="z-[202] w-[220px] rounded-xl border border-border-300 bg-bg-000 p-1.5 shadow-elevated max-h-[50vh] overflow-y-auto"
          >
            {endpoints.map((ep) => (
              <DropdownMenu.Sub key={ep.id}>
                <DropdownMenu.SubTrigger
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-[13px] outline-none transition-colors
                    text-text-200 hover:bg-bg-200 data-[state=open]:bg-bg-200
                    ${endpointId === ep.id ? "font-medium text-accent-brand" : ""}`}
                >
                  <span>{ep.label}</span>
                  <svg viewBox="0 0 24 24" className="h-3 w-3 text-text-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent
                    sideOffset={4}
                    className="z-[203] max-h-[50vh] min-w-[200px] overflow-y-auto rounded-xl border border-border-300 bg-bg-000 p-1.5 shadow-elevated"
                  >
                    {ep.models.map((m) => {
                      const active = endpointId === ep.id && modelId === m.id;
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
                        </DropdownMenu.Item>
                      );
                    })}
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
