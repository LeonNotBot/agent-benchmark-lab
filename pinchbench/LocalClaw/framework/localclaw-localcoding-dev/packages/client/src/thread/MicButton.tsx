// 麦克风录音按钮：复用 useAudioRecorder + speech.recognize 轮询
// 识别结果经 store.prompt 回填，通过 onTranscript 同步给父组件本地 value
import { useEffect, useRef } from "react";
import type { ClientEvent } from "@lenovo/agent-protocol";
import { useAppStore } from "../store/useAppStore";
import { useLocale } from "../i18n";
import { useAudioRecorder } from "../hooks/useAudioRecorder";

interface Props {
  sendEvent: (event: ClientEvent) => void;
  baseText: string;
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

export function MicButton({ sendEvent, baseText, onTranscript, disabled }: Props) {
  const locale = useAppStore((s) => s.locale);
  const { t } = useLocale();
  const speechStatus = useAppStore((s) => s.speechStatus);
  const setSpeechStatus = useAppStore((s) => s.setSpeechStatus);
  const setSpeechBasePrompt = useAppStore((s) => s.setSpeechBasePrompt);
  const recorder = useAudioRecorder();
  const intervalRef = useRef<number>(0);
  const timeoutRef = useRef<number>(0);

  const isRecording = speechStatus === "recording";
  const isProcessing = speechStatus === "processing";

  // 录音/识别期间订阅 store.prompt，把结果同步回父组件
  useEffect(() => {
    if (speechStatus === "idle") return;
    let prev = useAppStore.getState().prompt;
    return useAppStore.subscribe((s) => {
      if (s.prompt !== prev) { prev = s.prompt; onTranscript(s.prompt); }
    });
  }, [speechStatus, onTranscript]);

  const clearTimers = () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = 0; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = 0; }
  };

  const stop = () => {
    clearTimers();
    const base64 = recorder.stopRecording();
    if (base64) {
      setSpeechStatus("processing");
      sendEvent({ type: "speech.recognize", payload: { audio: base64, locale } } as any);
    } else {
      setSpeechStatus("idle");
      setSpeechBasePrompt("");
    }
  };

  const start = async () => {
    try {
      setSpeechBasePrompt(baseText);
      setSpeechStatus("recording");
      await recorder.startRecording();
      intervalRef.current = window.setInterval(() => {
        const audio = recorder.getCurrentAudio();
        if (audio) sendEvent({ type: "speech.recognize", payload: { audio, locale } } as any);
      }, 3000);
      timeoutRef.current = window.setTimeout(stop, 55000);
    } catch {
      clearTimers();
      setSpeechStatus("idle");
    }
  };

  useEffect(() => () => clearTimers(), []);

  return (
    <button
      onClick={isRecording ? stop : start}
      disabled={disabled || isProcessing}
      aria-label={isRecording ? t("mic.stop") : t("mic.start")}
      title={isRecording ? t("mic.stop") : t("mic.start")}
      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-40 ${
        isRecording ? "bg-danger-100 text-white" : "text-text-400 hover:bg-bg-200 hover:text-text-200"
      }`}
    >
      {isProcessing ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-text-400 border-t-transparent" />
      ) : (
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      )}
    </button>
  );
}
