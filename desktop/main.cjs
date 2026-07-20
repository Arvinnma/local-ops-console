const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, screen, session, shell } = require("electron");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const {
  canManageLoginItem,
  createLoginItemSettings,
  createStartupPresentation,
  shouldStartSilently
} = require("./startup-mode.cjs");
const { bringWindowToFront } = require("./window-lifecycle.cjs");

const execFileAsync = promisify(execFile);
const CONTROL_URL = "http://127.0.0.1:19090/";
const SERVICE_LABEL = `gui/${process.getuid()}/com.arvin.localops`;
const SERVICE_PLIST = path.join(os.homedir(), "Library", "LaunchAgents", "com.arvin.localops.plist");
const INSTALL_DIR = path.join(os.homedir(), ".local", "share", "local-ops");
const INSTALLED_PLIST = path.join(INSTALL_DIR, "launchd", "com.arvin.localops.plist");
const INSTALLED_MANIFEST = path.join(INSTALL_DIR, ".bundle-manifest.json");
const CATALOG_PATH = path.join(INSTALL_DIR, "config", "catalog.json");
const PORTLESS_LABEL = "com.arvin.localops.portless";
const PORTLESS_DAEMON = `/Library/LaunchDaemons/${PORTLESS_LABEL}.plist`;
const PORTLESS_HELPER = `/Library/PrivilegedHelperTools/${PORTLESS_LABEL}`;
const PORTLESS_ANCHOR = "/etc/pf.anchors/com.arvin.localops";
const PORTLESS_PROMPT_MARKER = path.join(INSTALL_DIR, "config", ".portless-prompted-v1");
const LOG_DIR = path.join(os.homedir(), "Library", "Logs", "Local Ops");
const LOG_FILE = path.join(LOG_DIR, "desktop.log");
const TRAY_RESOURCE_NAME_WIDTH = 28;
const TRAY_STATUS_WIDTH = 12;
const TRAY_ROUTE_COLUMN_WIDTH = 24;
const TRAY_PANEL_WIDTH = 330;
const TRAY_PANEL_MAX_HEIGHT = 740;

let mainWindow = null;
let tray = null;
let trayPanelWindow = null;
let trayMenu = null;
let traySnapshot = null;
let trayRefreshPromise = null;
const trayActionsInFlight = new Set();
let reconnectTimer = null;
let healthTimer = null;
let sessionCaptureTimer = null;
let sessionCapturePromise = null;
let isQuitting = false;
let quitCaptureStarted = false;
let quitCaptureCompleted = false;
let isOnline = false;
let installPromise = null;
let startupActionsApplied = false;
let startupInitializationComplete = false;
let startupPresentation = createStartupPresentation(false);

fs.mkdirSync(LOG_DIR, { recursive: true });
app.setName("Local Ops");
app.setAppUserModelId("com.arvin.localops");
app.enableSandbox();

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

app.on("second-instance", () => showMainWindow());
app.on("before-quit", (event) => {
  if (quitCaptureCompleted) {
    isQuitting = true;
    clearTimers();
    return;
  }
  event.preventDefault();
  if (quitCaptureStarted) return;
  quitCaptureStarted = true;
  isQuitting = true;
  clearTimers();
  void Promise.race([
    captureSessionState(),
    new Promise((resolve) => setTimeout(resolve, 5000))
  ]).finally(() => {
    quitCaptureCompleted = true;
    app.quit();
  });
});

app.whenReady().then(async () => {
  const launchLoginItem = readLoginItemSettings();
  startupPresentation = createStartupPresentation(shouldStartSilently({
    platform: process.platform,
    isPackaged: app.isPackaged,
    wasOpenedAtLogin: launchLoginItem.wasOpenedAtLogin,
    requestedSilent: process.argv.includes("--local-ops-silent-start")
  }));
  applyDockIcon();
  if (startupPresentation.isSilent() && process.platform === "darwin" && app.dock) {
    app.dock.hide();
    log("login launch detected: starting silently in the menu bar");
  }
  configureSecurity();
  configureIpc();
  configureAboutPanel();
  createApplicationMenu();
  createTray();
  createMainWindow();
  await connectControlPlane();
  startHealthMonitor();
  startupInitializationComplete = true;
  if (!app.isPackaged && process.env.LOCAL_OPS_TRAY_PREVIEW === "1") {
    mainWindow?.hide();
    toggleTrayPanel();
    const trayCapturePath = process.env.LOCAL_OPS_TRAY_CAPTURE;
    if (trayCapturePath) {
      setTimeout(async () => {
        if (!trayPanelWindow || trayPanelWindow.isDestroyed()) return;
        try {
          if (isOnline) {
            await refreshTraySnapshot(true);
            pushTrayPanelState();
            await new Promise((resolve) => setTimeout(resolve, 120));
          }
          if (process.env.LOCAL_OPS_TRAY_CAPTURE_SCROLL === "bottom") {
            const scrollState = await trayPanelWindow.webContents.executeJavaScript(
              '(() => { const element = document.querySelector("#resource-sections"); element.scrollTop = element.scrollHeight; return { scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }; })()',
              true
            );
            log(`tray preview scroll state: ${JSON.stringify(scrollState)}`);
            await new Promise((resolve) => setTimeout(resolve, 120));
          }
          const capture = await trayPanelWindow.webContents.capturePage();
          fs.writeFileSync(trayCapturePath, capture.toPNG());
          log(`tray preview captured: ${trayCapturePath}`);
        } catch (error) {
          log(`tray preview capture failed: ${error.message}`);
        }
      }, 1200);
    }
  }
});

function applyDockIcon() {
  if (process.platform !== "darwin" || !app.dock) return;

  const iconPath = path.join(__dirname, "assets", "local-ops-app-icon-1024.png");
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    log(`Dock icon could not be loaded: ${iconPath}`);
    return;
  }

  app.dock.setIcon(icon);
  log(`Dock icon applied at runtime: ${iconPath}`);
}

app.on("activate", () => {
  if (startupPresentation.isSilent() && !startupInitializationComplete) return;
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  showMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

process.on("uncaughtException", (error) => {
  log(`uncaughtException: ${error.stack || error.message}`);
  if (app.isReady()) dialog.showErrorBox(trayText("Local Ops 遇到错误", "Local Ops Error"), nativeErrorMessage(error.message));
});

process.on("unhandledRejection", (error) => {
  log(`unhandledRejection: ${error?.stack || error}`);
});

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;

  mainWindow = new BrowserWindow({
    title: "Local Ops",
    width: 1440,
    height: 920,
    minWidth: 720,
    minHeight: 520,
    resizable: true,
    maximizable: true,
    show: false,
    backgroundColor: "#f4f7f5",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 17, y: 17 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "splash.html"), { query: { lang: desktopLanguage() } });
  mainWindow.once("ready-to-show", () => {
    if (startupPresentation.shouldShowWindow()) mainWindow?.show();
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => { mainWindow = null; });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAllowedAppUrl(url) || isAllowedBundledFile(url)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });

  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, description, validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || !validatedUrl.startsWith(CONTROL_URL)) return;
    log(`load failed ${errorCode}: ${description}`);
    showOffline(description);
    scheduleReconnect();
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    log(`renderer gone: ${details.reason}`);
    scheduleReconnect(500);
  });

  mainWindow.webContents.on("console-message", (details) => {
    const payload = typeof details === "object" && details
      ? `${details.level || "log"}: ${details.message || ""} (${details.sourceId || "renderer"}:${details.lineNumber || 0})`
      : String(details || "");
    if (/error|warning|uncaught|rejection/i.test(payload)) log(`renderer ${payload}`);
  });

  return mainWindow;
}

function configureSecurity() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
}

function configureAboutPanel() {
  app.setAboutPanelOptions({
    applicationName: "Local Ops",
    applicationVersion: app.getVersion(),
    version: `Electron ${process.versions.electron}`,
    copyright: trayText("本机服务、SSH 隧道与反向代理控制台", "Local services, SSH tunnels, and reverse-proxy console")
  });
}

function createApplicationMenu() {
  const t = trayText;
  const template = [
    {
      label: "Local Ops",
      submenu: [
        { role: "about", label: t("关于 Local Ops", "About Local Ops") },
        { type: "separator" },
        { label: t("显示控制台", "Show Console"), accelerator: "CommandOrControl+1", click: showMainWindow },
        { label: t("在浏览器中打开", "Open in Browser"), click: () => openSafeExternal(browserUrl()) },
        { label: t("打开日志文件夹", "Open Logs Folder"), click: () => shell.openPath(LOG_DIR) },
        { type: "separator" },
        { label: t("重启后台控制面", "Restart Control Plane"), click: restartControlPlane },
        { type: "separator" },
        { role: "hide", label: t("隐藏 Local Ops", "Hide Local Ops") },
        { role: "hideOthers", label: t("隐藏其他", "Hide Others") },
        { role: "unhide", label: t("全部显示", "Show All") },
        { type: "separator" },
        { role: "quit", label: t("退出 Local Ops", "Quit Local Ops") }
      ]
    },
    { role: "editMenu", label: t("编辑", "Edit") },
    {
      label: t("显示", "View"),
      submenu: [
        { role: "reload", label: t("刷新页面", "Reload") },
        { role: "forceReload", label: t("强制刷新", "Force Reload") },
        { type: "separator" },
        { role: "resetZoom", label: t("实际大小", "Actual Size") },
        { role: "zoomIn", label: t("放大", "Zoom In") },
        { role: "zoomOut", label: t("缩小", "Zoom Out") },
        { type: "separator" },
        { role: "togglefullscreen", label: t("进入全屏幕", "Toggle Full Screen") }
      ]
    },
    { role: "windowMenu", label: t("窗口", "Window") }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  let image = nativeImage.createFromPath(path.join(__dirname, "assets", "tray-iconTemplate.png"));
  if (image.isEmpty()) image = nativeImage.createFromNamedImage("NSStatusAvailable");
  if (image.isEmpty()) image = nativeImage.createEmpty();
  image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip(`Local Ops · ${trayText("正在连接", "Connecting")}`);
  const openMenu = () => {
    if (!tray || tray.isDestroyed()) return;
    if (process.platform !== "darwin") {
      tray.popUpContextMenu(trayMenu || buildTrayMenu());
      return;
    }
    toggleTrayPanel();
  };
  tray.on("click", openMenu);
  tray.on("right-click", openMenu);
  tray.on("double-click", showMainWindow);
  createTrayPanelWindow();
  updateTray(false);
}

function createTrayPanelWindow() {
  if (trayPanelWindow && !trayPanelWindow.isDestroyed()) return trayPanelWindow;

  trayPanelWindow = new BrowserWindow({
    width: TRAY_PANEL_WIDTH,
    height: TRAY_PANEL_MAX_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    roundedCorners: true,
    movable: false,
    type: "panel",
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
      spellcheck: false
    }
  });

  trayPanelWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  trayPanelWindow.loadFile(path.join(__dirname, "tray.html"));
  trayPanelWindow.on("blur", () => {
    if (!process.env.LOCAL_OPS_TRAY_CAPTURE) trayPanelWindow?.hide();
  });
  trayPanelWindow.on("closed", () => { trayPanelWindow = null; });
  trayPanelWindow.webContents.on("did-finish-load", pushTrayPanelState);
  trayPanelWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  trayPanelWindow.webContents.on("will-navigate", (event, url) => {
    if (isAllowedBundledFile(url)) return;
    event.preventDefault();
  });
  trayPanelWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  trayPanelWindow.webContents.on("console-message", (details) => {
    const message = typeof details === "object" ? String(details?.message || "") : String(details || "");
    if (/error|warning|uncaught|rejection/i.test(message)) log(`tray renderer: ${message}`);
  });
  return trayPanelWindow;
}

function toggleTrayPanel() {
  const panel = createTrayPanelWindow();
  if (panel.isVisible()) {
    panel.hide();
    return;
  }
  positionTrayPanel(panel);
  pushTrayPanelState();
  panel.show();
  panel.focus();
  if (isOnline) void refreshTraySnapshot(true);
}

function positionTrayPanel(panel) {
  if (!tray || tray.isDestroyed()) return;
  const trayBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: Math.round(trayBounds.x + trayBounds.width / 2),
    y: Math.round(trayBounds.y + trayBounds.height / 2)
  });
  const workArea = display.workArea;
  const height = Math.min(TRAY_PANEL_MAX_HEIGHT, Math.max(360, workArea.height - 12));
  const x = Math.min(
    workArea.x + workArea.width - TRAY_PANEL_WIDTH - 6,
    Math.max(workArea.x + 6, Math.round(trayBounds.x + trayBounds.width / 2 - TRAY_PANEL_WIDTH / 2))
  );
  let y = Math.max(workArea.y + 6, Math.round(trayBounds.y + trayBounds.height + 5));
  if (y + height > workArea.y + workArea.height - 6) y = workArea.y + 6;
  panel.setBounds({ x, y, width: TRAY_PANEL_WIDTH, height }, false);
}

function updateTray(online) {
  isOnline = online;
  if (!tray) return;
  if (!online) traySnapshot = null;
  tray.setToolTip(trayTooltip());
  rebuildTrayMenu();
  if (online) void refreshTraySnapshot();
}

function rebuildTrayMenu() {
  trayMenu = buildTrayMenu();
  if (tray && process.platform !== "darwin") tray.setContextMenu(trayMenu);
  pushTrayPanelState();
}

function buildTrayMenu() {
  const t = trayText;
  const footer = [
    { label: t("刷新状态", "Refresh Status"), click: () => void refreshTraySnapshot(true) },
    { label: t("显示控制台", "Show Console"), click: showMainWindow },
    {
      label: t("更多", "More"),
      submenu: [
        { label: t("在浏览器中打开", "Open in Browser"), click: () => openSafeExternal(browserUrl()) },
        { label: t("打开日志文件夹", "Open Logs Folder"), click: () => shell.openPath(LOG_DIR) },
        { label: t("重启后台控制面", "Restart Control Plane"), click: restartControlPlane }
      ]
    },
    { type: "separator" },
    { label: t("退出 Local Ops", "Quit Local Ops"), click: () => { isQuitting = true; app.quit(); } }
  ];

  if (!isOnline) {
    return Menu.buildFromTemplate([
      { label: t("● 控制面离线", "● Control Plane Offline"), enabled: false },
      { type: "separator" },
      { label: t("重新连接后台", "Reconnect Backend"), click: connectControlPlane },
      ...footer
    ]);
  }

  if (!traySnapshot) {
    return Menu.buildFromTemplate([
      { label: t("● 控制面在线 · 正在读取资源…", "● Online · Loading Resources…"), enabled: false },
      { type: "separator" },
      ...footer
    ]);
  }

  const { bootstrap, state, docker } = traySnapshot;
  const config = bootstrap.config || {};
  const processById = new Map((state.processes || []).map((item) => [item.id, item]));
  const services = config.services || [];
  const tunnels = config.tunnels || [];
  const routes = config.routes || [];
  const terminalTasks = config.terminalTasks || [];
  const runningServices = services.filter((item) => processById.get(item.id)?.status === "running").length;
  const runningTunnels = tunnels.filter((item) => tunnelPresentationState(processById.get(item.id)) === "connected").length;
  const containers = docker.containers || [];
  const runningContainers = containers.filter((item) => item.running).length;

  return Menu.buildFromTemplate([
    sectionMenuLabel(t(`服务 · ${runningServices}/${services.length} 运行`, `Services · ${runningServices}/${services.length} running`)),
    ...managedProcessMenu(services, processById, "service"),
    sectionMenuLabel(t(`SSH 隧道 · ${runningTunnels}/${tunnels.length} 运行`, `SSH Tunnels · ${runningTunnels}/${tunnels.length} running`)),
    ...managedProcessMenu(tunnels, processById, "tunnel"),
    sectionMenuLabel(t(`终端操作 · ${terminalTasks.length}`, `Terminal Actions · ${terminalTasks.length}`)),
    ...terminalTaskMenu(terminalTasks),
    sectionMenuLabel(docker.daemonOnline
      ? t(`Docker 容器 · ${runningContainers}/${containers.length} 运行`, `Docker Containers · ${runningContainers}/${containers.length} running`)
      : t("Docker 容器 · Engine 未运行", "Docker Containers · Engine Offline")),
    ...dockerMenu(docker),
    sectionMenuLabel(t(`反向代理 · ${routes.filter((item) => item.enabled !== false).length}`, `Reverse Proxies · ${routes.filter((item) => item.enabled !== false).length}`)),
    ...routeMenu(routes),
    { type: "separator" },
    ...footer
  ]);
}

function sectionMenuLabel(label) {
  return { label, enabled: false };
}

function managedProcessMenu(definitions, processById, kind) {
  if (!definitions.length) return [{ label: trayText("尚未配置", "Not Configured"), enabled: false }];
  return definitions.map((definition) => {
    const processState = processById.get(definition.id);
    const active = processIsActive(processState);
    const action = active ? "stop" : "start";
    const actionKey = `process:${definition.id}`;
    return {
      label: trayManagedResourceLabel(definition.name || definition.id, processState, kind, trayActionsInFlight.has(actionKey)),
      enabled: isOnline && !trayActionsInFlight.has(actionKey),
      click: () => void performTrayMutation(
        actionKey,
        `/api/processes/${encodeURIComponent(definition.id)}/${action}`,
        trayText(
          `${active ? "停止" : "启动"}${kind === "tunnel" ? " SSH 隧道" : "服务"}失败`,
          `Failed to ${active ? "stop" : "start"} ${kind === "tunnel" ? "SSH tunnel" : "service"}`
        )
      )
    };
  });
}

function routeMenu(routes) {
  if (!routes.length) return [{ label: trayText("尚未配置", "Not Configured"), enabled: false }];
  return routes.map((route) => ({
    label: trayRouteLabel(route.name || route.id, routeHost(route.url)),
    enabled: route.enabled !== false && isSafeExternalUrl(route.url),
    click: () => openSafeExternal(route.url)
  }));
}

function terminalTaskMenu(tasks) {
  if (!tasks.length) return [{ label: trayText("尚未配置", "Not Configured"), enabled: false }];
  return tasks.map((task) => {
    const actionKey = `terminal:${task.id}`;
    return {
      label: trayReadyLabel(`${task.kind === "ssh" ? "SSH · " : ""}${task.name || task.id}`, trayActionsInFlight.has(actionKey)),
      enabled: isOnline && !trayActionsInFlight.has(actionKey),
      click: () => void performTrayMutation(
        actionKey,
        `/api/terminal-tasks/${encodeURIComponent(task.id)}/run`,
        trayText("执行终端操作失败", "Failed to Run Terminal Action")
      )
    };
  });
}

function dockerMenu(docker) {
  if (!docker.available) return [{ label: trayResourceLabel(trayText("Docker CLI 未找到", "Docker CLI Not Found"), false), enabled: false }];
  if (!docker.daemonOnline) {
    return docker.appInstalled
      ? [{
          label: trayResourceLabel(trayText("Docker Desktop", "Docker Desktop"), false, trayActionsInFlight.has("docker:desktop")),
          enabled: !trayActionsInFlight.has("docker:desktop"),
          click: () => void performTrayMutation(
            "docker:desktop",
            "/api/docker/desktop/start",
            trayText("启动 Docker Desktop 失败", "Failed to Start Docker Desktop"),
            30000
          )
        }]
      : [{ label: trayResourceLabel(trayText("Docker Desktop 未安装", "Docker Desktop Not Installed"), false), enabled: false }];
  }
  if (!docker.containers.length) return [{ label: trayText("没有容器", "No Containers"), enabled: false }];
  return docker.containers.map((container) => {
    const action = container.running ? "stop" : "start";
    const actionKey = `docker:${container.id}`;
    return {
      label: trayResourceLabel(container.name || container.shortId, Boolean(container.running), trayActionsInFlight.has(actionKey)),
      enabled: !trayActionsInFlight.has(actionKey),
      click: () => void performTrayMutation(
        actionKey,
        `/api/docker/${encodeURIComponent(container.id)}/${action}`,
        trayText(
          `${container.running ? "停止" : "启动"} Docker 容器失败`,
          `Failed to ${container.running ? "stop" : "start"} Docker Container`
        ),
        70000
      )
    };
  });
}

function trayResourceLabel(name, running, busy = false) {
  const status = busy
    ? trayText("处理中 🟡", "Working 🟡")
    : running
      ? trayText("已开启 🟢", "On 🟢")
      : trayText("已关闭 🔴", "Off 🔴");
  return trayStatusLabel(name, status);
}

function trayManagedResourceLabel(name, processState, kind, busy = false) {
  if (busy) return trayStatusLabel(name, trayText("处理中 🟡", "Working 🟡"));
  if (kind !== "tunnel") return trayResourceLabel(name, processIsActive(processState));
  const displayState = tunnelPresentationState(processState);
  const status = ({
    connected: trayText("已连接 🟢", "Connected 🟢"),
    connecting: trayText("连接中 🟡", "Connecting 🟡"),
    connection_failed: trayText("连接失败 🔴", "Connection Failed 🔴"),
    stopped: trayText("已停止 🔴", "Stopped 🔴")
  })[displayState];
  return trayStatusLabel(name, status);
}

function tunnelPresentationState(processState) {
  const status = String(processState?.status || "unknown");
  if (status === "disabled" || status === "stopped" || !processState) return "stopped";
  const healthReady = Boolean(processState.healthCheck?.ok);
  const domainReady = !processState.domainEntry?.configured || Boolean(processState.domainEntry?.ready);
  if (status === "connected" && healthReady && domainReady) return "connected";
  if (status === "connection_failed" || (status === "connected" && healthReady && !domainReady && processState.domainEntry?.terminal)) {
    return "connection_failed";
  }
  return processIsActive(processState) || ["waiting_network", "connecting", "retrying", "restarting", "running"].includes(status)
    ? "connecting"
    : "connection_failed";
}

function processIsActive(processState) {
  return Boolean(processState?.active ?? processState?.status === "running");
}

function trayReadyLabel(name, busy = false) {
  return trayStatusLabel(name, busy ? trayText("执行中 🟡", "Running 🟡") : trayText("就绪 🟢", "Ready 🟢"));
}

function trayStatusLabel(name, status) {
  return `${fitTrayColumn(name, TRAY_RESOURCE_NAME_WIDTH)}  ${fitTrayColumn(status, TRAY_STATUS_WIDTH, true)}`;
}

function trayRouteLabel(name, address) {
  return `${fitTrayColumn(name, TRAY_ROUTE_COLUMN_WIDTH)}  │  ${fitTrayColumn(address, TRAY_ROUTE_COLUMN_WIDTH)}`;
}

function fitTrayColumn(value, width, alignRight = false) {
  const text = truncateTrayText(String(value || ""), width);
  const padding = "\u2002".repeat(Math.max(0, width - trayTextWidth(text)));
  return alignRight ? `${padding}${text}` : `${text}${padding}`;
}

function truncateTrayText(value, width) {
  if (trayTextWidth(value) <= width) return value;
  const suffix = "…";
  let result = "";
  for (const character of value) {
    if (trayTextWidth(result + character + suffix) > width) break;
    result += character;
  }
  return `${result}${suffix}`;
}

function trayTextWidth(value) {
  let width = 0;
  for (const character of value) {
    width += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u.test(character) ? 2 : 1;
  }
  return width;
}

function buildTrayPanelState() {
  const language = traySnapshot?.bootstrap?.config?.settings?.language
    || readJsonFile(CATALOG_PATH, {}).settings?.language
    || "zh-CN";
  const t = (zh, en) => language === "en-US" ? en : zh;
  const config = traySnapshot?.bootstrap?.config || readJsonFile(CATALOG_PATH, {});
  const processById = new Map((traySnapshot?.state?.processes || []).map((item) => [item.id, item]));
  const docker = traySnapshot?.docker || { available: false, appInstalled: false, daemonOnline: false, containers: [] };
  const services = config.services || [];
  const tunnels = config.tunnels || [];
  const terminalTasks = config.terminalTasks || [];
  const routes = config.routes || [];
  const containers = docker.containers || [];
  const runningServices = services.filter((item) => processById.get(item.id)?.status === "running").length;
  const runningTunnels = tunnels.filter((item) => tunnelPresentationState(processById.get(item.id)) === "connected").length;
  const runningContainers = containers.filter((item) => item.running).length;

  const managedItems = (definitions, kind) => definitions.map((definition) => {
    const actionKey = `process:${definition.id}`;
    const processState = processById.get(definition.id);
    const active = processIsActive(processState);
    const tunnelState = kind === "tunnel" ? tunnelPresentationState(processState) : null;
    const connected = kind === "tunnel" ? tunnelState === "connected" : processState?.status === "running";
    const busy = trayActionsInFlight.has(actionKey);
    const status = busy
      ? t("处理中", "Working")
      : kind === "tunnel"
          ? ({
            connected: t("已连接", "Connected"),
            connecting: t("连接中", "Connecting"),
            connection_failed: t("连接失败", "Connection Failed"),
            stopped: t("已停止", "Stopped")
          })[tunnelState]
        : connected ? t("已开启", "On") : t("已关闭", "Off");
    return {
      id: definition.id,
      name: definition.name || definition.id,
      running: connected,
      active,
      busy,
      disabled: !isOnline,
      tone: busy || tunnelState === "connecting" ? "busy" : connected ? "running" : "stopped",
      status,
      action: { type: "process", id: definition.id, kind }
    };
  });

  let dockerItems = [];
  if (!docker.available) {
    dockerItems = [{
      id: "docker-unavailable",
      name: t("Docker CLI 未找到", "Docker CLI Not Found"),
      running: false,
      busy: false,
      disabled: true,
      status: t("不可用", "Unavailable")
    }];
  } else if (!docker.daemonOnline) {
    const busy = trayActionsInFlight.has("docker:desktop");
    dockerItems = [{
      id: "docker-desktop",
      name: docker.appInstalled ? "Docker Desktop" : t("Docker Desktop 未安装", "Docker Desktop Not Installed"),
      running: false,
      busy,
      disabled: !docker.appInstalled,
      status: busy ? t("启动中", "Starting") : t("已关闭", "Off"),
      action: docker.appInstalled ? { type: "docker-desktop" } : null
    }];
  } else {
    dockerItems = containers.map((container) => {
      const actionKey = `docker:${container.id}`;
      const busy = trayActionsInFlight.has(actionKey);
      return {
        id: container.id,
        name: container.name || container.shortId,
        running: Boolean(container.running),
        busy,
        disabled: false,
        status: busy ? t("处理中", "Working") : container.running ? t("已开启", "On") : t("已关闭", "Off"),
        action: { type: "docker", id: container.id }
      };
    });
  }

  const sections = [
    {
      id: "services",
      title: t("服务", "Services"),
      count: t(`${runningServices}/${services.length} 运行`, `${runningServices}/${services.length} running`),
      items: managedItems(services, "service")
    },
    {
      id: "tunnels",
      title: t("SSH 隧道", "SSH Tunnels"),
      count: t(`${runningTunnels}/${tunnels.length} 运行`, `${runningTunnels}/${tunnels.length} running`),
      items: managedItems(tunnels, "tunnel")
    },
    {
      id: "terminal",
      title: t("终端操作", "Terminal Actions"),
      count: t(`${terminalTasks.length} 项`, `${terminalTasks.length} actions`),
      items: terminalTasks.map((task) => {
        const busy = trayActionsInFlight.has(`terminal:${task.id}`);
        return {
          id: task.id,
          name: task.name || task.id,
          running: isOnline,
          busy,
          disabled: !isOnline,
          status: busy ? t("执行中", "Running") : isOnline ? t("就绪", "Ready") : t("不可用", "Unavailable"),
          action: { type: "terminal", id: task.id }
        };
      })
    },
    {
      id: "docker",
      title: t("Docker 容器", "Docker Containers"),
      count: docker.daemonOnline
        ? t(`${runningContainers}/${containers.length} 运行`, `${runningContainers}/${containers.length} running`)
        : t("Engine 离线", "Engine offline"),
      items: dockerItems
    },
    {
      id: "routes",
      title: t("反向代理", "Reverse Proxy"),
      count: t(`${routes.filter((item) => item.enabled !== false).length} 个地址`, `${routes.filter((item) => item.enabled !== false).length} routes`),
      items: routes.map((route) => ({
        id: route.id,
        name: route.name || route.id,
        address: routeHost(route.url),
        description: route.url,
        disabled: route.enabled === false || !isSafeExternalUrl(route.url),
        action: { type: "route", id: route.id }
      }))
    }
  ];

  return {
    online: isOnline,
    refreshing: Boolean(trayRefreshPromise),
    language,
    labels: {
      refresh: t("刷新", "Refresh"),
      showMain: t("控制台", "Console"),
      openBrowser: t("浏览器", "Browser"),
      openLogs: t("日志", "Logs"),
      quitApp: t("退出", "Quit"),
      offlineTitle: t("后台控制面未连接", "Control Plane Offline"),
      offlineDetail: t("资源状态暂时不可用，请稍后刷新。", "Resource status is unavailable. Refresh again shortly.")
    },
    summary: isOnline
      ? t(
          `服务 ${runningServices}/${services.length} · 隧道 ${runningTunnels}/${tunnels.length} · Docker ${runningContainers}/${containers.length}`,
          `Svc ${runningServices}/${services.length} · SSH ${runningTunnels}/${tunnels.length} · Docker ${runningContainers}/${containers.length}`
        )
      : t("后台控制面未连接", "Control plane offline"),
    sections
  };
}

function pushTrayPanelState() {
  if (!trayPanelWindow || trayPanelWindow.isDestroyed()) return;
  trayPanelWindow.webContents.send("local-ops:tray-panel-state", buildTrayPanelState());
}

async function performTrayPanelAction(payload = {}) {
  const type = String(payload.type || "");
  const config = traySnapshot?.bootstrap?.config || readJsonFile(CATALOG_PATH, {});
  const processById = new Map((traySnapshot?.state?.processes || []).map((item) => [item.id, item]));

  if (type === "refresh") {
    await refreshTraySnapshot(true);
    return { message: trayText("状态已刷新", "Status refreshed") };
  }
  if (type === "show-main") {
    trayPanelWindow?.hide();
    await new Promise((resolve) => setImmediate(resolve));
    showMainWindow();
    return {};
  }
  if (type === "open-browser") {
    trayPanelWindow?.hide();
    openSafeExternal(browserUrl());
    return {};
  }
  if (type === "open-logs") {
    trayPanelWindow?.hide();
    await shell.openPath(LOG_DIR);
    return {};
  }
  if (type === "quit-app") {
    trayPanelWindow?.hide();
    setTimeout(() => {
      isQuitting = true;
      app.quit();
    }, 60);
    return {};
  }
  if (type === "route") {
    const route = (config.routes || []).find((item) => item.id === String(payload.id || ""));
    if (!route || route.enabled === false || !isSafeExternalUrl(route.url)) throw new Error("该反向代理地址不可用");
    trayPanelWindow?.hide();
    openSafeExternal(route.url);
    return {};
  }
  if (!isOnline) throw new Error(trayText("后台控制面未连接", "Control plane offline"));

  if (type === "process") {
    const definitions = [...(config.services || []), ...(config.tunnels || [])];
    const definition = definitions.find((item) => item.id === String(payload.id || ""));
    if (!definition) throw new Error("没有找到该服务或 SSH 隧道");
    const active = processIsActive(processById.get(definition.id));
    const action = active ? "stop" : "start";
    await runTrayMutation(
      `process:${definition.id}`,
      `/api/processes/${encodeURIComponent(definition.id)}/${action}`
    );
    return { message: trayText(`${definition.name || definition.id} 已${active ? "关闭" : "开启"}`, `${definition.name || definition.id} ${active ? "stopped" : "started"}`) };
  }

  if (type === "terminal") {
    const task = (config.terminalTasks || []).find((item) => item.id === String(payload.id || ""));
    if (!task) throw new Error("没有找到该终端操作");
    await runTrayMutation(`terminal:${task.id}`, `/api/terminal-tasks/${encodeURIComponent(task.id)}/run`);
    return { message: trayText(`${task.name || task.id} 已交给终端执行`, `${task.name || task.id} sent to terminal`) };
  }

  if (type === "docker-desktop") {
    await runTrayMutation("docker:desktop", "/api/docker/desktop/start", 30000);
    return { message: trayText("正在启动 Docker Desktop", "Starting Docker Desktop") };
  }

  if (type === "docker") {
    const container = (traySnapshot?.docker?.containers || []).find((item) => item.id === String(payload.id || ""));
    if (!container) throw new Error("没有找到该 Docker 容器");
    const action = container.running ? "stop" : "start";
    await runTrayMutation(`docker:${container.id}`, `/api/docker/${encodeURIComponent(container.id)}/${action}`, 70000);
    return { message: trayText(`${container.name || container.shortId} 已${container.running ? "关闭" : "开启"}`, `${container.name || container.shortId} ${container.running ? "stopped" : "started"}`) };
  }

  throw new Error("不支持的菜单栏操作");
}

async function performTrayMutation(actionKey, requestPath, errorTitle, timeout = 30000) {
  try {
    await runTrayMutation(actionKey, requestPath, timeout);
  } catch (error) {
    log(`tray action ${actionKey} failed: ${error.message}`);
    dialog.showErrorBox(errorTitle, nativeErrorMessage(error.message));
  }
}

async function runTrayMutation(actionKey, requestPath, timeout = 30000) {
  if (trayActionsInFlight.has(actionKey)) return;
  trayActionsInFlight.add(actionKey);
  rebuildTrayMenu();
  try {
    const bootstrap = await controlRequestJson("/api/bootstrap");
    await controlRequestJson(requestPath, {
      method: "POST",
      headers: { "X-Local-Ops-Token": bootstrap.csrfToken },
      timeout
    });
  } finally {
    trayActionsInFlight.delete(actionKey);
    await refreshTraySnapshot(true);
  }
}

function refreshTraySnapshot(force = false) {
  if (!isOnline) return Promise.resolve();
  if (trayRefreshPromise) return trayRefreshPromise;
  trayRefreshPromise = (async () => {
    const suffix = force ? "?fresh=1" : "";
    const [bootstrap, state, docker] = await Promise.all([
      controlRequestJson("/api/bootstrap", { timeout: 12000 }),
      controlRequestJson(`/api/state${suffix}`, { timeout: 25000 }),
      controlRequestJson(`/api/docker${suffix}`, { timeout: 25000 }).catch((error) => ({
        available: false,
        appInstalled: false,
        daemonOnline: false,
        containers: [],
        error: error.message
      }))
    ]);
    traySnapshot = { bootstrap, state, docker, at: Date.now() };
    configureAboutPanel();
    createApplicationMenu();
    if (tray) tray.setToolTip(trayTooltip());
    rebuildTrayMenu();
  })().catch((error) => {
    log(`tray refresh failed: ${error.message}`);
  }).finally(() => {
    trayRefreshPromise = null;
  });
  return trayRefreshPromise;
}

function trayTooltip() {
  if (!isOnline) return `Local Ops · ${trayText("控制面离线", "Control Plane Offline")}`;
  if (!traySnapshot) return `Local Ops · ${trayText("正在读取资源", "Loading Resources")}`;
  const config = traySnapshot.bootstrap.config || {};
  const processById = new Map((traySnapshot.state.processes || []).map((item) => [item.id, item]));
  const services = config.services || [];
  const tunnels = config.tunnels || [];
  const running = services.filter((item) => processById.get(item.id)?.status === "running").length
    + tunnels.filter((item) => tunnelPresentationState(processById.get(item.id)) === "connected").length;
  const total = services.length + tunnels.length;
  return `Local Ops · ${trayText(`${running}/${total} 个资源运行中`, `${running}/${total} resources running`)}`;
}

function trayText(zh, en) {
  return desktopLanguage() === "en-US" ? en : zh;
}

function desktopLanguage() {
  return traySnapshot?.bootstrap?.config?.settings?.language
    || readJsonFile(CATALOG_PATH, {}).settings?.language
    || "zh-CN";
}

function nativeErrorMessage(value) {
  const message = String(value || trayText("未知错误", "Unknown error"));
  if (desktopLanguage() !== "en-US") return message;
  const exact = new Map([
    ["后台服务尚未安装，请把 App 放入“应用程序”后重新打开", "The background service is not installed. Move the app to Applications and reopen it."],
    ["导出配置内容无效或过大", "The exported configuration is invalid or too large."],
    ["配置文件不能超过 2 MB", "The configuration file must not exceed 2 MB."],
    ["该操作只能从 Local Ops App 发起", "This operation may be started only from the Local Ops app."],
    ["无端口访问目前仅支持 macOS", "Portless access is currently supported on macOS only."],
    ["App 中缺少无端口访问组件，请重新安装 Local Ops", "The app is missing its portless-access component. Reinstall Local Ops."],
    ["没有找到 Local Ops 配置", "The Local Ops configuration was not found."],
    ["等待控制面响应超时", "Timed out waiting for the control plane."],
    ["已取消管理员授权", "Administrator authorization was canceled."],
    ["本机 80 端口已被其他程序占用", "Local port 80 is already in use by another application."],
    ["系统规则已经安装，但 80 端口尚未连通", "The system rule was installed, but local port 80 is not reachable yet."],
    ["App 中缺少后台组件，请重新安装 Local Ops", "The app is missing background components. Reinstall Local Ops."],
    ["App 中的后台组件清单无效，请重新安装 Local Ops", "The bundled background-component manifest is invalid. Reinstall Local Ops."],
    ["请先把 Local Ops 拖到“应用程序”文件夹，再从“应用程序”中打开", "Move Local Ops to Applications, then open it from Applications."],
    ["后台服务注册失败", "Failed to register the background service."],
    ["后台服务暂时不可用", "The control plane is temporarily unavailable."],
    ["等待后台控制面启动超时", "Timed out waiting for the control plane to start."],
    ["该反向代理地址不可用", "This reverse-proxy address is unavailable."],
    ["没有找到该服务或 SSH 隧道", "The service or SSH tunnel was not found."],
    ["没有找到该终端操作", "The terminal action was not found."],
    ["没有找到该 Docker 容器", "The Docker container was not found."],
    ["不支持的菜单栏操作", "Unsupported menu-bar action."]
  ]).get(message);
  if (exact) return exact;
  let match = message.match(/^App 中缺少后台组件：(.+)$/u);
  if (match) return `The app is missing a background component: ${match[1]}`;
  match = message.match(/^控制面请求失败（(\d+)）$/u);
  if (match) return `Control-plane request failed (${match[1]}).`;
  match = message.match(/^系统配置失败：(.+)$/u);
  if (match) return `System configuration failed: ${match[1]}`;
  return message;
}

function routeHost(value) {
  try {
    const url = new URL(value);
    const host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
    const path = url.pathname === "/" ? "" : url.pathname;
    return `${host}${path}${url.search}${url.hash}`;
  } catch {
    return value || "";
  }
}

async function connectControlPlane() {
  try {
    const installResult = await ensureBundledBackend();
    await ensureControlPlane(installResult.restartRequired);
    applyLoginItemPreference();
    await loadConsole();
    updateTray(true);
    void applyAppStartupActionsOnce();
    if (startupPresentation.shouldShowWindow()) void maybeOfferPortlessAccess();
  } catch (error) {
    log(`connect failed: ${error.message}`);
    updateTray(false);
    await showOffline(error.message);
    scheduleReconnect();
  }
}

async function ensureControlPlane(forceBootstrap = false) {
  if (!forceBootstrap && await checkHealth()) return;
  if (!fs.existsSync(SERVICE_PLIST)) throw new Error("后台服务尚未安装，请把 App 放入“应用程序”后重新打开");

  if (forceBootstrap) {
    await bootstrapLaunchAgent();
    await waitForHealth(18000);
    return;
  }

  try {
    await execLaunchctl(["print", SERVICE_LABEL]);
    await execLaunchctl(["kickstart", "-k", SERVICE_LABEL]);
  } catch {
    await bootstrapLaunchAgent();
  }
  await waitForHealth(15000);
}

async function restartControlPlane() {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  await mainWindow.loadFile(path.join(__dirname, "splash.html"), { query: { lang: desktopLanguage() } });
  showMainWindow();
  try {
    const installResult = await ensureBundledBackend();
    if (installResult.restartRequired) {
      await bootstrapLaunchAgent();
    } else {
      try {
        await execLaunchctl(["kickstart", "-k", SERVICE_LABEL]);
      } catch {
        await bootstrapLaunchAgent();
      }
    }
    await waitForHealth(18000);
    await loadConsole();
    updateTray(true);
  } catch (error) {
    updateTray(false);
    await showOffline(error.message);
    dialog.showErrorBox(trayText("后台重启失败", "Failed to Restart the Control Plane"), nativeErrorMessage(error.message));
  }
}

function ensureBundledBackend() {
  if (!app.isPackaged) return Promise.resolve({ restartRequired: false });
  if (!installPromise) {
    installPromise = installBundledBackend().finally(() => { installPromise = null; });
  }
  return installPromise;
}

function configureIpc() {
  ipcMain.handle("local-ops:tray-panel-state", async (event) => {
    assertTrustedRenderer(event);
    return buildTrayPanelState();
  });
  ipcMain.handle("local-ops:tray-panel-action", async (event, payload = {}) => {
    assertTrustedRenderer(event);
    return performTrayPanelAction(payload);
  });
  ipcMain.on("local-ops:tray-panel-close", (event) => {
    assertTrustedRenderer(event);
    trayPanelWindow?.hide();
  });
  ipcMain.handle("local-ops:portless-status", async (event) => {
    assertTrustedRenderer(event);
    return getPortlessStatus();
  });
  ipcMain.handle("local-ops:set-portless-access", async (event, enabled) => {
    assertTrustedRenderer(event);
    return setPortlessAccess(Boolean(enabled));
  });
  ipcMain.handle("local-ops:login-item-status", async (event) => {
    assertTrustedRenderer(event);
    return getLoginItemStatus();
  });
  ipcMain.handle("local-ops:set-login-item", async (event, enabled) => {
    assertTrustedRenderer(event);
    return setLoginItemEnabled(enabled);
  });
  ipcMain.handle("local-ops:save-config-file", async (event, payload = {}) => {
    assertTrustedRenderer(event);
    const content = String(payload.content || "");
    if (!content || Buffer.byteLength(content, "utf8") > 2 * 1024 * 1024) throw new Error("导出配置内容无效或过大");
    const suggestedName = /^[a-zA-Z0-9._-]+\.json$/.test(String(payload.suggestedName || ""))
      ? String(payload.suggestedName)
      : "local-ops-config.json";
    const result = await dialog.showSaveDialog(mainWindow, {
      title: trayText("导出 Local Ops 配置", "Export Local Ops Configuration"),
      defaultPath: path.join(app.getPath("documents"), suggestedName),
      buttonLabel: trayText("导出配置", "Export"),
      filters: [{ name: trayText("JSON 配置", "JSON Configuration"), extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, content, { encoding: "utf8", mode: 0o600 });
    return { canceled: false, fileName: path.basename(result.filePath) };
  });
  ipcMain.handle("local-ops:open-config-file", async (event) => {
    assertTrustedRenderer(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: trayText("导入 Local Ops 配置", "Import Local Ops Configuration"),
      buttonLabel: trayText("选择配置", "Choose Configuration"),
      properties: ["openFile"],
      filters: [{ name: trayText("JSON 配置", "JSON Configuration"), extensions: ["json"] }]
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const file = result.filePaths[0];
    if (fs.statSync(file).size > 2 * 1024 * 1024) throw new Error("配置文件不能超过 2 MB");
    return { canceled: false, fileName: path.basename(file), content: fs.readFileSync(file, "utf8") };
  });
}

function assertTrustedRenderer(event) {
  const senderUrl = event.senderFrame?.url || event.sender?.getURL?.() || "";
  if (!isAllowedAppUrl(senderUrl) && !isAllowedBundledFile(senderUrl)) throw new Error("该操作只能从 Local Ops App 发起");
}

function getLoginItemStatus() {
  const available = canManageLoginItem(process.platform, app.isPackaged);
  const current = available ? readLoginItemSettings() : {};
  return {
    available,
    enabled: available && Boolean(current.openAtLogin),
    wasOpenedAtLogin: available && Boolean(current.wasOpenedAtLogin)
  };
}

function readLoginItemSettings() {
  try {
    return app.getLoginItemSettings();
  } catch (error) {
    log(`login item status unavailable: ${error.message}`);
    return {};
  }
}

function setLoginItemEnabled(enabled) {
  if (!canManageLoginItem(process.platform, app.isPackaged)) return getLoginItemStatus();
  app.setLoginItemSettings(createLoginItemSettings(enabled));
  return getLoginItemStatus();
}

function applyLoginItemPreference() {
  if (!canManageLoginItem(process.platform, app.isPackaged)) return;
  const catalog = readJsonFile(CATALOG_PATH, {});
  app.setLoginItemSettings(createLoginItemSettings(catalog.settings?.launchAppAtLogin));
}

async function applyAppStartupActionsOnce() {
  if (startupActionsApplied) return;
  startupActionsApplied = true;
  try {
    const bootstrap = await controlRequestJson("/api/bootstrap");
    const result = await controlRequestJson("/api/startup/app", {
      method: "POST",
      headers: { "X-Local-Ops-Token": bootstrap.csrfToken },
      timeout: 210000
    });
    const started = Number(result.services || 0) + Number(result.tunnels || 0) + Number(result.docker || 0);
    if (started) log(`app startup actions started services=${result.services || 0} tunnels=${result.tunnels || 0} docker=${result.docker || 0}`);
    if (result.dockerDesktop) log("app startup actions opened Docker Desktop and waited for Docker Engine");
    if (result.errors?.length) log(`app startup action warnings: ${result.errors.join(" | ")}`);
  } catch (error) {
    log(`app startup actions failed: ${error.message}`);
  } finally {
    startSessionCaptureMonitor();
  }
}

function startSessionCaptureMonitor() {
  clearInterval(sessionCaptureTimer);
  void captureSessionState();
  sessionCaptureTimer = setInterval(() => void captureSessionState(), 30000);
}

function captureSessionState() {
  if (!isOnline) return Promise.resolve();
  if (sessionCapturePromise) return sessionCapturePromise;
  sessionCapturePromise = (async () => {
    const bootstrap = await controlRequestJson("/api/bootstrap", { timeout: 4000 });
    await controlRequestJson("/api/session/capture", {
      method: "POST",
      headers: { "X-Local-Ops-Token": bootstrap.csrfToken },
      timeout: 30000
    });
  })().catch((error) => {
    log(`session state capture failed: ${error.message}`);
  }).finally(() => {
    sessionCapturePromise = null;
  });
  return sessionCapturePromise;
}

async function getPortlessStatus() {
  const catalog = readJsonFile(CATALOG_PATH, {});
  const proxyPort = Number(catalog.settings?.proxyPort || 19080);
  const publicProxyPort = Number(catalog.settings?.publicProxyPort || proxyPort);
  const installed = [PORTLESS_DAEMON, PORTLESS_HELPER, PORTLESS_ANCHOR].every((file) => fs.existsSync(file));
  const active = installed && await checkPortlessHealth();
  return {
    available: process.platform === "darwin",
    installed,
    configured: publicProxyPort === 80,
    active,
    proxyPort,
    publicProxyPort
  };
}

async function setPortlessAccess(enabled) {
  if (process.platform !== "darwin") throw new Error("无端口访问目前仅支持 macOS");
  if (app.isPackaged) assertInstalledApplicationLocation();

  if (enabled) {
    const resourceDir = app.isPackaged
      ? path.join(process.resourcesPath, "portless")
      : path.join(__dirname, "portless");
    const sources = {
      daemon: path.join(resourceDir, `${PORTLESS_LABEL}.plist`),
      helper: path.join(resourceDir, PORTLESS_LABEL),
      anchor: path.join(resourceDir, "com.arvin.localops.anchor")
    };
    for (const source of Object.values(sources)) {
      if (!fs.existsSync(source)) throw new Error("App 中缺少无端口访问组件，请重新安装 Local Ops");
    }

    const command = [
      "/usr/bin/install -d -o root -g wheel -m 755 /Library/PrivilegedHelperTools",
      `/usr/bin/install -o root -g wheel -m 755 ${shellQuote(sources.helper)} ${shellQuote(PORTLESS_HELPER)}`,
      `/usr/bin/install -o root -g wheel -m 644 ${shellQuote(sources.anchor)} ${shellQuote(PORTLESS_ANCHOR)}`,
      `/usr/bin/install -o root -g wheel -m 644 ${shellQuote(sources.daemon)} ${shellQuote(PORTLESS_DAEMON)}`,
      `/bin/launchctl bootout system/${PORTLESS_LABEL} >/dev/null 2>&1 || true`,
      shellQuote(PORTLESS_HELPER),
      `/bin/launchctl bootstrap system ${shellQuote(PORTLESS_DAEMON)}`,
      `/bin/launchctl kickstart -k system/${PORTLESS_LABEL}`
    ].join("; ");
    await runElevatedShell(command);
    await updatePublicProxyPort(80);
  } else {
    const command = [
      `/bin/launchctl bootout system/${PORTLESS_LABEL} >/dev/null 2>&1 || true`,
      `/sbin/pfctl -a com.apple/local-ops -F all >/dev/null 2>&1 || true`,
      `/bin/rm -f ${shellQuote(PORTLESS_DAEMON)} ${shellQuote(PORTLESS_HELPER)} ${shellQuote(PORTLESS_ANCHOR)}`
    ].join("; ");
    await runElevatedShell(command);
    const catalog = readJsonFile(CATALOG_PATH, {});
    await updatePublicProxyPort(Number(catalog.settings?.proxyPort || 19080));
  }

  await new Promise((resolve) => setTimeout(resolve, 350));
  return getPortlessStatus();
}

async function updatePublicProxyPort(port) {
  const catalog = readJsonFile(CATALOG_PATH);
  if (!catalog?.settings) throw new Error("没有找到 Local Ops 配置");
  catalog.settings.publicProxyPort = Number(port);
  writeFileAtomic(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, 0o600);
  await renderInstalledConfig();
  await reloadRuntimeConfiguration();
}

async function reloadRuntimeConfiguration() {
  const bootstrap = await controlRequestJson("/api/bootstrap");
  await controlRequestJson("/api/reload", {
    method: "POST",
    headers: { "X-Local-Ops-Token": bootstrap.csrfToken }
  });
}

function controlRequestJson(requestPath, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port: 19090,
      path: requestPath,
      method: options.method || "GET",
      headers: options.headers || {},
      timeout: Number(options.timeout || 8000)
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { if (body.length < 131072) body += chunk; });
      response.on("end", () => {
        let payload = {};
        try { payload = JSON.parse(body || "{}"); } catch {}
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(payload);
        else reject(new Error(payload.error || `控制面请求失败（${response.statusCode}）`));
      });
    });
    request.on("timeout", () => request.destroy(new Error("等待控制面响应超时")));
    request.on("error", reject);
    request.end();
  });
}

function checkPortlessHealth() {
  return new Promise((resolve) => {
    const request = http.get({
      hostname: "127.0.0.1",
      port: 80,
      path: "/api/health",
      headers: { Host: "console.localhost" },
      timeout: 1200
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { if (body.length < 2048) body += chunk; });
      response.on("end", () => {
        try {
          const payload = JSON.parse(body);
          resolve(response.statusCode === 200 && payload.ok === true);
        } catch { resolve(false); }
      });
    });
    request.on("timeout", () => { request.destroy(); resolve(false); });
    request.on("error", () => resolve(false));
  });
}

async function runElevatedShell(command) {
  const appleScript = `do shell script ${JSON.stringify(command)} with administrator privileges`;
  try {
    await execFileAsync("/usr/bin/osascript", ["-e", appleScript], { timeout: 300000, maxBuffer: 1024 * 1024 });
  } catch (error) {
    const message = `${error.stderr || ""} ${error.message || ""}`;
    if (/User canceled|-128|已取消/i.test(message)) throw new Error("已取消管理员授权");
    if (/port 80 is already in use/i.test(message)) throw new Error("本机 80 端口已被其他程序占用");
    throw new Error(`系统配置失败：${cleanElevatedError(message)}`);
  }
}

function cleanElevatedError(value) {
  return String(value || "未知错误")
    .replace(/^.*execution error:\s*/s, "")
    .replace(/\s*\(-?\d+\)\s*$/, "")
    .trim()
    .slice(0, 280);
}

async function maybeOfferPortlessAccess() {
  if (!app.isPackaged || fs.existsSync(PORTLESS_PROMPT_MARKER)) return;
  const status = await getPortlessStatus();
  if (status.installed && status.configured) return;

  fs.mkdirSync(path.dirname(PORTLESS_PROMPT_MARKER), { recursive: true });
  fs.writeFileSync(PORTLESS_PROMPT_MARKER, `${new Date().toISOString()}\n`, { mode: 0o600 });
  const result = await dialog.showMessageBox(mainWindow, {
    type: "info",
    title: trayText("启用无端口访问", "Enable Portless Access"),
    message: trayText("是否隐藏本地域名后的 :19080？", "Hide :19080 from local domain addresses?"),
    detail: trayText("启用后可直接访问 http://openclaw.localhost。macOS 会要求输入一次管理员密码，转发仅作用于本机。", "After enabling, use addresses such as http://openclaw.localhost directly. macOS will ask for an administrator password once; forwarding remains local to this Mac."),
    buttons: [trayText("启用无端口访问", "Enable Portless Access"), trayText("稍后在设置中启用", "Enable Later in Settings")],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (result.response !== 0) return;

  try {
    const next = await setPortlessAccess(true);
    if (!next.active) throw new Error("系统规则已经安装，但 80 端口尚未连通");
    if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.webContents.reload();
    await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: trayText("无端口访问已启用", "Portless Access Enabled"),
      message: trayText("现在可以直接使用 .localhost 域名", ".localhost domains are ready to use"),
      detail: trayText("例如：http://openclaw.localhost", "Example: http://openclaw.localhost"),
      buttons: [trayText("完成", "Done")]
    });
  } catch (error) {
    if (error.message === "已取消管理员授权") return;
    dialog.showErrorBox(trayText("无端口访问启用失败", "Failed to Enable Portless Access"), nativeErrorMessage(error.message));
  }
}

function browserUrl() {
  const catalog = readJsonFile(CATALOG_PATH, {});
  const proxyPort = Number(catalog.settings?.proxyPort || 19080);
  const publicPort = Number(catalog.settings?.publicProxyPort || proxyPort);
  return publicPort === 80 ? "http://console.localhost" : `http://console.localhost:${publicPort}`;
}

async function installBundledBackend() {
  assertInstalledApplicationLocation();

  const bundleDir = path.join(process.resourcesPath, "local-ops");
  const bundleManifestPath = path.join(bundleDir, "bundle-manifest.json");
  if (!fs.existsSync(bundleManifestPath)) throw new Error("App 中缺少后台组件，请重新安装 Local Ops");

  const manifest = readJsonFile(bundleManifestPath);
  if (!manifest?.version || !manifest?.builtAt) throw new Error("App 中的后台组件清单无效，请重新安装 Local Ops");
  const installedManifest = readJsonFile(INSTALLED_MANIFEST, {});
  const ownedItems = ["bin", "public", "scripts", "src"];
  const backendMissing = ownedItems.some((item) => !fs.existsSync(path.join(INSTALL_DIR, item)));
  const bundleChanged = backendMissing
    || installedManifest.version !== manifest.version
    || installedManifest.builtAt !== manifest.builtAt;
  const launchAgent = renderLaunchAgent();
  const plistChanged = readTextFile(INSTALLED_PLIST) !== launchAgent
    || !fs.existsSync(SERVICE_PLIST);

  if (!bundleChanged && !plistChanged) return { restartRequired: false };

  log(`installing bundled backend ${manifest.version || "unknown"}`);
  await execLaunchctl(["bootout", SERVICE_LABEL]).catch(() => {});

  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  fs.mkdirSync(path.join(INSTALL_DIR, "config"), { recursive: true });
  fs.mkdirSync(path.join(INSTALL_DIR, "generated"), { recursive: true });
  fs.mkdirSync(path.join(INSTALL_DIR, "runtime"), { recursive: true });
  fs.mkdirSync(path.join(INSTALL_DIR, "launchd"), { recursive: true });

  if (bundleChanged) syncBundledFiles(bundleDir, ownedItems);
  ensureUserConfiguration(bundleDir);
  installLaunchAgent(launchAgent);
  await renderInstalledConfig();

  const installedState = {
    ...manifest,
    installedAt: new Date().toISOString(),
    appExecutable: process.execPath
  };
  writeFileAtomic(INSTALLED_MANIFEST, `${JSON.stringify(installedState, null, 2)}\n`, 0o600);
  installCliLink();
  log(`bundled backend ${manifest.version || "unknown"} installed`);
  return { restartRequired: true };
}

function assertInstalledApplicationLocation() {
  const userApplications = path.join(os.homedir(), "Applications") + path.sep;
  const isInApplications = process.execPath.startsWith(`/Applications${path.sep}`)
    || process.execPath.startsWith(userApplications);
  if (!isInApplications) {
    throw new Error("请先把 Local Ops 拖到“应用程序”文件夹，再从“应用程序”中打开");
  }
}

function syncBundledFiles(bundleDir, ownedItems) {
  for (const item of ownedItems) {
    const source = path.join(bundleDir, item);
    const target = path.join(INSTALL_DIR, item);
    if (!fs.existsSync(source)) throw new Error(`App 中缺少后台组件：${item}`);
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(source, target, { recursive: true, force: true });
  }

  for (const file of ["package.json", "bundle-manifest.json"]) {
    const source = path.join(bundleDir, file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(INSTALL_DIR, file));
  }

  fs.chmodSync(path.join(INSTALL_DIR, "bin", "caddy"), 0o755);
  fs.chmodSync(path.join(INSTALL_DIR, "bin", "process-compose"), 0o755);
  fs.chmodSync(path.join(INSTALL_DIR, "bin", "local-ops-keychain"), 0o755);
  for (const script of fs.readdirSync(path.join(INSTALL_DIR, "scripts"))) {
    if (script.endsWith(".zsh")) fs.chmodSync(path.join(INSTALL_DIR, "scripts", script), 0o755);
  }
}

function ensureUserConfiguration(bundleDir) {
  const catalog = path.join(INSTALL_DIR, "config", "catalog.json");
  const catalogExample = path.join(INSTALL_DIR, "config", "catalog.example.json");
  const bundledExample = path.join(bundleDir, "config", "catalog.example.json");
  const token = path.join(INSTALL_DIR, "config", "process-compose.token");

  fs.copyFileSync(bundledExample, catalogExample);
  if (!fs.existsSync(catalog)) fs.copyFileSync(bundledExample, catalog);
  if (!fs.existsSync(token)) {
    fs.writeFileSync(token, `${crypto.randomBytes(32).toString("hex")}\n`, { mode: 0o600, flag: "wx" });
  }
  fs.chmodSync(catalog, 0o600);
  fs.chmodSync(token, 0o600);
}

function installLaunchAgent(content) {
  writeFileAtomic(INSTALLED_PLIST, content, 0o600);
  fs.mkdirSync(path.dirname(SERVICE_PLIST), { recursive: true });
  try {
    const currentTarget = fs.readlinkSync(SERVICE_PLIST);
    if (path.resolve(path.dirname(SERVICE_PLIST), currentTarget) === INSTALLED_PLIST) return;
  } catch {}
  fs.rmSync(SERVICE_PLIST, { force: true });
  fs.symlinkSync(INSTALLED_PLIST, SERVICE_PLIST);
}

function renderLaunchAgent() {
  const root = xmlEscape(INSTALL_DIR);
  const home = xmlEscape(os.homedir());
  const appExecutable = xmlEscape(process.execPath);
  const processCompose = xmlEscape(path.join(INSTALL_DIR, "bin", "process-compose"));
  const caddy = xmlEscape(path.join(INSTALL_DIR, "bin", "caddy"));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.arvin.localops</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>${root}/scripts/start-stack.zsh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${root}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${root}/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key>
    <string>${home}</string>
    <key>ELECTRON_RUN_AS_NODE</key>
    <string>1</string>
    <key>LOCAL_OPS_HOME</key>
    <string>${root}</string>
    <key>LOCAL_OPS_NODE</key>
    <string>${appExecutable}</string>
    <key>LOCAL_OPS_PROCESS_COMPOSE</key>
    <string>${processCompose}</string>
    <key>LOCAL_OPS_CADDY</key>
    <string>${caddy}</string>
    <key>LOCAL_OPS_KEYCHAIN_HELPER</key>
    <string>${root}/bin/local-ops-keychain</string>
    <key>LOCAL_OPS_SSH_ASKPASS</key>
    <string>${root}/scripts/local-ops-ssh-askpass.zsh</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${root}/runtime/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${root}/runtime/launchd.err.log</string>
</dict>
</plist>
`;
}

async function renderInstalledConfig() {
  const nodeExecutable = process.execPath;
  const { stdout, stderr } = await execFileAsync(nodeExecutable, [path.join(INSTALL_DIR, "scripts", "render-config.mjs")], {
    cwd: INSTALL_DIR,
    timeout: 30000,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      LOCAL_OPS_HOME: INSTALL_DIR,
      LOCAL_OPS_NODE: nodeExecutable,
      LOCAL_OPS_PROCESS_COMPOSE: path.join(INSTALL_DIR, "bin", "process-compose"),
      LOCAL_OPS_CADDY: path.join(INSTALL_DIR, "bin", "caddy"),
      LOCAL_OPS_KEYCHAIN_HELPER: path.join(INSTALL_DIR, "bin", "local-ops-keychain"),
      LOCAL_OPS_SSH_ASKPASS: path.join(INSTALL_DIR, "scripts", "local-ops-ssh-askpass.zsh")
    }
  });
  if (stdout.trim()) log(stdout.trim());
  if (stderr.trim()) log(stderr.trim());
}

function installCliLink() {
  const target = path.join(INSTALL_DIR, "scripts", "opsctl.zsh");
  for (const directory of ["/opt/homebrew/bin", "/usr/local/bin"]) {
    try {
      fs.accessSync(directory, fs.constants.W_OK);
      const link = path.join(directory, "localops");
      if (fs.existsSync(link) && !fs.lstatSync(link).isSymbolicLink()) continue;
      fs.rmSync(link, { force: true });
      fs.symlinkSync(target, link);
      return;
    } catch {}
  }
}

async function bootstrapLaunchAgent() {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await execLaunchctl(["bootstrap", `gui/${process.getuid()}`, SERVICE_PLIST]);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw lastError || new Error("后台服务注册失败");
}

function readJsonFile(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function readTextFile(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
}

function writeFileAtomic(file, content, mode) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, { encoding: "utf8", mode });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, mode);
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function execLaunchctl(args) {
  log(`launchctl ${args.join(" ")}`);
  return execFileAsync("/bin/launchctl", args, { timeout: 20000 });
}

async function loadConsole() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  await mainWindow.loadURL(`${CONTROL_URL}#overview`);
  log("console loaded");
  showMainWindowIfAllowed();
}

async function showOffline(message) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await mainWindow.loadFile(path.join(__dirname, "offline.html"), {
    query: {
      lang: desktopLanguage(),
      reason: nativeErrorMessage(message || trayText("后台服务暂时不可用", "The control plane is temporarily unavailable")).slice(0, 240)
    }
  });
  showMainWindowIfAllowed();
}

function scheduleReconnect(delay = 2000) {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(async () => {
    if (isQuitting) return;
    if (await checkHealth()) {
      await loadConsole();
      updateTray(true);
      void applyAppStartupActionsOnce();
    } else {
      updateTray(false);
      scheduleReconnect(2500);
    }
  }, delay);
}

function startHealthMonitor() {
  clearInterval(healthTimer);
  healthTimer = setInterval(async () => {
    const online = await checkHealth();
    if (online !== isOnline) {
      updateTray(online);
      log(`health changed: ${online ? "online" : "offline"}`);
      if (online && mainWindow && mainWindow.webContents.getURL().startsWith("file:")) await loadConsole();
    }
    if (online) void refreshTraySnapshot();
  }, 10000);
}

function checkHealth() {
  return new Promise((resolve) => {
    const request = http.get({ hostname: "127.0.0.1", port: 19090, path: "/api/health", timeout: 1200 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        if (body.length < 2048) body += chunk;
      });
      response.on("end", () => {
        try {
          const payload = JSON.parse(body);
          resolve(response.statusCode === 200 && payload.ok === true && payload.service === "local-ops-console");
        } catch {
          resolve(false);
        }
      });
    });
    request.on("timeout", () => { request.destroy(); resolve(false); });
    request.on("error", () => resolve(false));
  });
}

async function waitForHealth(timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await checkHealth()) return;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error("等待后台控制面启动超时");
}

function showMainWindow() {
  const wasSilent = startupPresentation.isSilent();
  startupPresentation.reveal();
  if (process.platform === "darwin" && app.dock) void app.dock.show();
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  const before = mainWindowState();
  bringWindowToFront(app, mainWindow, process.platform);
  if (wasSilent && isOnline) void maybeOfferPortlessAccess();
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    log(`main window requested: before=${JSON.stringify(before)} after=${JSON.stringify(mainWindowState())}`);
  }, 120);
}

function showMainWindowIfAllowed() {
  if (!startupPresentation.shouldShowWindow()) return false;
  showMainWindow();
  return true;
}

function mainWindowState() {
  return {
    appHidden: process.platform === "darwin" ? app.isHidden() : false,
    visible: Boolean(mainWindow?.isVisible()),
    minimized: Boolean(mainWindow?.isMinimized()),
    focused: Boolean(mainWindow?.isFocused())
  };
}

function isAllowedAppUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === "http://127.0.0.1:19090";
  } catch {
    return false;
  }
}

function isSafeExternalUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}

function isAllowedBundledFile(value) {
  try {
    const file = path.normalize(new URL(value).pathname);
    return ["splash.html", "offline.html", "tray.html"].some((name) => file.endsWith(path.sep + name));
  } catch {
    return false;
  }
}

function openSafeExternal(value) {
  if (isSafeExternalUrl(value)) void shell.openExternal(value);
}

function clearTimers() {
  clearTimeout(reconnectTimer);
  clearInterval(healthTimer);
  clearInterval(sessionCaptureTimer);
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFile(LOG_FILE, line, () => {});
}
