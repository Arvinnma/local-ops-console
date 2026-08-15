import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const sourceRoot = path.resolve(import.meta.dirname, "..");
const publicRoot = path.join(sourceRoot, "public");
const chromePath = process.env.LOCAL_OPS_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "local-ops-refresh-isolated-"));
const calls = [];
let snapshotFailure = false;
let domainFailure = false;
let revision = 1;
let chrome;
let server;

try {
  await fs.access(chromePath);
  server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/api/bootstrap") {
      return sendJson(response, 200, bootstrapFixture(server.address().port));
    }
    if (request.method === "GET" && url.pathname === "/api/snapshot") {
      calls.push({ method: "GET", path: url.pathname, fresh: url.searchParams.get("fresh") });
      if (snapshotFailure) return sendJson(response, 503, { error: "isolated snapshot timeout" });
      return sendJson(response, 200, snapshotFixture(server.address().port));
    }
    if (request.method === "POST") {
      calls.push({ method: "POST", path: url.pathname });
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === "GET") return serveStatic(url.pathname, response);
    sendJson(response, 404, { error: "not found" });
  });
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const base = `http://127.0.0.1:${server.address().port}`;

  chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let chromeStderr = "";
  chrome.stderr.setEncoding("utf8");
  chrome.stderr.on("data", (chunk) => { chromeStderr += chunk; });

  const [debugPort] = (await waitForFile(path.join(profile, "DevToolsActivePort"))).trim().split("\n");
  const targets = await waitForTargets(Number(debugPort));
  const page = targets.find((item) => item.type === "page");
  assert.ok(page?.webSocketDebuggerUrl, "Chrome did not expose a page target");
  const cdp = await createCdpClient(page.webSocketDebuggerUrl);
  const browserErrors = [];
  cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    browserErrors.push(exceptionDetails.exception?.description || exceptionDetails.text || "unknown browser error");
  });
  await Promise.all([cdp.send("Page.enable"), cdp.send("Runtime.enable")]);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const originalSetInterval = window.setInterval.bind(window);
      window.setInterval = (callback, delay, ...args) => Number(delay) === 3500
        ? 0
        : originalSetInterval(callback, delay, ...args);
    })();`
  });
  const loaded = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url: `${base}/#tunnels` });
  await loaded;
  await waitFor(() => cdp.evaluate(`document.documentElement.dataset.snapshotState === "fresh"`));

  const initial = await cdp.evaluate(`(() => ({
    service: document.querySelector("#services-table")?.textContent.includes("Isolated Service"),
    tunnel: document.querySelector("#tunnel-cards")?.textContent.includes("Isolated Tunnel"),
    tunnelState: document.querySelector("#tunnel-cards .status-pill")?.textContent.trim(),
    revision: document.querySelector("#last-sync")?.textContent.trim()
  }))()`);
  assert.equal(initial.service, true, "initial service snapshot was not rendered");
  assert.equal(initial.tunnel, true, "initial tunnel snapshot was not rendered");
  assert.equal(initial.tunnelState, "已连接");
  await cdp.evaluate(`(() => {
    window.__localOpsStableServiceRow = document.querySelector("#services-table tr");
    window.__localOpsStableTunnelCard = document.querySelector("#tunnel-cards .tunnel-card");
  })()`);

  snapshotFailure = true;
  await cdp.evaluate(`document.querySelector("#refresh-button").click()`);
  await waitFor(() => cdp.evaluate(`document.documentElement.dataset.snapshotState === "stale"`));
  const stale = await cdp.evaluate(`(() => {
    document.querySelector('[data-view="services"]')?.click();
    const servicePrimary = document.querySelector("#services-table .row-actions > .mini-button:first-child");
    document.querySelector('[data-view="tunnels"]')?.click();
    const tunnelPrimary = document.querySelector("#tunnel-cards .row-actions > .mini-button:first-child");
    return {
      label: document.querySelector("#last-sync")?.textContent.trim(),
      serviceStillPresent: document.querySelector("#services-table")?.textContent.includes("Isolated Service"),
      tunnelStillPresent: document.querySelector("#tunnel-cards")?.textContent.includes("Isolated Tunnel"),
      serviceDisabled: Boolean(servicePrimary?.disabled),
      tunnelDisabled: Boolean(tunnelPrimary?.disabled)
    };
  })()`);
  assert.match(stale.label, /刷新失败/);
  assert.equal(stale.serviceStillPresent, true, "stale refresh cleared the last service snapshot");
  assert.equal(stale.tunnelStillPresent, true, "stale refresh cleared the last tunnel snapshot");
  assert.equal(stale.serviceDisabled, true, "stale service mutation remained enabled");
  assert.equal(stale.tunnelDisabled, true, "stale tunnel mutation remained enabled");

  const staleSecondaryActions = await cdp.evaluate(`(() => {
    document.querySelector('[data-view="services"]')?.click();
    const serviceRow = document.querySelector("#services-table tr");
    serviceRow?.querySelector("[data-action-menu]")?.click();
    const menuButtons = [...document.querySelectorAll("#action-menu button")];
    const menuDisabled = menuButtons
      .filter((item) => item.textContent.trim() !== "查看日志")
      .every((item) => item.disabled);
    const logsEnabled = menuButtons.some((item) => item.textContent.trim() === "查看日志" && !item.disabled);
    document.querySelector('[data-view="terminal"]')?.click();
    const terminalPrimary = document.querySelector("#terminal-table .row-actions > .mini-button:first-child");
    const terminalSort = document.querySelector("#terminal-table .sort-handle");
    return {
      menuDisabled,
      logsEnabled,
      terminalDisabled: Boolean(terminalPrimary?.disabled),
      terminalSortDisabled: terminalSort?.getAttribute("aria-disabled") === "true"
    };
  })()`);
  assert.equal(staleSecondaryActions.menuDisabled, true, "stale menu mutations remained enabled");
  assert.equal(staleSecondaryActions.logsEnabled, true, "stale logs action should remain readable");
  assert.equal(staleSecondaryActions.terminalDisabled, true, "stale terminal execution remained enabled");
  assert.equal(staleSecondaryActions.terminalSortDisabled, true, "stale sorting remained enabled");

  snapshotFailure = false;
  revision += 1;
  await cdp.evaluate(`document.querySelector("#refresh-button").click()`);
  await waitFor(() => cdp.evaluate(`document.documentElement.dataset.snapshotState === "fresh"`));

  domainFailure = true;
  revision += 1;
  await cdp.evaluate(`document.querySelector("#refresh-button").click()`);
  await waitFor(() => cdp.evaluate(`document.querySelector("#tunnel-cards .status-pill")?.textContent.trim() === "入口未就绪"`));
  const failedAction = await cdp.evaluate(`(() => {
    const button = document.querySelector("#tunnel-cards .row-actions > .mini-button:first-child");
    return { action: button?.dataset.action || "", disabled: Boolean(button?.disabled) };
  })()`);
  assert.deepEqual(failedAction, { action: "stop", disabled: false });
  const actionStart = calls.length;
  await cdp.evaluate(`document.querySelector("#tunnel-cards [data-action=stop]").click()`);
  await waitFor(() => calls.slice(actionStart).some((item) => item.method === "POST"));
  const mutationPaths = calls.slice(actionStart).filter((item) => item.method === "POST").map((item) => item.path);
  assert.deepEqual(mutationPaths, ["/api/processes/isolated-tunnel/stop"]);

  domainFailure = false;
  revision += 1;
  await cdp.evaluate(`document.querySelector("#refresh-button").click()`);
  await waitFor(() => cdp.evaluate(`document.querySelector("#tunnel-cards .status-pill")?.textContent.trim() === "已连接"`));
  const stableNodes = await cdp.evaluate(`(() => ({
    service: window.__localOpsStableServiceRow === document.querySelector("#services-table tr"),
    tunnel: window.__localOpsStableTunnelCard === document.querySelector("#tunnel-cards .tunnel-card")
  }))()`);
  assert.deepEqual(stableNodes, { service: true, tunnel: true }, "refresh replaced stable resource DOM nodes");
  assert.deepEqual(browserErrors, [], `browser exceptions detected:\n${browserErrors.join("\n")}`);
  assert.doesNotMatch(chromeStderr, /content security policy/i);
  cdp.close();
  console.log("Isolated refresh acceptance passed: stable DOM, stale retention, disabled mutations, and stoppable unready tunnels");
} finally {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  if (chrome && chrome.exitCode == null) {
    const exited = new Promise((resolve) => chrome.once("exit", resolve));
    chrome.kill("SIGTERM");
    await Promise.race([exited, delay(3000)]);
  }
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
}

function bootstrapFixture(consolePort) {
  return {
    csrfToken: "isolated-csrf-token",
    app: {
      name: "Local Ops",
      consoleUrl: `http://127.0.0.1:${consolePort}`,
      proxyPort: 19080,
      publicProxyPort: 19080,
      portlessAccess: false
    },
    config: {
      settings: {
        consolePort,
        processComposePort: 19091,
        workerComposePort: 19093,
        caddyAdminPort: 19092,
        proxyPort: 19080,
        publicProxyPort: 19080,
        launchAppAtLogin: false,
        restoreLastSessionOnAppLaunch: false,
        language: "zh-CN"
      },
      services: [{
        id: "isolated-service",
        name: "Isolated Service",
        description: "isolated fixture",
        icon: "server",
        namespace: "tests"
      }],
      tunnels: [{
        id: "isolated-tunnel",
        name: "Isolated Tunnel",
        description: "isolated fixture",
        icon: "ssh",
        sshUser: "tester",
        sshHost: "example.test",
        sshPort: 22,
        localPort: 19999,
        remoteHost: "127.0.0.1",
        remotePort: 8080
      }],
      externalServices: [],
      terminalTasks: [{
        id: "isolated-terminal",
        name: "Isolated Terminal",
        description: "isolated fixture",
        icon: "terminal",
        kind: "command",
        terminalApp: "terminal",
        command: "printf isolated"
      }],
      routes: [{
        id: "isolated-route",
        name: "Isolated Entry",
        icon: "link",
        host: "isolated.localhost",
        target: "127.0.0.1:19999",
        enabled: true,
        system: false,
        url: "http://isolated.localhost:19080"
      }],
      systemProcesses: []
    }
  };
}

function snapshotFixture(consolePort) {
  const bootstrap = bootstrapFixture(consolePort);
  const entryReady = !domainFailure;
  const tunnel = {
    id: "isolated-tunnel",
    name: "Isolated Tunnel",
    description: "isolated fixture",
    icon: "ssh",
    kind: "tunnel",
    namespace: "tests",
    status: entryReady ? "connected" : "connection_failed",
    rawStatus: "running",
    active: true,
    health: entryReady ? "healthy" : "degraded",
    pid: 4242,
    restarts: 0,
    protected: false,
    networkCheck: { ok: true, latencyMs: 7, target: "example.test:22" },
    healthCheck: { ok: true, latencyMs: 2, mode: "tcp", target: "127.0.0.1:19999" },
    readinessCheck: { configured: false, ok: true, mode: "none" },
    domainEntry: {
      configured: true,
      ready: entryReady,
      terminal: !entryReady,
      status: entryReady ? "ready" : "failed",
      target: "http://isolated.localhost:19080",
      lastError: entryReady ? "" : "ECONNREFUSED: isolated entry unavailable",
      checks: [{
        id: "isolated-route",
        ok: entryReady,
        statusCode: entryReady ? 200 : null,
        latencyMs: entryReady ? 4 : null,
        error: entryReady ? "" : "ECONNREFUSED"
      }]
    },
    fullyAvailable: entryReady,
    lastConnectionError: "",
    diagnostics: {}
  };
  return {
    schemaVersion: 1,
    catalogRevision: `isolated-${revision}`,
    generatedAt: new Date().toISOString(),
    bootstrap,
    state: {
      generatedAt: new Date().toISOString(),
      orchestrator: { online: true, workerOnline: true, error: "" },
      summary: { total: 2, running: 2, stopped: 0, unhealthy: entryReady ? 0 : 1, externalOnline: 0, routes: 1 },
      processes: [{
        id: "isolated-service",
        name: "Isolated Service",
        description: "isolated fixture",
        icon: "server",
        kind: "service",
        namespace: "tests",
        status: "running",
        rawStatus: "running",
        active: true,
        health: "healthy",
        pid: 3131,
        restarts: 0,
        protected: false
      }, tunnel],
      external: [],
      routes: [{ ...bootstrap.config.routes[0], entryReady, fullyAvailable: entryReady }],
      system: {
        hostname: "isolated.local",
        platform: "test",
        uptimeSeconds: 120,
        memoryUsed: 1024,
        memoryTotal: 2048,
        loadAverage: 0
      }
    },
    docker: null
  };
}

async function serveStatic(urlPath, response) {
  const relative = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath).replace(/^\/+/, "");
  const filePath = path.resolve(publicRoot, relative);
  if (!filePath.startsWith(`${publicRoot}${path.sep}`)) return sendJson(response, 403, { error: "forbidden" });
  try {
    const body = await fs.readFile(filePath);
    const type = ({
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml"
    })[path.extname(filePath)] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    response.end(body);
  } catch {
    sendJson(response, 404, { error: "not found" });
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

async function waitForFile(file, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { return await fs.readFile(file, "utf8"); } catch {}
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${file}`);
}

async function waitForTargets(port, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) return response.json();
    } catch (error) { lastError = error; }
    await delay(100);
  }
  throw lastError || new Error("Timed out waiting for Chrome DevTools targets");
}

async function waitFor(predicate, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error("Timed out waiting for isolated browser state");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createCdpClient(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result || {});
      return;
    }
    for (const listener of listeners.get(message.method) || []) listener(message.params || {});
  });
  return {
    send(method, params = {}) {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    async evaluate(expression) {
      const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed");
      }
      return result.result?.value;
    },
    on(method, listener) {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(listener);
    },
    once(method) {
      return new Promise((resolve) => {
        const listener = (params) => {
          listeners.set(method, (listeners.get(method) || []).filter((item) => item !== listener));
          resolve(params);
        };
        this.on(method, listener);
      });
    },
    close() { socket.close(); }
  };
}
