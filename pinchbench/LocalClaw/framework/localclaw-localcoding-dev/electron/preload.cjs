const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  openFolderDialog: () => ipcRenderer.invoke("dialog:openFolder"),
  // 应用环境信息(release/version/platform/instanceId),前端 telemetry 初始化用
  appInfo: () => ipcRenderer.invoke("app:info"),
  // 内嵌浏览器
  browserClearCookies: () => ipcRenderer.invoke("browser:clearCookies"),
  browserClearCache: () => ipcRenderer.invoke("browser:clearCache"),
  browserOpenExternal: (url) => ipcRenderer.invoke("browser:openExternal", url),
});
