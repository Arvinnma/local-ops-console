"use strict";

const CONNECTING = new Set(["waiting_network", "connecting", "retrying", "restarting", "running"]);

function tunnelDisplayState(processState) {
  const status = String(processState?.status || "unknown");
  if (!processState || status === "disabled" || status === "stopped") return "stopped";
  const healthReady = Boolean(processState.healthCheck?.ok);
  const domainReady = !processState.domainEntry?.configured || Boolean(processState.domainEntry?.ready);
  if (status === "connected" && healthReady && domainReady) return "connected";
  if (status === "connection_failed" || (status === "connected" && healthReady && !domainReady && processState.domainEntry?.terminal)) {
    return "connection_failed";
  }
  return processIsActive(processState) || CONNECTING.has(status) ? "connecting" : "connection_failed";
}

function resolveTunnelOperation(processState, busy = false) {
  if (busy) return { displayState: "connecting", operation: "", disabled: true };
  const displayState = tunnelDisplayState(processState);
  if (displayState === "connected") return { displayState, operation: "stop", disabled: false };
  if (displayState === "stopped") return { displayState, operation: "start", disabled: false };
  if (displayState === "connection_failed") {
    const domainOnly = Boolean(processState?.healthCheck?.ok)
      && Boolean(processState?.domainEntry?.configured)
      && !processState?.domainEntry?.ready;
    if (domainOnly) return { displayState, operation: "domain-recheck", disabled: false };
    return { displayState, operation: processIsActive(processState) ? "restart" : "start", disabled: false };
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
