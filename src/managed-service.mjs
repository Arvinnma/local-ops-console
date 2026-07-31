import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { execFileSync } from "node:child_process";

const STATE_VERSION = 1;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function managedServiceStatePath(runtimeDir, id) {
  return path.join(runtimeDir, "services", `${safeId(id)}.json`);
}

export function readManagedServiceState(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || Number(value.version) !== STATE_VERSION) return null;
    return value;
  } catch {
    return null;
  }
}

export function writeManagedServiceState(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({
    ...value,
    version: STATE_VERSION,
    updatedAt: new Date().toISOString()
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

export function isProcessAlive(pid) {
  const value = positivePid(pid);
  if (!value) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function managedRuntimeActive(state) {
  return Boolean(
    state
    && (isProcessAlive(state.wrapperPid) || isProcessAlive(state.childPid))
    && state.phase !== "stopped"
  );
}

export function reconcileManagedServiceProcess(definition, processState, runtimeState) {
  if (!runtimeState || runtimeState.serviceId !== definition.id) return processState;
  const childAlive = isProcessAlive(runtimeState.childPid);
  const wrapperAlive = isProcessAlive(runtimeState.wrapperPid);
  const managedService = {
    phase: String(runtimeState.phase || "unknown"),
    wrapperPid: wrapperAlive ? Number(runtimeState.wrapperPid) : null,
    childPid: childAlive ? Number(runtimeState.childPid) : null,
    adopted: Boolean(runtimeState.adopted),
    error: String(runtimeState.error || ""),
    conflict: runtimeState.conflict || null,
    startedAt: runtimeState.startedAt || null,
    updatedAt: runtimeState.updatedAt || null
  };

  if (childAlive) {
    return {
      ...processState,
      status: "running",
      health: processState.health === "unhealthy" ? "unhealthy" : "running",
      active: true,
      pid: Number(runtimeState.childPid),
      managedService
    };
  }
  if (wrapperAlive && runtimeState.phase === "port_conflict") {
    return {
      ...processState,
      status: "running",
      health: "degraded",
      active: true,
      pid: Number(runtimeState.wrapperPid),
      managedService
    };
  }
  return { ...processState, managedService };
}

export function localHealthEndpoint(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname)) return null;
    return {
      host: url.hostname === "localhost" ? "127.0.0.1" : url.hostname.replace(/^\[(.*)\]$/, "$1"),
      port: Number(url.port || (url.protocol === "https:" ? 443 : 80))
    };
  } catch {
    return null;
  }
}

export function probeTcpListener(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: Number(port) });
    let settled = false;
    const finish = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export function processTree(rootPid) {
  const root = positivePid(rootPid);
  if (!root) return [];
  let output = "";
  try {
    output = execFileSync("/bin/ps", ["-axo", "pid=,ppid="], { encoding: "utf8" });
  } catch {
    return [root];
  }
  const children = new Map();
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const result = [];
  const visit = (pid) => {
    for (const child of children.get(pid) || []) visit(child);
    result.push(pid);
  };
  visit(root);
  return result;
}

export async function terminateProcessTree(rootPid, options = {}) {
  const root = positivePid(rootPid);
  if (!root || root === process.pid || root === 1) return;
  const graceMs = finitePositive(options.graceMs, 4000);
  signalTree(root, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(root)) return;
    await delay(50);
  }
  signalTree(root, "SIGKILL");
}

export async function stopManagedServiceRuntime(file, options = {}) {
  const state = readManagedServiceState(file);
  if (!state) return false;
  const wrapperPid = positivePid(state.wrapperPid);
  const childPid = positivePid(state.childPid);
  if (wrapperPid && isProcessAlive(wrapperPid)) {
    await terminateProcessTree(wrapperPid, options);
  }
  if (childPid && isProcessAlive(childPid)) {
    await terminateProcessTree(childPid, options);
  }
  writeManagedServiceState(file, {
    ...state,
    phase: "stopped",
    wrapperPid: null,
    childPid: null,
    stoppedAt: new Date().toISOString(),
    error: ""
  });
  return true;
}

function signalTree(rootPid, signal) {
  for (const pid of processTree(rootPid)) {
    if (pid === process.pid || pid === 1) continue;
    try { process.kill(pid, signal); } catch {}
  }
}

function positivePid(value) {
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 1 ? pid : null;
}

function finitePositive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
