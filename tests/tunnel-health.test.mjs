import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import {
  enrichTunnelProcess,
  latestTunnelError,
  probeTunnel,
  probeTunnelReadiness,
  resetTunnelRuntime
} from "../src/tunnel-health.mjs";

test("SSH tunnel liveness uses TCP while HTTP is reported separately as readiness", async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("ready");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const definition = tunnelDefinition("healthy-http", server.address().port);
  const probe = await probeTunnel(definition);
  assert.equal(probe.ok, true);
  assert.equal(probe.mode, "tcp");
  assert.equal(probe.statusCode, null);
  const readiness = await probeTunnelReadiness(definition);
  assert.equal(readiness.ok, true);
  assert.equal(readiness.statusCode, 200);

  resetTunnelRuntime(definition.id);
  const result = await enrichTunnelProcess(definition, runningProcess(), { now: 1_000_000 });
  assert.equal(result.status, "connected");
  assert.equal(result.active, true);
  assert.equal(result.health, "healthy");
  assert.equal(result.healthCheck.mode, "tcp");
  assert.equal(result.readinessCheck.mode, "http");
  assert.equal(result.readinessCheck.ok, true);
  assert.equal(result.lastConnectedAt, new Date(1_000_000).toISOString());
});

test("a new tunnel without a TCP listener transitions from connecting to retrying", async () => {
  const closedServer = http.createServer();
  await new Promise((resolve, reject) => {
    closedServer.once("error", reject);
    closedServer.listen(0, "127.0.0.1", resolve);
  });
  const port = closedServer.address().port;
  await new Promise((resolve) => closedServer.close(resolve));

  const definition = tunnelDefinition("unavailable-http", port);
  resetTunnelRuntime(definition.id);
  const first = await enrichTunnelProcess(definition, runningProcess(), { now: 2_000_000 });
  assert.equal(first.status, "connecting");
  assert.equal(first.lastConnectionError, "");
  assert.match(first.diagnostics.lastConnectionError, /fetch failed|ECONNREFUSED|refused/i);

  const second = await enrichTunnelProcess(definition, runningProcess(), { now: 2_006_000 });
  assert.equal(second.status, "retrying");
  assert.ok(second.nextRetryAt);
});

test("HTTP 5xx degrades readiness without terminating a live SSH tunnel and later recovers", async (t) => {
  let ready = false;
  const listener = netServer();
  const readiness = http.createServer((_request, response) => {
    response.writeHead(ready ? 200 : 503);
    response.end(ready ? "ready" : "upstream unavailable");
  });
  await Promise.all([listen(listener), listen(readiness)]);
  t.after(() => Promise.all([close(listener), close(readiness)]));

  const definition = tunnelDefinition("http-recovers", listener.address().port, {
    healthUrl: `http://127.0.0.1:${readiness.address().port}/health`
  });
  const process = runningProcess();
  resetTunnelRuntime(definition.id);
  for (const now of [3_000_000, 3_003_000, 3_006_000]) {
    const degraded = await enrichTunnelProcess(definition, process, { now });
    assert.equal(degraded.status, "connected");
    assert.equal(degraded.active, true);
    assert.equal(degraded.pid, process.pid);
    assert.equal(degraded.restarts, process.restarts);
    assert.equal(degraded.healthCheck.ok, true);
    assert.equal(degraded.healthCheck.target, `tcp://127.0.0.1:${listener.address().port}`);
    assert.equal(degraded.readinessCheck.statusCode, 503);
    assert.equal(degraded.readinessCheck.ok, false);
    assert.equal(degraded.health, "degraded");
    assert.equal(degraded.fullyAvailable, false);
  }

  ready = true;
  const recovered = await enrichTunnelProcess(definition, process, { now: 3_009_000 });
  assert.equal(recovered.status, "connected");
  assert.equal(recovered.pid, process.pid);
  assert.equal(recovered.restarts, process.restarts);
  assert.equal(recovered.readinessCheck.statusCode, 200);
  assert.equal(recovered.health, "healthy");
  assert.equal(recovered.fullyAvailable, true);
});

test("HTTP readiness timeouts do not consume SSH restart attempts", async (t) => {
  const listener = netServer();
  const readiness = http.createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200);
      response.end("late");
    }, 200);
  });
  await Promise.all([listen(listener), listen(readiness)]);
  t.after(() => Promise.all([close(listener), close(readiness)]));

  const definition = tunnelDefinition("slow-readiness", listener.address().port, {
    healthUrl: `http://127.0.0.1:${readiness.address().port}/`
  });
  const process = { ...runningProcess(), restarts: 0 };
  const result = await enrichTunnelProcess(definition, process, {
    now: Date.now(),
    httpProbeTimeoutMs: 40
  });
  assert.equal(result.status, "connected");
  assert.equal(result.active, true);
  assert.equal(result.pid, process.pid);
  assert.equal(result.restarts, process.restarts);
  assert.equal(result.retryCount, 0);
  assert.equal(result.healthCheck.ok, true);
  assert.equal(result.readinessCheck.ok, false);
  assert.match(result.readinessCheck.error, /超时/);
});

test("a tunnel without healthUrl keeps its TCP-only behavior", async (t) => {
  const listener = netServer();
  await listen(listener);
  t.after(() => close(listener));
  const definition = tunnelDefinition("tcp-only", listener.address().port, { healthUrl: "" });
  const result = await enrichTunnelProcess(definition, runningProcess(), { now: Date.now() });
  assert.equal(result.status, "connected");
  assert.equal(result.healthCheck.ok, true);
  assert.equal(result.readinessCheck.configured, false);
  assert.equal(result.readinessCheck.ok, true);
  assert.equal(result.health, "healthy");
});

test("a restarting SSH process exposes its latest error and next retry", async () => {
  const definition = tunnelDefinition("retrying-ssh", 18080);
  resetTunnelRuntime(definition.id);
  const now = Date.now();
  const result = await enrichTunnelProcess(definition, {
    ...runningProcess(),
    status: "restarting",
    active: true,
    pid: 0,
    restarts: 4,
    exitCode: 255,
    lastActivityAt: new Date(now - 1000).toISOString()
  }, {
    now,
    readLogs: async () => "ssh: connect to host example.com port 22: Operation timed out"
  });
  assert.equal(result.status, "retrying");
  assert.equal(result.retryCount, 4);
  assert.equal(result.lastConnectionError, "");
  assert.match(result.diagnostics.lastConnectionError, /Operation timed out/);
  assert.ok(Date.parse(result.nextRetryAt) > now);
});

test("a terminal SSH failure is distinct from an active retry", async () => {
  const definition = tunnelDefinition("terminal-failure", 18080);
  resetTunnelRuntime(definition.id);
  const result = await enrichTunnelProcess(definition, {
    ...runningProcess(),
    status: "stopped",
    active: false,
    pid: null,
    exitCode: 255,
    rawStatus: "failed"
  }, {
    now: Date.now(),
    readLogs: async () => "ssh: Permission denied (publickey)."
  });
  assert.equal(result.status, "connection_failed");
  assert.equal(result.active, false);
  assert.match(result.lastConnectionError, /Permission denied/);
  assert.equal(result.nextRetryAt, null);
});

test("a user-disabled tunnel remains stopped even when an old exit code exists", async () => {
  const definition = tunnelDefinition("disabled-tunnel", 18080);
  resetTunnelRuntime(definition.id);
  const result = await enrichTunnelProcess(definition, {
    ...runningProcess(),
    status: "disabled",
    active: false,
    pid: null,
    exitCode: 255,
    rawStatus: "disabled"
  }, { now: Date.now() });
  assert.equal(result.status, "stopped");
  assert.equal(result.lastConnectionError, "");
});

test("a running gate reports waiting for network instead of connected", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "local-ops-health-"));
  const stateFile = path.join(directory, "network.json");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const now = Date.now();
  fs.writeFileSync(stateFile, JSON.stringify({
    wrapperPid: 12345,
    phase: "waiting_network",
    updatedAt: new Date(now).toISOString(),
    nextCheckAt: new Date(now + 3000).toISOString(),
    networkAttempts: 2,
    endpoint: { host: "81.70.228.59", port: 22 },
    networkCheck: { ok: false, checkedAt: new Date(now).toISOString(), error: "ETIMEDOUT" },
    error: "ETIMEDOUT"
  }));
  const definition = tunnelDefinition("waiting-network", 18080);
  const result = await enrichTunnelProcess(definition, runningProcess(), {
    now,
    networkStateFile: stateFile,
    entryRoutes: [{ id: "panel", name: "Panel", enabled: true, url: "http://panel.localhost/secret" }]
  });
  assert.equal(result.status, "waiting_network");
  assert.equal(result.networkCheck.target, "81.70.228.59:22");
  assert.equal(result.networkCheck.ok, false);
  assert.equal(result.domainEntry.ready, false);
  assert.equal(result.fullyAvailable, false);
});

test("managed wrapper phases expose consecutive failures instead of Process Compose lifetime restarts", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "local-ops-health-retries-"));
  const stateFile = path.join(directory, "network.json");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const now = Date.now();
  fs.writeFileSync(stateFile, JSON.stringify({
    wrapperPid: 12345,
    phase: "retrying",
    updatedAt: new Date(now).toISOString(),
    consecutiveFailures: 4,
    retryLimit: 10,
    nextCheckAt: new Date(now + 3000).toISOString(),
    error: "ssh: connection reset"
  }));
  const definition = tunnelDefinition("wrapper-retry-count", 18080);
  const process = { ...runningProcess(), restarts: 99 };
  const first = await enrichTunnelProcess(definition, process, {
    now,
    networkStateFile: stateFile
  });
  assert.equal(first.status, "retrying");
  assert.equal(first.retryCount, 4);
  assert.equal(first.retryLimit, 10);

  resetTunnelRuntime(definition.id);
  const afterServerRestart = await enrichTunnelProcess(definition, process, {
    now: now + 1000,
    networkStateFile: stateFile
  });
  assert.equal(afterServerRestart.retryCount, 4);
  assert.equal(afterServerRestart.status, "retrying");
});

test("stabilizing wrapper state remains connecting and retains failures until confirmed", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "local-ops-health-stabilizing-"));
  const stateFile = path.join(directory, "network.json");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const now = Date.now();
  fs.writeFileSync(stateFile, JSON.stringify({
    wrapperPid: 12345,
    phase: "stabilizing",
    updatedAt: new Date(now).toISOString(),
    consecutiveFailures: 3,
    retryLimit: 10,
    listenerCheck: { target: "127.0.0.1:18080", ok: true, latencyMs: 1, error: "" },
    readinessCheck: { configured: true, mode: "http", target: "http://127.0.0.1:18080/", ok: true, statusCode: 200, latencyMs: 2, error: "" }
  }));
  const result = await enrichTunnelProcess(tunnelDefinition("stabilizing", 18080), runningProcess(), {
    now,
    networkStateFile: stateFile
  });
  assert.equal(result.status, "connecting");
  assert.equal(result.retryCount, 3);
  assert.equal(result.healthCheck.ok, true);
  assert.equal(result.readinessCheck.ok, true);
  assert.equal(result.fullyAvailable, false);
});

test("an exhausted live wrapper reports terminal failure with ten consecutive failures", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "local-ops-health-terminal-"));
  const stateFile = path.join(directory, "network.json");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const now = Date.now();
  fs.writeFileSync(stateFile, JSON.stringify({
    wrapperPid: 12345,
    phase: "connection_failed",
    updatedAt: new Date(now).toISOString(),
    consecutiveFailures: 10,
    retryLimit: 10,
    error: "ssh: connect to host example.com port 22: Operation timed out"
  }));
  const result = await enrichTunnelProcess(tunnelDefinition("exhausted-wrapper", 18080), runningProcess(), {
    now,
    networkStateFile: stateFile
  });
  assert.equal(result.status, "connection_failed");
  assert.equal(result.active, true);
  assert.equal(result.retryCount, 10);
  assert.equal(result.retryLimit, 10);
  assert.match(result.lastConnectionError, /Operation timed out/);
  assert.equal(result.nextRetryAt, null);
});

test("a management entry is fully available only when tunnel and domain checks both pass", async (t) => {
  const tunnelServer = http.createServer((_request, response) => {
    response.writeHead(200);
    response.end("tunnel ready");
  });
  const entryServer = http.createServer((_request, response) => {
    response.writeHead(200);
    response.end("login");
  });
  await Promise.all([listen(tunnelServer), listen(entryServer)]);
  t.after(() => Promise.all([close(tunnelServer), close(entryServer)]));

  const definition = tunnelDefinition("full-entry", tunnelServer.address().port);
  const result = await enrichTunnelProcess(definition, runningProcess(), {
    now: Date.now(),
    entryRoutes: [{
      id: "panel-entry",
      name: "Panel",
      enabled: true,
      url: `http://127.0.0.1:${entryServer.address().port}/office-login`
    }]
  });
  assert.equal(result.status, "connected");
  assert.equal(result.domainEntry.ready, true);
  assert.equal(result.fullyAvailable, true);
});

test("slow authentication-protected domain entries accept 401 and 403 responses", async (t) => {
  const tunnelServer = http.createServer((_request, response) => {
    response.writeHead(200);
    response.end("tunnel ready");
  });
  const statusCodes = [401, 403];
  const entryServers = statusCodes.map((statusCode) => (
    http.createServer((_request, response) => {
      setTimeout(() => {
        response.writeHead(statusCode);
        response.end("authentication required");
      }, 2200);
    })
  ));
  await Promise.all([listen(tunnelServer), ...entryServers.map(listen)]);
  t.after(() => Promise.all([close(tunnelServer), ...entryServers.map(close)]));

  const definition = tunnelDefinition("slow-protected-entry", tunnelServer.address().port);
  const result = await enrichTunnelProcess(definition, runningProcess(), {
    now: Date.now(),
    entryRoutes: entryServers.map((server, index) => ({
      id: `protected-route-${statusCodes[index]}`,
      name: "Protected service",
      enabled: true,
      url: `http://127.0.0.1:${server.address().port}/`
    }))
  });
  assert.equal(result.status, "connected");
  assert.equal(result.domainEntry.ready, true);
  assert.deepEqual(
    result.domainEntry.checks.map((check) => check.statusCode),
    statusCodes
  );
  assert.ok(result.domainEntry.checks.every((check) => check.latencyMs >= 2000));
  assert.equal(result.fullyAvailable, true);
});

test("a failed full-domain check stays connecting until the ten-attempt budget is exhausted", async (t) => {
  let entryReady = false;
  let entryProbeCount = 0;
  const tunnelServer = http.createServer((_request, response) => {
    response.writeHead(200);
    response.end("tunnel ready");
  });
  const entryServer = http.createServer((_request, response) => {
    entryProbeCount += 1;
    response.writeHead(entryReady ? 200 : 404);
    response.end(entryReady ? "ready" : "wrong entry path");
  });
  await Promise.all([listen(tunnelServer), listen(entryServer)]);
  t.after(() => Promise.all([close(tunnelServer), close(entryServer)]));

  const definition = tunnelDefinition("bad-entry", tunnelServer.address().port);
  const startedAt = Date.now();
  let result = await enrichTunnelProcess(definition, runningProcess(), {
    now: startedAt,
    entryRoutes: [{
      id: "bad-panel-entry",
      name: "Panel",
      enabled: true,
      url: `http://127.0.0.1:${entryServer.address().port}/wrong-path`
    }]
  });
  assert.equal(result.status, "retrying");
  assert.equal(result.healthCheck.ok, true);
  assert.equal(result.domainEntry.ready, false);
  assert.equal(result.domainEntry.retrying, true);
  assert.equal(result.domainEntry.retryLimit, 10);
  assert.equal(result.fullyAvailable, false);
  assert.equal(result.health, "degraded");
  assert.equal(entryProbeCount, 1);

  result = await enrichTunnelProcess(definition, runningProcess(), {
    now: startedAt + 1000,
    entryRoutes: [{
      id: "bad-panel-entry",
      name: "Panel",
      enabled: true,
      url: `http://127.0.0.1:${entryServer.address().port}/wrong-path`
    }]
  });
  assert.equal(result.status, "retrying");
  assert.equal(entryProbeCount, 1);

  for (let retry = 1; retry <= 10; retry += 1) {
    result = await enrichTunnelProcess(definition, runningProcess(), {
      now: startedAt + retry * 3000,
      entryRoutes: [{
        id: "bad-panel-entry",
        name: "Panel",
        enabled: true,
        url: `http://127.0.0.1:${entryServer.address().port}/wrong-path`
      }]
    });
  }
  assert.equal(result.status, "connection_failed");
  assert.equal(result.domainEntry.terminal, true);
  assert.equal(result.domainEntry.retryCount, 10);
  assert.equal(entryProbeCount, 11);
  assert.equal(
    result.nextRetryAt,
    new Date(startedAt + 60_000).toISOString()
  );

  entryReady = true;
  for (const elapsed of [35_000, 45_000, 59_000]) {
    result = await enrichTunnelProcess(definition, runningProcess(), {
      now: startedAt + elapsed,
      entryRoutes: [{
        id: "bad-panel-entry",
        name: "Panel",
        enabled: true,
        url: `http://127.0.0.1:${entryServer.address().port}/wrong-path`
      }]
    });
    assert.equal(result.status, "connection_failed");
    assert.equal(entryProbeCount, 11);
  }

  result = await enrichTunnelProcess(definition, runningProcess(), {
    now: startedAt + 60_000,
    entryRoutes: [{
      id: "bad-panel-entry",
      name: "Panel",
      enabled: true,
      url: `http://127.0.0.1:${entryServer.address().port}/wrong-path`
    }]
  });
  assert.equal(result.status, "connected");
  assert.equal(result.domainEntry.ready, true);
  assert.equal(result.domainEntry.terminal, undefined);
  assert.equal(result.domainEntry.lastError, "");
  assert.match(result.diagnostics.lastDomainError, /HTTP 404/);
  assert.equal(entryProbeCount, 12);
});

test("legacy startup retry overrides are normalized to the ten-attempt budget", async (t) => {
  const tunnelServer = http.createServer((_request, response) => {
    response.writeHead(200);
    response.end("tunnel ready");
  });
  await listen(tunnelServer);
  t.after(() => close(tunnelServer));

  const definition = tunnelDefinition("automatic-entry", tunnelServer.address().port);
  resetTunnelRuntime(definition.id);
  const result = await enrichTunnelProcess(definition, runningProcess(), {
    now: Date.now(),
    retryLimit: 40,
    entryRoutes: [{
      id: "offline-entry",
      name: "Offline",
      enabled: true,
      url: "http://127.0.0.1:1/unavailable"
    }]
  });
  assert.equal(result.status, "retrying");
  assert.equal(result.domainEntry.retryLimit, 10);
  assert.equal(result.retryLimit, 10);
});

test("extracts a useful SSH error from process logs", () => {
  assert.equal(
    latestTunnelError("noise\nssh: bind to port 18080: Address already in use\nmore noise"),
    "ssh: bind to port 18080: Address already in use"
  );
});

function tunnelDefinition(id, port, overrides = {}) {
  return {
    id,
    name: id,
    kind: "tunnel",
    bindAddress: "127.0.0.1",
    localPort: port,
    healthUrl: `http://127.0.0.1:${port}/`,
    ...overrides
  };
}

function netServer() {
  return net.createServer();
}

function runningProcess() {
  return {
    id: "fixture",
    name: "Fixture",
    kind: "tunnel",
    status: "running",
    health: "running",
    active: true,
    pid: 12345,
    restarts: 0,
    exitCode: 0,
    rawStatus: "running",
    lastActivityAt: null
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}
