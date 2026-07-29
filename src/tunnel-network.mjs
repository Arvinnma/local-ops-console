import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const NETWORK_RETRY_INTERVAL_MS = 3000;
export const NETWORK_PROBE_TIMEOUT_MS = 1500;

export async function resolveSshEndpoint({
  destination,
  host,
  port,
  sshBinary = "/usr/bin/ssh",
  run = execFileAsync
}) {
  const fallback = {
    configuredHost: String(host || ""),
    configuredPort: Number(port || 22),
    host: String(host || ""),
    port: Number(port || 22),
    proxyJump: "",
    proxyCommand: ""
  };
  try {
    const { stdout } = await run(sshBinary, ["-G", "-p", String(fallback.port), String(destination || host)], {
      timeout: 2500,
      maxBuffer: 1024 * 1024,
      env: process.env
    });
    return { ...fallback, ...parseSshConfiguration(stdout, fallback) };
  } catch (error) {
    return {
      ...fallback,
      resolutionError: cleanNetworkError(error)
    };
  }
}

export function parseSshConfiguration(output, fallback = {}) {
  const values = new Map();
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = /^(\S+)\s+(.+)$/.exec(line.trim());
    if (!match || values.has(match[1].toLowerCase())) continue;
    values.set(match[1].toLowerCase(), match[2].trim());
  }
  const parsedPort = Number(values.get("port") || fallback.port || 22);
  return {
    host: values.get("hostname") || fallback.host || fallback.configuredHost || "",
    port: Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : Number(fallback.port || 22),
    proxyJump: normalizeProxySetting(values.get("proxyjump")),
    proxyCommand: normalizeProxySetting(values.get("proxycommand"))
  };
}

export function isSshManagedConnection(endpoint) {
  return Boolean(endpoint?.proxyJump || endpoint?.proxyCommand);
}

export function delegatedSshNetworkCheck(endpoint, target, checkedAt = new Date().toISOString()) {
  return {
    mode: "ssh-managed",
    delegated: true,
    proxyJump: String(endpoint?.proxyJump || ""),
    proxyCommand: String(endpoint?.proxyCommand || ""),
    target: String(target || endpoint?.configuredHost || endpoint?.host || ""),
    checkedAt,
    ok: null,
    latencyMs: null,
    error: ""
  };
}

export function probeTcpEndpoint(host, port, timeoutMs = NETWORK_PROBE_TIMEOUT_MS) {
  const started = performance.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: Number(port) });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        target: `${host}:${port}`,
        checkedAt: new Date().toISOString(),
        latencyMs: result.ok ? Math.round(performance.now() - started) : null,
        ...result
      });
    };
    socket.setTimeout(timeoutMs, () => finish({ ok: false, error: `连接超时（${formatSeconds(timeoutMs)} 秒）` }));
    socket.once("connect", () => finish({ ok: true, error: "" }));
    socket.once("error", (error) => finish({ ok: false, error: cleanNetworkError(error) }));
  });
}

export function readTunnelNetworkState(file) {
  try {
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    return state && typeof state === "object" ? state : null;
  } catch {
    return null;
  }
}

export function writeTunnelNetworkState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

export function cleanNetworkError(error) {
  const code = String(error?.cause?.code || error?.code || "").trim();
  const message = String(error?.cause?.message || error?.message || error || "网络连接失败").trim();
  return code && !message.includes(code) ? `${code}: ${message}` : message;
}

function normalizeProxySetting(value) {
  const text = String(value || "").trim();
  return text.toLowerCase() === "none" ? "" : text;
}

function formatSeconds(milliseconds) {
  const seconds = milliseconds / 1000;
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}
