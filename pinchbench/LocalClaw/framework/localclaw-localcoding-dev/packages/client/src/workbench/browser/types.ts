// webview 句柄类型：只暴露我们用到的方法（避免引入完整 Electron 类型）
export interface WebviewHandle {
  src: string;
  goBack(): void;
  goForward(): void;
  reload(): void;
  reloadIgnoringCache(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  getURL(): string;
  loadURL(url: string): Promise<void>;
  setZoomFactor(factor: number): void;
  getZoomFactor(): number;
  addEventListener(type: string, listener: (e: any) => void): void;
  removeEventListener(type: string, listener: (e: any) => void): void;
}

export interface LocalService {
  name: string;
  url: string;
  port: number;
  online: boolean;
}
