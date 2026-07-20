import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CADDYFILE_PATH,
  PROCESS_COMPOSE_PATH,
  WORKER_COMPOSE_PATH,
  applyPortableConfigImport,
  buildTerminalAppleScript,
  createPortableConfigExport,
  loadCatalog,
  normalizeRoute,
  normalizeService,
  normalizeTerminalTask,
  normalizeTunnel,
  renderSshCommand,
  renderWorkerCompose,
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

test("supports an access path appended to a local domain", () => {
  const catalog = structuredClone(loadCatalog());
  catalog.settings.publicProxyPort = 80;
  const route = normalizeRoute({
    id: "panel-office",
    name: "1Panel",
    host: "panel.localhost/Office_26d916e99015?from=local",
    target: "127.0.0.1:18080"
  });
  assert.equal(route.host, "panel.localhost");
  assert.equal(route.path, "/Office_26d916e99015?from=local");
  assert.equal(routeUrl(catalog, route), "http://panel.localhost/Office_26d916e99015?from=local");
});

test("rejects a protocol-relative local-domain path", () => {
  assert.throws(() => normalizeRoute({
    name: "Unsafe path",
    host: "panel.localhost//example.com",
    target: "127.0.0.1:18080"
  }), /访问路径/);
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
  assert.equal(tunnel.healthUrl, "");
  assert.equal("autoStart" in tunnel, false);
});

test("renders manually started SSH tunnels with three retries and no scheduler autostart", () => {
  const catalog = structuredClone(loadCatalog());
  catalog.tunnels = [normalizeTunnel({
    id: "panel-test",
    name: "Panel Test",
    sshHost: "example.com",
    sshUser: "ubuntu",
    localPort: 18080,
    remoteHost: "127.0.0.1",
    remotePort: 10081,
    healthUrl: "http://127.0.0.1:18080/"
  })];
  const compose = renderWorkerCompose(catalog);
  assert.match(compose, /ConnectTimeout=5/);
  assert.match(compose, /ConnectionAttempts=1/);
  assert.match(compose, /BatchMode=yes/);
  assert.match(compose, /backoff_seconds: 3/);
  assert.match(compose, /max_restarts: 3/);
  assert.match(compose, /disabled: true/);
  assert.match(compose, /--retry-limit '3'/);
  assert.match(compose, /run-managed-tunnel\.mjs/);
  assert.match(compose, /--host.*example\.com/);
  assert.match(compose, /--allow-waiting-network/);
  assert.match(compose, /--connecting-grace-ms 7000/);
  assert.match(compose, /readiness_probe:/);
  assert.match(compose, /liveness_probe:/);
  assert.match(compose, /tunnel-http-health\.mjs/);
  assert.match(compose, /http:\/\/127\.0\.0\.1:18080\//);
  assert.match(compose, /period_seconds: 3/);
});

test("startup-restored SSH tunnels use a forty-retry runtime policy", () => {
  const catalog = structuredClone(loadCatalog());
  catalog.tunnels = [normalizeTunnel({
    id: "manual-tunnel",
    name: "Manual Tunnel",
    sshHost: "example.com",
    sshUser: "ubuntu",
    localPort: 18081,
    remoteHost: "127.0.0.1",
    remotePort: 10082
  })];
  const compose = renderWorkerCompose(catalog, {
    tunnelRetryLimits: new Map([["manual-tunnel", 40]])
  });
  assert.match(compose, /restart: "always"/);
  assert.match(compose, /backoff_seconds: 3/);
  assert.match(compose, /max_restarts: 40/);
  assert.match(compose, /disabled: true/);
  assert.match(compose, /--retry-limit '40'/);
});

test("rejects non-local tunnel health checks", () => {
  assert.throws(() => normalizeTunnel({
    name: "Unsafe health",
    sshHost: "example.com",
    sshUser: "ubuntu",
    localPort: 18080,
    remoteHost: "127.0.0.1",
    remotePort: 10081,
    healthUrl: "https://example.com/health"
  }), /健康检查只能访问本机地址/);
});

test("renders Keychain AskPass for encrypted SSH identities without embedding a passphrase", () => {
  const reference = "33fb0702-7bac-4c90-b0c3-02bb0e4c679c";
  const command = renderSshCommand([
    "/usr/bin/ssh", "-N", "-T", "-i", "/tmp/encrypted-key", "ubuntu@example.com"
  ], reference, true);
  assert.match(command, /SSH_ASKPASS=/);
  assert.match(command, /LOCAL_OPS_KEYCHAIN_ACCOUNT=33fb0702/);
  assert.match(command, /PasswordAuthentication=no/);
  assert.doesNotMatch(command, /private key password/i);
});

test("uses non-interactive SSH for a background tunnel without a saved passphrase", () => {
  const command = renderSshCommand([
    "/usr/bin/ssh", "-N", "-T", "ubuntu@example.com"
  ], "", true);
  assert.match(command, /BatchMode=yes/);
  assert.match(command, /ConnectTimeout=5/);
  assert.match(command, /ConnectionAttempts=1/);
  assert.doesNotMatch(command, /SSH_ASKPASS=/);
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
  assert.match(ssh.identityFile, /\/\.ssh\/id_test$/);
  assert.equal(ssh.icon, "ssh");
});

test("generates safe AppleScript for Terminal and iTerm2 without quote injection", () => {
  const command = `printf '%s\\n' "quoted value"; printf '\\\\done'`;
  for (const terminalApp of ["terminal", "iterm2"]) {
    const script = buildTerminalAppleScript(terminalApp, command);
    assert.match(script, terminalApp === "iterm2" ? /write text/ : /do script/);

    // osacompile is only available on macOS. Keep the script-generation and
    // escaping assertions cross-platform, then add a native compilation check
    // whenever the matching macOS application is available.
    if (process.platform !== "darwin") continue;
    if (terminalApp === "iterm2" && !fs.existsSync("/Applications/iTerm.app")) continue;

    const output = path.join(os.tmpdir(), `local-ops-applescript-${terminalApp}-${process.pid}.scpt`);
    try {
      execFileSync("/usr/bin/osacompile", ["-o", output, "-e", script], { stdio: "pipe" });
      assert.equal(fs.existsSync(output), true);
    } finally {
      fs.rmSync(output, { force: true });
    }
  }
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

test("exports and imports portable configuration without Docker resources or remembered state", () => {
  const source = structuredClone(loadCatalog());
  source.settings.launchAppAtLogin = true;
  source.settings.restoreLastSessionOnAppLaunch = true;
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
  source.tunnels = [normalizeTunnel({
    name: "Secure tunnel",
    sshHost: "example.com",
    sshUser: "ubuntu",
    localPort: 15432,
    remoteHost: "127.0.0.1",
    remotePort: 5432,
    passphraseRef: "33fb0702-7bac-4c90-b0c3-02bb0e4c679c"
  })];

  const document = createPortableConfigExport(source, "2026-07-19T00:00:00.000Z");
  assert.equal(document.exportedAt, "2026-07-19T00:00:00.000Z");
  assert.equal(document.config.settings.restoreLastSessionOnAppLaunch, true);
  assert.equal(document.config.settings.language, "en-US");
  assert.equal(document.config.lastSession, undefined);
  assert.deepEqual(document.config.services.map((item) => item.id), ["portable-api"]);
  assert.equal(document.config.routes.some((item) => item.system), false);
  assert.equal(document.config.tunnels[0].passphraseRef, undefined);
  document.config.tunnels[0].passphraseRef = "33fb0702-7bac-4c90-b0c3-02bb0e4c679c";

  const current = structuredClone(loadCatalog());
  current.settings.restoreLastSessionOnAppLaunch = false;
  current.services = [normalizeService({ name: "Local Docker", kind: "docker", command: "docker ps", workingDir: "/tmp" })];
  const imported = applyPortableConfigImport(document, current);
  assert.equal(imported.settings.restoreLastSessionOnAppLaunch, true);
  assert.equal(imported.settings.language, "en-US");
  assert.equal(imported.settings.consolePort, current.settings.consolePort);
  assert.deepEqual(imported.services.map((item) => item.id), ["portable-api", "local-docker"]);
  assert.equal(imported.externalServices[0].id, "existing-api");
  assert.equal(imported.tunnels[0].passphraseRef, "");
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

test("maps legacy startup switches to the session restore preference", () => {
  const document = createPortableConfigExport(loadCatalog());
  delete document.config.settings.restoreLastSessionOnAppLaunch;
  document.config.settings.startServicesOnAppLaunch = true;
  document.config.settings.startTunnelsOnAppLaunch = false;
  const current = structuredClone(loadCatalog());
  current.settings.restoreLastSessionOnAppLaunch = false;
  assert.equal(applyPortableConfigImport(document, current).settings.restoreLastSessionOnAppLaunch, true);
});
