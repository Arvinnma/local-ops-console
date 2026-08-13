import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { catalogRevision } from "../src/catalog-revision.mjs";

const sourceRoot = path.resolve(import.meta.dirname, "..");

test("snapshot keeps bootstrap and state on one catalog revision while catalog changes", { timeout: 20_000 }, async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "local-ops-snapshot-"));
  const consolePort = await freePort();
  const corePort = await freePort();
  const workerPort = await freePort();
  const processServers = await Promise.all([
    delayedProcessServer(corePort, 350),
    delayedProcessServer(workerPort, 350)
  ]);
  context.after(async () => {
    for (const server of processServers) await closeServer(server);
    await fs.rm(root, { recursive: true, force: true });
  });

  for (const directory of ["src", "public", "scripts"]) {
    await fs.cp(path.join(sourceRoot, directory), path.join(root, directory), { recursive: true });
  }
  await fs.mkdir(path.join(root, "config"), { recursive: true });
  await fs.mkdir(path.join(root, "generated"), { recursive: true });
  await fs.mkdir(path.join(root, "runtime"), { recursive: true });
  await fs.writeFile(path.join(root, "config/process-compose.token"), "isolated-test-token\n", { mode: 0o600 });

  const oldCatalog = catalogFixture({ consolePort, corePort, workerPort, serviceId: "old-service" });
  const newCatalog = catalogFixture({ consolePort, corePort, workerPort, serviceId: "new-service" });
  const catalogPath = path.join(root, "config/catalog.json");
  await fs.writeFile(catalogPath, `${JSON.stringify(oldCatalog, null, 2)}\n`);

  const child = spawn(globalThis.process.execPath, [path.join(root, "src/server.mjs")], {
    cwd: root,
    env: {
      ...globalThis.process.env,
      LOCAL_OPS_PROCESS_COMPOSE: "/usr/bin/false",
      LOCAL_OPS_CADDY: "/usr/bin/false",
      LOCAL_OPS_DOCKER: "/definitely/missing/docker"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });
  context.after(() => terminate(child));
  await waitForHealth(consolePort, child, () => logs);

  const firstRequest = fetch(`http://127.0.0.1:${consolePort}/api/snapshot?fresh=1&docker=1`);
  await new Promise((resolve) => setTimeout(resolve, 80));
  await fs.writeFile(catalogPath, `${JSON.stringify(newCatalog, null, 2)}\n`);
  const firstResponse = await firstRequest;
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.bootstrap.config.services[0].id, "old-service");
  assert.ok(first.state.processes.some((item) => item.id === "old-service"));
  assert.ok(!first.state.processes.some((item) => item.id === "new-service"));
  assert.equal(first.catalogRevision, catalogRevision(first.bootstrap.config));
  assert.ok(Object.hasOwn(first, "docker"));

  const secondResponse = await fetch(`http://127.0.0.1:${consolePort}/api/snapshot?fresh=1`);
  assert.equal(secondResponse.status, 200);
  const second = await secondResponse.json();
  assert.equal(second.bootstrap.config.services[0].id, "new-service");
  assert.ok(second.state.processes.some((item) => item.id === "new-service"));
  assert.ok(!second.state.processes.some((item) => item.id === "old-service"));
  assert.equal(second.catalogRevision, catalogRevision(second.bootstrap.config));
  assert.notEqual(second.catalogRevision, first.catalogRevision);
});

function catalogFixture({ consolePort, corePort, workerPort, serviceId }) {
  return {
    version: 1,
    settings: {
      consolePort,
      processComposePort: corePort,
      workerComposePort: workerPort,
      caddyAdminPort: 19092,
      proxyPort: 19080,
      publicProxyPort: 19080,
      launchAppAtLogin: false,
      restoreLastSessionOnAppLaunch: false,
      language: "zh-CN"
    },
    services: [{
      id: serviceId,
      name: serviceId,
      icon: "server",
      kind: "command",
      namespace: "tests",
      description: "isolated snapshot fixture",
      command: "/usr/bin/true",
      workingDir: "/tmp",
      restartPolicy: "no",
      autoStart: false,
      healthUrl: ""
    }],
    tunnels: [],
    externalServices: [],
    terminalTasks: [],
    routes: [{
      id: "console",
      name: "Local Ops",
      icon: "localops",
      host: "console.localhost",
      target: `127.0.0.1:${consolePort}`,
      enabled: true,
      system: true
    }]
  };
}

async function delayedProcessServer(port, delayMs) {
  const server = http.createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("[]");
    }, delayMs);
  });
  await new Promise((resolve, reject) => server.listen(port, "127.0.0.1", resolve).once("error", reject));
  return server;
}

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const { port } = server.address();
  await closeServer(server);
  return port;
}

async function waitForHealth(port, child, readLogs) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`isolated server exited ${child.exitCode}: ${readLogs()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`isolated server did not become healthy: ${readLogs()}`);
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve) => server.close(resolve));
}

function terminate(child) {
  if (child.exitCode === null) child.kill("SIGTERM");
}
