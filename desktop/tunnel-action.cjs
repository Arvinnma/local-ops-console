"use strict";

const CONNECTING = new Set(["waiting_network", "connecting", "retrying", "restarting", "running"]);

function tunnelDisplayState(processState) {
  const status = String(processState?.status || "unknown");
  if (!processState || status === "disabled" || status === "stopped") return "stopped";
  const healthReady = Boolean(processState.healthCheck?.ok);
  if (healthReady) {
    if (processState.readinessCheck?.configured && !processState.readinessCheck?.ok) return "service_unready";
    if (processState.domainEntry?.configured && !processState.domainEntry?.ready) return "entry_unready";
    return "connected";
  }
  if (status === "connection_failed" && !processIsActive(processState)) return "connection_failed";
  return processIsActive(processState) || CONNECTING.has(status) ? "connecting" : "connection_failed";
}

function resolveTunnelOperation(processState, busy = false) {
  if (busy) return { displayState: "connecting", operation: "", disabled: true };
  const displayState = tunnelDisplayState(processState);
  if (processIsActive(processState)) return { displayState, operation: "stop", disabled: false };
  if (displayState === "stopped") return { displayState, operation: "start", disabled: false };
  if (displayState === "connection_failed") {
    return { displayState, operation: "start", disabled: false };
  }
  return { displayState, operation: "", disabled: true };
}

function processIsActive(processState) {
  return Boolean(processState?.active ?? processState?.status === "running");
}

function operationMatches(expectedOperation, currentOperation) {
  return Boolean(expectedOperation) && String(expectedOperation) === String(currentOperation);
}

module.exports = { operationMatches, processIsActive, resolveTunnelOperation, tunnelDisplayState };
