import test from "node:test";
import assert from "node:assert/strict";

import {
  isDomainOnlyFailure,
  tunnelDisplayState,
  tunnelFailureMessage,
  tunnelPrimaryAction
} from "../public/tunnel-ui.js";

test("tunnel presentation exposes only the four user-facing states", () => {
  assert.equal(tunnelDisplayState({ status: "stopped", active: false }), "stopped");
  assert.equal(tunnelDisplayState({ status: "waiting_network", active: true }), "connecting");
  assert.equal(tunnelDisplayState({ status: "retrying", active: true }), "connecting");
  assert.equal(tunnelDisplayState({ status: "connection_failed", active: false }), "connection_failed");
  assert.equal(tunnelDisplayState(connectedTunnel()), "connected");
});

test("a configured domain entry must be ready before the card reports connected", () => {
  const process = connectedTunnel({
    domainEntry: {
      configured: true,
      ready: false,
      lastError: "ECONNREFUSED"
    },
    fullyAvailable: false
  });
  assert.equal(tunnelDisplayState(process), "connecting");
  assert.equal(tunnelFailureMessage(process), "");
  assert.equal(isDomainOnlyFailure(process), true);
});

test("a domain entry becomes a final failure only after its retry budget is exhausted", () => {
  const process = connectedTunnel({
    status: "connection_failed",
    domainEntry: {
      configured: true,
      ready: false,
      terminal: true,
      lastError: "ECONNREFUSED"
    },
    fullyAvailable: false
  });
  assert.equal(tunnelDisplayState(process), "connection_failed");
  assert.equal(tunnelFailureMessage(process), "ECONNREFUSED");
  assert.equal(isDomainOnlyFailure(process), true);
});

test("a tunnel without a domain entry only requires its SSH health check", () => {
  const process = connectedTunnel({ domainEntry: { configured: false, ready: false } });
  assert.equal(tunnelDisplayState(process), "connected");
  assert.equal(tunnelFailureMessage(process), "");
  assert.equal(isDomainOnlyFailure(process), false);
});

test("HTTP application readiness can be degraded while the SSH tunnel stays connected", () => {
  const process = connectedTunnel({
    readinessCheck: {
      configured: true,
      ok: false,
      statusCode: 503,
      error: "HTTP 503 Service Unavailable"
    }
  });
  assert.equal(tunnelDisplayState(process), "connected");
  assert.equal(tunnelFailureMessage(process), "");
});

test("an active retry and a locally pending action remain connecting and clear errors", () => {
  const retrying = {
    status: "retrying",
    active: true,
    lastConnectionError: "Connection timed out"
  };
  assert.equal(tunnelDisplayState(retrying), "connecting");
  assert.equal(tunnelFailureMessage(retrying), "");
  assert.equal(tunnelDisplayState({ status: "connection_failed", active: false }, true), "connecting");
});

test("only a final failure exposes its error copy", () => {
  const failed = {
    status: "connection_failed",
    active: false,
    lastConnectionError: "Permission denied (publickey)"
  };
  assert.equal(tunnelFailureMessage(failed), "Permission denied (publickey)");
  assert.equal(tunnelFailureMessage({ ...failed, status: "stopped" }), "");
  assert.equal(tunnelFailureMessage(connectedTunnel()), "");
});

test("an SSH failure takes priority over a dependent domain-entry failure", () => {
  const failed = {
    status: "connection_failed",
    active: false,
    lastConnectionError: "Permission denied (publickey)",
    healthCheck: { ok: false, error: "ECONNREFUSED" },
    domainEntry: { configured: true, ready: false, lastError: "域名入口尚未就绪" }
  };
  assert.equal(tunnelFailureMessage(failed), "Permission denied (publickey)");
});

test("primary actions follow the four-state interaction contract", () => {
  assert.deepEqual(tunnelPrimaryAction("connected"), {
    action: "stop", style: "stop", label: "关闭", disabled: false
  });
  assert.deepEqual(tunnelPrimaryAction("stopped"), {
    action: "start", style: "start", label: "开启", disabled: false
  });
  assert.deepEqual(tunnelPrimaryAction("connection_failed"), {
    action: "retry-tunnel", style: "restart", label: "重试", disabled: false
  });
  assert.deepEqual(tunnelPrimaryAction("connecting"), {
    action: "", style: "pending", label: "连接中", disabled: true
  });
});

function connectedTunnel(overrides = {}) {
  return {
    status: "connected",
    active: true,
    healthCheck: { ok: true },
    domainEntry: { configured: false, ready: false },
    fullyAvailable: true,
    ...overrides
  };
}
