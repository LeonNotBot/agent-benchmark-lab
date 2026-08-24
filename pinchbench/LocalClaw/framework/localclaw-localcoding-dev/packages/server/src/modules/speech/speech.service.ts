import { Injectable } from "@nestjs/common";

const SPEECH_MODEL = "gemma4:e4b";
const BASE_URL = process.env.LOCAL_CLAW_OLLAMA_URL || "http://localhost:11434";

const PROMPTS: Record<string, string> = {
  zh: "听写以上音频，用简体中文输出内容。仅输出听写结果，无内容则输出[EMPTY]。",
  en: "Transcribe the audio above. Output ONLY the transcription in English, nothing else. If silent or unclear, output [EMPTY].",
};
const DEFAULT_PROMPT = PROMPTS.en;

@Injectable()
export class SpeechService {
  /**
   * 语音听写后端是本地多模态模型（默认 gemma4:e4b），通过本地 OpenAI 兼容端点
   * （默认 localhost:11434，可经 LOCAL_CLAW_OLLAMA_URL 覆盖）调用。此处仅做一次轻量
   * 探测确认端点在线——不再依赖已移除的 OllamaService（不负责安装/拉起本地服务）。
   * 用户需自行确保本地推理服务运行且已拉取该模型，否则听写优雅报错。
   */
  private async isBackendRunning(): Promise<boolean> {
    try {
      const res = await fetch(`${BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async recognize(audioBase64: string, locale?: string): Promise<string> {
    const ready = await this.isBackendRunning();
    if (!ready) throw new Error("本地语音识别服务未运行（默认 localhost:11434）");

    const prompt = (locale && PROMPTS[locale]) || DEFAULT_PROMPT;

    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: SPEECH_MODEL,
        messages: [
          {
            role: "user",
            content: prompt,
            images: [audioBase64],
          },
        ],
        stream: false,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`本地语音识别服务返回 ${res.status}: ${text}`);
    }

    const data = await res.json();
    const text = (data?.message?.content ?? "").trim();

    // Filter out echo/empty responses
    if (!text || text.includes("[EMPTY]") || text === prompt) {
      return "";
    }

    return text;
  }
}
