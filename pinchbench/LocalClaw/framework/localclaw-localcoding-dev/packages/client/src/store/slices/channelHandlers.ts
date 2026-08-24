// Channel event handlers
type SetFn = (partial: any) => void;

export function handleChannelEvents(
  event: any,
  set: SetFn,
): boolean {
  const { type } = event;

  if (type === "channel.list") {
    set({ channels: event.payload.channels });
    return true;
  }

  if (type === "channel.saved") {
    set((state: any) => {
      const exists = state.channels.some((ch: any) => ch.id === event.payload.channel.id);
      if (exists) {
        return { channels: state.channels.map((ch: any) => ch.id === event.payload.channel.id ? event.payload.channel : ch) };
      }
      return { channels: [event.payload.channel, ...state.channels] };
    });
    return true;
  }

  if (type === "channel.deleted") {
    set((state: any) => ({ channels: state.channels.filter((ch: any) => ch.id !== event.payload.channelId) }));
    return true;
  }

  if (type === "channel.status") {
    const { channelId, status, error } = event.payload;
    set((state: any) => ({
      channels: state.channels.map((ch: any) => ch.id === channelId ? { ...ch, status, errorMessage: error } : ch),
    }));
    return true;
  }

  if (type === "channel.qrcode") {
    set({ wechatQrUrl: event.payload.url });
    return true;
  }

  if (type === "channel.qrcode.warning") {
    set({ wechatQrWarning: event.payload.message });
    return true;
  }

  return false;
}
