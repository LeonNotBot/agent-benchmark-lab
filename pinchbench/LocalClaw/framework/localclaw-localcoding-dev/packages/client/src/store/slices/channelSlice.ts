import type { ChannelConfig, ChannelStatus } from "@lenovo/agent-protocol";

export interface ChannelSlice {
  channels: ChannelConfig[];
  wechatQrUrl: string | null;
  wechatQrWarning: string | null;
  channelPanelMode: "list" | "add" | "edit";
  selectedChannelId: string | null;
  setChannels: (channels: ChannelConfig[]) => void;
  setWechatQrUrl: (url: string | null) => void;
  setWechatQrWarning: (warning: string | null) => void;
  setChannelPanelMode: (mode: "list" | "add" | "edit") => void;
  setSelectedChannelId: (id: string | null) => void;
  updateChannelStatus: (id: string, status: ChannelStatus, error?: string) => void;
}

export function createChannelSlice(set: any): ChannelSlice {
  return {
    channels: [],
    wechatQrUrl: null,
    wechatQrWarning: null,
    channelPanelMode: "list",
    selectedChannelId: null,

    setChannels: (channels) => set({ channels }),
    setWechatQrUrl: (wechatQrUrl) => set({ wechatQrUrl }),
    setWechatQrWarning: (wechatQrWarning) => set({ wechatQrWarning }),
    setChannelPanelMode: (channelPanelMode) => set({ channelPanelMode }),
    setSelectedChannelId: (selectedChannelId) => set({ selectedChannelId }),
    updateChannelStatus: (id, status, error) =>
      set((state: any) => ({
        channels: state.channels.map((ch: any) =>
          ch.id === id ? { ...ch, status, errorMessage: error } : ch,
        ),
      })),
  };
}
