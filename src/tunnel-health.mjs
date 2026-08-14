import net from "node:net";

import {
  TUNNEL_RESTART_BACKOFF_SECONDS,
  tunnelNetworkStatePath,
  tunnelRetryLimit
} from "./config.mjs";
import { readTunnelNetworkState } from "./tunnel-network.mjs";

const CONNECTING_WINDOW_MS = 5000;
const HTTP_PROBE_TIMEOUT_MS = 10000;
const TCP_PROBE_TIMEOUT_MS = 1500;
const ACTIVE_NETWORK_WAIT_MAX_AGE_MS = 12000;
const DOMAIN_RETRY_INTERVAL_MS = TUNNEL_RESTART_BACKOFF_SECONDS * 1000;
const DOMAIN_RECOVERY_PROBE_INTERVAL_MS = 30000;
const runtimeById = new Map();
const probesInFlight = new Map();

export async function enrichTunnelProcess(definition, process, options = {}) {
  const now = Number(options.now || Date.now());
  const runtime = runtimeFor(definition.id);
  const rawStatus = String(process.rawStatus || "").toLowerCase();
  const entryRoutes = Array.isArray(options.entryRoutes) ? options.entryRoutes : [];
  const httpProbeTimeoutMs = positiveMilliseconds(options.httpProbeTimeoutMs, HTTP_PROBE_TIMEOUT_MS);
  const domainRecoveryProbeIntervalMs = positiveMilliseconds(
    options.domainRecoveryProbeIntervalMs,
    DOMAIN_RECOVERY_PROBE_INTERVAL_MS
  );
  const networkState = currentNetworkState(
    options.networkStateFile || tunnelNetworkStatePath(definition.id),
    process,
    now
  );
  definition = {
    ...definition,
    retryLimit: tunnelRetryLimit(options.retryLimit ?? networkState?.retryLimit),
    consecutiveFailures: Number.isFinite(Number(networkState?.consecutiveFailures))
      ? Math.max(0, Number(networkState.consecutiveFailures))
      : null
  };
  const networkCheck = networkCheckDescriptor(definition, networkState);

  if (process.status === "disabled" || rawStatus.includes("disabled")) {
    resetInactiveRuntime(runtime);
    return tunnelResult(definition, process, runtime, {
      status: "stopped",
      active: false,
      health: "unknown",
      healthCheck: healthCheckDescriptor(definition),
      readinessCheck: readinessCheckDescriptor(definition),
      networkCheck,
      domainEntry: unavailableDomainEntry(entryRoutes, "SSH 隧道已停止")
    });
  }

  if (process.status === "stopped" && !process.active) {
    if (isTerminalTunnelFailure(process, rawStatus)) {
      await rememberProcessFailure(runtime, process, options.readLogs, now);
      return tunnelResult(definition, process, runtime, {
        status: "connection_failed",
        active: false,
        health: "unhealthy",
        healthCheck: healthCheckDescriptor(definition),
        readinessCheck: readinessCheckDescriptor(definition),
        networkCheck,
        domainEntry: unavailableDomainEntry(entryRoutes, "SSH 隧道连接失败")
      });
    }
    resetInactiveRuntime(runtime);
    return tunnelResult(definition, process, runtime, {
      status: "stopped",
      active: false,
      health: "unknown",
      healthCheck: healthCheckDescriptor(definition),
      readinessCheck: readinessCheckDescriptor(definition),
      networkCheck,
      domainEntry: unavailableDomainEntry(entryRoutes, "SSH 隧道已停止")
    });
  }

  if (process.status === "restarting" || (process.active && process.status !== "running")) {
    runtime.connected = false;
    runtime.nextRetryAt = estimateNextRetry(process.lastActivityAt, now);
    if (typeof options.readLogs === "function" && runtime.lastLogActivity !== process.lastActivityAt) {
      runtime.lastLogActivity = process.lastActivityAt || String(now);
      const loggedError = latestTunnelError(await safeReadLogs(options.readLogs));
      if (loggedError) rememberError(runtime, loggedError, now);
    }
    if (!runtime.lastError) {
      rememberError(runtime, process.exitCode == null
        ? "SSH 连接失败，等待自动重试"
        : `SSH 进程已退出（exit ${process.exitCode}），等待自动重试`, now);
    }
    return tunnelResult(definition, process, runtime, {
      status: "retrying",
      active: true,
      health: "unhealthy",
      healthCheck: healthCheckDescriptor(definition),
      readinessCheck: readinessCheckDescriptor(definition),
      networkCheck,
      domainEntry: unavailableDomainEntry(entryRoutes, "SSH 隧道正在重试")
    });
  }

  if (process.status !== "running") {
    runtime.connected = false;
    runtime.nextRetryAt = null;
    if (!process.active && (rawStatus.includes("error") || rawStatus.includes("fail"))) {
      await rememberProcessFailure(runtime, process, options.readLogs, now);
      return tunnelResult(definition, process, runtime, {
        status: "connection_failed",
        active: false,
        health: "unhealthy",
        healthCheck: healthCheckDescriptor(definition),
        readinessCheck: readinessCheckDescriptor(definition),
        networkCheck,
        domainEntry: unavailableDomainEntry(entryRoutes, "SSH 隧道连接失败")
      });
    }
    return tunnelResult(definition, process, runtime, {
      status: rawStatus.includes("disable") ? "stopped" : "unknown",
      active: Boolean(process.active),
      health: "unknown",
      healthCheck: healthCheckDescriptor(definition),
      readinessCheck: readinessCheckDescriptor(definition),
      networkCheck,
      domainEntry: unavailableDomainEntry(entryRoutes, "SSH 隧道尚未连接")
    });
  }

  if (runtime.lastPid !== process.pid) {
    runtime.lastPid = process.pid || null;
    runtime.firstSeenAt = now;
    runtime.connected = false;
    resetDomainRetry(runtime);
  }

  if (networkState?.phase === "waiting_network") {
    runtime.connected = false;
    runtime.nextRetryAt = networkState.nextCheckAt || new Date(now + TUNNEL_RESTART_BACKOFF_SECONDS * 1000).toISOString();
    rememberError(runtime, networkState.error || "SSH 主机暂时不可连接，等待网络恢复", now);
    return tunnelResult(definition, process, runtime, {
      status: "waiting_network",
      active: true,
      health: "waiting",
      healthCheck: healthCheckDescriptor(definition),
      readinessCheck: readinessCheckDescriptor(definition),
      networkCheck,
      domainEntry: unavailableDomainEntry(entryRoutes, "正在等待 SSH 网络")
    });
  }

  if (["retrying", "ssh_exited"].includes(networkState?.phase)) {
    runtime.connected = false;
    runtime.nextRetryAt = networkState.nextCheckAt || new Date(now + TUNNEL_RESTART_BACKOFF_SECONDS * 1000).toISOString();
    rememberError(runtime, networkState.error || "SSH 连接失败，等待自动重试", now);
    return tunnelResult(definition, process, runtime, {
      status: "retrying",
      active: true,
      health: "unhealthy",
      healthCheck: networkHealthDescriptor(definition, networkState),
      readinessCheck: networkReadinessDescriptor(definition, networkState),
      networkCheck,
      domainEntry: unavailableDomainEntry(entryRoutes, "SSH 隧道正在重试")
    });
  }

  if (networkState?.phase === "connection_failed") {
    runtime.connected = false;
    runtime.nextRetryAt = null;
    rememberError(runtime, networkState.error || "SSH 隧道连续失败次数已达到上限", now);
    return tunnelResult(definition, process, runtime, {
      status: "connection_failed",
      active: true,
      health: "unhealthy",
      healthCheck: networkHealthDescriptor(definition, networkState),
      readinessCheck: networkReadinessDescriptor(definition, networkState),
      networkCheck,
      domainEntry: unavailableDomainEntry(entryRoutes, "SSH 隧道连接失败")
    });
  }

  if (["connecting", "stabilizing"].includes(networkState?.phase)) {
    runtime.connected = false;
    runtime.nextRetryAt = null;
    return tunnelResult(definition, process, runtime, {
      status: "connecting",
      active: true,
      health: networkState.phase === "stabilizing" ? "waiting" : "unhealthy",
      healthCheck: networkHealthDescriptor(definition, networkState),
      readinessCheck: networkReadinessDescriptor(definition, networkState),
      networkCheck,
      domainEntry: unavailableDomainEntry(entryRoutes, "SSH 隧道正在确认稳定状态")
    });
  }

  const probe = await probeTunnel(definition);
  runtime.lastProbe = probe;
  runtime.nextRetryAt = null;
  if (probe.ok) {
    if (!runtime.connected) runtime.lastSuccessAt = new Date(now).toISOString();
    runtime.connected = true;
    const readinessCheck = await probeTunnelReadiness(definition, { timeoutMs: httpProbeTimeoutMs });
    const domainProbeDueAt = nextDomainProbeAt(runtime, domainRecoveryProbeIntervalMs);
    if (domainProbeDueAt && now < domainProbeDueAt) {
      runtime.nextRetryAt = new Date(domainProbeDueAt).toISOString();
      const domainEntry = runtime.lastDomainEntry || unavailableDomainEntry(entryRoutes, runtime.lastDomainError || "域名入口连接失败");
      return tunnelResult(definition, process, runtime, {
        status: runtime.domainTerminal ? "connection_failed" : "retrying",
        active: true,
        health: "degraded",
        healthCheck: probe,
        readinessCheck,
        networkCheck,
        domainEntry: domainRetryDescriptor(domainEntry, runtime, definition)
      });
    }
    const domainEntry = await probeDomainEntries(entryRoutes, { timeoutMs: httpProbeTimeoutMs });
    rememberDomainEntry(runtime, domainEntry, now);
    if (domainEntry.configured && !domainEntry.ready) {
      const exhausted = registerDomainFailure(
        runtime,
        definition,
        now,
        domainRecoveryProbeIntervalMs
      );
      return tunnelResult(definition, process, runtime, {
        status: exhausted ? "connection_failed" : "retrying",
        active: true,
        health: "degraded",
        healthCheck: probe,
        readinessCheck,
        networkCheck,
        domainEntry: domainRetryDescriptor(domainEntry, runtime, definition)
      });
    }
    resetDomainRetry(runtime);
    return tunnelResult(definition, process, runtime, {
      status: "connected",
      active: true,
      health: (!readinessCheck.ok || (domainEntry.configured && !domainEntry.ready)) ? "degraded" : "healthy",
      healthCheck: probe,
      readinessCheck,
      networkCheck,
      domainEntry
    });
  }

  rememberError(runtime, probe.error || "隧道健康检查失败", now);
  runtime.connected = false;
  const connecting = now - runtime.firstSeenAt < CONNECTING_WINDOW_MS && Number(process.restarts || 0) === 0;
  if (!connecting) runtime.nextRetryAt = new Date(now + TUNNEL_RESTART_BACKOFF_SECONDS * 1000).toISOString();
  return tunnelResult(definition, process, runtime, {
    status: connecting ? "connecting" : "retrying",
    active: true,
    health: "unhealthy",
    healthCheck: probe,
    readinessCheck: readinessCheckDescriptor(definition),
    networkCheck,
    domainEntry: unavailableDomainEntry(entryRoutes, "SSH 隧道尚未通过健康检查")
  });
}

function isTerminalTunnelFailure(process, rawStatus) {
  if (rawStatus.includes("error") || rawStatus.includes("fail")) return true;
  const exitCode = Number(process.exitCode);
  return Number.isFinite(exitCode) && exitCode !== 0;
}

async function rememberProcessFailure(runtime, process, readLogs, now) {
  if (typeof readLogs === "function") {
    const loggedError = latestTunnelError(await safeReadLogs(readLogs));
    if (loggedError) rememberError(runtime, loggedError, now);
  }
  if (!runtime.lastError) {
    const exitCode = Number(process.exitCode);
    rememberError(runtime, Number.isFinite(exitCode)
      ? `SSH 连接失败（exit ${exitCode}）`
      : "SSH 隧道连接失败", now);
  }
  runtime.connected = false;
  runtime.nextRetryAt = null;
}

export function pruneTunnelRuntime(ids) {
  const keep = new Set(ids);
  for (const id of runtimeById.keys()) {
    if (!keep.has(id)) runtimeById.delete(id);
  }
}

export function resetTunnelRuntime(id) {
  if (id) runtimeById.delete(id);
  else runtimeById.clear();
}

export function resetTunnelDomainRuntime(id) {
  if (!id) return false;
  const runtime = runtimeById.get(id);
  if (!runtime) return false;
  resetDomainRetry(runtime);
  runtime.nextRetryAt = null;
  return true;
}

export function latestTunnelError(logs) {
  const lines = String(logs || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidate = [...lines].reverse().find((line) => (
    /ssh:|connect|timed out|timeout|refused|resolve|permission denied|address already in use|forwarding failed|remote host|broken pipe|closed/i.test(line)
  )) || lines.at(-1) || "";
  return candidate.slice(-480);
}

export async function probeTunnel(definition, options = {}) {
  const timeoutMs = positiveMilliseconds(options.timeoutMs, TCP_PROBE_TIMEOUT_MS);
  return cachedProbe(`tunnel:${definition.id}:tcp:${timeoutMs}`, () => (
    probeTcp(definition.bindAddress || "127.0.0.1", Number(definition.localPort), timeoutMs)
  ));
}

export async function probeTunnelReadiness(definition, options = {}) {
  if (!definition.healthUrl) return readinessCheckDescriptor(definition);
  const timeoutMs = positiveMilliseconds(options.timeoutMs, HTTP_PROBE_TIMEOUT_MS);
  return cachedProbe(`tunnel-readiness:${definition.id}:${timeoutMs}`, async () => ({
    configured: true,
    ...(await probeHttp(definition.healthUrl, {
      maximumSuccessStatus: 499,
      timeoutMs
    }))
  }));
}

export async function probeDomainEntries(routes, options = {}) {
  const configured = Array.isArray(routes) && routes.length > 0;
  if (!configured) return unavailableDomainEntry([], "");
  const timeoutMs = positiveMilliseconds(options.timeoutMs, HTTP_PROBE_TIMEOUT_MS);
  const checks = await Promise.all(routes.map(async (route) => {
    if (route.enabled === false) {
      return entryCheckDescriptor(route, { error: "域名入口未启用" });
    }
    const result = await cachedProbe(`entry:${route.id}:${route.url}:${timeoutMs}`, () => (
      probeHttp(route.url, {
        maximumSuccessStatus: 399,
        acceptedStatuses: [401, 403],
        timeoutMs
      })
    ));
    return entryCheckDescriptor(route, result);
  }));
  const ready = checks.length > 0 && checks.every((item) => item.ok);
  return {
    configured: true,
    ready,
    status: ready ? "ready" : "not_ready",
    target: checks[0]?.target || "",
    checks,
    error: checks.find((item) => !item.ok)?.error || ""
  };
}

function runtimeFor(id) {
  if (!runtimeById.has(id)) {
    runtimeById.set(id, {
      connected: false,
      firstSeenAt: 0,
      lastPid: null,
      lastSuccessAt: null,
      lastError: "",
      lastErrorAt: null,
      lastLogActivity: "",
      nextRetryAt: null,
      lastProbe: null,
      lastDomainReadyAt: null,
      lastDomainError: "",
      lastDomainErrorAt: null,
      lastDomainEntry: null,
      domainFailureCount: 0,
      domainLastAttemptAt: 0,
      domainTerminal: false
    });
  }
  return runtimeById.get(id);
}

function resetInactiveRuntime(runtime) {
  runtime.connected = false;
  runtime.firstSeenAt = 0;
  runtime.lastPid = null;
  runtime.nextRetryAt = null;
  resetDomainRetry(runtime);
}

function tunnelResult(definition, process, runtime, overrides) {
  const domainEntry = overrides.domainEntry || unavailableDomainEntry([], "");
  const connected = overrides.status === "connected" && Boolean(overrides.healthCheck?.ok);
  const readinessCheck = overrides.readinessCheck || readinessCheckDescriptor(definition);
  const connectionFailureActive = overrides.status === "connection_failed" && !Boolean(overrides.healthCheck?.ok);
  const domainFailureActive = Boolean(domainEntry.configured)
    && !Boolean(domainEntry.ready)
    && Boolean(domainEntry.terminal);
  const historicalConnectionError = runtime.lastError || "";
  const historicalDomainError = runtime.lastDomainError || domainEntry.error || "";
  return {
    ...process,
    ...overrides,
    connectionStatus: overrides.status,
    fullyAvailable: connected && readinessCheck.ok && (!domainEntry.configured || domainEntry.ready),
    lastConnectionError: connectionFailureActive ? historicalConnectionError : "",
    lastConnectionErrorAt: connectionFailureActive ? runtime.lastErrorAt : null,
    lastConnectedAt: runtime.lastSuccessAt,
    retryCount: definition.consecutiveFailures == null
      ? Number(process.restarts || 0)
      : definition.consecutiveFailures,
    retryLimit: Number(definition.retryLimit || tunnelRetryLimit(definition)),
    nextRetryAt: runtime.nextRetryAt,
    networkCheck: overrides.networkCheck || networkCheckDescriptor(definition, null),
    healthCheck: overrides.healthCheck || runtime.lastProbe || healthCheckDescriptor(definition),
    readinessCheck,
    domainEntry: {
      ...domainEntry,
      lastReadyAt: runtime.lastDomainReadyAt,
      lastError: domainFailureActive ? historicalDomainError : "",
      lastErrorAt: domainFailureActive ? runtime.lastDomainErrorAt : null
    },
    diagnostics: {
      lastConnectionError: historicalConnectionError,
      lastConnectionErrorAt: runtime.lastErrorAt,
      lastDomainError: historicalDomainError,
      lastDomainErrorAt: runtime.lastDomainErrorAt
    }
  };
}

function healthCheckDescriptor(definition) {
  return {
    mode: "tcp",
    target: `tcp://${definition.bindAddress || "127.0.0.1"}:${definition.localPort}`,
    ok: false,
    statusCode: null,
    latencyMs: null,
    error: ""
  };
}

function readinessCheckDescriptor(definition) {
  return {
    configured: Boolean(definition.healthUrl),
    mode: definition.healthUrl ? "http" : "none",
    target: definition.healthUrl || "",
    ok: !definition.healthUrl,
    statusCode: null,
    latencyMs: null,
    error: ""
  };
}

function networkHealthDescriptor(definition, state) {
  const check = state?.listenerCheck || {};
  return {
    mode: "tcp",
    target: check.target || `tcp://${definition.bindAddress || "127.0.0.1"}:${definition.localPort}`,
    ok: Boolean(check.ok),
    statusCode: null,
    latencyMs: check.latencyMs ?? null,
    error: check.error || ""
  };
}

function networkReadinessDescriptor(definition, state) {
  const check = state?.readinessCheck;
  if (!check || typeof check !== "object") return readinessCheckDescriptor(definition);
  return {
    configured: Boolean(check.configured),
    mode: check.mode || (check.configured ? "http" : "none"),
    target: check.target || definition.healthUrl || "",
    ok: Boolean(check.ok),
    statusCode: check.statusCode ?? null,
    latencyMs: check.latencyMs ?? null,
    error: check.error || ""
  };
}

function networkCheckDescriptor(definition, state) {
  const endpoint = state?.endpoint || {};
  const check = state?.networkCheck || {};
  const delegated = Boolean(check.delegated || check.mode === "ssh-managed");
  return {
    mode: delegated ? "ssh-managed" : "ssh-host-tcp",
    delegated,
    proxyJump: check.proxyJump || endpoint.proxyJump || "",
    proxyCommand: check.proxyCommand || endpoint.proxyCommand || "",
    target: delegated
      ? (check.target || definition.sshHost)
      : endpoint.host
        ? `${endpoint.host}:${endpoint.port || definition.sshPort || 22}`
        : `${definition.sshHost}:${definition.sshPort || 22}`,
    configuredTarget: `${definition.sshHost}:${definition.sshPort || 22}`,
    resolvedHost: endpoint.host || "",
    resolvedPort: Number(endpoint.port || definition.sshPort || 22),
    ok: state?.phase === "waiting_network" ? false : delegated ? null : Boolean(check.ok),
    checkedAt: check.checkedAt || null,
    latencyMs: check.latencyMs ?? null,
    attempts: Number(state?.networkAttempts || 0),
    error: state?.phase === "waiting_network" ? (state.error || check.error || "SSH 主机暂时不可连接") : "",
    nextCheckAt: state?.nextCheckAt || null
  };
}

function currentNetworkState(file, process, now) {
  const state = readTunnelNetworkState(file);
  if (!state || Number(state.wrapperPid) !== Number(process.pid)) return null;
  if (state.phase !== "waiting_network") return state;
  const age = now - Date.parse(state.updatedAt || "");
  return Number.isFinite(age) && age >= 0 && age < ACTIVE_NETWORK_WAIT_MAX_AGE_MS ? state : null;
}

function unavailableDomainEntry(routes, error) {
  const checks = (routes || []).map((route) => entryCheckDescriptor(route, { error }));
  return {
    configured: checks.length > 0,
    ready: false,
    status: checks.length ? "not_ready" : "not_configured",
    target: checks[0]?.target || "",
    checks,
    error: checks.length ? error : ""
  };
}

function entryCheckDescriptor(route, result = {}) {
  return {
    id: route.id,
    name: route.name,
    mode: "http-entry",
    target: route.url,
    enabled: route.enabled !== false,
    ok: Boolean(result.ok),
    statusCode: result.statusCode ?? null,
    latencyMs: result.latencyMs ?? null,
    error: result.error || ""
  };
}

function rememberDomainEntry(runtime, entry, now) {
  runtime.lastDomainEntry = entry;
  if (!entry.configured) return;
  if (entry.ready) {
    runtime.lastDomainReadyAt = new Date(now).toISOString();
    return;
  }
  const message = String(entry.error || "域名入口尚未就绪").trim().slice(0, 480);
  if (runtime.lastDomainError !== message) runtime.lastDomainErrorAt = new Date(now).toISOString();
  runtime.lastDomainError = message;
}

function registerDomainFailure(runtime, definition, now, recoveryProbeIntervalMs) {
  if (!runtime.domainLastAttemptAt || now - runtime.domainLastAttemptAt >= DOMAIN_RETRY_INTERVAL_MS - 250) {
    runtime.domainFailureCount += 1;
    runtime.domainLastAttemptAt = now;
  }
  const exhausted = runtime.domainFailureCount > tunnelRetryLimit(definition);
  runtime.domainTerminal = exhausted;
  runtime.nextRetryAt = exhausted
    ? new Date(now + recoveryProbeIntervalMs).toISOString()
    : new Date(now + DOMAIN_RETRY_INTERVAL_MS).toISOString();
  return exhausted;
}

function nextDomainProbeAt(runtime, recoveryProbeIntervalMs) {
  if (!runtime.domainFailureCount || !runtime.domainLastAttemptAt) return 0;
  const interval = runtime.domainTerminal
    ? recoveryProbeIntervalMs
    : DOMAIN_RETRY_INTERVAL_MS;
  return runtime.domainLastAttemptAt + interval;
}

function domainRetryDescriptor(entry, runtime, definition) {
  return {
    ...entry,
    retryCount: Math.max(0, runtime.domainFailureCount - 1),
    retryLimit: tunnelRetryLimit(definition),
    retrying: !runtime.domainTerminal,
    terminal: runtime.domainTerminal,
    nextRetryAt: runtime.nextRetryAt
  };
}

function resetDomainRetry(runtime) {
  runtime.domainFailureCount = 0;
  runtime.domainLastAttemptAt = 0;
  runtime.domainTerminal = false;
  runtime.lastDomainEntry = null;
}

function estimateNextRetry(lastActivityAt, now) {
  let next = Date.parse(lastActivityAt || "") + TUNNEL_RESTART_BACKOFF_SECONDS * 1000;
  if (!Number.isFinite(next)) next = now + TUNNEL_RESTART_BACKOFF_SECONDS * 1000;
  while (next <= now) next += TUNNEL_RESTART_BACKOFF_SECONDS * 1000;
  return new Date(next).toISOString();
}

function rememberError(runtime, error, now) {
  const message = String(error || "").trim().slice(0, 480);
  if (!message) return;
  if (runtime.lastError !== message) runtime.lastErrorAt = new Date(now).toISOString();
  runtime.lastError = message;
}

async function safeReadLogs(readLogs) {
  try {
    return await readLogs();
  } catch {
    return "";
  }
}

async function cachedProbe(key, factory) {
  const existing = probesInFlight.get(key);
  if (existing) return existing;
  const probe = Promise.resolve().then(factory);
  probesInFlight.set(key, probe);
  try {
    return await probe;
  } finally {
    if (probesInFlight.get(key) === probe) probesInFlight.delete(key);
  }
}

async function probeHttp(url, {
  maximumSuccessStatus,
  acceptedStatuses = [],
  timeoutMs = HTTP_PROBE_TIMEOUT_MS
}) {
  timeoutMs = positiveMilliseconds(timeoutMs, HTTP_PROBE_TIMEOUT_MS);
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "manual",
      headers: { "User-Agent": "Local-Ops-Tunnel-Health/1.0" }
    });
    const ok = (
      (response.status >= 100 && response.status <= maximumSuccessStatus)
      || acceptedStatuses.includes(response.status)
    );
    response.body?.cancel().catch(() => {});
    return {
      mode: "http",
      target: url,
      ok,
      statusCode: response.status,
      latencyMs: Math.round(performance.now() - started),
      error: ok ? "" : `HTTP ${response.status} ${response.statusText || ""}`.trim()
    };
  } catch (error) {
    return {
      mode: "http",
      target: url,
      ok: false,
      statusCode: null,
      latencyMs: null,
      error: error?.name === "AbortError"
        ? `HTTP 健康检查超时（${formatSeconds(timeoutMs)} 秒）`
        : cleanProbeError(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

function probeTcp(host, port, timeoutMs = TCP_PROBE_TIMEOUT_MS) {
  const started = performance.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        mode: "tcp",
        target: `tcp://${host}:${port}`,
        statusCode: null,
        latencyMs: result.ok ? Math.round(performance.now() - started) : null,
        ...result
      });
    };
    socket.setTimeout(timeoutMs, () => finish({ ok: false, error: `TCP 健康检查超时（${formatSeconds(timeoutMs)} 秒）` }));
    socket.once("connect", () => finish({ ok: true, error: "" }));
    socket.once("error", (error) => finish({ ok: false, error: cleanProbeError(error) }));
  });
}

function cleanProbeError(error) {
  const code = String(error?.cause?.code || error?.code || "").trim();
  const message = String(error?.cause?.message || error?.message || error || "健康检查失败").trim();
  return code && !message.includes(code) ? `${code}: ${message}` : message;
}

function positiveMilliseconds(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatSeconds(milliseconds) {
  const seconds = milliseconds / 1000;
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}
