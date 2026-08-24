import { useCallback, useRef, useState } from "react";

export type RecorderStatus = "idle" | "recording" | "processing";

const TARGET_SAMPLE_RATE = 16000;
const MAX_DURATION_SEC = 55;

/** Encode Float32 PCM samples into a 16-bit WAV with RIFF header. */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numSamples = samples.length;
  const bytesPerSample = 2;
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

/** Downsample from source rate to target rate. */
function downsample(buf: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return buf;
  const ratio = from / to;
  const len = Math.round(buf.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = buf[Math.round(i * ratio)];
  }
  return out;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function useAudioRecorder() {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);

  /** Merge current chunks into a single base64 WAV without clearing them. */
  const encodeChunks = useCallback((chunks: Float32Array[]): string | null => {
    if (chunks.length === 0) return null;
    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    if (totalLen === 0) return null;
    const merged = new Float32Array(totalLen);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.length; }
    const actualRate = contextRef.current?.sampleRate ?? TARGET_SAMPLE_RATE;
    const mono = downsample(merged, actualRate, TARGET_SAMPLE_RATE);
    const wav = encodeWav(mono, TARGET_SAMPLE_RATE);
    return arrayBufferToBase64(wav);
  }, []);

  const cleanup = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    contextRef.current?.close().catch(() => {});
    contextRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startRecording = useCallback(async () => {
    if (status !== "idle") return;
    chunksRef.current = [];

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: TARGET_SAMPLE_RATE, channelCount: 1, echoCancellation: true },
    });
    streamRef.current = stream;

    const ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    contextRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      chunksRef.current.push(new Float32Array(data));
    };
    source.connect(processor);
    processor.connect(ctx.destination);

    setStatus("recording");
  }, [status]);

  const stopRecording = useCallback((): string | null => {
    if (status !== "recording" && chunksRef.current.length === 0) return null;

    cleanup();
    setStatus("processing");

    const base64 = encodeChunks(chunksRef.current);
    chunksRef.current = [];

    setStatus("idle");
    return base64;
  }, [status, cleanup, encodeChunks]);

  /** Get current accumulated audio as base64 WAV without stopping recording. */
  const getCurrentAudio = useCallback((): string | null => {
    return encodeChunks([...chunksRef.current]);
  }, [encodeChunks]);

  const cancel = useCallback(() => {
    cleanup();
    chunksRef.current = [];
    setStatus("idle");
  }, [cleanup]);

  return { status, setStatus, startRecording, stopRecording, getCurrentAudio, cancel };
}
