import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CADDYFILE_PATH,
  PROCESS_COMPOSE_PATH,
  WORKER_COMPOSE_PATH,
  applyPortableConfigImport,
  createPortableConfigExport,
  loadCatalog,
  normalizeRoute,
  normalizeService,
  normalizeTerminalTask,
  normalizeTunnel,
  renderAll,
  routeUrl
} from "../src/config.mjs";

test("renders valid base configuration", () => {
  const catalog = loadCatalog();
  renderAll(catalog);
  const processCompose = fs.readFileSync(PROCESS_COMPOSE_PATH, "utf8");
  const workerCompose = fs.readFileSync(WORKER_COMPOSE_PATH, "utf8");
  const caddyfile = fs.readFileSync(CADDYFILE_PATH, "utf8");
  assert.match(processCompose, /local-ops-console:/);
  assert.match(processCompose, /caddy:/);
  assert.match(processCompose, /local-ops-worker:/);
  assert.match(workerCompose, /local-ops-worker-sentinel:/);
  assert.match(caddyfile, /console\.localhost:19080/);
  assert.equal(routeUrl(catalog, catalog.routes[0]), "http://console.localhost:19080");
});

test("omits the default HTTP port when portless access is enabled", () => {
  const catalog = structuredClone(loadCatalog());
  catalog.settings.publicProxyPort = 80;
  assert.equal(routeUrl(catalog, catalog.routes[0]), "http://console.localhost");
});

test("normalizes a safe SSH tunnel", () => {
  const tunnel = normalizeTunnel({
    name: "Production DB",
    sshHost: "example.com",
    sshUser: "ubuntu",
    localPort: 15432,
    remoteHost: "127.0.0.1",
    remotePort: 5432,
    autoStart: true
  });
  assert.equal(tunnel.id, "production-db");
  assert.equal(tunnel.bindAddress, "127.0.0.1");
  assert.equal(tunnel.sshPort, 22);
});

test("normalizes terminal command and SSH tasks", () => {
  const command = normalizeTerminalTask({
    name: "Start web",
    terminalApp: "iterm2",
    kind: "command",
    command: "npm run dev",
    workingDir: "/tmp"
  });
  assert.equal(command.id, "start-web");
  assert.equal(command.terminalApp, "iterm2");
  assert.equal(command.icon, "terminal");

  const ssh = normalizeTerminalTask({
    name: "Admin SSH",
    kind: "ssh",
    sshUser: "ubuntu",
    sshHost: "example.com",
    sshPort: 2222,
    localPort: 18080,
    remoteHost: "127.0.0.1",
    remotePort: 8080,
    identityFile: "~/.ssh/id_test"
  });
  assert.equal(ssh.sshPort, 2222);
  assert.equal(ssh.localPort, 18080);
  assert.match(ssh.identityFile, /\/\.ssh\/id_test$/);
  assert.equal(ssh.icon, "ssh");
});

test("requires both sides of a terminal SSH forwarding pair", () => {
  assert.throws(() => normalizeTerminalTask({
    name: "Broken SSH",
    kind: "ssh",
    sshUser: "ubuntu",
    sshHost: "example.com",
    localPort: 18080
  }), /同时填写/);
});

test("rejects non-local reverse proxy targets", () => {
  assert.throws(() => normalizeRoute({
    name: "Unsafe",
    host: "unsafe.localhost",
    target: "example.com:443"
  }), /转发目标必须/);
});

test("exports and imports portable configuration without Docker settings or resources", () => {
  const source = structuredClone(loadCatalog());
  source.settings.launchAppAtLogin = true;
  source.settings.startServicesOnAppLaunch = true;
  source.settings.startTunnelsOnAppLaunch = true;
  source.settings.startDockerOnAppLaunch = true;
  source.settings.language = "en-US";
  source.services = [
    normalizeService({ name: "Portable API", kind: "node", command: "npm start", workingDir: "/tmp" }),
    normalizeService({ name: "Docker Command", kind: "docker", command: "docker compose up", workingDir: "/tmp" })
  ];
  source.externalServices = [{
    id: "existing-api",
    name: "Existing API",
    kind: "external",
    description: "只监控",
    target: "127.0.0.1:4321",
    healthPath: "/health"
  }];
  source.routes.push(normalizeRoute({ name: "Portable API", host: "portable.localhost", target: "127.0.0.1:4321" }));

  const document = createPortableConfigExport(source, "2026-07-19T00:00:00.000Z");
  assert.equal(document.exportedAt, "2026-07-19T00:00:00.000Z");
  assert.equal(document.config.settings.startDockerOnAppLaunch, undefined);
  assert.equal(document.config.settings.language, "en-US");
  assert.deepEqual(document.config.services.map((item) => item.id), ["portable-api"]);
  assert.equal(document.config.routes.some((item) => item.system), false);

  const current = structuredClone(loadCatalog());
  current.settings.startDockerOnAppLaunch = true;
  current.services = [normalizeService({ name: "Local Docker", kind: "docker", command: "docker ps", workingDir: "/tmp" })];
  const imported = applyPortableConfigImport(document, current);
  assert.equal(imported.settings.startDockerOnAppLaunch, true);
  assert.equal(imported.settings.language, "en-US");
  assert.equal(imported.settings.consolePort, current.settings.consolePort);
  assert.deepEqual(imported.services.map((item) => item.id), ["portable-api", "local-docker"]);
  assert.equal(imported.externalServices[0].id, "existing-api");
  assert.equal(imported.routes[0].system, true);
  assert.equal(imported.routes[1].host, "portable.localhost");
});

test("rejects unrelated configuration files", () => {
  assert.throws(() => applyPortableConfigImport({ hello: "world" }, loadCatalog()), /不是 Local Ops/);
});

test("keeps old portable exports compatible when language is absent", () => {
  const document = createPortableConfigExport(loadCatalog());
  delete document.config.settings.language;
  const current = structuredClone(loadCatalog());
  current.settings.language = "en-US";
  assert.equal(applyPortableConfigImport(document, current).settings.language, "en-US");
});
