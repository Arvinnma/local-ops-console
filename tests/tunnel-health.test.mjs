import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  enrichTunnelProcess,
  latestTunnelError,
  probeTunnel,
  resetTunnelRuntime
} from "../src/tunnel-health.mjs";

test("an HTTP tunnel is connected only after a valid response", async (t) => {
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
  assert.equal(probe.statusCode, 200);

  resetTunnelRuntime(definition.id);
  const result = await enrichTunnelProcess(definition, runningProcess(), { now: 1_000_000 });
  assert.equal(result.status, "connected");
  assert.equal(result.active, true);
  assert.equal(result.health, "healthy");
  assert.equal(result.lastConnectedAt, new Date(1_000_000).toISOString());
});

test("a new but unverified tunnel transitions from connecting to retrying", async () => {
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
  assert.match(first.lastConnectionError, /fetch failed|ECONNREFUSED|refused/i);

  const second = await enrichTunnelProcess(definition, runningProcess(), { now: 2_006_000 });
  assert.equal(second.status, "retrying");
  assert.ok(second.nextRetryAt);
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
  assert.match(result.lastConnectionError, /Operation timed out/);
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

test("a failed full-domain check stays connecting until the manual retry budget is exhausted", async (t) => {
  const tunnelServer = http.createServer((_request, response) => {
    response.writeHead(200);
    response.end("tunnel ready");
  });
  const entryServer = http.createServer((_request, response) => {
    response.writeHead(404);
    response.end("wrong entry path");
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
  assert.equal(result.domainEntry.retryLimit, 3);
  assert.equal(result.fullyAvailable, false);
  assert.equal(result.health, "degraded");

  for (let retry = 1; retry <= 3; retry += 1) {
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
  assert.equal(result.domainEntry.retryCount, 3);
});

test("startup-restored domain-entry checks use a 40-retry budget", async (t) => {
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
  assert.equal(result.domainEntry.retryLimit, 40);
  assert.equal(result.retryLimit, 40);
});

test("extracts a useful SSH error from process logs", () => {
  assert.equal(
    latestTunnelError("noise\nssh: bind to port 18080: Address already in use\nmore noise"),
    "ssh: bind to port 18080: Address already in use"
  );
});

function tunnelDefinition(id, port) {
  return {
    id,
    name: id,
    kind: "tunnel",
    bindAddress: "127.0.0.1",
    localPort: port,
    healthUrl: `http://127.0.0.1:${port}/`
  };
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
