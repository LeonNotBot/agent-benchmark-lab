import { Injectable, Inject } from "@nestjs/common";
import type { WsEventHandler } from "@lenovo/agent-sdk";
import type { ServerEvent } from "@lenovo/agent-protocol";
import { SpeechService } from "../speech/speech.service";

/**
 * 语音识别事件处理器（宿主侧）：处理 SDK 内核不认识的 speech.recognize 事件。
 * SpeechService 留在 server，只在此处适配成 SDK 的 WsEventHandler 通用契约。
 */
@Injectable()
export class SpeechHandler implements WsEventHandler {
  readonly type = "speech.recognize";

  constructor(
    @Inject(SpeechService) private readonly speechService: SpeechService,
  ) {}

  async handle(
    payload: unknown,
    emit: (event: ServerEvent) => void,
  ): Promise<void> {
    const { audio, locale } = (payload ?? {}) as {
      audio: string;
      locale?: string;
    };
    try {
      const text = await this.speechService.recognize(audio, locale);
      emit({ type: "speech.result", payload: { text } });
    } catch (error) {
      emit({ type: "speech.error", payload: { message: String(error) } });
    }
  }
}
