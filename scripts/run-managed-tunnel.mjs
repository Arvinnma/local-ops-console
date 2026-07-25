#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";

import {
  NETWORK_RETRY_INTERVAL_MS,
  probeTcpEndpoint,
  readTunnelNetworkState,
  resolveSshEndpoint,
  writeTunnelNetworkState
} from "../src/tunnel-network.mjs";
import { recordProcessLifecycle } from "../src/process-lifecycle.mjs";

const options = parseArguments(process.argv.slice(2));
let child = null;
let stopping = false;
let stopContext = null;
let networkAttempts = 0;
const startedAt = new Date().toISOString();

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => stop(signal));
}

await waitForNetworkAndRun();

async function waitForNetworkAndRun() {
  if (stopping) return;
  const endpoint = await resolveSshEndpoint({
    destination: options.destination,
    host: options.host,
    port: options.port,
    sshBinary: options.sshBinary
  });
  const probe = await probeTcpEndpoint(endpoint.host, endpoint.port);
  networkAttempts = 1;
  if (probe.ok) {
    updateState("connecting", {
      endpoint,
      networkAttempts,
      networkCheck: probe,
      reachableAt: probe.checkedAt,
      nextCheckAt: null,
      error: ""
    });
    process.stdout.write(`[Local Ops] SSH 网络已就绪：${endpoint.host}:${endpoint.port}，开始连接\n`);
    return runSshCommand(endpoint, probe);
  }

  const nextCheckAt = new Date(Date.now() + NETWORK_RETRY_INTERVAL_MS).toISOString();
  const error = endpoint.resolutionError || probe.error || "SSH 主机暂时不可连接";
  updateState("waiting_network", {
    endpoint,
    networkAttempts,
    networkCheck: probe,
    nextCheckAt,
    error,
    exitCode: 75
  });
  process.stderr.write(`[Local Ops] SSH 网络尚未就绪 ${endpoint.host}:${endpoint.port}：${error}；3 秒后自动重试\n`);
  process.exitCode = 75;
}

function runSshCommand(endpoint, networkCheck) {
  if (stopping) return;
  const shell = fs.existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/sh";
  child = spawn(shell, ["-c", options.command], {
    cwd: options.workingDir,
    env: process.env,
    stdio: "inherit"
  });
  updateState("connecting", {
    endpoint,
    networkAttempts,
    networkCheck,
    reachableAt: networkCheck.checkedAt,
    sshPid: child.pid,
    error: ""
  });
  child.once("error", (error) => {
    updateState("ssh_exited", { endpoint, networkAttempts, error: String(error?.message || error), exitCode: 1 });
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    child = null;
    if (stopping) {
      finishStoppedState({ endpoint, networkAttempts });
      process.exit(0);
    }
    const exitCode = Number.isInteger(code) ? code : 1;
    const error = signal ? `SSH 进程收到 ${signal} 后退出` : `SSH 进程已退出（exit ${exitCode}）`;
    updateState("ssh_exited", { endpoint, networkAttempts, exitCode, signal: signal || null, error });
    process.exit(exitCode || 1);
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
  child.kill(signal === "SIGHUP" ? "SIGTERM" : signal);
  const forceTimer = setTimeout(() => child?.kill("SIGKILL"), 2000);
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
    version: 1,
    tunnelId: options.id,
    wrapperPid: process.pid,
    startedAt,
    updatedAt: new Date().toISOString(),
    phase,
    configuredHost: options.host,
    configuredPort: options.port,
    retryLimit: options.retryLimit,
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
  for (const key of ["id", "state", "lifecycle", "host", "port", "retry-limit", "destination", "command", "working-dir"]) {
    if (!values.get(key)) fail(`缺少参数 --${key}`);
  }
  const port = Number(values.get("port"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail("SSH 端口无效");
  const retryLimit = Number(values.get("retry-limit"));
  if (!Number.isInteger(retryLimit) || retryLimit < 1) fail("SSH 重试次数无效");
  return {
    id: values.get("id"),
    stateFile: values.get("state"),
    lifecycleFile: values.get("lifecycle"),
    host: values.get("host"),
    port,
    retryLimit,
    destination: values.get("destination"),
    command: values.get("command"),
    workingDir: values.get("working-dir"),
    sshBinary: values.get("ssh-binary") || "/usr/bin/ssh"
  };
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
