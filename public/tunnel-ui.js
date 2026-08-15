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
  if (process.healthCheck?.ok) {
    if (process.readinessCheck?.configured && !process.readinessCheck?.ok) return "service_unready";
    if (process.domainEntry?.configured && !process.domainEntry?.ready) return "entry_unready";
    return "connected";
  }

  if (status === "connection_failed" && !process.active) return "connection_failed";
  if (CONNECTING_STATES.has(status) || process.active) return "connecting";
  return "connection_failed";
}

export function tunnelFailureMessage(process = {}, displayState = tunnelDisplayState(process)) {
  const entry = process.domainEntry || {};
  const readiness = process.readinessCheck || {};
  const health = process.healthCheck || {};
  const network = process.networkCheck || {};
  if (displayState === "service_unready") {
    return readiness.error
      || (readiness.statusCode ? `HTTP ${readiness.statusCode}` : "远端服务尚未就绪");
  }
  if (displayState === "entry_unready") {
    return entry.lastError || entry.error || entry.checks?.find((item) => !item.ok)?.error || "域名入口尚未就绪";
  }
  if (displayState !== "connection_failed") return "";
  if (isDomainOnlyFailure(process)) {
    return entry.lastError || entry.error || entry.checks?.find((item) => !item.ok)?.error || "域名入口尚未就绪";
  }
  return process.lastConnectionError
    || health.error
    || network.error
    || (readiness.configured && !readiness.ok ? readiness.error : "")
    || (entry.configured && !entry.ready ? entry.lastError || entry.error : "")
    || "SSH 隧道连接失败";
}

export function isDomainOnlyFailure(process = {}) {
  return Boolean(process.healthCheck?.ok)
    && Boolean(process.domainEntry?.configured)
    && !process.domainEntry?.ready;
}

export function tunnelPrimaryAction(displayState, { active = false, busy = false } = {}) {
  if (busy) return { action: "", style: "pending", label: "处理中", disabled: true };
  if (active) {
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
