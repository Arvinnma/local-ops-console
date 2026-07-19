const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, session, shell } = require("electron");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

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

let mainWindow = null;
let tray = null;
let reconnectTimer = null;
let healthTimer = null;
let isQuitting = false;
let isOnline = false;
let installPromise = null;
let startupActionsApplied = false;

fs.mkdirSync(LOG_DIR, { recursive: true });
app.setName("Local Ops");
app.setAppUserModelId("com.arvin.localops");
app.enableSandbox();

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

app.on("second-instance", () => showMainWindow());
app.on("before-quit", () => {
  isQuitting = true;
  clearTimers();
});

app.whenReady().then(async () => {
  configureSecurity();
  configureIpc();
  configureAboutPanel();
  createApplicationMenu();
  createTray();
  createMainWindow();
  await connectControlPlane();
  startHealthMonitor();
});

app.on("activate", () => {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  showMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

process.on("uncaughtException", (error) => {
  log(`uncaughtException: ${error.stack || error.message}`);
  if (app.isReady()) dialog.showErrorBox("Local Ops 遇到错误", error.message);
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

  mainWindow.loadFile(path.join(__dirname, "splash.html"));
  mainWindow.once("ready-to-show", () => mainWindow?.show());

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

  mainWindow.webContents.on("console-message", (_event, details) => {
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
    copyright: "本机服务、SSH 隧道与反向代理控制台"
  });
}

function createApplicationMenu() {
  const template = [
    {
      label: "Local Ops",
      submenu: [
        { role: "about", label: "关于 Local Ops" },
        { type: "separator" },
        { label: "显示控制台", accelerator: "CommandOrControl+1", click: showMainWindow },
        { label: "在浏览器中打开", click: () => openSafeExternal(browserUrl()) },
        { label: "打开日志文件夹", click: () => shell.openPath(LOG_DIR) },
        { type: "separator" },
        { label: "重启后台控制面", click: restartControlPlane },
        { type: "separator" },
        { role: "hide", label: "隐藏 Local Ops" },
        { role: "hideOthers", label: "隐藏其他" },
        { role: "unhide", label: "全部显示" },
        { type: "separator" },
        { role: "quit", label: "退出 Local Ops" }
      ]
    },
    { role: "editMenu", label: "编辑" },
    {
      label: "显示",
      submenu: [
        { role: "reload", label: "刷新页面" },
        { role: "forceReload", label: "强制刷新" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "进入全屏幕" }
      ]
    },
    { role: "windowMenu", label: "窗口" }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  let image = nativeImage.createFromNamedImage("NSStatusAvailable");
  if (image.isEmpty()) image = nativeImage.createEmpty();
  image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip("Local Ops · 正在连接");
  tray.on("click", showMainWindow);
  updateTray(false);
}

function updateTray(online) {
  isOnline = online;
  if (!tray) return;
  tray.setToolTip(`Local Ops · ${online ? "控制面在线" : "控制面离线"}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: online ? "● 控制面在线" : "● 控制面离线", enabled: false },
    { type: "separator" },
    { label: "显示控制台", click: showMainWindow },
    { label: "在浏览器中打开", click: () => openSafeExternal(browserUrl()) },
    { label: "重启后台控制面", click: restartControlPlane },
    { label: "打开日志文件夹", click: () => shell.openPath(LOG_DIR) },
    { type: "separator" },
    { label: "退出", click: () => { isQuitting = true; app.quit(); } }
  ]));
}

async function connectControlPlane() {
  try {
    const installResult = await ensureBundledBackend();
    await ensureControlPlane(installResult.restartRequired);
    applyLoginItemPreference();
    await loadConsole();
    updateTray(true);
    void applyAppStartupActionsOnce();
    void maybeOfferPortlessAccess();
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
  await mainWindow.loadFile(path.join(__dirname, "splash.html"));
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
    dialog.showErrorBox("后台重启失败", error.message);
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
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), openAsHidden: false });
    return getLoginItemStatus();
  });
  ipcMain.handle("local-ops:save-config-file", async (event, payload = {}) => {
    assertTrustedRenderer(event);
    const content = String(payload.content || "");
    if (!content || Buffer.byteLength(content, "utf8") > 2 * 1024 * 1024) throw new Error("导出配置内容无效或过大");
    const suggestedName = /^[a-zA-Z0-9._-]+\.json$/.test(String(payload.suggestedName || ""))
      ? String(payload.suggestedName)
      : "local-ops-config.json";
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "导出 Local Ops 配置",
      defaultPath: path.join(app.getPath("documents"), suggestedName),
      buttonLabel: "导出配置",
      filters: [{ name: "JSON 配置", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, content, { encoding: "utf8", mode: 0o600 });
    return { canceled: false, fileName: path.basename(result.filePath) };
  });
  ipcMain.handle("local-ops:open-config-file", async (event) => {
    assertTrustedRenderer(event);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "导入 Local Ops 配置",
      buttonLabel: "选择配置",
      properties: ["openFile"],
      filters: [{ name: "JSON 配置", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const file = result.filePaths[0];
    if (fs.statSync(file).size > 2 * 1024 * 1024) throw new Error("配置文件不能超过 2 MB");
    return { canceled: false, fileName: path.basename(file), content: fs.readFileSync(file, "utf8") };
  });
}

function assertTrustedRenderer(event) {
  const senderUrl = event.senderFrame?.url || event.sender?.getURL?.() || "";
  if (!isAllowedAppUrl(senderUrl)) throw new Error("该操作只能从 Local Ops App 发起");
}

function getLoginItemStatus() {
  const current = app.getLoginItemSettings();
  return {
    available: process.platform === "darwin" && app.isPackaged,
    enabled: Boolean(current.openAtLogin),
    wasOpenedAtLogin: Boolean(current.wasOpenedAtLogin)
  };
}

function applyLoginItemPreference() {
  const catalog = readJsonFile(CATALOG_PATH, {});
  app.setLoginItemSettings({
    openAtLogin: Boolean(catalog.settings?.launchAppAtLogin),
    openAsHidden: false
  });
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
  }
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
    title: "启用无端口访问",
    message: "是否隐藏本地域名后的 :19080？",
    detail: "启用后可直接访问 http://openclaw.localhost。macOS 会要求输入一次管理员密码，转发仅作用于本机。",
    buttons: ["启用无端口访问", "稍后在设置中启用"],
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
      title: "无端口访问已启用",
      message: "现在可以直接使用 .localhost 域名",
      detail: "例如：http://openclaw.localhost",
      buttons: ["完成"]
    });
  } catch (error) {
    if (error.message === "已取消管理员授权") return;
    dialog.showErrorBox("无端口访问启用失败", error.message);
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
      LOCAL_OPS_CADDY: path.join(INSTALL_DIR, "bin", "caddy")
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
  showMainWindow();
}

async function showOffline(message) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await mainWindow.loadFile(path.join(__dirname, "offline.html"), {
    query: { reason: String(message || "后台服务暂时不可用").slice(0, 240) }
  });
  showMainWindow();
}

function scheduleReconnect(delay = 2000) {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(async () => {
    if (isQuitting) return;
    if (await checkHealth()) {
      await loadConsole();
      updateTray(true);
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
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
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
    return ["splash.html", "offline.html"].some((name) => file.endsWith(path.sep + name));
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
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFile(LOG_FILE, line, () => {});
}
