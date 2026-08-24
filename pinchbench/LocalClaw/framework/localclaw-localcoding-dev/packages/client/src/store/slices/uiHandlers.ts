// Speech event handlers
type SetFn = (partial: any) => void;

export function handleSpeechEvents(
  event: any,
  set: SetFn,
  get: () => any,
): boolean {
  const { type } = event;

  if (type === "speech.result") {
    const { speechStatus } = get();
    if (speechStatus === "idle") return true;
    const text = event.payload.text;
    if (text) {
      const { speechBasePrompt } = get();
      set({ prompt: speechBasePrompt + text });
    }
    if (speechStatus === "processing") {
      set({ speechStatus: "idle", speechBasePrompt: "" });
    }
    return true;
  }

  if (type === "speech.error") {
    set({ speechStatus: "idle", speechBasePrompt: "" });
    return true;
  }

  return false;
}
