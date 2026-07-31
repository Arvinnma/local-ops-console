import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  isProcessAlive,
  readManagedServiceState,
  reconcileManagedServiceProcess
} from "../src/managed-service.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER = path.join(ROOT, "scripts", "run-managed-service.mjs");

test("a live tracked child reconciles a false orchestrator exit", (t) => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  t.after(() => terminate(child));
  const result = reconcileManagedServiceProcess({ id: "dashboard" }, {
    id: "dashboard",
    status: "stopped",
    rawStatus: "completed",
    active: false,
    pid: null,
    health: "unknown"
  }, {
    serviceId: "dashboard",
    phase: "running",
    wrapperPid: null,
    childPid: child.pid
  });
  assert.equal(result.status, "running");
  assert.equal(result.active, true);
  assert.equal(result.pid, child.pid);
});

test("an occupied health port blocks duplicate start without a restart loop", async (t) => {
  const server = net.createServer();
  await listen(server);
  t.after(() => close(server));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "local-ops-managed-conflict-"));
  const stateFile = path.join(directory, "state.json");
  const marker = path.join(directory, "spawned");
  const runner = startRunner({
    id: "conflict-service",
    stateFile,
    healthUrl: `http://127.0.0.1:${server.address().port}/health`,
    command: `/usr/bin/touch '${marker}'`
  });
  t.after(() => terminate(runner));

  const state = await waitForState(stateFile, (value) => value.phase === "port_conflict");
  assert.equal(state.wrapperPid, runner.pid);
  assert.equal(fs.existsSync(marker), false);
  await delay(2300);
  assert.equal(isProcessAlive(runner.pid), true);
  assert.equal(fs.existsSync(marker), false);
});

test("stopping the wrapper cleans the service process and descendants", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "local-ops-managed-tree-"));
  const stateFile = path.join(directory, "state.json");
  const childScript = path.join(directory, "child.mjs");
  const rootPort = await availablePort();
  const descendantPort = await availablePort();
  fs.writeFileSync(childScript, `
    import net from "node:net";
    import { spawn } from "node:child_process";
    spawn(process.execPath, ["-e", "require('net').createServer().listen(${descendantPort}, '127.0.0.1'); setInterval(() => {}, 1000)"], { stdio: "ignore" });
    net.createServer().listen(${rootPort}, "127.0.0.1");
    setInterval(() => {}, 1000);
  `);
  const runner = startRunner({
    id: "tree-service",
    stateFile,
    healthUrl: `http://127.0.0.1:${rootPort}/`,
    command: `'${process.execPath}' '${childScript}'`
  });
  t.after(() => terminate(runner));

  const state = await waitForState(stateFile, (value) => value.phase === "running" && value.childPid);
  await waitForPort(rootPort, true);
  await waitForPort(descendantPort, true);
  runner.kill("SIGTERM");
  await waitForExit(runner);
  await waitForPort(rootPort, false);
  await waitForPort(descendantPort, false);
  assert.equal(isProcessAlive(state.childPid), false);
  assert.equal(readManagedServiceState(stateFile).phase, "stopped");
});

test("stopping a duplicate supervisor also cleans the lost original instance", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "local-ops-managed-duplicate-"));
  const stateFile = path.join(directory, "state.json");
  const port = await availablePort();
  const command = `'${process.execPath}' -e "require('net').createServer().listen(${port}, '127.0.0.1'); setInterval(() => {}, 1000)"`;
  const owner = startRunner({ id: "duplicate-service", stateFile, healthUrl: "", command });
  t.after(() => terminate(owner));
  const first = await waitForState(stateFile, (value) => value.phase === "running" && value.childPid);
  await waitForPort(port, true);

  const duplicate = startRunner({ id: "duplicate-service", stateFile, healthUrl: "", command });
  t.after(() => terminate(duplicate));
  await delay(350);
  assert.equal(isProcessAlive(owner.pid), true);
  assert.equal(isProcessAlive(first.childPid), true);
  duplicate.kill("SIGTERM");
  await waitForExit(duplicate);
  await waitForPort(port, false);
  await waitForProcessExit(owner.pid);
  assert.equal(isProcessAlive(first.childPid), false);
});

function startRunner({ id, stateFile, healthUrl, command }) {
  return spawn(process.execPath, [
    RUNNER,
    "--id", id,
    "--state", stateFile,
    "--working-dir", path.dirname(stateFile),
    "--health-url", healthUrl,
    "--command", command
  ], { stdio: ["ignore", "ignore", "ignore"] });
}

async function waitForState(file, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = readManagedServiceState(file);
    if (state && predicate(state)) return state;
    await delay(50);
  }
  throw new Error(`Timed out waiting for managed service state: ${file}`);
}

async function waitForPort(port, expected, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen(port) === expected) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for port ${port} to become ${expected ? "open" : "closed"}`);
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(100);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    const closed = () => { socket.destroy(); resolve(false); };
    socket.once("error", closed);
    socket.once("timeout", closed);
  });
}

async function availablePort() {
  const server = net.createServer();
  await listen(server);
  const port = server.address().port;
  await close(server);
  return port;
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

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}

async function waitForProcessExit(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for PID ${pid} to exit`);
}

function terminate(child) {
  if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
