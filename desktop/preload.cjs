const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("localOpsDesktop", Object.freeze({
  getPortlessStatus: () => ipcRenderer.invoke("local-ops:portless-status"),
  setPortlessAccess: (enabled) => ipcRenderer.invoke("local-ops:set-portless-access", Boolean(enabled)),
  getLoginItemStatus: () => ipcRenderer.invoke("local-ops:login-item-status"),
  setLoginItemEnabled: (enabled) => ipcRenderer.invoke("local-ops:set-login-item", Boolean(enabled)),
  saveConfigurationFile: (content, suggestedName) => ipcRenderer.invoke("local-ops:save-config-file", { content, suggestedName }),
  openConfigurationFile: () => ipcRenderer.invoke("local-ops:open-config-file")
}));
