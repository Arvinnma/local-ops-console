import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BASE = process.env.LOCAL_OPS_TEST_URL || "http://127.0.0.1:19090";
const suffix = `${process.pid}-${Date.now().toString(36)}`;
const ids = {
  service: `local-ops-smoke-service-${suffix}`,
  tunnel: `local-ops-smoke-tunnel-${suffix}`,
  route: `local-ops-smoke-route-${suffix}`,
  terminal: `local-ops-smoke-terminal-${suffix}`
};
const created = new Set();
let fixtureServer;
let dockerFixtureId = "";
let restorePreferenceChanged = false;

const bootstrap = await get("/api/bootstrap");
const originalRestorePreference = Boolean(bootstrap.config.settings.restoreLastSessionOnAppLaunch);
const occupiedTunnelPorts = new Set(bootstrap.config.tunnels.map((item) => Number(item.localPort)));
let tunnelLocalPort = 40000 + (process.pid % 15000);
while (occupiedTunnelPorts.has(tunnelLocalPort)) tunnelLocalPort += 1;

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.method && options.method !== "GET") headers["X-Local-Ops-Token"] = bootstrap.csrfToken;
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`);
  return payload;
}

async function get(path) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${BASE}${path}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`);
      return payload;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

async function waitFor(predicate, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Timed out waiting for Local Ops runtime state");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

async function startFixtureServer() {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, path: request.url, fixture: ids.route }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

function rawRequest({ port, path = "/", host }) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path,
      method: "GET",
      headers: host ? { Host: host } : {}
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    request.once("error", reject);
    request.end();
  });
}

async function cleanup(endpoint, id) {
  try { await api(`/api/${endpoint}/${encodeURIComponent(id)}`, { method: "DELETE" }); } catch {}
}

async function dockerCommand(args) {
  const binary = process.env.LOCAL_OPS_DOCKER_BIN || "/Applications/Docker.app/Contents/Resources/bin/docker";
  return execFileAsync(binary, args, { timeout: 70000, maxBuffer: 4 * 1024 * 1024 });
}

try {
  const healthResponse = await fetch(`${BASE}/api/health`);
  assert.equal(healthResponse.status, 200);
  assert.match(healthResponse.headers.get("content-security-policy") || "", /default-src 'self'/);
  assert.equal(healthResponse.headers.get("x-frame-options"), "DENY");

  const current = await api("/api/state?fresh=1");
  assert.equal(current.orchestrator.online, true);
  assert.ok(current.processes.some((item) => item.id === "caddy" && item.status === "running"));

  const rejectedMutation = await fetch(`${BASE}/api/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-Local-Ops-Token": "invalid" },
    body: JSON.stringify({ language: "zh-CN" })
  });
  assert.equal(rejectedMutation.status, 403);

  const rejectedOrigin = await fetch(`${BASE}/api/settings`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-Local-Ops-Token": bootstrap.csrfToken,
      Origin: "https://attacker.example"
    },
    body: JSON.stringify({ language: bootstrap.config.settings.language })
  });
  assert.equal(rejectedOrigin.status, 403);

  const consolePort = Number(new URL(BASE).port);
  const rejectedHost = await rawRequest({ port: consolePort, path: "/api/health", host: "attacker.example" });
  assert.equal(rejectedHost.status, 421);

  const portable = await api("/api/config/export");
  assert.equal(portable.format, "local-ops-portable-config");
  assert.equal(portable.formatVersion, 1);
  assert.ok(Array.isArray(portable.config.services));
  assert.ok(!JSON.stringify(portable).includes("passphraseRef"));
  assert.ok(portable.config.services.every((item) => item.kind !== "docker"));

  await api("/api/services", {
    method: "POST",
    body: {
      id: ids.service,
      name: "Smoke Worker",
      icon: "nodejs",
      kind: "command",
      description: "Temporary Local Ops end-to-end process",
      command: `${shellQuote(process.execPath)} -e ${shellQuote('console.log("smoke-ready"); setInterval(() => console.log("smoke-tick"), 500)')}`,
      workingDir: "/tmp",
      namespace: "tests",
      autoStart: false,
      restartPolicy: "always"
    }
  });
  created.add("service");

  await api(`/api/services/${encodeURIComponent(ids.service)}`, {
    method: "PUT",
    body: {
      name: "Smoke Worker Updated",
      icon: "nodejs",
      kind: "command",
      description: "Temporary Local Ops end-to-end process",
      command: `${shellQuote(process.execPath)} -e ${shellQuote('console.log("smoke-ready"); setInterval(() => console.log("smoke-tick"), 500)')}`,
      workingDir: "/tmp",
      namespace: "tests",
      autoStart: false,
      restartPolicy: "always"
    }
  });

  await api(`/api/processes/${encodeURIComponent(ids.service)}/start`, { method: "POST" });
  await waitFor(async () => {
    const state = await api("/api/state?fresh=1");
    return state.processes.find((item) => item.id === ids.service && item.status === "running");
  });
  const logs = await api(`/api/logs/${encodeURIComponent(ids.service)}?tail=30`);
  assert.match(logs.logs, /smoke-ready/);
  await api(`/api/processes/${encodeURIComponent(ids.service)}/restart`, { method: "POST" });
  await api(`/api/processes/${encodeURIComponent(ids.service)}/stop`, { method: "POST" });
  await waitFor(async () => {
    const state = await api("/api/state?fresh=1");
    return state.processes.find((item) => item.id === ids.service && item.status !== "running");
  });

  // Verify the App's "restore the previous session" flow without leaving the
  // temporary service running or changing the user's saved preference.
  await api(`/api/processes/${encodeURIComponent(ids.service)}/start`, { method: "POST" });
  await waitFor(async () => {
    const state = await api("/api/state?fresh=1");
    return state.processes.find((item) => item.id === ids.service && item.status === "running");
  });
  await api("/api/session/capture", { method: "POST" });
  await api(`/api/processes/${encodeURIComponent(ids.service)}/stop`, { method: "POST" });
  await waitFor(async () => {
    const state = await api("/api/state?fresh=1");
    return state.processes.find((item) => item.id === ids.service && item.status !== "running");
  });
  if (!originalRestorePreference) {
    await api("/api/settings", {
      method: "PATCH",
      body: { restoreLastSessionOnAppLaunch: true }
    });
    restorePreferenceChanged = true;
  }
  const restoredSession = await api("/api/startup/app", { method: "POST" });
  assert.equal(restoredSession.restored, true);
  await waitFor(async () => {
    const state = await api("/api/state?fresh=1");
    return state.processes.find((item) => item.id === ids.service && item.status === "running");
  });
  await api(`/api/processes/${encodeURIComponent(ids.service)}/stop`, { method: "POST" });
  await waitFor(async () => {
    const state = await api("/api/state?fresh=1");
    return state.processes.find((item) => item.id === ids.service && item.status !== "running");
  });
  if (restorePreferenceChanged) {
    await api("/api/settings", {
      method: "PATCH",
      body: { restoreLastSessionOnAppLaunch: originalRestorePreference }
    });
    restorePreferenceChanged = false;
  }

  const serviceOrderBefore = (await api("/api/bootstrap")).config.services.map((item) => item.id);
  const serviceOrderReversed = [...serviceOrderBefore].reverse();
  await api("/api/order/services", { method: "PUT", body: { ids: serviceOrderReversed } });
  assert.deepEqual((await api("/api/bootstrap")).config.services.map((item) => item.id), serviceOrderReversed);
  await api("/api/order/services", { method: "PUT", body: { ids: serviceOrderBefore } });

  await api("/api/tunnels", {
    method: "POST",
    body: {
      id: ids.tunnel,
      name: "Smoke SSH Tunnel",
      icon: "ssh",
      description: "Temporary disabled tunnel",
      sshHost: "127.0.0.1",
      sshUser: "smoke",
      sshPort: 22,
      localPort: tunnelLocalPort,
      remoteHost: "127.0.0.1",
      remotePort: 49192,
      identityFile: ""
    }
  });
  created.add("tunnel");
  const tunnelPayload = (await api("/api/bootstrap")).config.tunnels.find((item) => item.id === ids.tunnel);
  assert.equal(tunnelPayload.hasKeyPassphrase, false);
  assert.equal("passphraseRef" in tunnelPayload, false);
  const rejectedTrayStop = await fetch(`${BASE}/api/processes/${encodeURIComponent(ids.tunnel)}/stop`, {
    method: "POST",
    headers: {
      "X-Local-Ops-Token": bootstrap.csrfToken,
      "X-Local-Ops-Requested-By": "tray",
      "X-Local-Ops-Event-Name": "tray-panel.resource-row.click",
      "X-Local-Ops-Action-Id": `unconfirmed-${suffix}`,
      "X-Local-Ops-Call-Path": "smoke>control-api",
      "X-Local-Ops-User-Intent-Confirmed": "false"
    }
  });
  assert.equal(rejectedTrayStop.status, 409);

  fixtureServer = await startFixtureServer();
  const fixturePort = fixtureServer.address().port;
  const routeHost = `${ids.route}.localhost`;
  await api("/api/routes", {
    method: "POST",
    body: {
      id: ids.route,
      name: "Smoke Route",
      icon: "link",
      host: `${routeHost}/audit`,
      target: `127.0.0.1:${fixturePort}`,
      enabled: true
    }
  });
  created.add("route");
  const proxyPort = Number(bootstrap.config.settings.publicProxyPort || bootstrap.config.settings.proxyPort);
  const routeAuthority = proxyPort === 80 ? routeHost : `${routeHost}:${proxyPort}`;
  const proxied = await rawRequest({ port: proxyPort, path: "/audit", host: routeAuthority });
  assert.equal(proxied.status, 200);
  assert.deepEqual(JSON.parse(proxied.body), { ok: true, path: "/audit", fixture: ids.route });

  await api("/api/terminal-tasks", {
    method: "POST",
    body: {
      id: ids.terminal,
      name: "Smoke Terminal Task",
      icon: "terminal",
      description: "Temporary command definition",
      terminalApp: "terminal",
      kind: "command",
      command: "printf local-ops-smoke",
      workingDir: "/tmp"
    }
  });
  created.add("terminal");
  await api(`/api/terminal-tasks/${encodeURIComponent(ids.terminal)}`, {
    method: "PUT",
    body: {
      name: "Smoke Terminal Task Updated",
      icon: "terminal",
      description: "Temporary command definition",
      terminalApp: "terminal",
      kind: "command",
      command: "printf local-ops-smoke-updated",
      workingDir: "/tmp"
    }
  });

  const docker = await api("/api/docker?fresh=1");
  assert.ok(Array.isArray(docker.containers));
  if (process.env.LOCAL_OPS_TEST_DOCKER_MUTATIONS === "1" && docker.daemonOnline) {
    const dockerName = `local-ops-smoke-${suffix}`;
    const image = process.env.LOCAL_OPS_TEST_DOCKER_IMAGE || "redis:8-alpine";
    const createdContainer = await dockerCommand([
      "create", "--name", dockerName, "--label", "com.arvin.localops.smoke=true",
      "--entrypoint", "/bin/sh", image, "-c", "while :; do sleep 60; done"
    ]);
    dockerFixtureId = createdContainer.stdout.trim();
    assert.ok(dockerFixtureId);
    await api(`/api/docker/${encodeURIComponent(dockerFixtureId)}/start`, { method: "POST" });
    await waitFor(async () => (await api("/api/docker?fresh=1")).containers.find((item) => item.id === dockerFixtureId && item.running));
    await api(`/api/docker/${encodeURIComponent(dockerFixtureId)}/restart`, { method: "POST" });
    await api(`/api/docker/${encodeURIComponent(dockerFixtureId)}/stop`, { method: "POST" });
    await waitFor(async () => (await api("/api/docker?fresh=1")).containers.find((item) => item.id === dockerFixtureId && !item.running));
  }

  const invalidImport = await fetch(`${BASE}/api/config/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Local-Ops-Token": bootstrap.csrfToken },
    body: JSON.stringify({ format: "not-local-ops", formatVersion: 1, config: {} })
  });
  assert.equal(invalidImport.status, 400);

  console.log("Smoke test passed: security, state, services, logs, session restore, ordering, tunnels, routes, terminal tasks, export, Docker read");
} finally {
  if (restorePreferenceChanged) {
    await api("/api/settings", {
      method: "PATCH",
      body: { restoreLastSessionOnAppLaunch: originalRestorePreference }
    }).catch(() => {});
  }
  if (dockerFixtureId) await dockerCommand(["rm", "-f", dockerFixtureId]).catch(() => {});
  if (created.has("terminal")) await cleanup("terminal-tasks", ids.terminal);
  if (created.has("route")) await cleanup("routes", ids.route);
  if (fixtureServer) await new Promise((resolve) => fixtureServer.close(resolve));
  if (created.has("tunnel")) await cleanup("tunnels", ids.tunnel);
  if (created.has("service")) await cleanup("services", ids.service);
  await api("/api/session/capture", { method: "POST" }).catch(() => {});
}
