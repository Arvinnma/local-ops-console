import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseSshConfiguration } from "../src/tunnel-network.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER = path.join(ROOT, "scripts", "run-managed-tunnel.mjs");

test("parses the effective HostName and port from ssh -G output", () => {
  const endpoint = parseSshConfiguration([
    "user ubuntu",
    "hostname 81.70.228.59",
    "port 2202",
    "proxyjump none"
  ].join("\n"), { host: "frp-relay-01", port: 22 });
  assert.equal(endpoint.host, "81.70.228.59");
  assert.equal(endpoint.port, 2202);
  assert.equal(endpoint.proxyJump, "");
});

test("managed tunnels fail fast while the SSH endpoint is unavailable and connect on the next retry", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "local-ops-network-"));
  const stateFile = path.join(directory, "state.json");
  const lifecycleFile = path.join(directory, "process-lifecycle.json");
  const reserved = net.createServer();
  await listen(reserved);
  const port = reserved.address().port;
  await close(reserved);

  const runnerArgs = [
    RUNNER,
    "--id", "network-fixture",
    "--state", stateFile,
    "--lifecycle", lifecycleFile,
    "--host", "127.0.0.1",
    "--port", String(port),
    "--retry-limit", "3",
    "--destination", "fixture@127.0.0.1",
    "--working-dir", directory,
    "--command", "/bin/sleep 30"
  ];
  const runner = spawn(process.execPath, runnerArgs, { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => {
    if (runner.exitCode == null) runner.kill("SIGKILL");
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const waiting = await waitForState(stateFile, (state) => state.phase === "waiting_network", 5000);
  assert.equal(waiting.networkCheck.ok, false);
  assert.equal(waiting.retryLimit, 3);
  assert.match(waiting.nextCheckAt, /^\d{4}-/);
  assert.equal(await waitForExit(runner), 75);

  const server = net.createServer();
  await listen(server, port);
  t.after(() => close(server));
  const connectedAt = Date.now();
  const retryRunner = spawn(process.execPath, runnerArgs, { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => {
    if (retryRunner.exitCode == null) retryRunner.kill("SIGKILL");
  });
  const connecting = await waitForState(stateFile, (state) => state.phase === "connecting" && state.sshPid, 6500);
  assert.equal(connecting.networkCheck.ok, true);
  assert.ok(Date.now() - connectedAt < 2500, "the next scheduler retry should connect without an extra fixed delay");

  fs.writeFileSync(stateFile, JSON.stringify({
    ...connecting,
    phase: "stopping",
    updatedAt: new Date().toISOString(),
    requestedBy: "ui",
    stopReason: "explicit_stop",
    stopRequestedAt: new Date().toISOString()
  }));
  retryRunner.kill("SIGTERM");
  const exitCode = await waitForExit(retryRunner);
  assert.equal(exitCode, 0);
  const stopped = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(stopped.phase, "stopped");
  assert.equal(stopped.requestedBy, "ui");
  assert.equal(stopped.stopReason, "explicit_stop");
  assert.match(stopped.stoppedAt, /^\d{4}-/);
  const lifecycle = JSON.parse(fs.readFileSync(lifecycleFile, "utf8"));
  assert.equal(lifecycle.processes["network-fixture"].lastStop.requestedBy, "ui");
  assert.equal(lifecycle.processes["network-fixture"].lastStop.reason, "explicit_stop");
});

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function waitForExit(child) {
  return child.exitCode == null
    ? new Promise((resolve) => child.once("exit", resolve))
    : Promise.resolve(child.exitCode);
}

async function waitForState(file, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const state = JSON.parse(fs.readFileSync(file, "utf8"));
      if (predicate(state)) return state;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for tunnel state in ${file}`);
}
