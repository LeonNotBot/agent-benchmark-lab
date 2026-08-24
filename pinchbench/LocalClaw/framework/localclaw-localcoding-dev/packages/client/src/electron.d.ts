// Electron preload bridge typing. The desktop shell exposes `window.electronAPI`
// via contextBridge; in the browser build it is undefined, so every member is optional.
export interface AppInfo {
  release: boolean;
  version: string;
  platform: string;
  instanceId: string;
}

export interface ElectronAPI {
  platform?: string;
  minimize?: () => void;
  maximize?: () => void;
  close?: () => void;
  isMaximized?: () => Promise<boolean>;
  openFolderDialog?: () => Promise<string | null>;
  appInfo?: () => Promise<AppInfo>;
  browserOpenExternal?: (url: string) => void;
  browserClearCookies?: () => void;
  browserClearCache?: () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
