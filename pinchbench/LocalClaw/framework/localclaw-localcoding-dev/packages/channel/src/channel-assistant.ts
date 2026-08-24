import { Injectable } from "@nestjs/common";
import type { StreamEvent } from "golembot/dist/engine.js";
import type { ImageAttachment, FileAttachment, ChannelMessage } from "golembot/dist/channel.js";
import type { NetworkHealthEvent } from "./network-monitor.service";
import { RunnerService } from "@lenovo/agent-sdk";
import { SessionService } from "@lenovo/agent-sdk";
import type { IRoutingService } from "@lenovo/agent-sdk";
import type { Attachment } from "@lenovo/agent-protocol";
import { ChatSessionService } from "./chat-session.service";
import type { ChannelGatewayBridge } from "./channel.bridge";

@Injectable()
export class ChannelAssistant {
  private readonly activeHandles = new Map<string, { abort: () => void }>();
  /** 标记当前会话中是否已发出流式 text_delta 事件，用于跳过 result 去重。 */
  private streamedText = false;
  /** 当前 chatId，用于网络错误时回复通知（仅在对话进行中有效） */
  private currentChatId: string | null = null;

  /**
   * @param replyFn 用于在网络错误时主动通知用户（飞书 reply）
   * @param checkNetwork 立即触发一次网络状态检测
   * @param bridge 渠道网关桥接：用于把会话/流式消息实时推送给前端（与微信 daemon 对齐）
   */
  constructor(
    private readonly runner: RunnerService,
    private readonly sessions: SessionService,
    private readonly chatSessions: ChatSessionService,
    private readonly channelId: string,
    private readonly replyFn?: (msg: ChannelMessage, text: string) => Promise<void>,
    private readonly checkNetwork?: () => Promise<NetworkHealthEvent>,
    private readonly routing?: IRoutingService,
    private readonly bridge?: ChannelGatewayBridge,
  ) {}

  private parseChatId(sessionKey: string): string | null {
    // sessionKey 格式可能是:
    // - channelType:chatId:senderId (标准格式, 如 "feishu:oc_xxx:on_xxx")
    // - feishu:chatId:senderId:thread:threadId (Slack DM with thread)
    // - channelType:chatId (群组会话 buildConversationKey)
    if (!sessionKey) return null;
    const parts = sessionKey.split(":");
    if (parts.length < 2) {
      console.warn(`[channel-assistant] parseChatId: sessionKey "${sessionKey}" has too few parts`);
      return null;
    }
    // 检查是否是 Slack thread 格式: slack:chatId:senderId:thread:threadId
    const threadIdx = parts.indexOf("thread");
    if (threadIdx > 0 && threadIdx < parts.length - 1) {
      // 返回 chatId (第二个部分)
      return parts[1];
    }
    // 标准格式: channelType:chatId:senderId
    return parts[1];
  }

  chat(
    message: string,
    opts?: { sessionKey?: string; images?: ImageAttachment[]; files?: FileAttachment[] },
  ): AsyncIterable<StreamEvent> {
    const sessionKey = opts?.sessionKey ?? "";
    console.log(`[channel-assistant] chat: sessionKey="${sessionKey}" messageLen=${message.length} images=${opts?.images?.length ?? 0} files=${opts?.files?.length ?? 0}`);
    this.streamedText = false;
    return this.startChat(message, sessionKey, opts?.images, opts?.files);
  }

  async cancel(sessionKey?: string): Promise<boolean> {
    if (!sessionKey) return false;
    const handle = this.activeHandles.get(sessionKey);
    if (!handle) return false;
    handle.abort();
    this.activeHandles.delete(sessionKey);
    return true;
  }

  async resetSession(sessionKey?: string): Promise<void> {
    if (!sessionKey) return;
    const chatId = this.parseChatId(sessionKey);
    if (!chatId) return;
    this.chatSessions.setSessionKey(chatId, this.channelId, "");
  }

  setEngine(_engine: string, _clearModel?: boolean): void {
    // Local Claw 用自己的 routing，不切换 engine
  }

  setModel(_model: string): void {
    // Local Claw 用自己的 routing，不直接切 model（模型由 UI/路由偏好统一管理）。
    // 渠道侧的 /model 命令仅作只读展示，写操作交由 UI。
  }

  async getStatus(): Promise<any> {
    // 返回真实活跃模型，让 /status 与「你用的是哪个模型」查询与 UI 设置一致。
    const active = this.routing?.getActiveCloudModel();
    return {
      config: { name: "local-claw", engine: "claude-code" },
      skills: [],
      engine: "claude-code",
      model: active?.label ?? active?.modelName,
    };
  }

  async listModels(): Promise<string[]> {
    // 当前活跃模型置于列表首位，供 /model 命令展示真实值。
    const active = this.routing?.getActiveCloudModel();
    return active ? [active.label || active.modelName] : [];
  }

  /**
   * 构造「当前模型事实」前缀。当用户用自然语言问「你用的是哪个大模型」时，
   * 模型可据此如实回答，而非凭 system prompt 自述（自述值常与 UI 设置不符）。
   * 路由不可用时返回空串，不干扰正常对话。
   */
  private buildModelFact(): string {
    const active = this.routing?.getActiveCloudModel();
    if (!active) return "";
    const name = active.label || active.modelName;
    return `[当前模型事实] 你当前运行在大模型「${name}」(${active.modelName})。` +
      `若用户询问你正在使用哪个模型，请如实回答此模型，不要编造或自述其他名称。\n\n`;
  }

  /**
   * 去掉文本中的 <think>...</think> 推理标签，只保留正文。
   * 兼容流式场景下未闭合的标签前缀（如 "<thi"）。
   */
  private static stripThinkingTags(text: string): string {
    // 移除完整标签
    let out = text.replace(/<\/?think(?:ing)?>/gi, "");
    // 移除流式场景下不完整的标签前缀（如 "<", "<t", "<th", "<thi", "<thin", "<think"）
    out = out.replace(/<\/?t(?:h(?:i(?:n(?:k(?:i(?:n(?:g)?)?)?)?)?)?)?$/i, "");
    return out;
  }

  private mapServerEvent(serverEvent: any): StreamEvent | null {
    if (!serverEvent?.type) return null;
    if (serverEvent.type === "stream.message") {
      const sdkMsg = serverEvent.payload?.message;
      // 流式文本增量：stream_event → content_block_delta → text_delta。
      // 每个 delta 只含新增 token，Gateway streaming loop 用 += 正确累加。
      if (sdkMsg?.type === "stream_event") {
        const ev = sdkMsg.event;
        if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
          this.streamedText = true;
          return { type: "text", content: ChannelAssistant.stripThinkingTags(ev.delta.text) };
        }
      }
      // SDKResultMessage 携带最终完整文本。如果已通过 text_delta 流式发出则跳过，
      // 避免 Gateway 的 fullReply += 重复累加；否则回退到一次下发（非流式场景）。
      if (sdkMsg?.type === "result" && sdkMsg.subtype === "success") {
        if (this.streamedText) return null;
        const result = typeof sdkMsg.result === "string" ? sdkMsg.result : "";
        if (result) return { type: "text", content: ChannelAssistant.stripThinkingTags(result) };
      }
      // CLI 内部错误（如 ede_diagnostic / error_during_execution）兜底：
      // 防止用户在 IM 端看到沉默，给一条提示消息。
      if (sdkMsg?.type === "result" && sdkMsg.subtype !== "success") {
        if (this.streamedText) return null;
        return {
          type: "text",
          content: "抱歉，这条请求我没能处理好，可以换种方式再问问吗？",
        };
      }
      return null;
    }
    return null;
  }

  private startChat(
    message: string,
    sessionKey: string,
    images?: ImageAttachment[],
    files?: FileAttachment[],
  ): AsyncIterable<StreamEvent> {
    type QueueItem =
      | { event: StreamEvent }
      | { done: true }
      | { error: unknown };
    const queue: QueueItem[] = [];
    let resolveNext: (() => void) | null = null;
    const wake = () => {
      const fn = resolveNext;
      resolveNext = null;
      fn?.();
    };

    // 记录当前 chatId，对话结束后清空
    this.currentChatId = this.parseChatId(sessionKey) ?? null;
    let errorNotified = false;

    const onEvent = (serverEvent: any) => {
      const mapped = this.mapServerEvent(serverEvent);
      if (mapped) {
        queue.push({ event: mapped });
        wake();
      }
      if (serverEvent?.type === "session.status") {
        const status = serverEvent.payload?.status;
        // RunnerSpawnService emits these statuses on completion paths.
        if (
          status === "completed" ||
          status === "error" ||
          status === "cancelled" ||
          status === "idle"
        ) {
          this.currentChatId = null; // 对话结束，清空 chatId
          queue.push({ done: true });
          wake();
        }
      }

      // 检测网络错误：CLI 报告 api_retry 后最终失败，或 result 带 is_error + 网络相关错误信息
      if (!errorNotified && this.isNetworkError(serverEvent)) {
        errorNotified = true;
        void this.notifyNetworkError().catch(() => {});
      }
    };

    const setupPromise = this.setupRunner(message, sessionKey, onEvent, images, files).catch(
      (err) => {
        queue.push({ error: err });
        wake();
      },
    );

    return this.makeIterable(queue, (r) => { resolveNext = r; }, sessionKey, setupPromise);
  }

  private static readonly CHANNEL_PROMPT_PREFIX =
    "[Channel 模式] 你正在回复 IM 用户。请遵守以下约束：\n" +
    "- 必须使用中文回复，禁止在回复中夹杂英文（除非用户明确使用英文提问）。\n" +
    "- 禁止调用 Bash/BashOutput/KillShell — 绝不使用这些工具。\n" +
    "- 列出目录内容请使用 Glob，pattern 为 '*' 或 '**/*'（不要用 Bash，不要用 LS）。\n" +
    "- 读取文件内容请使用 Read 工具。\n" +
    "- 必须始终给出文字回复 — 绝不要保持沉默。如果无法满足请求，请直接说明。\n" +
    "- 不要调用 init 时状态为 'failed' 的 MCP 工具。\n\n";

  private async setupRunner(
    message: string,
    sessionKey: string,
    onEvent: (e: any) => void,
    images?: ImageAttachment[],
    files?: FileAttachment[],
  ): Promise<void> {
    console.log(`[channel-assistant] setupRunner: sessionKey="${sessionKey}" messageLen=${message.length} images=${images?.length ?? 0} files=${files?.length ?? 0}`);

    const chatId = this.parseChatId(sessionKey);
    if (!chatId) {
      console.error(`[channel-assistant] Cannot parse chatId from sessionKey: ${sessionKey}`);
      throw new Error(`无法从 sessionKey 解析 chatId: ${sessionKey}`);
    }
    console.log(`[channel-assistant] setupRunner: parsed chatId="${chatId}" channelId="${this.channelId}"`);

    const binding = this.chatSessions.resolve(chatId, this.channelId);
    if (!binding) {
      console.error(`[channel-assistant] No binding found for chatId="${chatId}" channelId="${this.channelId}"`);
      throw new Error(
        `会话 ${chatId} 未绑定工作区。请先使用 /bind <路径> 绑定工作区。`,
      );
    }
    if (!binding.workspaceDir) {
      console.error(`[channel-assistant] Binding found but no workspaceDir for chatId="${chatId}" channelId="${this.channelId}"`);
      throw new Error(
        `会话 ${chatId} 未绑定工作区。请先使用 /bind <路径> 绑定工作区。`,
      );
    }
    console.log(`[channel-assistant] setupRunner: binding resolved, workspaceDir="${binding.workspaceDir}"`);
    let session = binding.sessionKey
      ? this.sessions.getSession(binding.sessionKey)
      : undefined;
    if (!session) {
      session = this.sessions.createSession({
        cwd: binding.workspaceDir,
        // 占位标题，稍后由 ensureSessionVisible 按消息内容生成有意义标题。
        title: `IM ${chatId}`,
        // kind='chat' 使渠道会话出现在前端会话列表（listSessions 只查 kind='chat'），
        // 与微信 daemon 对齐，实现钉钉/企微/飞书聊天记录的全量同步可见。
        kind: "chat",
      });
      this.chatSessions.setSessionKey(chatId, this.channelId, session.id);
    } else if (session.cwd !== binding.workspaceDir) {
      // 工作目录已被用户在 UI 改过：复用的 session 仍持有旧 cwd（spawn 进程级固化），
      // 而 binding.workspaceDir 已是最新值。必须同步 session.cwd，否则 runner 仍 spawn 在
      // 旧目录；同时清空 claudeSessionId，避免在旧目录上下文里 --resume 续接（旧会话的
      // 文件/cwd 语境与新目录不一致，续接会答非所问）。改目录即开启全新上下文。
      console.log(
        `[channel-assistant] workspaceDir changed: "${session.cwd}" -> "${binding.workspaceDir}", resetting session cwd & resume context`,
      );
      this.sessions.updateSession(session.id, {
        cwd: binding.workspaceDir,
        claudeSessionId: undefined,
      });
      session = this.sessions.getSession(session.id) ?? session;
    }
    const sessionId = session.id;
    // 统一保证会话「可见 + 有意义标题」：兼容历史 kind='channel' 的旧绑定
    // （它们被 listSessions 过滤、且无内容标题，前端显示「(未命名)」）。
    this.ensureSessionVisible(session, message, binding.workspaceDir);

    // 处理图片附件：压缩后嵌入 prompt。
    // 直接嵌 1MB base64 会爆 2000 token 上下文限制，必须先压缩。
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    let finalPrompt = ChannelAssistant.CHANNEL_PROMPT_PREFIX + this.buildModelFact() + message;
    const compressedImages: { base64: string; mimeType: string; name: string; size: number }[] = [];

    if (images && images.length > 0) {
      const imageDir = join(binding.workspaceDir, ".golem", "images");
      mkdirSync(imageDir, { recursive: true });
      const ts = Date.now();

      // 压缩图片：自适应质量保识别精度。
      // 尺寸固定 1568px（Anthropic 多模态最优长边，更大也会被 API 缩回），
      // 质量按 90→82→72→60 阶梯递减，首个使 base64 不超过体积上限的即采用。
      // 清晰小图（含文字/截图）保留高质量，仅高分辨率大图才降质，避免爆 context。
      // 不再拼 "[Image N: base64 data:]" 文本——直接通过 attachments 参数传入 runner，
      // 由 runner-spawn sendUserMessage() 转成 Anthropic 原生 image content block，
      // 绕过网关的 imgRe 正则解析，不依赖 convertMessagesToAnthropic。
      const TARGET_B64_LEN = 130 * 1024; // base64 字符上限 ≈ 100KB 图，留足 token 余量
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const rawData = img.data instanceof Buffer ? img.data : Buffer.from(img.data);
        const sizeKB = rawData.length / 1024;
        let b64: string | null = null;
        let mime = "image/jpeg";
        try {
          const { createRequire } = await import("node:module");
          const require = createRequire(import.meta.url);
          const sharp = require("sharp");
          for (const quality of [90, 82, 72, 60]) {
            const buf: Buffer = await sharp(Buffer.from(rawData))
              .resize(1568, 1568, { fit: "inside", withoutEnlargement: true })
              .jpeg({ quality })
              .toBuffer();
            if (buf.toString("base64").length <= TARGET_B64_LEN) {
              b64 = buf.toString("base64");
              mime = "image/jpeg";
              const compressedPath = join(imageDir, "compressed_" + i + ".jpg");
              writeFileSync(compressedPath, new Uint8Array(buf));
              console.log("[channel-assistant] Compressed image " + (i + 1) + ": " + sizeKB.toFixed(0) + "KB -> " + (buf.length / 1024).toFixed(0) + "KB (quality=" + quality + ")");
              break;
            }
          }
        } catch (e) {
          console.log("[channel-assistant] Sharp compression failed: " + String(e) + ", using original");
        }
        if (!b64) {
          // sharp 不可用或所有质量级都超限：原图 base64，保留真实 mime
          b64 = rawData.toString("base64");
          mime = img.mimeType || "image/jpeg";
        }
        const ext = mime === "image/png" ? ".png" : ".jpg";
        compressedImages.push({
          base64: b64,
          mimeType: mime,
          name: "img_" + ts + "_" + i + ext,
          size: rawData.length,
        });
      }

      if (compressedImages.length > 0) {
        finalPrompt += "\n\n[User sent " + compressedImages.length + " image(s) — attached below as image blocks]";
      }
    }

    // 处理文件附件
    if (files && files.length > 0) {
      const fileDir = join(binding.workspaceDir, ".golem", "files");
      mkdirSync(fileDir, { recursive: true });
      const filePaths: string[] = [];
      for (const file of files) {
        const filePath = join(fileDir, file.fileName);
        const data: Uint8Array = file.data instanceof Buffer
          ? new Uint8Array(file.data)
          : file.data;
        writeFileSync(filePath, data);
        filePaths.push(filePath);
      }
      const fileRefs = filePaths.map((p) => "- " + p).join("\n");
      finalPrompt += "\n\n[User attached " + filePaths.length + " file(s). File paths:\n" + fileRefs + "]";
      console.log("[channel-assistant] Saved " + filePaths.length + " files to " + fileDir);
    }

    // 取当前活跃模型并透传给 runner，使渠道对话与 UI 模型选择一致。
    // 若 routing 服务未注入（向后兼容），modelOverride 为空时 forceCloudDecision
    // 会回落至全局态，但仍能正常运作。
    const active = this.routing?.getActiveCloudModel();

    // 全量同步：先持久化一份干净的用户消息（去掉 Channel prompt 前缀/模型事实），
    // 与微信 daemon 的 persistCliMessage 对齐，使前端会话视图能展示用户输入。
    this.persistUserMessage(sessionId, message, compressedImages);

    // 包装 onEvent：在转 IM 文本（原 onEvent）之外，把每条 stream.message 落 messages 表，
    // 并在 session.status 变化时更新会话状态。等价于 SDK 的 RunnerHostService.buildOnEvent，
    // 让钉钉/企微/飞书具备与微信一致的「过程全量入库 + 实时推送」能力。
    const persistingOnEvent = this.wrapOnEvent(sessionId, onEvent);

    const result = await this.runner.createRunner({
      prompt: finalPrompt,
      session,
      onEvent: persistingOnEvent,
      forceCloud: true,
      modelOverride: active?.modelName,
      endpointId: active?.endpointId,
      extraDisallowedTools: ["Bash", "BashOutput", "KillShell"],
      ephemeralProcess: true,
      // IM/channel 无交互界面，用户无法响应权限确认卡片。必须用 bypassPermissions
      // 完全放行，否则写类工具（Write/Edit 等）在 default 模式下会挂起等确认，
      // 表现为渠道消息无响应。危险 shell 工具已由上面的 extraDisallowedTools 禁掉。
      permissionMode: "bypassPermissions",
      // 跨消息记忆：用上轮回写的 claudeSessionId --resume 续接上下文，
      // 使飞书/钉钉/企微等 golembot 渠道具备与微信常驻 daemon 对齐的记忆能力。
      resumeSessionId: session.claudeSessionId,
      // 图片走 attachments 参数——runner-spawn sendUserMessage() 将其转成 Anthropic
      // 原生 image content block，直达 API，不依赖网关的 imgRe 文本解析。
      attachments: compressedImages,
      // 回写 init 返回的 claudeSessionId 到 DB，供下条消息 resume。
      onSessionUpdate: (updates) => {
        if ("claudeSessionId" in updates) {
          this.sessions.updateSession(session.id, { claudeSessionId: updates.claudeSessionId });
        }
      },
    });
    this.activeHandles.set(sessionKey, result.handle);
  }

  /**
   * 生成会话展示标题：取用户消息首行、压缩空白、截断到 ~40 字。
   * 渠道场景不调用大模型生成标题（会拖慢首响应、且 IM 内容通常足够短），
   * 直接用消息内容作标题，已足以区分会话，与 UI 聊天的可读性对齐。
   */
  private static deriveTitle(message: string): string {
    let firstLine = (message || "").replace(/\s+/g, " ").trim();
    // 去除 golembot 给渠道消息加的系统前缀 `[System: ...]`，还原真正的用户文本。
    firstLine = firstLine.replace(/^\s*\[System:[^\]]*\]\s*/i, "").trim();
    if (!firstLine) return "新对话";
    return firstLine.length > 40 ? firstLine.slice(0, 40) + "…" : firstLine;
  }

  /**
   * 保证渠道会话在前端「可见且有意义」。三件事：
   * 1. kind 升级为 'chat'：历史旧绑定的会话是 kind='channel'，被 listSessions 过滤掉；
   * 2. 标题补全：旧会话标题为空或为 `IM <chatId>` 占位时，用消息内容生成可读标题；
   * 3. 全量推送 emitSessionUpdate（带 title/kind/cwd/status），使前端 store 拿到非空标题，
   *    不再显示「(未命名)」。
   * 新建会话与复用旧会话都会走到此处，逻辑幂等。
   */
  private ensureSessionVisible(
    session: { id: string; title?: string; kind?: string },
    message: string,
    workspaceDir: string,
  ): void {
    try {
      const updates: { title?: string; kind?: "chat" } = {};
      if (session.kind !== "chat") updates.kind = "chat";
      const t = (session.title ?? "").trim();
      const isPlaceholder = !t || t.startsWith("IM ");
      if (isPlaceholder) updates.title = ChannelAssistant.deriveTitle(message);
      if (Object.keys(updates).length > 0) {
        this.sessions.updateSession(session.id, updates as any);
        if (updates.title) session.title = updates.title;
        if (updates.kind) session.kind = updates.kind;
      }
      this.bridge?.emitSessionUpdate({
        id: session.id,
        title: session.title,
        status: "running",
        cwd: workspaceDir,
        kind: "chat",
        channelId: this.channelId,
      });
      console.log(`[channel-assistant] emitSessionUpdate channelId="${this.channelId}" sessionId="${session.id}"`);
    } catch (e) {
      console.warn(`[channel-assistant] ensureSessionVisible failed: ${(e as Error)?.message}`);
    }
  }

  private persistUserMessage(
    sessionId: string,
    text: string,
    images: { base64: string; mimeType: string }[],
  ): void {
    try {
      const data: any = { type: "user_prompt", prompt: text };
      if (images.length > 0) {
        data.attachments = images.map((img) => ({
          type: "image",
          mimeType: img.mimeType,
        }));
      }
      this.sessions.recordMessage(sessionId, data);
      this.bridge?.emitStreamMessage(sessionId, data);
    } catch (e) {
      console.warn(`[channel-assistant] persistUserMessage failed: ${(e as Error)?.message}`);
    }
  }

  /**
   * 包装上游 onEvent：保留原有「事件→IM 文本」映射，并叠加全量持久化。
   * - stream.message：落 messages 表 + 推送前端（瞬时类型由 recordMessage 内部过滤）。
   * - session.status：更新会话状态 + 推送，使前端会话列表状态实时同步。
   * 这是 golembot 渠道全量同步的核心：原 onEvent 只回 IM，不入库。
   */
  private wrapOnEvent(
    sessionId: string,
    inner: (e: any) => void,
  ): (e: any) => void {
    return (serverEvent: any) => {
      try {
        if (serverEvent?.type === "stream.message") {
          const message = serverEvent.payload?.message;
          if (message) {
            this.sessions.recordMessage(sessionId, message);
            this.bridge?.emitStreamMessage(sessionId, message);
          }
        } else if (serverEvent?.type === "session.status") {
          const status = serverEvent.payload?.status;
          if (status) {
            this.sessions.updateSession(sessionId, { status });
            this.bridge?.emitSessionUpdate({ id: sessionId, status, channelId: this.channelId });
          }
        }
      } catch (e) {
        console.warn(`[channel-assistant] wrapOnEvent persist failed: ${(e as Error)?.message}`);
      }
      // 始终调用原 onEvent，保证 IM 回复链路不受影响
      inner(serverEvent);
    };
  }

  /**
   * 判断 serverEvent 是否为网络错误相关事件。
   * 三类信号：
   * 1. session.retry (api_retry) —— CLI 正在重连
   * 2. result / is_error=true + 网络相关错误文本
   * 3. error-trace 内联消息（stdout-close-while-running）
   */
  private isNetworkError(serverEvent: any): boolean {
    if (!serverEvent) return false;
    if (
      serverEvent.type === "session.retry" &&
      (serverEvent.payload?.attempt ?? 0) > 0
    ) {
      return true;
    }
    const r = serverEvent.payload?.message;
    if (r?.type === "result" && r.is_error === true) {
      const resultText = typeof r.result === "string" ? r.result : "";
      if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|DNS|unable to connect|network/i.test(resultText)) {
        return true;
      }
    }
    if (
      serverEvent.type === "error-trace" &&
      /(ENOTFOUND|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|unable to connect|进程未发 result)/i.test(JSON.stringify(serverEvent))
    ) {
      return true;
    }
    return false;
  }

  /**
   * 网络错误检测到后：先立即检测一次网络状态，再向用户发送通知。
   */
  private async notifyNetworkError(): Promise<void> {
    const chatId = this.currentChatId;
    if (!chatId || !this.replyFn) return;
    let reason = "网络连接异常，请检查本地网络状态";
    if (this.checkNetwork) {
      try {
        const health = await this.checkNetwork();
        if (health.reason) reason = health.reason;
      } catch { /* best-effort */ }
    }
    const time = new Date().toLocaleString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const text =
      "⚠️ LocalCoding 网络连接失败\n\n" +
      `**断开时间**：${time}\n\n` +
      `**可能原因**：${this.classifyReason(reason)}\n\n` +
      "**建议操作**：\n" +
      "1. 检查本地网络连接\n" +
      "2. 等待几秒后重新发送消息\n" +
      "3. 如持续断开请联系管理员";
    const fakeMsg: ChannelMessage = {
      chatId, senderId: "", text: "", images: [], files: [],
      channelType: "feishu", chatType: "dm", raw: undefined,
    };
    try {
      await this.replyFn(fakeMsg, text);
    } catch (e) {
      console.warn(`[channel-assistant] notifyNetworkError failed: ${(e as Error)?.message}`);
    }
  }

  private classifyReason(reason: string): string {
    const r = reason.toLowerCase();
    if (r.includes("enotfound") || r.includes("dns"))
      return "DNS 解析失败，请检查网络是否正常";
    if (r.includes("timeout") || r.includes("etimedout"))
      return "连接超时，可能是网络不稳定或防火墙阻断";
    if (r.includes("econnrefused"))
      return "目标服务器拒绝连接，请检查 API 服务是否在线";
    if (r.includes("unable to connect"))
      return "无法连接到服务器，请检查网络是否正常";
    return reason;
  }

  private makeIterable(
    queue: Array<{ event: StreamEvent } | { done: true } | { error: unknown }>,
    setResolve: (r: (() => void) | null) => void,
    sessionKey: string,
    setupPromise: Promise<void>,
  ): AsyncIterable<StreamEvent> {
    const handles = this.activeHandles;
    return {
      [Symbol.asyncIterator]: () => ({
        async next(): Promise<IteratorResult<StreamEvent>> {
          while (true) {
            if (queue.length === 0) {
              await new Promise<void>((r) => setResolve(r));
            }
            const item = queue.shift();
            if (!item) continue;
            if ("error" in item) {
              handles.delete(sessionKey);
              throw item.error;
            }
            if ("done" in item) {
              handles.delete(sessionKey);
              return { value: undefined, done: true };
            }
            return { value: item.event, done: false };
          }
        },
        async return(): Promise<IteratorResult<StreamEvent>> {
          await setupPromise;
          handles.delete(sessionKey);
          return { value: undefined, done: true };
        },
      }),
    };
  }
}
