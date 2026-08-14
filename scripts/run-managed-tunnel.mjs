#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";

import {
  delegatedSshNetworkCheck,
  isSshManagedConnection,
  probeTcpEndpoint,
  readTunnelNetworkState,
  resolveSshEndpoint,
  writeTunnelNetworkState
} from "../src/tunnel-network.mjs";
import { recordProcessLifecycle } from "../src/process-lifecycle.mjs";
import {
  TUNNEL_RETRY_BACKOFF_MS,
  TUNNEL_STABLE_WINDOW_MS,
  createTunnelRetryState,
  registerTunnelFailure,
  resetTunnelFailures,
  retryStateSnapshot
} from "../src/tunnel-retry-state.mjs";

const LISTENER_PROBE_TIMEOUT_MS = 1200;
const HEALTH_PROBE_TIMEOUT_MS = 10_000;
const READINESS_POLL_INTERVAL_MS = 500;

const options = parseArguments(process.argv.slice(2));
let child = null;
let stopping = false;
let stopContext = null;
let networkAttempts = 0;
const previousNetworkState = readTunnelNetworkState(options.stateFile);
let retryState = createTunnelRetryState(previousNetworkState, {
  retryLimit: options.retryLimit
});
const startedAt = new Date().toISOString();

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => stop(signal));
}

await superviseTunnel();

async function superviseTunnel() {
  if (retryState.exhausted) {
    updateState("connection_failed", {
      failedPhase: previousNetworkState?.failedPhase || previousNetworkState?.phase || "connection_failed",
      nextCheckAt: null,
      error: previousNetworkState?.error || `SSH 隧道连续失败 ${retryState.consecutiveFailures} 次，等待手动重试`
    });
    process.stderr.write(`[Local Ops] SSH 隧道已连续失败 ${retryState.consecutiveFailures} 次；保留终态并等待手动重试\n`);
    return waitUntilStopped();
  }
  while (!stopping) {
    const endpoint = await resolveSshEndpoint({
      destination: options.destination,
      host: options.host,
      port: options.port,
      sshBinary: options.sshBinary
    });
    networkAttempts += 1;
    let networkCheck;
    if (isSshManagedConnection(endpoint)) {
      networkCheck = delegatedSshNetworkCheck(endpoint, options.host);
      process.stdout.write(`[Local Ops] SSH 网络由 OpenSSH 代理配置建立：${options.host}\n`);
    } else {
      networkCheck = await probeTcpEndpoint(endpoint.host, endpoint.port);
      if (!networkCheck.ok) {
        const error = endpoint.resolutionError || networkCheck.error || "SSH 主机暂时不可连接";
        if (!registerAttemptFailure("waiting_network", error, {
          endpoint,
          networkCheck,
          exitCode: 75
        })) return waitUntilStopped();
        process.stderr.write(`[Local Ops] SSH 网络尚未就绪 ${endpoint.host}:${endpoint.port}：${error}；${formatMilliseconds(options.retryBackoffMs)}后自动重试\n`);
        await delay(options.retryBackoffMs);
        continue;
      }
      process.stdout.write(`[Local Ops] SSH 网络已就绪：${endpoint.host}:${endpoint.port}，开始连接\n`);
    }

    const outcome = await runSshAttempt(endpoint, networkCheck);
    if (stopping) {
      finishStoppedState({ endpoint, networkAttempts });
      return;
    }
    if (!registerAttemptFailure("ssh_exited", outcome.error, {
      endpoint,
      networkCheck,
      exitCode: outcome.exitCode,
      signal: outcome.signal
    })) return waitUntilStopped();
    await delay(options.retryBackoffMs);
  }
}

async function runSshAttempt(endpoint, networkCheck) {
  const shell = fs.existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/sh";
  const activeChild = spawn(shell, ["-c", options.command], {
    cwd: options.workingDir,
    env: process.env,
    stdio: "inherit"
  });
  child = activeChild;
  updateState("connecting", {
    endpoint,
    networkAttempts,
    networkCheck,
    reachableAt: networkCheck.checkedAt,
    sshPid: activeChild.pid,
    stableCandidateAt: null,
    nextCheckAt: null,
    error: ""
  });

  let settled = false;
  let resolveOutcome;
  const outcomePromise = new Promise((resolve) => { resolveOutcome = resolve; });
  const settle = (outcome) => {
    if (settled) return;
    settled = true;
    resolveOutcome(outcome);
  };
  activeChild.once("error", (error) => settle({
    exitCode: 1,
    signal: null,
    error: String(error?.message || error)
  }));
  activeChild.once("exit", (code, signal) => settle({
    exitCode: Number.isInteger(code) ? code : 1,
    signal: signal || null,
    error: signal ? `SSH 进程收到 ${signal} 后退出` : `SSH 进程已退出（exit ${Number.isInteger(code) ? code : 1}）`
  }));

  let stableCandidateAt = 0;
  let stableConfirmed = false;
  while (!settled && !stopping && !stableConfirmed) {
    const readiness = await probeManagedTunnelReadiness();
    if (settled || stopping) break;
    if (!readiness.ok) {
      stableCandidateAt = 0;
      updateState("connecting", {
        endpoint,
        networkAttempts,
        networkCheck,
        sshPid: activeChild.pid,
        listenerCheck: readiness.listenerCheck,
        readinessCheck: readiness.readinessCheck,
        stableCandidateAt: null,
        error: readiness.error
      });
    } else if (!stableCandidateAt) {
      stableCandidateAt = Date.now();
      updateState("stabilizing", {
        endpoint,
        networkAttempts,
        networkCheck,
        sshPid: activeChild.pid,
        listenerCheck: readiness.listenerCheck,
        readinessCheck: readiness.readinessCheck,
        stableCandidateAt: new Date(stableCandidateAt).toISOString(),
        error: ""
      });
    } else if (Date.now() - stableCandidateAt >= options.stableWindowMs) {
      retryState = resetTunnelFailures(retryState);
      stableConfirmed = true;
      updateState("connected", {
        endpoint,
        networkAttempts,
        networkCheck,
        sshPid: activeChild.pid,
        listenerCheck: readiness.listenerCheck,
        readinessCheck: readiness.readinessCheck,
        stableCandidateAt: new Date(stableCandidateAt).toISOString(),
        connectedAt: retryState.stableAt,
        error: ""
      });
      process.stdout.write(`[Local Ops] SSH 隧道已连续稳定 ${formatMilliseconds(options.stableWindowMs)}，连续失败计数已清零\n`);
      break;
    }
    if (!stableConfirmed) {
      await Promise.race([outcomePromise, delay(options.readinessPollIntervalMs)]);
    }
  }

  const outcome = await outcomePromise;
  if (child === activeChild) child = null;
  return outcome;
}

async function probeManagedTunnelReadiness() {
  const listenerCheck = await probeTcpEndpoint(
    options.bindAddress,
    options.localPort,
    options.listenerProbeTimeoutMs
  );
  if (!listenerCheck.ok) {
    return {
      ok: false,
      listenerCheck,
      readinessCheck: unconfiguredReadiness(),
      error: listenerCheck.error || "本地监听端口尚未就绪"
    };
  }
  if (!options.healthUrl) {
    return { ok: true, listenerCheck, readinessCheck: unconfiguredReadiness(), error: "" };
  }
  const readinessCheck = await probeHttpReadiness(options.healthUrl, options.healthProbeTimeoutMs);
  return {
    ok: readinessCheck.ok,
    listenerCheck,
    readinessCheck,
    error: readinessCheck.error || ""
  };
}

async function probeHttpReadiness(url, timeoutMs) {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs)
    });
    const statusCode = response.status;
    await response.body?.cancel().catch(() => {});
    const ok = statusCode >= 100 && statusCode <= 499;
    return {
      configured: true,
      mode: "http",
      target: url,
      ok,
      statusCode,
      latencyMs: Math.round(performance.now() - started),
      error: ok ? "" : `HTTP ${statusCode}`
    };
  } catch (error) {
    return {
      configured: true,
      mode: "http",
      target: url,
      ok: false,
      statusCode: null,
      latencyMs: null,
      error: String(error?.cause?.message || error?.message || error || "HTTP 健康检查失败")
    };
  }
}

function unconfiguredReadiness() {
  return {
    configured: false,
    mode: "none",
    target: "",
    ok: true,
    statusCode: null,
    latencyMs: null,
    error: ""
  };
}

function registerAttemptFailure(phase, error, details = {}) {
  retryState = registerTunnelFailure(retryState);
  const nextCheckAt = retryState.shouldRetry
    ? new Date(Date.now() + options.retryBackoffMs).toISOString()
    : null;
  const nextPhase = retryState.exhausted
    ? "connection_failed"
    : phase === "waiting_network"
      ? "waiting_network"
      : "retrying";
  updateState(nextPhase, {
    ...details,
    failedPhase: phase,
    nextCheckAt,
    error
  });
  if (retryState.exhausted) {
    process.stderr.write(`[Local Ops] SSH 隧道连续失败 ${retryState.consecutiveFailures} 次，已达到上限；等待手动重试\n`);
    return false;
  }
  process.stderr.write(`[Local Ops] SSH 隧道连续失败 ${retryState.consecutiveFailures}/${retryState.retryLimit}，${formatMilliseconds(options.retryBackoffMs)}后重试\n`);
  return true;
}

function waitUntilStopped() {
  return new Promise(() => {
    const keepAlive = setInterval(() => {}, 60_000);
    keepAlive.ref();
  });
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  stopContext = resolveStopContext(signal);
  if (!child) {
    finishStoppedState();
    process.exit(0);
  }
  const activeChild = child;
  activeChild.kill(signal === "SIGHUP" ? "SIGTERM" : signal);
  const forceTimer = setTimeout(() => {
    if (activeChild.exitCode == null) activeChild.kill("SIGKILL");
  }, 2000);
  forceTimer.unref();
}

function resolveStopContext(signal) {
  const state = readTunnelNetworkState(options.stateFile);
  if (state?.phase === "stopping" && state.stopReason && state.requestedBy) {
    return {
      requestedBy: state.requestedBy,
      stopReason: state.stopReason,
      stopRequestedAt: state.stopRequestedAt || state.updatedAt || new Date().toISOString(),
      signal
    };
  }
  return {
    requestedBy: "orchestrator",
    stopReason: `signal:${signal}`,
    stopRequestedAt: new Date().toISOString(),
    signal
  };
}

function finishStoppedState(details = {}) {
  const stoppedAt = new Date().toISOString();
  const context = stopContext || resolveStopContext("unknown");
  updateState("stopped", {
    ...details,
    ...context,
    stoppedAt,
    nextCheckAt: null,
    error: ""
  });
  recordProcessLifecycle(options.lifecycleFile, {
    id: options.id,
    kind: "tunnel",
    action: "stop",
    requestedBy: context.requestedBy,
    reason: context.stopReason,
    at: stoppedAt
  });
}

function updateState(phase, details = {}) {
  writeTunnelNetworkState(options.stateFile, {
    version: 2,
    tunnelId: options.id,
    wrapperPid: process.pid,
    startedAt,
    updatedAt: new Date().toISOString(),
    phase,
    configuredHost: options.host,
    configuredPort: options.port,
    bindAddress: options.bindAddress,
    localPort: options.localPort,
    ...retryStateSnapshot(retryState),
    ...details
  });
}

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) fail(`无效参数：${key || ""}`);
    values.set(key.slice(2), value);
  }
  for (const key of ["id", "state", "lifecycle", "host", "port", "bind-address", "local-port", "retry-limit", "destination", "command", "working-dir"]) {
    if (!values.get(key)) fail(`缺少参数 --${key}`);
  }
  const port = validPort(values.get("port"), "SSH 端口无效");
  const localPort = validPort(values.get("local-port"), "本地监听端口无效");
  const retryLimit = positiveInteger(values.get("retry-limit"), "SSH 重试次数无效");
  return {
    id: values.get("id"),
    stateFile: values.get("state"),
    lifecycleFile: values.get("lifecycle"),
    host: values.get("host"),
    port,
    bindAddress: values.get("bind-address"),
    localPort,
    healthUrl: values.get("health-url") || "",
    retryLimit,
    stableWindowMs: nonNegativeInteger(values.get("stable-window-ms"), TUNNEL_STABLE_WINDOW_MS),
    retryBackoffMs: positiveInteger(values.get("retry-backoff-ms"), "SSH 重试间隔无效", TUNNEL_RETRY_BACKOFF_MS),
    readinessPollIntervalMs: positiveInteger(values.get("readiness-poll-ms"), "就绪检查间隔无效", READINESS_POLL_INTERVAL_MS),
    listenerProbeTimeoutMs: positiveInteger(values.get("listener-probe-timeout-ms"), "监听检查超时无效", LISTENER_PROBE_TIMEOUT_MS),
    healthProbeTimeoutMs: positiveInteger(values.get("health-probe-timeout-ms"), "健康检查超时无效", HEALTH_PROBE_TIMEOUT_MS),
    destination: values.get("destination"),
    command: values.get("command"),
    workingDir: values.get("working-dir"),
    sshBinary: values.get("ssh-binary") || "/usr/bin/ssh"
  };
}

function validPort(value, message) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(message);
  return port;
}

function positiveInteger(value, message, fallback = null) {
  if ((value === undefined || value === "") && fallback != null) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) fail(message);
  return number;
}

function nonNegativeInteger(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) fail("稳定窗口无效");
  return number;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatMilliseconds(milliseconds) {
  const seconds = milliseconds / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} 秒`;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
