import { useState, useEffect } from "react";
import { useAppStore } from "../store/useAppStore";
import { useLocale } from "../i18n";
import { useClickOutside } from "../hooks/useClickOutside";
import {
  apiListEndpointPresets,
  apiCreateEndpoint,
  apiUpdateEndpoint,
  apiTestEndpointPreview,
  apiDeleteEndpoint,
  apiListEndpointModels,
  type EndpointPreset,
} from "../api/endpoint";
import { apiListEndpoints } from "../api/model";
import { ModelListEditor } from "./ModelListEditor";
import { confirmDialog } from "./ConfirmDialog";
import { showToast } from "./Toast";
import { isEndpointUsable, isLocalEndpoint } from "../utils/endpointUsable";
import type { EndpointConfig, EndpointInfo, ModelConfig } from "@lenovo/agent-protocol";

/**
 * 前端预检：在 enabled endpoint 间找首个跨服务撞名的公开 model id（与后端 findModelIdConflicts 同规则）。
 * 返回 null 表示无冲突。提前拦截给用户更快反馈，后端仍是最终权威（返回 409）。
 */
function findFirstModelIdConflict(
  endpoints: EndpointConfig[],
): { modelId: string; otherEndpointId: string } | null {
  const owner = new Map<string, string>();
  for (const ep of endpoints) {
    if (!ep.enabled) continue;
    for (const m of ep.models) {
      const prev = owner.get(m.id);
      if (prev && prev !== ep.id) return { modelId: m.id, otherEndpointId: prev };
      owner.set(m.id, ep.id);
    }
  }
  return null;
}

// 编辑态：基于脱敏的 EndpointInfo，apiKey 单独维护（空=不修改已有 key）
type EditState = {
  id: string;
  label: string;
  apiType: EndpointConfig["apiType"];
  baseUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  enabled: boolean;
  models: ModelConfig[];
  /** Azure OpenAI：api-version（URL 必需）。仅 Azure 预设带，其余 undefined。 */
  azure?: { apiVersion: string };
};

function infoToEdit(e: EndpointInfo): EditState {
  return { ...e, apiKey: "", models: [...e.models] };
}

/**
 * EditState → EndpointConfig（保存用）。单一映射点：剥掉仅 UI 用的 hasApiKey，
 * 其余字段整体透传（含 azure）。create / update 共用此函数。
 */
function editStateToConfig(item: EditState): EndpointConfig {
  const { hasApiKey: _hasApiKey, ...config } = item;
  return config as EndpointConfig;
}

function presetToEdit(p: EndpointPreset): EditState {  return {
    id: p.id,
    label: p.label,
    apiType: p.apiType,
    baseUrl: p.baseUrl,
    apiKey: "",
    hasApiKey: false,
    enabled: true,
    models: [...p.models],
    ...(p.azure ? { azure: p.azure } : {}),
  };
}

export function EndpointSection() {
  return <EndpointManager />;
}

function EndpointManager() {
  const { t } = useLocale();
  const endpoints = useAppStore((s) => s.endpoints);
  const setEndpoints = useAppStore((s) => s.setEndpoints);
  const [presets, setPresets] = useState<EndpointPreset[]>([]);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    apiListEndpointPresets().then(setPresets).catch(() => {});
    // mount 时主动拉一次 endpoints：不依赖 App 全局加载时序，
    // 避免打开设置页时 store 尚为空而误显示「还没有配置任何模型服务」。
    apiListEndpoints().then(setEndpoints).catch(() => {});
  }, []);

  const refresh = async () => {
    const list = await apiListEndpoints();
    setEndpoints(list);
  };

  const handleDelete = async (id: string) => {
    const ok = await confirmDialog({
      title: t("endpoint.deleteTitle"),
      message: t("endpoint.deleteConfirm"),
      confirmText: t("endpoint.deleteConfirmText"),
      danger: true,
    });
    if (!ok) return;
    const res = await apiDeleteEndpoint(id);
    if (res.endpoints) setEndpoints(res.endpoints);
  };

  if (editing) {
    return (
      <EndpointForm
        initial={editing}
        presets={presets}
        siblings={endpoints}
        isNew={adding}
        onPersisted={setEndpoints}
        onClose={() => { setEditing(null); setAdding(false); }}
      />
    );
  }

  return (
    <EndpointList
      endpoints={endpoints}
      onAdd={(preset) => {
        setAdding(true);
        setEditing(preset ? presetToEdit(preset) : blankEdit());
      }}
      onEdit={(e) => {
        setAdding(false);
        setEditing(infoToEdit(e));
      }}
      onDelete={handleDelete}
      onRefresh={refresh}
      presets={presets}
    />
  );
}

function blankEdit(): EditState {
  return {
    id: "",
    label: "",
    apiType: "openai-compatible",
    baseUrl: "",
    apiKey: "",
    hasApiKey: false,
    enabled: true,
    models: [],
  };
}

function EndpointList({
  endpoints,
  presets,
  onAdd,
  onEdit,
  onDelete,
}: {
  endpoints: EndpointInfo[];
  presets: EndpointPreset[];
  onAdd: (preset: EndpointPreset | null) => void;
  onEdit: (e: EndpointInfo) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
}) {
  const { t } = useLocale();

  // 隐藏已添加过的预设
  const availablePresets = presets.filter((p) => !endpoints.some((e) => e.id === p.id));

  return (
    <div className="px-10 py-8">
      <div className="mx-auto" style={{ maxWidth: '760px' }}>
        {/* 标题行 */}
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold text-text-100">
            {t("endpoint.sectionTitle")}
          </h2>
          {endpoints.length > 0 && (
            <AddServicePicker availablePresets={availablePresets} onAdd={onAdd} />
          )}
        </div>

        {/* 描述 */}
        <p className="text-[13px] text-text-400 leading-relaxed mb-6">
          {t("endpoint.sectionDesc")}
        </p>

        {/* Content */}
        {endpoints.length === 0 ? (
          <EmptyState availablePresets={availablePresets} onAdd={onAdd} />
        ) : (
          <div className="rounded-2xl border border-border-300 bg-bg-000 divide-y divide-border-200">
            {endpoints.map((e) => (
              <ServiceRow
                key={e.id}
                endpoint={e}
                onEdit={() => onEdit(e)}
                onDelete={() => onDelete(e.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AddServicePicker({
  availablePresets,
  onAdd,
  align = "right",
}: {
  availablePresets: EndpointPreset[];
  onAdd: (preset: EndpointPreset | null) => void;
  /** 浮层相对按钮的对齐方向。标题栏按钮在最右用 right；空状态按钮居中用 center。 */
  align?: "right" | "center";
}) {
  const { t } = useLocale();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [presetExpanded, setPresetExpanded] = useState(false);
  const pickerRef = useClickOutside<HTMLDivElement>(pickerOpen, () => setPickerOpen(false));

  const panelPos = align === "center" ? "left-1/2 -translate-x-1/2" : "right-0";

  return (
    <div className="relative ml-4 shrink-0" ref={pickerRef}>
      <button
        onClick={() => setPickerOpen((v) => !v)}
        className="px-3 py-1.5 rounded-lg bg-accent-brand text-white text-xs font-medium hover:opacity-90 transition-opacity"
      >
        + {t("endpoint.addService")}
      </button>
      {pickerOpen && (
        <div className={`absolute ${panelPos} top-full mt-1 w-64 rounded-xl border border-border-300 bg-bg-000 py-1 shadow-xl z-10`}>
          {/* 自定义服务 — 主项 */}
          <button
            onClick={() => { setPickerOpen(false); setPresetExpanded(false); onAdd(null); }}
            className="w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-bg-100 transition-colors"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-text-100">{t("endpoint.customService")}</span>
                <span className="rounded bg-accent-brand/10 px-1 py-px text-[10px] font-medium text-accent-brand">{t("endpoint.recommended")}</span>
              </span>
              <span className="mt-0.5 block text-[11px] text-text-400">{t("endpoint.customServiceDesc")}</span>
            </span>
          </button>

          {/* 预设折叠区 */}
          {availablePresets.length > 0 && (
            <>
              <div className="my-1 h-px bg-border-200" />
              <button
                onClick={() => setPresetExpanded((v) => !v)}
                className="w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-bg-100 transition-colors"
              >
                <svg className={`h-3.5 w-3.5 shrink-0 mt-0.5 text-text-300 transition-transform ${presetExpanded ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path d="M9 5l7 7-7 7" />
                </svg>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-text-100">{t("endpoint.fromPreset")}</span>
                  <span className="mt-0.5 block text-[11px] text-text-400">{t("endpoint.fromPresetDesc")}</span>
                </span>
              </button>
              {presetExpanded && availablePresets.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setPickerOpen(false); setPresetExpanded(false); onAdd(p); }}
                  className="w-full px-3 py-2 pl-8 text-left text-xs text-text-200 hover:bg-bg-100 transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({ availablePresets, onAdd }: {
  availablePresets: EndpointPreset[];
  onAdd: (preset: EndpointPreset | null) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="rounded-2xl border border-border-300 bg-bg-000 px-6 py-16 text-center">
      <h3 className="text-sm font-medium text-text-200 mb-1.5">
        {t("endpoint.emptyTitle")}
      </h3>
      <p className="text-xs text-text-400 mb-6 max-w-xs mx-auto">
        {t("endpoint.emptyDesc")}
      </p>
      <div className="inline-flex">
        <AddServicePicker availablePresets={availablePresets} onAdd={onAdd} align="center" />
      </div>
    </div>
  );
}

function ServiceRow({ endpoint, onEdit, onDelete }: {
  endpoint: EndpointInfo;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useClickOutside<HTMLDivElement>(menuOpen, () => setMenuOpen(false));
  const isLocal = isLocalEndpoint(endpoint);
  const usable = isEndpointUsable(endpoint);
  const statusText = (endpoint.hasApiKey || isLocal) ? t("endpoint.ready") : t("endpoint.missingApiKey");

  return (
    <div className="flex items-center">
      <button
        onClick={onEdit}
        className="flex-1 flex items-center gap-3 px-4 py-3.5 hover:bg-bg-100 transition-colors text-left cursor-pointer"
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          usable ? "bg-green-500" : "bg-text-400/40"
        }`} />
        <span className="text-sm font-medium text-text-100 truncate flex-1">{endpoint.label}</span>
        <span className="text-xs text-text-400 shrink-0">
          {t("endpoint.modelCount", { count: endpoint.models.length })} · {statusText}
        </span>
      </button>

      {/* ⋯ 菜单 */}
      <div className="relative pr-2" ref={menuRef}>
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}
          className="p-1.5 rounded hover:bg-bg-200 text-text-400 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16">
            <circle cx="8" cy="3" r="1.5"/>
            <circle cx="8" cy="8" r="1.5"/>
            <circle cx="8" cy="13" r="1.5"/>
          </svg>
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 w-36 rounded-lg border border-border-300 bg-bg-000 py-1 shadow-xl z-20">
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onEdit(); }}
              className="w-full px-3 py-1.5 text-left text-xs text-text-200 hover:bg-bg-100 transition-colors"
            >
              {t("endpoint.edit")}
            </button>
            <div className="my-1 h-px bg-border-200" />
            <button
              onClick={async (e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onDelete();
              }}
              className="w-full px-3 py-1.5 text-left text-xs text-danger-100 hover:bg-danger-900 transition-colors"
            >
              {t("endpoint.delete")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function EndpointForm({
  initial,
  presets,
  siblings,
  isNew,
  onPersisted,
  onClose,
}: {
  initial: EditState;
  presets: EndpointPreset[];
  /** 现有 endpoint 列表，仅用于「模型 id 跨服务撞名」前端预检。 */
  siblings: EndpointInfo[];
  isNew: boolean;
  /** 落库成功后回传脱敏全表，供刷新设置页。 */
  onPersisted: (list: EndpointInfo[]) => void;
  /** 关闭表单（保存成功或取消）。 */
  onClose: () => void;
}) {
  const { t } = useLocale();
  const [item, setItem] = useState<EditState>(initial);
  const [testing, setTesting] = useState(false);
  // 提交中守卫：串行化 persist，防止 Test/Save 往返窗口内重入发出第二个 create
  // （savedId 异步滞后 → 闭包读到旧的 null → 重复 create → 服务端撞名 409）。
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; suggestedApiType?: EndpointConfig["apiType"] } | null>(null);
  // 新建未落库时为 null；落库后（或编辑既有）持有服务端真实 id，后续保存走 update。
  const [savedId, setSavedId] = useState<string | null>(isNew ? null : initial.id);
  // preset 用「打开表单时的初始 id」判定来源，而非实时输入——决定是否隐藏 API Key / 显示获取链接。
  const preset = presets.find((p) => p.id === initial.id);
  const isLocal = !!preset?.local || isLocalEndpoint(item);

  const set = (patch: Partial<EditState>) => setItem((s) => ({ ...s, ...patch }));

  const labelError = !item.label.trim();
  // baseUrl 含未改写的模板占位（如 Azure 的 <resource>）时不可保存/测试：否则会真发请求到
  // 字面 https://<resource>... → DNS 失败。在最早的 canSave 层拦，Save/Test 同时置灰。
  const baseUrlHasTemplate = /[<>]/.test(item.baseUrl);
  const canSave =
    !!item.label.trim() && !!item.baseUrl && !baseUrlHasTemplate && item.models.length > 0 && item.models.every((m) => m.id);

  const inputCls =
    "w-full rounded-lg border border-border-300 bg-bg-000 px-3 py-2 text-xs text-text-100 shadow-soft placeholder:text-text-400 focus:border-accent-brand/40 focus:outline-none";

  /**
   * 落库（幂等）：首次新建走 create（服务端铸 id，预设则沿用预设 id），之后走 update。
   * 这样「测试」先落库再测、随后「保存」不会重复创建。返回真实 id；失败已 toast，返回 null。
   */
  const persist = async (): Promise<string | null> => {
    // 重入守卫：一次只允许一个落库往返。挡住 Test 进行中再点 Save、或 Save 连点。
    if (busy) return null;
    setBusy(true);
    try {
      // 前端预检：公开 model id 跨服务唯一（与后端 409 同规则，提前拦截）。
      const others = siblings.filter((e) => e.id !== item.id);
      const prospective: EndpointConfig[] = [
        ...others.map((e) => ({ ...e, apiKey: "" } as EndpointConfig)),
        editStateToConfig(item),
      ];
      const conflict = findFirstModelIdConflict(prospective);
      if (conflict) {
        showToast("error", `模型 id "${conflict.modelId}" 已存在于服务「${conflict.otherEndpointId}」，请改用唯一的模型 id（如加后缀）`);
        return null;
      }
      const res = savedId == null
        ? await apiCreateEndpoint(editStateToConfig(item))
        : await apiUpdateEndpoint(savedId, editStateToConfig(item));
      if (res.ok && res.endpoints) {
        onPersisted(res.endpoints);
        const id = res.endpoint?.id ?? savedId!;
        setSavedId(id);
        // 同步真实 id 与脱敏态，使后续编辑/测试基于落库结果。
        if (res.endpoint) setItem((it) => ({ ...it, id, apiKey: "", hasApiKey: res.endpoint!.hasApiKey }));
        return id;
      }
      if (res.code === "model_id_conflict" && res.conflicts?.length) {
        const c = res.conflicts[0];
        showToast("error", `模型 id "${c.modelId}" 在多个服务中重复（${c.endpointIds.join(" / ")}），请改名后重试`);
      } else {
        showToast("error", res.error || t("endpoint.saveFailed"));
      }
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    const id = await persist();
    if (id) onClose();
  };

  const handleTest = async (apiTypeOverride?: EndpointConfig["apiType"]) => {
    setTesting(true);
    setTestResult(null);
    try {
      // 不再 persist()，直接传当前表单值（临时测试，不落库）
      const res = await apiTestEndpointPreview({
        baseUrl: item.baseUrl,
        apiType: apiTypeOverride ?? item.apiType,  // 诊断式重试时用建议协议，绕开 setState 异步滞后
        apiKey: item.apiKey || undefined,  // 空串转 undefined
        models: item.models,
        id: item.id || undefined,  // 编辑态有 id，服务端回退已存 key
        ...(item.azure ? { azure: item.azure } : {}),  // 透传 azure
      });
      setTestResult(res);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="px-10 py-8">
      <div className="mx-auto" style={{ maxWidth: '760px' }}>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="rounded-lg p-1 text-text-400 hover:bg-bg-100">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <span className="text-sm font-medium text-text-100">{isNew ? t("endpoint.addServiceTitle") : item.label}</span>
          </div>

      <Field label={t("endpoint.fieldName")}>
        <input className={inputCls} value={item.label} onChange={(e) => set({ label: e.target.value })} placeholder={t("endpoint.namePlaceholder")} />
        {labelError && <p className="mt-1 text-[11px] text-danger-100">{t("endpoint.nameRequired")}</p>}
      </Field>

      <Field label={t("endpoint.protocolLabel")}>
        {/* 协议不再是裸下拉：用两张带场景说明的 radio 卡片，让不懂「协议」术语的用户也能
            按「我用的是哪类服务」对号入座。预设端点协议出厂锁定，渲染为禁用态卡片 + 只读说明。 */}
        <div className="space-y-1.5">
          {([
            { value: "openai-compatible", title: t("endpoint.openaiCompatible"), desc: t("endpoint.openaiCompatibleDesc"), recommended: true },
            { value: "anthropic", title: t("endpoint.anthropicProtocol"), desc: t("endpoint.anthropicProtocolDesc"), recommended: false },
          ] as const).map((opt) => {
            const selected = item.apiType === opt.value;
            const locked = !!preset;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={locked && !selected}
                onClick={() => { if (!locked) set({ apiType: opt.value }); }}
                className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                  selected ? "border-accent-brand/60 bg-purple-light2" : "border-border-300 bg-bg-000 hover:border-accent-brand/30"
                } ${locked ? "cursor-default" : "cursor-pointer"} ${locked && !selected ? "opacity-40" : ""}`}
              >
                <span className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${selected ? "border-accent-brand" : "border-border-300"}`}>
                  {selected && <span className="h-1.5 w-1.5 rounded-full bg-accent-brand" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-text-100">{opt.title}</span>
                    {opt.recommended && <span className="rounded bg-accent-brand/10 px-1 py-px text-[10px] font-medium text-accent-brand">{t("endpoint.recommended")}</span>}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-text-400">{opt.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
        {preset && <p className="mt-1 text-[11px] text-fg-subtle">{t("endpoint.apiTypeLocked")}</p>}
      </Field>

      <Field label={t("endpoint.fieldBaseUrl")}>
        <input className={inputCls} value={item.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder={item.apiType === "anthropic" ? "https://api.anthropic.com" : "https://api.example.com/v1"} />
        {/* 模板占位（如 Azure 的 <resource>）未改写：高亮提醒，否则路由命中不了。 */}
        {/[<>]/.test(item.baseUrl) && (
          <p className="mt-1 text-[11px] text-amber-600">
            {t("endpoint.baseUrlTemplateHint")}
          </p>
        )}
        {item.apiType === "openai-compatible" && !isLocal && item.baseUrl.trim() && !/[<>]/.test(item.baseUrl) && !item.azure && !/\/v\d+\/?$/.test(item.baseUrl.trim()) && (
          <p className="mt-1 text-[11px] text-amber-600">
            {t("endpoint.baseUrlHint")}
            <button
              type="button"
              onClick={() => set({ baseUrl: item.baseUrl.trim().replace(/\/$/, "") + "/v1" })}
              className="ml-1 text-accent-brand hover:underline"
            >
              {t("endpoint.completeV1")}
            </button>
          </p>
        )}
      </Field>

      {/* Azure OpenAI：api-version 是 URL 必需参数，单独可编辑。仅 Azure endpoint 显示。 */}
      {item.azure && (
        <Field label="API Version">
          <input
            className={inputCls}
            value={item.azure.apiVersion}
            onChange={(e) => set({ azure: { apiVersion: e.target.value } })}
            placeholder="2024-10-21"
          />
          <p className="mt-1 text-[11px] text-fg-subtle">{t("endpoint.azureApiVersionHint")}</p>
        </Field>
      )}

      {!isLocal && (
        <Field label="API Key">
          <input
            type="password"
            className={inputCls}
            value={item.apiKey}
            onChange={(e) => set({ apiKey: e.target.value })}
            placeholder={item.hasApiKey ? t("endpoint.apiKeySavedPlaceholder") : t("endpoint.apiKeyPlaceholder")}
          />
          {preset?.apiKeyUrl && (
            <a href={preset.apiKeyUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11px] text-accent-brand hover:underline">
              {t("endpoint.getApiKey")}
            </a>
          )}
        </Field>
      )}

      <ModelListEditor
        models={item.models}
        onChange={(models) => set({ models })}
        canFetch={!!item.baseUrl}
        fetchModels={() =>
          apiListEndpointModels({
            baseUrl: item.baseUrl,
            apiType: item.apiType,
            apiKey: item.apiKey || undefined,
            id: item.id || undefined,
          })
        }
      />

      {testResult && (
        <div className={`rounded-lg px-3 py-2 text-xs ${testResult.ok ? "bg-green-500/10 text-green-600" : "bg-danger-900 text-danger-100"}`}>
          <div>{testResult.ok ? t("endpoint.testSuccess") : t("endpoint.testFailed", { error: testResult.error ?? "" })}</div>
          {/* 诊断式引导：失败且后端判定协议可能选反 → 给一键切换并重试，把红字升级为可执行操作。 */}
          {!testResult.ok && testResult.suggestedApiType && testResult.suggestedApiType !== item.apiType && (
            <button
              type="button"
              onClick={() => {
                const next = testResult.suggestedApiType!;
                set({ apiType: next });
                // 用 next 作为显式 override 立即重测——handleTest 不读 item.apiType，
                // 故无需等 setState 落地（这正是 override 参数存在的理由）。
                void handleTest(next);
              }}
              className="mt-1.5 inline-block rounded-md bg-bg-000 px-2 py-1 text-[11px] font-medium text-accent-brand hover:underline"
            >
              {testResult.suggestedApiType === "anthropic" ? t("endpoint.suggestSwitchAnthropic") : t("endpoint.suggestSwitchOpenAI")}
            </button>
          )}
        </div>
      )}

      <div className="flex gap-2 pt-4">
        <button onClick={handleSave} disabled={!canSave || busy || testing} className="px-4 py-2 rounded-lg bg-accent-brand text-white text-xs font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity">
          {t("endpoint.save")}
        </button>
        <button onClick={() => handleTest()} disabled={!canSave || busy || testing} className="px-4 py-2 rounded-lg border border-border-300 text-xs text-text-300 hover:bg-bg-100 disabled:opacity-40 transition-colors">
          {testing ? t("endpoint.testing") : t("endpoint.testConnection")}
        </button>
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border-300 text-xs text-text-400 hover:bg-bg-100 transition-colors">
          {t("endpoint.cancel")}
        </button>
      </div>
    </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-text-400">{label}</label>
      {children}
    </div>
  );
}

