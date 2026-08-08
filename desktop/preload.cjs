const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("localOpsDesktop", Object.freeze({
  getPortlessStatus: () => ipcRenderer.invoke("local-ops:portless-status"),
  setPortlessAccess: (enabled) => ipcRenderer.invoke("local-ops:set-portless-access", Boolean(enabled)),
  setProxyPort: (port) => ipcRenderer.invoke("local-ops:set-proxy-port", Number(port)),
  getLoginItemStatus: () => ipcRenderer.invoke("local-ops:login-item-status"),
  setLoginItemEnabled: (enabled) => ipcRenderer.invoke("local-ops:set-login-item", Boolean(enabled)),
  saveConfigurationFile: (content, suggestedName) => ipcRenderer.invoke("local-ops:save-config-file", { content, suggestedName }),
  openConfigurationFile: () => ipcRenderer.invoke("local-ops:open-config-file"),
  getTrayPanelState: () => ipcRenderer.invoke("local-ops:tray-panel-state"),
  performTrayPanelAction: (action) => ipcRenderer.invoke("local-ops:tray-panel-action", action),
  closeTrayPanel: () => ipcRenderer.send("local-ops:tray-panel-close"),
  onTrayPanelState: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("local-ops:tray-panel-state", listener);
    return () => ipcRenderer.removeListener("local-ops:tray-panel-state", listener);
  }
}));
