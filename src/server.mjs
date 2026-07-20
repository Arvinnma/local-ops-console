import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  BINARIES,
  CADDYFILE_PATH,
  PROCESS_COMPOSE_PATH,
  ROOT,
  SSH_ASKPASS_PATH,
  SYSTEM_PROCESS_DEFINITIONS,
  TOKEN_PATH,
  TUNNEL_MANUAL_RETRY_LIMIT,
  TUNNEL_STARTUP_RETRY_LIMIT,
  WORKER_COMPOSE_PATH,
  applyPortableConfigImport,
  buildTerminalAppleScript,
  createPortableConfigExport,
  loadCatalog,
  normalizeRoute,
  normalizeService,
  normalizeTerminalTask,
  normalizeTunnel,
  processDefinitions,
  portableConfigCounts,
  publicProxyPort,
  renderAll,
  renderSshCommand,
  routeUrl,
  saveCatalog,
  validateCatalog
} from "./config.mjs";
import {
  deletePrivateKeyPassphrase,
  hasPrivateKeyPassphrase,
  normalizePrivateKeyPassphrase,
  readPrivateKeyPassphrase,
  storePrivateKeyPassphrase
} from "./keychain.mjs";
import { enrichTunnelProcess, pruneTunnelRuntime, resetTunnelRuntime } from "./tunnel-health.mjs";

const execFileAsync = promisify(execFile);
const PUBLIC_DIR = path.join(ROOT, "public");
const LAST_SESSION_PATH = path.join(ROOT, "config", "last-session.json");
const CSRF_TOKEN = crypto.randomBytes(32).toString("hex");
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

let mutationQueue = Promise.resolve();
let workerConfigQueue = Promise.resolve();
const processActionQueues = new Map();
const tunnelRetryLimits = new Map();
let stateCache = { at: 0, value: null };
let dockerCache = { at: 0, value: null };
let sessionCapturePromise = null;

const server = http.createServer(async (request, response) => {
  try {
    const catalog = loadCatalog();
    if (!isAllowedHost(request.headers.host, catalog)) {
      return sendJson(response, 421, { error: "该地址不允许访问控制台" });
    }

    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    setSecurityHeaders(response);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, { ok: true, service: "local-ops-console" });
    }
    if (request.method === "GET" && url.pathname === "/api/bootstrap") {
      return sendJson(response, 200, bootstrapPayload(catalog));
    }
    if (request.method === "GET" && url.pathname === "/api/config/export") {
      return sendJson(response, 200, createPortableConfigExport(catalog));
    }
    if (request.method === "GET" && url.pathname === "/api/state") {
      return sendJson(response, 200, await getState(catalog, url.searchParams.get("fresh") === "1"));
    }
    if (request.method === "GET" && url.pathname === "/api/docker") {
      return sendJson(response, 200, await getDockerState(url.searchParams.get("fresh") === "1"));
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/logs/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/logs/".length));
      assertKnownProcess(catalog, id);
      const tail = Math.min(Math.max(Number(url.searchParams.get("tail") || 240), 20), 1200);
      return sendJson(response, 200, { id, logs: await processLogs(catalog, id, tail) });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      assertMutationRequest(request, catalog);
    }

    const actionMatch = /^\/api\/processes\/([^/]+)\/(start|stop|restart)$/.exec(url.pathname);
    if (request.method === "POST" && actionMatch) {
      const [, encodedId, action] = actionMatch;
      const id = decodeURIComponent(encodedId);
      const definition = assertKnownProcess(catalog, id);
      if (definition.protected && action !== "restart") {
        throw httpError(403, "控制台自身不能从网页停止");
      }
      if (definition.kind === "tunnel" && action !== "stop") await assertPassphraseAvailable(definition);
      if (definition.kind === "tunnel" && action !== "stop") {
        await configureTunnelRetryLimits(catalog, [id], TUNNEL_MANUAL_RETRY_LIMIT);
      }
      if (definition.kind === "tunnel") resetTunnelRuntime(id);
      await processAction(catalog, id, action);
      invalidateState();
      return sendJson(response, 200, { ok: true, id, action });
    }

    const dockerActionMatch = /^\/api\/docker\/([^/]+)\/(start|stop|restart)$/.exec(url.pathname);
    if (request.method === "POST" && dockerActionMatch && dockerActionMatch[1] !== "desktop") {
      const [, encodedId, action] = dockerActionMatch;
      const container = await assertDockerContainer(decodeURIComponent(encodedId));
      await runDocker([action, container.id], action === "stop" ? 30000 : 20000);
      invalidateDocker();
      return sendJson(response, 200, { ok: true, id: container.id, action });
    }

    if (request.method === "POST" && url.pathname === "/api/docker/start-all") {
      const result = await startAllDockerContainers();
      return sendJson(response, 200, { ok: true, ...result });
    }

    if (request.method === "POST" && url.pathname === "/api/docker/desktop/start") {
      await runTool("/usr/bin/open", ["-a", "Docker"], 15000);
      invalidateDocker();
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === "POST" && url.pathname === "/api/startup/app") {
      return sendJson(response, 200, { ok: true, ...(await applyAppStartupActions(catalog)) });
    }

    if (request.method === "POST" && url.pathname === "/api/session/capture") {
      const snapshot = await captureLastSessionState(catalog);
      return sendJson(response, 200, {
        ok: true,
        capturedAt: snapshot.capturedAt,
        services: snapshot.services.length,
        tunnels: snapshot.tunnels.length,
        docker: snapshot.docker.containers.length
      });
    }

    if (request.method === "POST" && url.pathname === "/api/config/import") {
      const body = await readJson(request, 2 * 1024 * 1024);
      const previousSecretReferences = sshPassphraseReferences(catalog);
      let imported;
      await enqueueMutation((next) => {
        imported = validateInput(() => applyPortableConfigImport(body, next));
        for (const key of Object.keys(next)) delete next[key];
        Object.assign(next, imported);
      });
      const retainedSecretReferences = sshPassphraseReferences(imported);
      for (const reference of previousSecretReferences) {
        if (!retainedSecretReferences.has(reference)) await cleanupPassphrase(reference);
      }
      return sendJson(response, 200, {
        ok: true,
        counts: portableConfigCounts(imported),
        settings: {
          launchAppAtLogin: imported.settings.launchAppAtLogin,
          restoreLastSessionOnAppLaunch: imported.settings.restoreLastSessionOnAppLaunch,
          language: imported.settings.language
        }
      });
    }

    if (request.method === "POST" && url.pathname === "/api/services") {
      const body = await readJson(request);
      const service = validateInput(() => normalizeService(body));
      await enqueueMutation((next) => {
        if (next.services.some((item) => item.id === service.id) || next.tunnels.some((item) => item.id === service.id)) {
          throw httpError(409, `ID 已存在：${service.id}`);
        }
        next.services.push(service);
        if (body.domain) {
          const route = normalizeRoute({
            id: service.id,
            name: service.name,
            icon: service.icon,
            host: body.domain,
            target: `127.0.0.1:${Number(body.port)}`,
            enabled: true
          });
          if (next.routes.some((item) => item.id === route.id || item.host === route.host)) {
            throw httpError(409, "域名或域名 ID 已存在");
          }
          next.routes.push(route);
        }
      });
      return sendJson(response, 201, { ok: true, service });
    }

    const serviceMatch = /^\/api\/services\/([^/]+)$/.exec(url.pathname);
    if (request.method === "PUT" && serviceMatch) {
      const id = decodeURIComponent(serviceMatch[1]);
      const body = await readJson(request);
      const service = validateInput(() => normalizeService({ ...body, id }));
      await enqueueMutation((next) => {
        const index = next.services.findIndex((item) => item.id === id);
        if (index < 0) throw httpError(404, "没有找到该服务");
        next.services[index] = service;
      });
      return sendJson(response, 200, { ok: true, service });
    }

    if (request.method === "DELETE" && serviceMatch) {
      const id = decodeURIComponent(serviceMatch[1]);
      await enqueueMutation((next) => {
        const count = next.services.length;
        next.services = next.services.filter((item) => item.id !== id);
        next.routes = next.routes.filter((item) => item.system || item.id !== id);
        if (count === next.services.length) throw httpError(404, "没有找到该服务");
      });
      return sendJson(response, 200, { ok: true, id });
    }

    if (request.method === "POST" && url.pathname === "/api/tunnels") {
      const body = await readJson(request);
      const baseTunnel = validateInput(() => normalizeTunnel(body));
      const secret = await preparePassphraseChange(body, null, baseTunnel.identityFile, true);
      const tunnel = validateInput(() => normalizeTunnel({ ...body, passphraseRef: secret.reference }));
      try {
        await enqueueMutation((next) => {
          if (next.services.some((item) => item.id === tunnel.id) || next.tunnels.some((item) => item.id === tunnel.id)) {
            throw httpError(409, `ID 已存在：${tunnel.id}`);
          }
          if (next.tunnels.some((item) => item.localPort === tunnel.localPort)) {
            throw httpError(409, `本地端口 ${tunnel.localPort} 已被其他隧道使用`);
          }
          next.tunnels.push(tunnel);
        });
        await secret.commit();
      } catch (error) {
        await secret.rollback();
        throw error;
      }
      return sendJson(response, 201, { ok: true, tunnel: publicSshResource(tunnel) });
    }

    const tunnelMatch = /^\/api\/tunnels\/([^/]+)$/.exec(url.pathname);
    if (request.method === "PUT" && tunnelMatch) {
      const id = decodeURIComponent(tunnelMatch[1]);
      const existing = catalog.tunnels.find((item) => item.id === id);
      if (!existing) throw httpError(404, "没有找到该隧道");
      const body = await readJson(request);
      const baseTunnel = validateInput(() => normalizeTunnel({ ...body, id, passphraseRef: existing.passphraseRef }));
      const secret = await preparePassphraseChange(body, existing.passphraseRef, baseTunnel.identityFile, true);
      const tunnel = validateInput(() => normalizeTunnel({ ...body, id, passphraseRef: secret.reference }));
      try {
        await enqueueMutation((next) => {
          const index = next.tunnels.findIndex((item) => item.id === id);
          if (index < 0) throw httpError(404, "没有找到该隧道");
          if (next.tunnels.some((item) => item.id !== id && item.localPort === tunnel.localPort)) {
            throw httpError(409, `本地端口 ${tunnel.localPort} 已被其他隧道使用`);
          }
          next.tunnels[index] = tunnel;
        });
        await secret.commit();
      } catch (error) {
        await secret.rollback();
        throw error;
      }
      return sendJson(response, 200, { ok: true, tunnel: publicSshResource(tunnel) });
    }

    if (request.method === "DELETE" && tunnelMatch) {
      const id = decodeURIComponent(tunnelMatch[1]);
      const removed = catalog.tunnels.find((item) => item.id === id);
      await enqueueMutation((next) => {
        const count = next.tunnels.length;
        next.tunnels = next.tunnels.filter((item) => item.id !== id);
        if (count === next.tunnels.length) throw httpError(404, "没有找到该隧道");
      });
      await cleanupPassphrase(removed?.passphraseRef);
      return sendJson(response, 200, { ok: true, id });
    }

    if (request.method === "POST" && url.pathname === "/api/routes") {
      const body = await readJson(request);
      const route = validateInput(() => normalizeRoute(body));
      await enqueueMutation((next) => {
        if (next.routes.some((item) => item.id === route.id || item.host === route.host)) {
          throw httpError(409, "域名或域名 ID 已存在");
        }
        next.routes.push(route);
      });
      return sendJson(response, 201, { ok: true, route });
    }

    const routeMatch = /^\/api\/routes\/([^/]+)$/.exec(url.pathname);
    if (request.method === "PUT" && routeMatch) {
      const id = decodeURIComponent(routeMatch[1]);
      const body = await readJson(request);
      const route = validateInput(() => normalizeRoute({ ...body, id }));
      await enqueueMutation((next) => {
        const index = next.routes.findIndex((item) => item.id === id);
        if (index < 0) throw httpError(404, "没有找到该域名");
        if (next.routes[index].system) throw httpError(403, "控制台域名不能编辑");
        if (next.routes.some((item) => item.id !== id && item.host === route.host)) {
          throw httpError(409, "域名已存在");
        }
        next.routes[index] = route;
      });
      return sendJson(response, 200, { ok: true, route });
    }

    if (request.method === "DELETE" && routeMatch) {
      const id = decodeURIComponent(routeMatch[1]);
      await enqueueMutation((next) => {
        const route = next.routes.find((item) => item.id === id);
        if (!route) throw httpError(404, "没有找到该域名");
        if (route.system) throw httpError(403, "控制台域名不能删除");
        next.routes = next.routes.filter((item) => item.id !== id);
      });
      return sendJson(response, 200, { ok: true, id });
    }

    if (request.method === "POST" && url.pathname === "/api/terminal-tasks") {
      const body = await readJson(request);
      const baseTask = validateInput(() => normalizeTerminalTask(body));
      const secret = await preparePassphraseChange(body, null, baseTask.identityFile, baseTask.kind === "ssh");
      const task = validateInput(() => normalizeTerminalTask({ ...body, passphraseRef: secret.reference }));
      try {
        await enqueueMutation((next) => {
          if (next.terminalTasks.some((item) => item.id === task.id)) throw httpError(409, `ID 已存在：${task.id}`);
          next.terminalTasks.push(task);
        });
        await secret.commit();
      } catch (error) {
        await secret.rollback();
        throw error;
      }
      return sendJson(response, 201, { ok: true, task: publicSshResource(task) });
    }

    const terminalRunMatch = /^\/api\/terminal-tasks\/([^/]+)\/run$/.exec(url.pathname);
    if (request.method === "POST" && terminalRunMatch) {
      const id = decodeURIComponent(terminalRunMatch[1]);
      const task = catalog.terminalTasks.find((item) => item.id === id);
      if (!task) throw httpError(404, "没有找到该终端任务");
      await assertPassphraseAvailable(task);
      await launchTerminalTask(task);
      return sendJson(response, 200, { ok: true, id });
    }

    const terminalMatch = /^\/api\/terminal-tasks\/([^/]+)$/.exec(url.pathname);
    if (request.method === "PUT" && terminalMatch) {
      const id = decodeURIComponent(terminalMatch[1]);
      const existing = catalog.terminalTasks.find((item) => item.id === id);
      if (!existing) throw httpError(404, "没有找到该终端任务");
      const body = await readJson(request);
      const baseTask = validateInput(() => normalizeTerminalTask({ ...body, id, passphraseRef: existing.passphraseRef }));
      const secret = await preparePassphraseChange(body, existing.passphraseRef, baseTask.identityFile, baseTask.kind === "ssh");
      const task = validateInput(() => normalizeTerminalTask({ ...body, id, passphraseRef: secret.reference }));
      try {
        await enqueueMutation((next) => {
          const index = next.terminalTasks.findIndex((item) => item.id === id);
          if (index < 0) throw httpError(404, "没有找到该终端任务");
          next.terminalTasks[index] = task;
        });
        await secret.commit();
      } catch (error) {
        await secret.rollback();
        throw error;
      }
      return sendJson(response, 200, { ok: true, task: publicSshResource(task) });
    }
    if (request.method === "DELETE" && terminalMatch) {
      const id = decodeURIComponent(terminalMatch[1]);
      const removed = catalog.terminalTasks.find((item) => item.id === id);
      await enqueueMutation((next) => {
        const count = next.terminalTasks.length;
        next.terminalTasks = next.terminalTasks.filter((item) => item.id !== id);
        if (count === next.terminalTasks.length) throw httpError(404, "没有找到该终端任务");
      });
      await cleanupPassphrase(removed?.passphraseRef);
      return sendJson(response, 200, { ok: true, id });
    }

    const orderMatch = /^\/api\/order\/(services|tunnels|routes|terminal-tasks)$/.exec(url.pathname);
    if (request.method === "PUT" && orderMatch) {
      const key = orderMatch[1] === "terminal-tasks" ? "terminalTasks" : orderMatch[1];
      const body = await readJson(request);
      await enqueueCatalogMutation((next) => reorderCatalogList(next, key, body.ids));
      return sendJson(response, 200, { ok: true, key });
    }

    if (request.method === "PATCH" && url.pathname === "/api/settings") {
      const body = await readJson(request);
      await enqueueMutation((next) => {
        for (const key of ["launchAppAtLogin", "restoreLastSessionOnAppLaunch"]) {
          if (key in body) next.settings[key] = Boolean(body[key]);
        }
        if ("language" in body) {
          if (!["zh-CN", "en-US"].includes(body.language)) throw httpError(400, "不支持的界面语言");
          next.settings.language = body.language;
        }
      });
      return sendJson(response, 200, { ok: true, settings: loadCatalog().settings });
    }

    if (request.method === "POST" && url.pathname === "/api/reload") {
      await applyRuntimeConfig(loadCatalog());
      invalidateState();
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === "GET" || request.method === "HEAD") {
      return serveStatic(url.pathname, request.method, response);
    }
    return sendJson(response, 404, { error: "接口不存在" });
  } catch (error) {
    const status = Number(error.statusCode || 500);
    if (status >= 500) console.error(error);
    return sendJson(response, status, { error: error.message || "内部错误" });
  }
});

const initialCatalog = loadCatalog();
server.listen(initialCatalog.settings.consolePort, "127.0.0.1", () => {
  console.log(`Local Ops Console listening on http://127.0.0.1:${initialCatalog.settings.consolePort}`);
});

function bootstrapPayload(catalog) {
  return {
    csrfToken: CSRF_TOKEN,
    app: {
      name: "Local Ops",
      consoleUrl: routeUrl(catalog, catalog.routes.find((item) => item.id === "console")),
      proxyPort: catalog.settings.proxyPort,
      publicProxyPort: publicProxyPort(catalog),
      portlessAccess: publicProxyPort(catalog) === 80
    },
    config: publicCatalog(catalog)
  };
}

async function getState(catalog, force = false) {
  const now = Date.now();
  if (!force && stateCache.value && now - stateCache.at < 1800) return stateCache.value;

  let rawProcesses = [];
  let orchestrator = { online: true, workerOnline: true, error: "" };
  try {
    const core = await processList(catalog, "core");
    let worker = [];
    try {
      worker = await processList(catalog, "worker");
    } catch (error) {
      orchestrator.workerOnline = false;
      orchestrator.error = cleanError(error);
    }
    rawProcesses = [...core, ...worker];
  } catch (error) {
    orchestrator = { online: false, workerOnline: false, error: cleanError(error) };
  }

  const routes = catalog.routes.map((route) => ({ ...route, url: routeUrl(catalog, route) }));
  const definitions = processDefinitions(catalog);
  const rawByName = new Map(rawProcesses.map((item) => [String(item.name || item.process || item.process_name), item]));
  pruneTunnelRuntime(catalog.tunnels.map((item) => item.id));
  const processes = await Promise.all(definitions.map(async (definition) => {
    const process = normalizeProcess(definition, rawByName.get(definition.id));
    if (definition.kind !== "tunnel") return process;
    const enriched = await enrichTunnelProcess(definition, process, {
      readLogs: () => processLogs(catalog, definition.id, 40),
      entryRoutes: routes.filter((route) => routeTargetsTunnel(route, definition)),
      retryLimit: activeTunnelRetryLimit(definition.id)
    });
    if (enriched.active && enriched.retryLimit) tunnelRetryLimits.set(definition.id, enriched.retryLimit);
    return enriched;
  }));
  const external = await Promise.all(catalog.externalServices.map(probeExternal));
  const routeStates = routes.map((route) => {
    const tunnel = processes.find((item) => (
      item.kind === "tunnel" && item.domainEntry?.checks?.some((check) => check.id === route.id)
    ));
    const entryCheck = tunnel?.domainEntry?.checks?.find((check) => check.id === route.id);
    return {
      ...route,
      linkedTunnelId: tunnel?.id || null,
      entryReady: entryCheck ? Boolean(entryCheck.ok && tunnel?.healthCheck?.ok) : null,
      fullyAvailable: entryCheck ? Boolean(entryCheck.ok && tunnel?.fullyAvailable) : null,
      entryStatusCode: entryCheck?.statusCode ?? null,
      entryLatencyMs: entryCheck?.latencyMs ?? null,
      entryError: entryCheck?.error || ""
    };
  });
  const running = processes.filter((item) => (
    item.kind === "tunnel" ? item.status === "connected" : item.status === "running"
  )).length;
  const unhealthy = processes.filter((item) => ["unhealthy", "degraded"].includes(item.health)).length;
  const value = {
    generatedAt: new Date().toISOString(),
    orchestrator,
    summary: {
      total: processes.length,
      running,
      stopped: processes.length - running,
      unhealthy,
      externalOnline: external.filter((item) => item.online).length,
      routes: routeStates.filter((item) => item.enabled).length
    },
    processes,
    external,
    routes: routeStates,
    system: {
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      uptimeSeconds: os.uptime(),
      memoryUsed: os.totalmem() - os.freemem(),
      memoryTotal: os.totalmem(),
      loadAverage: os.loadavg()[0]
    }
  };
  stateCache = { at: now, value };
  return value;
}

function routeTargetsTunnel(route, tunnel) {
  const match = /^(127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})$/.exec(String(route.target || ""));
  if (!match) return false;
  return Number(match[2]) === Number(tunnel.localPort);
}

async function getDockerState(force = false) {
  const now = Date.now();
  if (!force && dockerCache.value && now - dockerCache.at < 1800) return dockerCache.value;

  const appInstalled = process.platform === "darwin" && [
    "/Applications/Docker.app",
    path.join(os.homedir(), "Applications", "Docker.app")
  ].some((item) => fs.existsSync(item));
  let clientVersion = "";
  try {
    const result = await runDocker(["version", "--format", "{{.Client.Version}}"], 5000);
    clientVersion = result.stdout.trim();
  } catch (error) {
    if (error.code === "ENOENT") {
      const unavailable = { available: false, appInstalled, daemonOnline: false, clientVersion: "", serverVersion: "", error: "没有找到 Docker CLI", containers: [] };
      dockerCache = { at: now, value: unavailable };
      return unavailable;
    }
    clientVersion = "已安装";
  }

  let serverVersion = "";
  let containers = [];
  try {
    const info = await runDocker(["info", "--format", "{{.ServerVersion}}"], 6000);
    serverVersion = info.stdout.trim();
    const result = await runDocker(["ps", "-a", "--no-trunc", "--format", "{{json .}}"], 10000);
    containers = result.stdout.split("\n").filter(Boolean).map((line) => normalizeDockerContainer(JSON.parse(line)));
  } catch (error) {
    const offline = {
      available: true,
      appInstalled,
      daemonOnline: false,
      clientVersion,
      serverVersion: "",
      error: cleanError(error) || "Docker Engine 尚未启动",
      containers: []
    };
    dockerCache = { at: now, value: offline };
    return offline;
  }

  const value = {
    available: true,
    appInstalled,
    daemonOnline: true,
    clientVersion,
    serverVersion,
    error: "",
    containers
  };
  dockerCache = { at: now, value };
  return value;
}

function normalizeDockerContainer(item) {
  const labels = parseDockerLabels(item.Labels);
  const state = String(item.State || "unknown").toLowerCase();
  return {
    id: String(item.ID || ""),
    shortId: String(item.ID || "").slice(0, 12),
    name: String(item.Names || item.Name || item.ID || "未命名容器"),
    image: String(item.Image || ""),
    state,
    status: String(item.Status || state),
    ports: String(item.Ports || ""),
    composeProject: labels["com.docker.compose.project"] || "",
    composeService: labels["com.docker.compose.service"] || "",
    running: state === "running" || state === "restarting" || state === "paused"
  };
}

function parseDockerLabels(value) {
  const labels = {};
  for (const part of String(value || "").split(",")) {
    const index = part.indexOf("=");
    if (index > 0) labels[part.slice(0, index)] = part.slice(index + 1);
  }
  return labels;
}

function runDocker(args, timeout = 15000) {
  return runTool(BINARIES.docker, args, timeout);
}

async function assertDockerContainer(id) {
  const docker = await getDockerState(true);
  if (!docker.available) throw httpError(503, "没有找到 Docker CLI");
  if (!docker.daemonOnline) throw httpError(503, "Docker Engine 尚未启动");
  const container = docker.containers.find((item) => item.id === id || item.shortId === id || item.name === id);
  if (!container) throw httpError(404, "没有找到该 Docker 容器");
  return container;
}

async function startAllDockerContainers() {
  const docker = await getDockerState(true);
  if (!docker.available) throw httpError(503, "没有找到 Docker CLI");
  if (!docker.daemonOnline) throw httpError(503, "Docker Engine 尚未启动");
  const candidates = docker.containers.filter((item) => !item.running);
  if (candidates.length) await runDocker(["start", ...candidates.map((item) => item.id)], 60000);
  invalidateDocker();
  return { started: candidates.length, total: docker.containers.length };
}

async function ensureDockerEngine() {
  let docker = await getDockerState(true);
  if (!docker.available) throw httpError(503, "没有找到 Docker CLI");

  let desktopStarted = false;
  if (!docker.daemonOnline) {
    if (!docker.appInstalled) throw httpError(503, "没有找到 Docker Desktop");
    await runTool("/usr/bin/open", ["-a", "Docker"], 15000);
    desktopStarted = true;

    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await wait(2000);
      docker = await getDockerState(true);
      if (docker.daemonOnline) break;
    }
    if (!docker.daemonOnline) {
      throw httpError(504, "Docker Desktop 已打开，但 Docker Engine 在 2 分钟内仍未就绪");
    }
  }

  return { docker, desktopStarted };
}

async function startRememberedDockerContainers(references) {
  if (!references.length) return { started: 0, total: 0, desktopStarted: false, missing: [] };
  const { docker, desktopStarted } = await ensureDockerEngine();
  const matched = docker.containers.filter((container) => references.some((reference) => dockerReferenceMatches(reference, container)));
  const candidates = matched.filter((item) => !item.running);

  if (candidates.length) await runDocker(["start", ...candidates.map((item) => item.id)], 60000);
  invalidateDocker();
  const missing = references
    .filter((reference) => !docker.containers.some((container) => dockerReferenceMatches(reference, container)))
    .map((reference) => reference.name || reference.id)
    .filter(Boolean);
  return { started: candidates.length, total: references.length, desktopStarted, missing };
}

async function applyAppStartupActions(catalog) {
  if (!catalog.settings.restoreLastSessionOnAppLaunch) {
    return { restored: false, services: 0, tunnels: 0, docker: 0, dockerDesktop: false, errors: [] };
  }

  const remembered = loadLastSessionState();
  const current = await getState(catalog, true);
  const processMap = new Map(current.processes.map((item) => [item.id, item]));
  const rememberedServiceIds = new Set(remembered.services);
  const rememberedTunnelIds = new Set(remembered.tunnels);
  const targets = [
    ...catalog.services.filter((item) => rememberedServiceIds.has(item.id)),
    ...catalog.tunnels.filter((item) => rememberedTunnelIds.has(item.id))
  ];
  const errors = [];
  const startupTunnelIds = [];
  for (const tunnel of catalog.tunnels) {
    if (!rememberedTunnelIds.has(tunnel.id) || processMap.get(tunnel.id)?.active) continue;
    try {
      await assertPassphraseAvailable(tunnel);
      startupTunnelIds.push(tunnel.id);
    } catch (error) {
      errors.push(`${tunnel.name || tunnel.id}：${cleanError(error)}`);
    }
  }
  const startupTunnelSet = new Set(startupTunnelIds);
  if (startupTunnelIds.length) {
    try {
      await configureTunnelRetryLimits(catalog, startupTunnelIds, TUNNEL_STARTUP_RETRY_LIMIT);
    } catch (error) {
      errors.push(`SSH 隧道开机恢复：${cleanError(error)}`);
      startupTunnelSet.clear();
    }
  }
  let services = 0;
  let tunnels = 0;
  for (const item of targets) {
    if (processMap.get(item.id)?.active) continue;
    const tunnel = catalog.tunnels.some((candidate) => candidate.id === item.id);
    if (tunnel && !startupTunnelSet.has(item.id)) continue;
    try {
      if (tunnel) resetTunnelRuntime(item.id);
      await processAction(catalog, item.id, "start");
      if (tunnel) tunnels += 1;
      else services += 1;
    } catch (error) {
      errors.push(`${item.name || item.id}：${cleanError(error)}`);
    }
  }
  let docker = 0;
  let dockerDesktop = false;
  if (remembered.docker.containers.length) {
    try {
      const result = await startRememberedDockerContainers(remembered.docker.containers);
      docker = result.started;
      dockerDesktop = result.desktopStarted;
      if (result.missing.length) errors.push(`Docker：未找到 ${result.missing.join("、")}`);
    }
    catch (error) { errors.push(`Docker：${cleanError(error)}`); }
  }
  invalidateState();
  return { restored: true, services, tunnels, docker, dockerDesktop, errors };
}

function captureLastSessionState(catalog) {
  if (sessionCapturePromise) return sessionCapturePromise;
  sessionCapturePromise = (async () => {
    const previous = loadLastSessionState();
    const [state, docker] = await Promise.all([
      getState(catalog, true),
      getDockerState(true)
    ]);
    const processMap = new Map(state.processes.map((item) => [item.id, item]));
    const workerReadable = state.orchestrator.workerOnline !== false;
    const services = workerReadable
      ? catalog.services.filter((item) => processMap.get(item.id)?.active).map((item) => item.id)
      : previous.services;
    const tunnels = workerReadable
      ? catalog.tunnels.filter((item) => processMap.get(item.id)?.active).map((item) => item.id)
      : previous.tunnels;
    const dockerContainers = docker.available
      ? docker.daemonOnline
        ? docker.containers.filter((item) => item.running).map(dockerContainerReference)
        : []
      : previous.docker.containers;
    const sessionState = {
      services,
      tunnels,
      docker: {
        daemonOnline: Boolean(docker.available && docker.daemonOnline),
        containers: dockerContainers
      }
    };
    const previousState = {
      services: previous.services,
      tunnels: previous.tunnels,
      docker: previous.docker
    };
    if (previous.capturedAt && JSON.stringify(sessionState) === JSON.stringify(previousState)) return previous;
    const snapshot = {
      version: 1,
      capturedAt: new Date().toISOString(),
      ...sessionState
    };
    writeLastSessionState(snapshot);
    return snapshot;
  })().finally(() => {
    sessionCapturePromise = null;
  });
  return sessionCapturePromise;
}

function loadLastSessionState() {
  const empty = {
    version: 1,
    capturedAt: "",
    services: [],
    tunnels: [],
    docker: { daemonOnline: false, containers: [] }
  };
  try {
    const value = JSON.parse(fs.readFileSync(LAST_SESSION_PATH, "utf8"));
    if (!value || Number(value.version) !== 1) return empty;
    return {
      version: 1,
      capturedAt: typeof value.capturedAt === "string" ? value.capturedAt : "",
      services: Array.isArray(value.services) ? value.services.map(String) : [],
      tunnels: Array.isArray(value.tunnels) ? value.tunnels.map(String) : [],
      docker: {
        daemonOnline: Boolean(value.docker?.daemonOnline),
        containers: Array.isArray(value.docker?.containers)
          ? value.docker.containers.map(normalizeDockerReference).filter((item) => item.id || item.name)
          : []
      }
    };
  } catch {
    return empty;
  }
}

function writeLastSessionState(snapshot) {
  fs.mkdirSync(path.dirname(LAST_SESSION_PATH), { recursive: true });
  const temporary = `${LAST_SESSION_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, LAST_SESSION_PATH);
  fs.chmodSync(LAST_SESSION_PATH, 0o600);
}

function dockerContainerReference(container) {
  return {
    id: String(container.id || ""),
    name: String(container.name || ""),
    composeProject: String(container.composeProject || ""),
    composeService: String(container.composeService || "")
  };
}

function normalizeDockerReference(reference) {
  if (typeof reference === "string") return { id: reference, name: "", composeProject: "", composeService: "" };
  return dockerContainerReference(reference || {});
}

function dockerReferenceMatches(reference, container) {
  const normalized = normalizeDockerReference(reference);
  if (normalized.id && normalized.id === container.id) return true;
  if (normalized.name && normalized.name === container.name) return true;
  return Boolean(
    normalized.composeProject
    && normalized.composeService
    && normalized.composeProject === container.composeProject
    && normalized.composeService === container.composeService
  );
}

function normalizeProcess(definition, raw = {}) {
  const rawStatus = String(raw.status || raw.state || (raw.is_running ? "running" : "unknown")).toLowerCase();
  const restarting = rawStatus.includes("restart") || rawStatus === "starting";
  const running = rawStatus.includes("running") || rawStatus.includes("ready") || Boolean(raw.is_running);
  const status = restarting
    ? "restarting"
    : running
      ? "running"
      : rawStatus.includes("disabled")
        ? "disabled"
        : rawStatus.includes("completed") || rawStatus.includes("stopped") || rawStatus.includes("exit")
          ? "stopped"
          : "unknown";
  const rawHealth = String(raw.health || raw.health_status || raw.is_ready || "").toLowerCase();
  const health = rawHealth.includes("unhealthy") || rawHealth.includes("not ready")
    ? "unhealthy"
    : rawHealth.includes("healthy") || rawHealth === "ready" || rawHealth === "true"
      ? "healthy"
      : status === "running" ? "running" : "unknown";
  return {
    id: definition.id,
    name: definition.name || definition.id,
    description: definition.description || "",
    icon: definition.icon || (definition.kind === "tunnel" ? "ssh" : "server"),
    kind: definition.kind || "service",
    namespace: definition.namespace || (definition.kind === "tunnel" ? "tunnels" : "services"),
    protected: Boolean(definition.protected),
    status,
    health,
    active: running || restarting,
    pid: running || restarting ? raw.pid || raw.process_id || null : null,
    restarts: Number(raw.restarts || raw.restart_count || 0),
    cpu: raw.cpu || raw.cpu_percent || "",
    memory: raw.memory || raw.memory_usage || raw.mem || "",
    exitCode: raw.exit_code ?? raw.exitCode ?? null,
    rawStatus,
    lastActivityAt: raw.last_activity_time || null,
    startedAt: raw.process_start_time || null,
    readyAt: raw.process_ready_time || null
  };
}

async function probeExternal(item) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1800);
  try {
    const response = await fetch(`http://${item.target}${item.healthPath || "/"}`, {
      signal: controller.signal,
      redirect: "manual",
      headers: { "User-Agent": "Local-Ops-Healthcheck/1.0" }
    });
    return {
      ...item,
      online: response.status < 500,
      statusCode: response.status,
      latencyMs: Math.round(performance.now() - started)
    };
  } catch (error) {
    return { ...item, online: false, statusCode: null, latencyMs: null, error: cleanError(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function processList(catalog, role) {
  const { stdout } = await runProcessCompose(catalog, ["process", "list", "--output", "json"], role);
  const parsed = JSON.parse(stdout || "[]");
  return Array.isArray(parsed) ? parsed : parsed.processes || [];
}

async function processLogs(catalog, id, tail) {
  const definition = assertKnownProcess(catalog, id);
  try {
    const { stdout, stderr } = await runProcessCompose(catalog, [
      "process", "logs", id, "--tail", String(tail), "--raw-log"
    ], definition.kind === "system" ? "core" : "worker");
    return stripAnsi(`${stdout}${stderr ? `\n${stderr}` : ""}`).trimEnd();
  } catch (error) {
    const text = `${error.stdout || ""}\n${error.stderr || ""}`.trim();
    if (text) return stripAnsi(text);
    throw error;
  }
}

async function processAction(catalog, id, action) {
  const definition = assertKnownProcess(catalog, id);
  const previous = processActionQueues.get(id) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    const role = definition.kind === "system" ? "core" : "worker";
    if (action === "start" || action === "stop") {
      const rawProcesses = await processList(catalog, role);
      const raw = rawProcesses.find((item) => String(item.name || item.process || item.process_name) === id);
      const current = normalizeProcess(definition, raw);
      if (action === "start" && current.active) return { skipped: true };
      if (action === "stop" && !current.active) return { skipped: true };
    }
    await runProcessCompose(catalog, ["process", action, id], role);
    return { skipped: false };
  });
  processActionQueues.set(id, task);
  try {
    return await task;
  } finally {
    if (processActionQueues.get(id) === task) processActionQueues.delete(id);
  }
}

async function launchTerminalTask(task) {
  const command = buildTerminalCommand(task);
  if (task.terminalApp === "iterm2") {
    const installed = ["/Applications/iTerm.app", path.join(os.homedir(), "Applications", "iTerm.app")].some((item) => fs.existsSync(item));
    if (!installed) throw httpError(400, "没有找到 iTerm2，请先安装或把该任务改为系统终端");
  }
  const script = buildTerminalAppleScript(task.terminalApp, command);
  try {
    await runTool("/usr/bin/osascript", ["-e", script], 20000);
  } catch (error) {
    const message = cleanError(error);
    if (/not authorized|不允许|权限/i.test(message)) {
      throw httpError(403, "macOS 尚未允许 Local Ops 控制终端，请在系统设置 → 隐私与安全性 → 自动化中授权");
    }
    throw error;
  }
}

function buildTerminalCommand(task) {
  const parts = [];
  if (task.workingDir) parts.push(`cd ${shellQuote(task.workingDir)}`);
  if (task.kind === "command") {
    parts.push(task.command);
  } else {
    const args = ["/usr/bin/ssh"];
    if (Number(task.sshPort || 22) !== 22) args.push("-p", String(task.sshPort));
    if (task.identityFile) args.push("-o", "IdentitiesOnly=yes", "-i", task.identityFile);
    if (task.localPort !== null && task.remotePort !== null) {
      args.push(
        "-N", "-T",
        "-o", "ExitOnForwardFailure=yes",
        "-o", "ServerAliveInterval=30",
        "-o", "ServerAliveCountMax=3",
        "-L", `127.0.0.1:${task.localPort}:${task.remoteHost}:${task.remotePort}`
      );
    }
    args.push(`${task.sshUser}@${task.sshHost}`);
    parts.push(renderSshCommand(args, task.passphraseRef, false));
  }
  return parts.join("; ");
}

async function preparePassphraseChange(body, existingReference, identityFile, supportsPassphrase) {
  const replacement = normalizePrivateKeyPassphrase(body.identityPassphrase);
  const remove = Boolean(body.removeIdentityPassphrase) || !supportsPassphrase;
  if (replacement && remove) throw httpError(400, "不能同时保存和删除 SSH 私钥口令");
  if (replacement && !identityFile) throw httpError(400, "保存私钥口令前必须选择 SSH 私钥文件");

  const previousReference = String(existingReference || "");
  let previousSecret = null;
  let previousSecretExists = false;
  let reference = previousReference;
  let storedReplacement = false;

  if (replacement) {
    reference ||= crypto.randomUUID();
    if (previousReference && await hasPrivateKeyPassphrase(previousReference)) {
      previousSecret = await readPrivateKeyPassphrase(previousReference);
      previousSecretExists = true;
    }
    await storePrivateKeyPassphrase(reference, replacement);
    storedReplacement = true;
    try {
      await verifyPrivateKeyPassphrase(identityFile, reference);
    } catch (error) {
      if (previousSecretExists) await storePrivateKeyPassphrase(previousReference, previousSecret);
      else await deletePrivateKeyPassphrase(reference).catch(() => {});
      throw error;
    }
  } else if (remove) {
    reference = "";
  }

  return {
    reference,
    async commit() {
      if (remove && previousReference) await cleanupPassphrase(previousReference);
    },
    async rollback() {
      if (!storedReplacement) return;
      if (previousSecretExists) await storePrivateKeyPassphrase(previousReference, previousSecret);
      else await deletePrivateKeyPassphrase(reference).catch(() => {});
    }
  };
}

async function verifyPrivateKeyPassphrase(identityFile, reference) {
  if (!fs.existsSync(identityFile)) throw httpError(400, "SSH 私钥文件不存在，请检查路径");
  try {
    await execFileAsync("/usr/bin/ssh-keygen", ["-y", "-f", identityFile], {
      cwd: ROOT,
      timeout: 15000,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        SSH_ASKPASS: SSH_ASKPASS_PATH,
        SSH_ASKPASS_REQUIRE: "force",
        DISPLAY: "local-ops:0",
        LC_ALL: "C",
        LOCAL_OPS_KEYCHAIN_HELPER: BINARIES.keychain,
        LOCAL_OPS_KEYCHAIN_ACCOUNT: reference
      }
    });
  } catch (error) {
    const detail = cleanError(error);
    if (/incorrect passphrase|bad passphrase|load failed|invalid format/i.test(detail)) {
      throw httpError(400, "SSH 私钥口令不正确，无法解锁所选私钥");
    }
    throw httpError(400, `无法验证 SSH 私钥口令：${detail || "未知错误"}`);
  }
}

async function assertPassphraseAvailable(resource) {
  if (!resource?.passphraseRef) return;
  if (!await hasPrivateKeyPassphrase(resource.passphraseRef)) {
    throw httpError(409, "该 SSH 私钥的口令在 macOS 钥匙串中不可用，请编辑资源并重新保存口令");
  }
}

async function cleanupPassphrase(reference) {
  if (!reference) return;
  try {
    await deletePrivateKeyPassphrase(reference);
  } catch (error) {
    console.warn(`Unable to remove obsolete SSH passphrase from Keychain: ${cleanError(error)}`);
  }
}

function runProcessCompose(catalog, args, role = "core") {
  const port = role === "worker" ? catalog.settings.workerComposePort : catalog.settings.processComposePort;
  return runTool(BINARIES.processCompose, [
    "--address", "127.0.0.1",
    "--port", String(port),
    "--token-file", TOKEN_PATH,
    ...args
  ]);
}

function runTool(file, args, timeout = 15000) {
  return execFileAsync(file, args, {
    cwd: ROOT,
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH || ""}`,
      NO_PROXY: appendNoProxy(process.env.NO_PROXY)
    }
  });
}

function enqueueMutation(mutator) {
  const task = mutationQueue.then(async () => {
    const before = loadCatalog();
    const next = structuredClone(before);
    mutator(next);
    validateCatalog(next);
    saveCatalog(next);
    renderRuntimeConfig(next);
    const workerChanged = JSON.stringify([before.services, before.tunnels]) !== JSON.stringify([next.services, next.tunnels]);
    const caddyChanged = JSON.stringify(caddySignature(before)) !== JSON.stringify(caddySignature(next));
    try {
      await applyRuntimeConfig(next, workerChanged, caddyChanged);
      invalidateState();
      return next;
    } catch (error) {
      saveCatalog(before);
      renderRuntimeConfig(before);
      try { await applyRuntimeConfig(before, workerChanged, caddyChanged); } catch {}
      throw error;
    }
  });
  mutationQueue = task.catch(() => {});
  return task;
}

function enqueueCatalogMutation(mutator) {
  const task = mutationQueue.then(async () => {
    const next = structuredClone(loadCatalog());
    mutator(next);
    validateCatalog(next);
    saveCatalog(next);
    return next;
  });
  mutationQueue = task.catch(() => {});
  return task;
}

async function applyRuntimeConfig(catalog, updateWorker = true, updateCaddy = true) {
  if (updateCaddy) await runTool(BINARIES.caddy, ["validate", "--config", CADDYFILE_PATH, "--adapter", "caddyfile"]);
  if (updateWorker) {
    await updateWorkerRuntimeConfig(catalog);
  }
  if (updateCaddy) {
    await runTool(BINARIES.caddy, [
      "reload", "--config", CADDYFILE_PATH, "--adapter", "caddyfile",
      "--address", `127.0.0.1:${catalog.settings.caddyAdminPort}`
    ]);
  }
}

function activeTunnelRetryLimit(id) {
  return tunnelRetryLimits.get(id);
}

function runtimeRenderOptions(catalog) {
  const ids = new Set(catalog.tunnels.map((item) => item.id));
  for (const id of tunnelRetryLimits.keys()) {
    if (!ids.has(id)) tunnelRetryLimits.delete(id);
  }
  return { tunnelRetryLimits: new Map(tunnelRetryLimits) };
}

function renderRuntimeConfig(catalog) {
  return renderAll(catalog, runtimeRenderOptions(catalog));
}

function enqueueWorkerConfig(operation) {
  const task = workerConfigQueue.catch(() => {}).then(operation);
  workerConfigQueue = task.catch(() => {});
  return task;
}

function updateWorkerRuntimeConfig(catalog) {
  return enqueueWorkerConfig(async () => {
    renderRuntimeConfig(catalog);
    await runProcessCompose(catalog, ["project", "update", "--config", WORKER_COMPOSE_PATH], "worker");
  });
}

function configureTunnelRetryLimits(catalog, ids, limit) {
  return enqueueWorkerConfig(async () => {
    const previous = new Map(ids.map((id) => [id, {
      exists: tunnelRetryLimits.has(id),
      value: tunnelRetryLimits.get(id)
    }]));
    for (const id of ids) tunnelRetryLimits.set(id, limit);
    try {
      renderRuntimeConfig(catalog);
      await runProcessCompose(catalog, ["project", "update", "--config", WORKER_COMPOSE_PATH], "worker");
    } catch (error) {
      for (const [id, state] of previous) {
        if (state.exists) tunnelRetryLimits.set(id, state.value);
        else tunnelRetryLimits.delete(id);
      }
      renderRuntimeConfig(catalog);
      throw error;
    }
  });
}

function caddySignature(catalog) {
  return {
    routes: catalog.routes.map(({ host, target, enabled }) => ({ host, target, enabled })),
    proxyPort: catalog.settings.proxyPort,
    caddyAdminPort: catalog.settings.caddyAdminPort
  };
}

function reorderCatalogList(catalog, key, requestedIds) {
  if (!Array.isArray(requestedIds)) throw httpError(400, "排序列表无效");
  const list = catalog[key];
  const movable = key === "routes" ? list.filter((item) => !item.system) : list;
  const expected = movable.map((item) => item.id);
  const ids = requestedIds.map(String);
  if (ids.length !== expected.length || new Set(ids).size !== ids.length || expected.some((id) => !ids.includes(id))) {
    throw httpError(400, "排序列表与当前资源不一致，请刷新后重试");
  }
  const byId = new Map(movable.map((item) => [item.id, item]));
  const sorted = ids.map((id) => byId.get(id));
  catalog[key] = key === "routes" ? [...list.filter((item) => item.system), ...sorted] : sorted;
}

function assertKnownProcess(catalog, id) {
  const definition = processDefinitions(catalog).find((item) => item.id === id);
  if (!definition) throw httpError(404, "没有找到该进程");
  return definition;
}

function publicCatalog(catalog) {
  return {
    settings: catalog.settings,
    services: catalog.services,
    tunnels: catalog.tunnels.map(publicSshResource),
    externalServices: catalog.externalServices,
    routes: catalog.routes.map((route) => ({ ...route, url: routeUrl(catalog, route) })),
    terminalTasks: catalog.terminalTasks.map(publicSshResource),
    systemProcesses: SYSTEM_PROCESS_DEFINITIONS
  };
}

function publicSshResource(item) {
  const result = { ...item, hasKeyPassphrase: Boolean(item.passphraseRef) };
  delete result.passphraseRef;
  return result;
}

function sshPassphraseReferences(catalog) {
  return new Set([
    ...(catalog?.tunnels || []),
    ...(catalog?.terminalTasks || [])
  ].map((item) => item.passphraseRef).filter(Boolean));
}

function isAllowedHost(host, catalog) {
  const publicPort = publicProxyPort(catalog);
  const publicHost = publicPort === 80 ? "console.localhost" : `console.localhost:${publicPort}`;
  const allowed = new Set([
    `127.0.0.1:${catalog.settings.consolePort}`,
    `localhost:${catalog.settings.consolePort}`,
    `[::1]:${catalog.settings.consolePort}`,
    `console.localhost:${catalog.settings.proxyPort}`,
    publicHost
  ]);
  return allowed.has(String(host || "").toLowerCase());
}

function assertMutationRequest(request, catalog) {
  if (request.headers["x-local-ops-token"] !== CSRF_TOKEN) {
    throw httpError(403, "控制令牌无效，请刷新页面后重试");
  }
  const origin = request.headers.origin;
  if (!origin) return;
  const publicPort = publicProxyPort(catalog);
  const publicOrigin = publicPort === 80
    ? "http://console.localhost"
    : `http://console.localhost:${publicPort}`;
  const allowedOrigins = new Set([
    `http://127.0.0.1:${catalog.settings.consolePort}`,
    `http://localhost:${catalog.settings.consolePort}`,
    `http://console.localhost:${catalog.settings.proxyPort}`,
    publicOrigin
  ]);
  if (!allowedOrigins.has(origin)) throw httpError(403, "请求来源无效");
}

async function readJson(request, limit = 262144) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > limit) throw httpError(413, "请求内容过大");
  }
  try { return JSON.parse(body || "{}"); } catch { throw httpError(400, "JSON 格式无效"); }
}

function serveStatic(requestPath, method, response) {
  const relative = requestPath === "/" ? "index.html" : decodeURIComponent(requestPath).replace(/^\/+/, "");
  const file = path.resolve(PUBLIC_DIR, relative);
  if (!file.startsWith(`${PUBLIC_DIR}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return sendJson(response, 404, { error: "页面不存在" });
  }
  response.statusCode = 200;
  response.setHeader("Content-Type", CONTENT_TYPES[path.extname(file)] || "application/octet-stream");
  response.setHeader("Cache-Control", relative === "index.html" ? "no-store" : "public, max-age=300");
  if (method === "HEAD") return response.end();
  fs.createReadStream(file).pipe(response);
}

function setSecurityHeaders(response) {
  response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function sendJson(response, status, value) {
  if (response.writableEnded) return;
  const body = JSON.stringify(value);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(body);
}

function invalidateState() {
  stateCache = { at: 0, value: null };
}

function invalidateDocker() {
  dockerCache = { at: 0, value: null };
}

function appendNoProxy(value = "") {
  const parts = new Set(String(value).split(",").map((item) => item.trim()).filter(Boolean));
  for (const item of ["127.0.0.1", "localhost", ".localhost", "::1"]) parts.add(item);
  return [...parts].join(",");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function stripAnsi(value) {
  return String(value).replace(/[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "");
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function cleanError(error) {
  return stripAnsi(error.stderr || error.message || String(error)).trim().split("\n").slice(-2).join(" · ");
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateInput(factory) {
  try {
    return factory();
  } catch (error) {
    if (error?.statusCode) throw error;
    throw httpError(400, error?.message || "请求参数无效");
  }
}

function formatFatal(error) {
  console.error(error);
  process.exitCode = 1;
}

process.on("uncaughtException", formatFatal);
process.on("unhandledRejection", formatFatal);
