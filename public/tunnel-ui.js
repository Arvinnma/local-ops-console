const CONNECTING_STATES = new Set([
  "waiting_network",
  "connecting",
  "retrying",
  "restarting",
  "running"
]);

export function tunnelDisplayState(process = {}, busy = false) {
  if (busy) return "connecting";

  const status = String(process.status || "unknown");
  if (status === "disabled" || status === "stopped") return "stopped";
  if (status === "connection_failed") return "connection_failed";

  if (status === "connected" && process.healthCheck?.ok) {
    if (process.domainEntry?.configured && !process.domainEntry?.ready) {
      return process.domainEntry?.terminal ? "connection_failed" : "connecting";
    }
    return "connected";
  }

  if (CONNECTING_STATES.has(status) || process.active) return "connecting";
  return "connection_failed";
}

export function tunnelFailureMessage(process = {}, displayState = tunnelDisplayState(process)) {
  if (displayState !== "connection_failed") return "";

  const entry = process.domainEntry || {};
  const health = process.healthCheck || {};
  const network = process.networkCheck || {};
  if (isDomainOnlyFailure(process)) {
    return entry.lastError || entry.error || entry.checks?.find((item) => !item.ok)?.error || "域名入口尚未就绪";
  }
  return process.lastConnectionError
    || health.error
    || network.error
    || (entry.configured && !entry.ready ? entry.lastError || entry.error : "")
    || "SSH 隧道连接失败";
}

export function isDomainOnlyFailure(process = {}) {
  return Boolean(process.healthCheck?.ok)
    && Boolean(process.domainEntry?.configured)
    && !process.domainEntry?.ready;
}

export function tunnelPrimaryAction(displayState) {
  if (displayState === "connected") {
    return { action: "stop", style: "stop", label: "关闭", disabled: false };
  }
  if (displayState === "stopped") {
    return { action: "start", style: "start", label: "开启", disabled: false };
  }
  if (displayState === "connection_failed") {
    return { action: "retry-tunnel", style: "restart", label: "重试", disabled: false };
  }
  return { action: "", style: "pending", label: "连接中", disabled: true };
}
