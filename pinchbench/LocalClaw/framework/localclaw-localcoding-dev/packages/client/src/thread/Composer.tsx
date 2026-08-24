// 卡片化输入框：输入 + 底栏(附件 / Mode chip / Model chip / 发送)。
// 会话级运行配置(model/permissionMode)随 session.start/continue payload 直发(保留 localcoding 直发链)。
import { useState, useCallback, useRef, useEffect } from "react";
import type { ClientEvent, PermissionMode } from "@lenovo/agent-protocol";
import type { SmartHybridConfig } from "@lenovo/agent-protocol";
import { useAppStore } from "../store/useAppStore";
import { useLocale } from "../i18n";
import { createSession } from "../store/slices/sessionSlice";
import { getRunConfig, flattenTarget } from "../store/slices/routingSlice";
import { useThreadStore } from "./store";
import { AttachmentChips, readFilesAsAttachments, ATTACHMENT_MAX } from "../runtime/AttachmentChips";
import { ModeChip } from "./ModeChip";
import { ModelSelectorChip } from "./ModelSelectorChip";
import { CwdMissingBanner } from "./CwdMissingBanner";
import { PermissionConfirmCard } from "./PermissionConfirmCard";
import { AskUserQuestionCard } from "./AskUserQuestionCard";
import { isInVscode, requestNativePermission, requestPickFile, onHostMessage, getEditorContext, type EditorContext } from "../vscode/bridge";
import { PlanApprovalCard } from "./PlanApprovalCard";
import { SlashCommandMenu, type SlashItem } from "./SlashCommandMenu";
import { track } from "../telemetry/client";
import type { QueuedMessage } from "./store/threadSlice";

// 稳定空数组引用：会话无队列时返回同一实例，避免 zustand selector 每次返回新 [] 触发重渲染。
const EMPTY_QUEUE: QueuedMessage[] = [];

// 新会话/空态（无 activeSessionId）时草稿分桶用的固定 key。
const NEW_DRAFT_KEY = "__new__";

interface Props {
  sendEvent: (event: ClientEvent) => void;
  variant?: "docked" | "centered";
}

export function Composer({ sendEvent, variant = "docked" }: Props) {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const defaultWorkspace = useAppStore((s) => s.defaultWorkspace);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const draftRunConfig = useAppStore((s) => s.draftRunConfig);
  // 升级态是会话级事实：只读当前会话的 escalationModel（有值=升级中），不再用全局布尔，
  // 避免会话 A 的升级在切到会话 B 时仍显示、以及 abort 后全局卡死。
  const escalationModel = useAppStore((s) =>
    activeSessionId ? s.sessions[activeSessionId]?.escalationModel : undefined,
  );
  const setDraftRunConfig = useAppStore((s) => s.setDraftRunConfig);
  const setSelectedModel = useAppStore((s) => s.setSelectedModel);
  const setSessionRunConfig = useAppStore((s) => s.setSessionRunConfig);
  const pendingStart = useThreadStore((s) => s.pendingStart);
  const setPendingStart = useThreadStore((s) => s.setPendingStart);
  const composerDraft = useThreadStore((s) => s.composerDraft);
  const setComposerDraft = useThreadStore((s) => s.setComposerDraft);
  const setDraftForSession = useThreadStore((s) => s.setDraftForSession);
  const attachments = useThreadStore((s) => s.attachments);
  const addAttachment = useThreadStore((s) => s.addAttachment);
  const removeAttachment = useThreadStore((s) => s.removeAttachment);
  const clearAttachments = useThreadStore((s) => s.clearAttachments);
  const enqueueMessage = useThreadStore((s) => s.enqueueMessage);
  const clearQueue = useThreadStore((s) => s.clearQueue);
  const { t } = useLocale();

  // 草稿分桶 key：有 activeSession 用其 id，空态用固定 key。切换会话时 key 变 → value 随之切换。
  const draftKey = activeSessionId ?? NEW_DRAFT_KEY;
  const value = useThreadStore((s) => s.draftBySession[draftKey] ?? "");
  const setValue = useCallback(
    (next: string) => setDraftForSession(draftKey, next),
    [draftKey, setDraftForSession],
  );
  const [dragOver, setDragOver] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 输入框整卡片 ref：斜杠浮层按整张卡片定位（贴卡片下方/上方），
  // 而非仅 textarea——否则会压在卡片内的工具栏上（见 docs/images/1.png）。
  const cardRef = useRef<HTMLDivElement>(null);

  // ── 斜杠命令补全状态 ──
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const slashItemsRef = useRef<SlashItem[]>([]);
  // VSCode @文件:记录触发 QuickPick 时 "@" 在输入串中的位置,选完据此替换。
  const atPosRef = useRef<number | null>(null);
  const slashFilter = slashOpen && value.startsWith("/") ? value.slice(1) : "";
  const slashCwd =
    ((activeSessionId ? sessions[activeSessionId]?.cwd : undefined) ?? defaultWorkspace) || undefined;

  // 自适应高度：先归零再按 scrollHeight 撑开，受 CSS max-height 约束（超出则内部滚动）。
  // 仅改 height，不读 maxHeight（由 style 控制），保证发送清空后回到单行。
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // value 变化（输入 / 发送清空 / 排队清空）后同步高度
  useEffect(() => {
    autoResize();
  }, [value, autoResize]);

  // 消费预填草稿（如「自动化-通过聊天创建」跳转注入）：注入到输入框并清空草稿，仅一次。
  useEffect(() => {
    if (composerDraft) {
      setValue(composerDraft);
      setComposerDraft("");
      // 注入后聚焦并将光标移到末尾
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      });
    }
  }, [composerDraft, setComposerDraft, setValue]);

  // 切换会话(draftKey 变)后草稿被整体替换，受控 textarea 会把光标重置到开头。
  // 此处在切换后把光标移到文本末尾，符合"接着写"的预期。仅依赖 draftKey，
  // 不依赖 value，避免每次按键都重置光标。
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || !el.value) return;
    el.setSelectionRange(el.value.length, el.value.length);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  // 排队：上一轮还在跑时输入的消息暂存于 store（按所属会话分桶），FIFO，status 回落后由
  // AppShell 的全局 hook 逐条自动发送。提升到 store 后，切换会话时队列跟着会话走，
  // 不会被误发到当前激活会话。runConfig 在【入队时】快照，避免排队后切 model/mode 改变配置。
  const queued = useThreadStore((s) =>
    activeSessionId ? (s.queuedBySession[activeSessionId] ?? EMPTY_QUEUE) : EMPTY_QUEUE,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
  const isRunning = activeSession?.status === "running" || pendingStart;
  const remaining = ATTACHMENT_MAX - attachments.length;

  // 待确认的「写类工具」权限请求覆盖输入框（替换渲染）。ExitPlanMode 由 ThreadPane 顶部
  // 面板处理，不在此集合内。取最新一条。
  const resolvePermissionRequest = useAppStore((s) => s.resolvePermissionRequest);
  const appendToolResult = useAppStore((s) => s.appendToolResult);
  const CONFIRM_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"];
  const pendingConfirm = (activeSession?.permissionRequests ?? []).filter(
    (r: { toolName: string }) => CONFIRM_TOOLS.includes(r.toolName),
  );
  const confirmReq = pendingConfirm[pendingConfirm.length - 1];

  // 待回答的 AskUserQuestion：同样覆盖输入框（翻页式问答卡，见 21/22.png）。取最新一条。
  const pendingAsk = (activeSession?.permissionRequests ?? []).filter(
    (r: { toolName: string }) => r.toolName === "AskUserQuestion",
  );
  const askReq = pendingAsk[pendingAsk.length - 1];

  // 待批准的 ExitPlanMode：覆盖输入框上方（见 docs/images/4.png）。取最新一条。
  const pendingPlan = (activeSession?.permissionRequests ?? []).filter(
    (r: { toolName: string }) => r.toolName === "ExitPlanMode" || r.toolName === "exit_plan_mode",
  );
  const planReq = pendingPlan[pendingPlan.length - 1];

  const handleConfirm = useCallback(
    (result: { behavior: "allow" | "deny"; updatedInput?: unknown; message?: string; dontAskAgain?: boolean }) => {
      if (!activeSessionId || !confirmReq) return;
      const { dontAskAgain, ...rest } = result;
      sendEvent({
        type: "permission.response",
        payload: { sessionId: activeSessionId, toolUseId: confirmReq.toolUseId, result: rest, dontAskAgain },
      } as ClientEvent);
      resolvePermissionRequest(activeSessionId, confirmReq.toolUseId);
    },
    [activeSessionId, confirmReq, sendEvent, resolvePermissionRequest],
  );

  // ── VSCode 插件：编辑类工具改走宿主原生 diff 审阅门 ──
  // confirmReq 为 Write/Edit/MultiEdit 且运行在 VSCode 里时，不渲染自画确认卡（见下方
  // 渲染分支），而是请求宿主弹原生 diff；宿主决策经 bridge 回传后等价调用 handleConfirm。
  const nativeReviewedRef = useRef<Set<string>>(new Set());
  const isEditToolName = (n?: string) =>
    n === "Write" || n === "Edit" || n === "MultiEdit";

  useEffect(() => {
    if (!confirmReq || !isInVscode() || !isEditToolName(confirmReq.toolName)) return;
    const id = confirmReq.toolUseId;
    if (nativeReviewedRef.current.has(id)) return;
    nativeReviewedRef.current.add(id);
    requestNativePermission(id, confirmReq.toolName, confirmReq.input);
  }, [confirmReq]);

  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.type !== "localcoding:permissionDecision") return;
      if (!confirmReq) return;
      if (msg.approved) {
        handleConfirm({ behavior: "allow", updatedInput: confirmReq.input as Record<string, unknown> });
      } else {
        handleConfirm({ behavior: "deny", message: msg.message });
      }
    });
    return off;
  }, [handleConfirm, confirmReq]);

  // VSCode @文件:宿主 QuickPick 选完 -> 把记录位置的单个 "@" 替换为 "@<相对路径> "。
  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.type !== "localcoding:filePicked") return;
      const pos = atPosRef.current;
      atPosRef.current = null;
      if (pos == null || !msg.path) return;
      const at = value.indexOf("@", Math.max(0, pos - 1));
      if (at < 0) return;
      setValue(value.slice(0, at) + "@" + msg.path + " " + value.slice(at + 1));
      textareaRef.current?.focus();
    });
    return off;
  }, [value, setValue]);

  // AskUserQuestion 提交/忽略：送后端解除阻塞 + 乐观写入 tool_result（消息流历史卡显示答案）。
  const handleAskSubmit = useCallback(
    (result: { behavior: "allow" | "deny"; updatedInput?: unknown; message?: string }) => {
      if (!activeSessionId || !askReq) return;
      sendEvent({
        type: "permission.response",
        payload: { sessionId: activeSessionId, toolUseId: askReq.toolUseId, result },
      } as ClientEvent);
      appendToolResult(activeSessionId, askReq.toolUseId, result);
      resolvePermissionRequest(activeSessionId, askReq.toolUseId);
    },
    [activeSessionId, askReq, sendEvent, appendToolResult, resolvePermissionRequest],
  );

  // 计划批准：以选定模式退出 plan。批准 = 放行 ExitPlanMode，同时把会话权限模式切到
  // 用户选择的执行模式（default 标准 / acceptEdits 自动执行）。否则下一轮 continue 仍带
  // permissionMode:"plan"，复用进程被热切回 plan，写操作再次被拦。
  const handlePlanApprove = useCallback(
    (mode: PermissionMode) => {
      if (!activeSessionId || !planReq) return;
      sendEvent({
        type: "permission.response",
        payload: {
          sessionId: activeSessionId,
          toolUseId: planReq.toolUseId,
          result: { behavior: "allow", updatedInput: planReq.input as Record<string, unknown> },
        },
      } as ClientEvent);
      setSessionRunConfig(activeSessionId, { permissionMode: mode });
      resolvePermissionRequest(activeSessionId, planReq.toolUseId);
    },
    [activeSessionId, planReq, sendEvent, setSessionRunConfig, resolvePermissionRequest],
  );

  // 继续完善：拒绝退出 plan，模型留在计划模式继续调研/完善计划。
  const handlePlanKeepPlanning = useCallback(() => {
    if (!activeSessionId || !planReq) return;
    sendEvent({
      type: "permission.response",
      payload: {
        sessionId: activeSessionId,
        toolUseId: planReq.toolUseId,
        result: { behavior: "deny", message: "Keep planning" },
      },
    } as ClientEvent);
    resolvePermissionRequest(activeSessionId, planReq.toolUseId);
  }, [activeSessionId, planReq, sendEvent, resolvePermissionRequest]);

  // 运行配置：有 activeSession 读会话字段；否则读"新会话默认"draftRunConfig。
  // model 缺省回退全局 selectedModel，mode 缺省 acceptEdits(自动执行)。
  const cfg = activeSession ?? draftRunConfig;
  // permissionMode 缺省 acceptEdits（对齐 dev：自动执行编辑）。
  const curMode: PermissionMode = cfg.permissionMode ?? "acceptEdits";
  const curSmartHybrid = cfg.smartHybrid;
  // 单模型显示：SH 激活时不回退 selectedModel（chip 显示 SH 态），否则回退全局默认。
  const curModel = curSmartHybrid ? undefined : (cfg.model ?? selectedModel.model);
  const curEndpointId = curSmartHybrid ? undefined : (cfg.endpointId ?? selectedModel.endpointId);

  // 写运行配置：有 activeSession 写会话字段；否则写 draft。
  // 治 #9：用户显式选模型（patch 同时含 model+endpointId）时，同步回写全局默认
  // selectedModel——它是新会话的默认来源（resolveRunConfig 回退链终点），重启后即上次选择。
  // 守卫：仅 model+endpointId 都在的 patch 触发，permissionMode-only 的 patch 不动全局默认
  //（防 Zed #41344 式「切个无关项把默认冲掉」）。selectedModel 只写这两个字段、不碰
  // smartHybrid，故无整块覆盖风险。
  const writeConfig = useCallback(
    (patch: { model?: string; endpointId?: string; smartHybrid?: SmartHybridConfig; permissionMode?: PermissionMode }) => {
      if (activeSessionId) setSessionRunConfig(activeSessionId, patch);
      else setDraftRunConfig(patch);
      if (patch.model && patch.endpointId) {
        setSelectedModel({ endpointId: patch.endpointId, model: patch.model });
      }
    },
    [activeSessionId, setSessionRunConfig, setDraftRunConfig, setSelectedModel],
  );

  // 选单模型：写 model/endpointId，互斥清空 smartHybrid。
  const selectSingleModel = useCallback(
    (endpointId: string, model: string) => writeConfig({ endpointId, model, smartHybrid: undefined }),
    [writeConfig],
  );
  // 选智能升级：写 smartHybrid，互斥清空 model/endpointId。
  // 退出 SmartHybrid 无需独立入口——直接在主菜单选一个单模型即可（selectSingleModel 会互斥清空）。
  const selectHybrid = useCallback(
    (config: SmartHybridConfig) => writeConfig({ smartHybrid: config, model: undefined, endpointId: undefined }),
    [writeConfig],
  );

  // ── VSCode 自动上下文注入 ──
  // 宿主实时推送活动编辑器上下文(文件/选区),存于 state 供输入框上方标签展示;
  // 用户可一键关闭本次注入。发消息时 buildPromptWithContext 把上下文拼到 prompt 前。
  const [editorCtx, setEditorCtx] = useState<EditorContext | null>(() => getEditorContext());
  const [ctxEnabled, setCtxEnabled] = useState(true);
  const editorCtxRef = useRef<EditorContext | null>(editorCtx);
  const ctxEnabledRef = useRef(ctxEnabled);
  editorCtxRef.current = editorCtx;
  ctxEnabledRef.current = ctxEnabled;

  useEffect(() => {
    const off = onHostMessage((msg) => {
      if (msg.type === "localcoding:editorContext") setEditorCtx(msg.ctx);
    });
    return off;
  }, []);

  // 把当前编辑器上下文拼到发给 agent 的 prompt 前(读 ref 避免闭包过期)。
  const buildPromptWithContext = (text: string): string => {
    const ctx = editorCtxRef.current;
    if (!ctxEnabledRef.current || !ctx) return text;
    let header = `[当前文件] ${ctx.filePath}`;
    if (ctx.selectedText && ctx.startLine) {
      header += `\n[选中 第${ctx.startLine}-${ctx.endLine}行]\n\`\`\`\n${ctx.selectedText}\n\`\`\``;
    }
    return `${header}\n\n${text}`;
  };

  const handleSend = useCallback(async () => {
    const text = value.trim();
    const hasAttachments = attachments.length > 0;
    if (!text && !hasAttachments) return;
    const sendAttachments = hasAttachments ? attachments : undefined;
    // VSCode 自动上下文注入:把当前文件/选区拼到发给 agent 的 prompt 前(展示仍用原文)。
    const promptForAgent = buildPromptWithContext(text);

    // 核心使用指标:输入框发送消息。直发与入队(续聊)两条路径都在此处统一计一次,
    // 避免漏计/重复计。不含消息正文,仅计数信号 + 非敏感属性。
    track("message_sent", {
      hasAttachment: hasAttachments,
      isFollowup: !!(activeSessionId && isRunning),
    });

    // 上一轮还在跑：入队，等 status 回落后自动发送（仅续聊场景，需已有会话）
    if (activeSessionId && isRunning) {
      const runConfig = getRunConfig(useAppStore.getState(), activeSessionId);
      enqueueMessage(activeSessionId, { prompt: promptForAgent, attachments: sendAttachments, runConfig });
      setValue("");
      clearAttachments();
      return;
    }

    // 发送时(非 render)取运行配置，单一来源，与队列/Reload 一致。
    const sendConfig = getRunConfig(useAppStore.getState(), activeSessionId);
    // 强约束：未选任何模型/SH（target 为 null）不发送——理论上 canSend 已拦，这里双保险。
    if (!sendConfig.target) return;
    // 扁平化成线格式（single→{model,endpointId}，hybrid→{smartHybrid}）+ 正交的 permissionMode。
    const wireConfig = { ...flattenTarget(sendConfig.target), permissionMode: sendConfig.permissionMode };

    if (!activeSessionId) {
      const clientSessionId = crypto.randomUUID();
      const title = (text || attachments[0]?.name || t("thread.newChatTitle")).slice(0, 30);

      // 乐观渲染:立即创建临时 session + 加入用户消息 + 激活。
      // server 回传 session.status 时通过 pendingClientSessionId remap 到真实 ID。
      useAppStore.setState((state: any) => ({
        sessions: {
          ...state.sessions,
          [clientSessionId]: {
            ...createSession(clientSessionId),
            title,
            status: "running",
            messages: [{ type: "user_prompt", prompt: text, attachments: sendAttachments }],
          },
        },
        activeSessionId: clientSessionId,
        pendingClientSessionId: clientSessionId,
      }));

      // 标题生成移到后台(不阻塞渲染)
      fetch("/api/sessions/title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userInput: text || t("thread.attachmentFallback") }),
      }).then(r => r.json()).then(d => {
        if (d.title) useAppStore.setState((state: any) => {
          const sid = state.pendingClientSessionId || clientSessionId;
          const s = state.sessions[sid];
          if (s) return { sessions: { ...state.sessions, [sid]: { ...s, title: d.title } } };
          return state;
        });
      }).catch(() => {});

      sendEvent({
        type: "session.start",
        payload: {
          title, prompt: promptForAgent,
          cwd: defaultWorkspace?.trim() || undefined,
          attachments: sendAttachments,
          ...wireConfig,
        },
      });
    } else {
      // 乐观渲染：立即把用户消息加入消息列表，不等 server 回传 stream.user_prompt。
      useAppStore.setState((state: any) => {
        const existing = state.sessions[activeSessionId];
        if (!existing) return state;
        return { sessions: { ...state.sessions, [activeSessionId]: { ...existing, messages: [...existing.messages, { type: "user_prompt", prompt: text, attachments: sendAttachments }] } } };
      });
      sendEvent({
        type: "session.continue",
        payload: { sessionId: activeSessionId, prompt: promptForAgent, attachments: sendAttachments, ...wireConfig },
      });
    }
    setValue("");
    clearAttachments();
  }, [value, isRunning, activeSessionId, defaultWorkspace, sendEvent, setPendingStart, attachments, clearAttachments, enqueueMessage, setValue, t]);

  const handleStop = useCallback(() => {
    if (!activeSessionId) return;
    sendEvent({ type: "session.stop", payload: { sessionId: activeSessionId } });
  }, [activeSessionId, sendEvent]);

  // textarea 自动高度
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [value]);

  // 排队 flush 已上移到 AppShell 的 useQueueFlush（全局监听所有会话 status 下降沿），
  // 这里不再处理——避免「切到别的会话后，原会话的排队消息被发到当前会话」的串台 bug。

  const handleAddFiles = useCallback(async (files: FileList | File[]) => {
    if (remaining <= 0) return;
    (await readFilesAsAttachments(files, remaining)).forEach(addAttachment);
  }, [addAttachment, remaining]);

  // 输入变化：检测行首 "/" 开启补全（仅当整个输入以 / 开头、无空格、无换行时）。
  const handleChange = useCallback((next: string) => {
    setValue(next);
    const isSlash = next.startsWith("/") && !/\s/.test(next);
    setSlashOpen(isSlash);
    if (isSlash) setSlashIndex(0);
    // VSCode：刚输入 @（行首或前置空白）→ 请求宿主原生 QuickPick 选文件。
    if (isInVscode() && next.length > value.length) {
      const caret = textareaRef.current?.selectionStart ?? next.length;
      const justTyped = next[caret - 1];
      const before = next[caret - 2];
      if (justTyped === "@" && (caret === 1 || before === " " || before === "\n" || before === undefined)) {
        atPosRef.current = caret - 1;
        requestPickFile();
      }
    }
  }, [setValue, value]);

  // 选中补全项 → 回填 "/xxx " 并关闭。
  const handleSlashSelect = useCallback((item: SlashItem) => {
    setValue(`/${item.insert} `);
    setSlashOpen(false);
    textareaRef.current?.focus();
  }, [setValue]);

  const handleSlashItems = useCallback((items: SlashItem[]) => {
    slashItemsRef.current = items;
    setSlashIndex((i) => Math.min(i, Math.max(0, items.length - 1)));
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 补全面板打开时优先拦截导航键，不触发发送。
    if (slashOpen && slashItemsRef.current.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % slashItemsRef.current.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + slashItemsRef.current.length) % slashItemsRef.current.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !(e as any).nativeEvent?.isComposing) {
        e.preventDefault();
        const it = slashItemsRef.current[slashIndex];
        if (it) handleSlashSelect(it);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !(e as any).nativeEvent?.isComposing) {
      e.preventDefault();
      // 内容为空直接返回，回车不触发停止；有内容才走 handleSend（空闲=直接发，running=入队）
      const hasInput = !!value.trim() || attachments.length > 0;
      if (!hasInput) return;
      handleSend();
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files?.length) handleAddFiles(e.dataTransfer.files);
  };

  // 强约束：有输入内容 + 已选运行目标（单模型 or 智能升级）才能发送。
  const hasTarget = !!(curSmartHybrid || (curModel && curEndpointId));
  const canSend = (!!value.trim() || attachments.length > 0) && hasTarget;

  // 命中待批准 ExitPlanMode → 用计划批准决策条替换输入框（覆盖输入区，见 docs/images/4.png）。
  // 计划内容本身在消息流里展示（见 MessageList），此处只做决策。
  if (planReq) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PlanApprovalCard
          onApprove={handlePlanApprove}
          onKeepPlanning={handlePlanKeepPlanning}
        />
      </div>
    );
  }

  // 命中待回答 AskUserQuestion → 用翻页式问答卡替换输入框（覆盖输入区，见 21/22.png）。
  if (askReq) {
    return <AskUserQuestionCard request={askReq} onSubmit={handleAskSubmit} />;
  }

  // 命中写类工具权限 → 用确认卡片替换输入框（覆盖输入区）。
  // VSCode 插件里编辑类工具改走宿主原生 diff（见上方委托 effect），此处不渲染自画卡。
  if (confirmReq && !(isInVscode() && isEditToolName(confirmReq.toolName))) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PermissionConfirmCard request={confirmReq} onSubmit={handleConfirm} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div
        ref={cardRef}
        className={`relative rounded-2xl border bg-bg-000 px-4 pb-3 pt-3 transition-all duration-200 ${
          dragOver ? "border-accent-brand bg-bg-100" : isFocused ? "border-accent-brand/60" : "border-border-300"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {slashOpen && (
          <SlashCommandMenu
            cwd={slashCwd}
            filter={slashFilter}
            direction={variant === "centered" ? "down" : "up"}
            activeIndex={slashIndex}
            onSelect={handleSlashSelect}
            onClose={() => setSlashOpen(false)}
            onItemsChange={handleSlashItems}
            anchorEl={textareaRef.current}
            positionEl={cardRef.current}
          />
        )}
        {activeSessionId && activeSession?.cwdMissing && (
          <CwdMissingBanner sessionId={activeSessionId} missingPath={activeSession.cwdMissing} />
        )}
        {queued.length > 0 && (
          <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-bg-200 px-2.5 py-1 text-xs text-text-300">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 6v6l4 2" /><circle cx="12" cy="12" r="9" /></svg>
            <span className="flex-1">{t("thread.queued", { n: queued.length })}</span>
            <button onClick={() => activeSessionId && clearQueue(activeSessionId)} className="shrink-0 text-text-400 hover:text-text-200" aria-label="Clear queue">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        )}
        <AttachmentChips attachments={attachments} onRemove={removeAttachment} />
        {isInVscode() && editorCtx && (
          <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px]">
            {ctxEnabled ? (
              <button
                type="button"
                onClick={() => setCtxEnabled(false)}
                className="flex items-center gap-1 rounded-full bg-accent-brand/10 px-2 py-0.5 font-mono text-accent-brand hover:bg-accent-brand/20"
                title="点击忽略本次上下文"
              >
                <span className="i-ph-paperclip" />
                {editorCtx.filePath.split(/[\\/]/).pop()}
                {editorCtx.startLine ? `:${editorCtx.startLine}-${editorCtx.endLine}` : ""}
                <span className="opacity-60">×</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setCtxEnabled(true)}
                className="rounded-full bg-bg-200 px-2 py-0.5 text-text-400 hover:text-text-200"
                title="点击重新附加当前文件/选区"
              >
                已忽略上下文 · 点击恢复
              </button>
            )}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          rows={1}
          autoFocus
          placeholder={t("thread.composerPlaceholder")}
          className="composer-input w-full resize-none border-transparent bg-transparent px-2 text-[15px] text-text-100 outline-none ring-0 focus:ring-0 focus:outline-none focus:border-transparent placeholder:text-text-400"
          style={{ minHeight: "44px", maxHeight: "200px", overflowY: "auto" }}
        />
        <div className="mt-2 flex items-center gap-1.5">
          <IconButton label={t("thread.addFiles")} onClick={() => fileInputRef.current?.click()} disabled={remaining <= 0}>
            <path d="M12 5v14M5 12h14" />
          </IconButton>
          <input
            ref={fileInputRef} type="file" multiple className="hidden"
            onChange={(e) => { if (e.target.files) handleAddFiles(e.target.files); e.target.value = ""; }}
          />
          <ModeChip mode={curMode} onChange={(mode) => writeConfig({ permissionMode: mode })} />
          {escalationModel && (
            <span
              title={escalationModel}
              className="flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40"
            >
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor"><path d="M13 2L3 14h7l-1 8 10-12h-7z" /></svg>
              <span className="max-w-[120px] truncate">{escalationModel}</span>
            </span>
          )}

          <div className="ml-auto flex items-center gap-1">
            <ModelSelectorChip
              endpointId={curEndpointId}
              model={curModel}
              smartHybrid={curSmartHybrid}
              onSelect={selectSingleModel}
              onSelectHybrid={selectHybrid}
            />
            {isRunning && !canSend ? (
              <button onClick={handleStop} title="Stop" className="flex h-8 w-8 items-center justify-center rounded-full bg-text-300 text-white transition-opacity hover:opacity-80" aria-label="Stop">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>
              </button>
            ) : (
              <button onClick={handleSend} disabled={!canSend} title="Send" className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-brand text-white transition-all duration-100 hover:scale-105 hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:hover:scale-100" aria-label="Send">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function IconButton({ label, onClick, disabled, children }: {
  label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={label} aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-text-400 transition-colors hover:bg-bg-200 hover:text-text-200 disabled:opacity-40">
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2">{children}</svg>
    </button>
  );
}

