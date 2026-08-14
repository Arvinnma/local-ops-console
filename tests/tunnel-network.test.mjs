import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  delegatedSshNetworkCheck,
  isSshManagedConnection,
  parseSshConfiguration
} from "../src/tunnel-network.mjs";

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

test("marks ProxyJump and ProxyCommand connections as managed by OpenSSH", () => {
  const jumpEndpoint = parseSshConfiguration([
    "hostname 127.0.0.1",
    "port 10022",
    "proxyjump frp-relay-01"
  ].join("\n"), { host: "office-server-01", port: 10022 });
  assert.equal(isSshManagedConnection(jumpEndpoint), true);
  assert.deepEqual(
    delegatedSshNetworkCheck(jumpEndpoint, "office-server-01", "2026-07-29T00:00:00.000Z"),
    {
      mode: "ssh-managed",
      delegated: true,
      proxyJump: "frp-relay-01",
      proxyCommand: "",
      target: "office-server-01",
      checkedAt: "2026-07-29T00:00:00.000Z",
      ok: null,
      latencyMs: null,
      error: ""
    }
  );

  const commandEndpoint = parseSshConfiguration([
    "hostname internal.example",
    "port 22",
    "proxycommand ssh gateway -W %h:%p"
  ].join("\n"), { host: "internal", port: 22 });
  assert.equal(isSshManagedConnection(commandEndpoint), true);
});

test("managed tunnels delegate ProxyJump reachability to OpenSSH", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "local-ops-proxyjump-"));
  const stateFile = path.join(directory, "state.json");
  const sshFixture = path.join(directory, "ssh-fixture");
  fs.writeFileSync(sshFixture, [
    "#!/bin/sh",
    "printf '%s\\n' 'hostname 127.0.0.1' 'port 10022' 'proxyjump frp-relay-01'"
  ].join("\n"), { mode: 0o700 });
  const localPort = await reservePort();

  const runner = spawn(process.execPath, [
    RUNNER,
    "--id", "proxyjump-fixture",
    "--state", stateFile,
    "--lifecycle", path.join(directory, "lifecycle.json"),
    "--host", "office-server-01",
    "--port", "10022",
    "--bind-address", "127.0.0.1",
    "--local-port", String(localPort),
    "--retry-limit", "10",
    "--destination", "fixture@office-server-01",
    "--ssh-binary", sshFixture,
    "--working-dir", directory,
    "--command", "exec /bin/sleep 30"
  ], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => {
    await stopRunner(runner);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const connecting = await waitForState(
    stateFile,
    (state) => state.phase === "connecting" && state.sshPid,
    5000
  );
  assert.equal(connecting.networkCheck.mode, "ssh-managed");
  assert.equal(connecting.networkCheck.delegated, true);
  assert.equal(connecting.networkCheck.ok, null);
  assert.equal(connecting.networkCheck.proxyJump, "frp-relay-01");
  assert.notEqual(runner.exitCode, 75);
});

test("managed tunnels fail fast while the SSH endpoint is unavailable and connect on the next retry", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "local-ops-network-"));
  const stateFile = path.join(directory, "state.json");
  const lifecycleFile = path.join(directory, "process-lifecycle.json");
  const reserved = net.createServer();
  await listen(reserved);
  const port = reserved.address().port;
  await close(reserved);
  const localPort = await reservePort();

  const runnerArgs = [
    RUNNER,
    "--id", "network-fixture",
    "--state", stateFile,
    "--lifecycle", lifecycleFile,
    "--host", "127.0.0.1",
    "--port", String(port),
    "--bind-address", "127.0.0.1",
    "--local-port", String(localPort),
    "--retry-limit", "10",
    "--retry-backoff-ms", "50",
    "--destination", "fixture@127.0.0.1",
    "--working-dir", directory,
    "--command", "exec /bin/sleep 30"
  ];
  const runner = spawn(process.execPath, runnerArgs, { stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => {
    await stopRunner(runner);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const waiting = await waitForState(stateFile, (state) => state.phase === "waiting_network", 5000);
  assert.equal(waiting.networkCheck.ok, false);
  assert.equal(waiting.retryLimit, 10);
  assert.equal(waiting.consecutiveFailures, 1);
  assert.match(waiting.nextCheckAt, /^\d{4}-/);
  assert.equal(runner.exitCode, null);

  const server = net.createServer();
  await listen(server, port);
  t.after(() => close(server));
  const connectedAt = Date.now();
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
  runner.kill("SIGTERM");
  const exitCode = await waitForExit(runner);
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

test("the managed wrapper retries nine times and enters terminal failure on the tenth", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "local-ops-retry-limit-"));
  const preflight = net.createServer();
  await listen(preflight);
  const localPort = await reservePort();
  const attemptsFile = path.join(directory, "attempts.txt");
  const commandFile = path.join(directory, "always-fail.cjs");
  fs.writeFileSync(commandFile, [
    "const fs = require('node:fs');",
    "fs.appendFileSync(process.argv[2], `${Date.now()}\\n`);",
    "process.exit(1);"
  ].join("\n"));

  const runner = spawnRunner({
    directory,
    id: "retry-limit-fixture",
    sshPort: preflight.address().port,
    localPort,
    command: `exec ${shellArg(process.execPath)} ${shellArg(commandFile)} ${shellArg(attemptsFile)}`,
    retryBackoffMs: 40
  });
  t.after(async () => {
    await stopRunner(runner);
    await close(preflight);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const ninth = await waitForState(
    path.join(directory, "state.json"),
    (state) => state.phase === "retrying" && state.consecutiveFailures === 9,
    8000,
    5
  );
  assert.equal(ninth.retryLimit, 10);
  assert.match(ninth.nextCheckAt, /^\d{4}-/);

  const terminal = await waitForState(
    path.join(directory, "state.json"),
    (state) => state.phase === "connection_failed",
    3000,
    5
  );
  assert.equal(terminal.consecutiveFailures, 10);
  assert.equal(terminal.nextCheckAt, null);
  assert.equal(runner.exitCode, null, "the wrapper stays alive for an explicit retry/stop action");

  const attempts = readAttemptTimes(attemptsFile);
  assert.equal(attempts.length, 10);
  assert.ok(
    attempts.slice(1).every((value, index) => value - attempts[index] >= 25),
    "failed attempts must respect the backoff instead of forming a hot loop"
  );
  assert.equal(await stopRunner(runner), 0);
});

test("an exhausted wrapper restart preserves the terminal failure budget", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "local-ops-terminal-restore-"));
  const preflight = net.createServer();
  await listen(preflight);
  const localPort = await reservePort();
  const attemptsFile = path.join(directory, "attempts.txt");
  const commandFile = path.join(directory, "always-fail.cjs");
  fs.writeFileSync(commandFile, [
    "const fs = require('node:fs');",
    "fs.appendFileSync(process.argv[2], `${Date.now()}\\n`);",
    "process.exit(1);"
  ].join("\n"));
  fs.writeFileSync(path.join(directory, "state.json"), JSON.stringify({
    phase: "connection_failed",
    consecutiveFailures: 10,
    retryLimit: 10,
    failureEpisodeStartedAt: "2026-08-14T00:00:00.000Z",
    lastFailureAt: "2026-08-14T00:00:30.000Z",
    error: "terminal fixture"
  }));

  const runner = spawnRunner({
    directory,
    id: "retry-limit-fixture",
    sshPort: preflight.address().port,
    localPort,
    command: `exec ${shellArg(process.execPath)} ${shellArg(commandFile)} ${shellArg(attemptsFile)}`,
    retryBackoffMs: 40
  });
  t.after(async () => {
    await stopRunner(runner);
    await close(preflight);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const restoredTerminal = await waitForState(
    path.join(directory, "state.json"),
    (state) => state.phase === "connection_failed" && state.wrapperPid === runner.pid,
    3000,
    5
  );
  assert.equal(restoredTerminal.consecutiveFailures, 10);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(fs.existsSync(attemptsFile), false, "a wrapper restart must not silently grant a new retry budget");
  assert.equal(await stopRunner(runner), 0);
});

test("three failures reset only after listener, HTTP readiness, and the stability window", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "local-ops-stable-reset-"));
  const preflight = net.createServer();
  await listen(preflight);
  const localPort = await reservePort();
  const attemptsFile = path.join(directory, "attempts.txt");
  const commandFile = writeHttpFixture(directory);
  const stateFile = path.join(directory, "state.json");
  const runner = spawnRunner({
    directory,
    id: "stable-reset-fixture",
    sshPort: preflight.address().port,
    localPort,
    healthUrl: `http://127.0.0.1:${localPort}/health`,
    command: `exec ${shellArg(process.execPath)} ${shellArg(commandFile)} ${localPort} ${shellArg(attemptsFile)} 3`,
    retryBackoffMs: 120,
    stableWindowMs: 140
  });
  t.after(async () => {
    await stopRunner(runner);
    await close(preflight);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const stabilizing = await waitForState(
    stateFile,
    (state) => state.phase === "stabilizing" && state.consecutiveFailures === 3,
    8000,
    5
  );
  assert.equal(stabilizing.listenerCheck.ok, true);
  assert.equal(stabilizing.readinessCheck.ok, true);
  assert.equal(stabilizing.consecutiveFailures, 3, "readiness alone must not reset before the stability window");

  const connected = await waitForState(
    stateFile,
    (state) => state.phase === "connected" && state.consecutiveFailures === 0,
    3000,
    5
  );
  assert.equal(connected.retryLimit, 10);
  assert.match(connected.stableAt, /^\d{4}-/);
  assert.equal(readAttemptTimes(attemptsFile).length, 4);

  process.kill(connected.sshPid, "SIGTERM");
  const nextEpisode = await waitForState(
    stateFile,
    (state) => state.phase === "retrying" && state.consecutiveFailures === 1,
    3000,
    5
  );
  assert.equal(nextEpisode.consecutiveFailures, 1, "a later outage starts a new episode at one");
});

test("an SSH child without a ready local listener does not clear a restored failure count", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "local-ops-no-listener-"));
  const preflight = net.createServer();
  await listen(preflight);
  const localPort = await reservePort();
  const stateFile = path.join(directory, "state.json");
  fs.writeFileSync(stateFile, JSON.stringify({
    phase: "retrying",
    consecutiveFailures: 3,
    retryLimit: 10,
    failureEpisodeStartedAt: "2026-08-13T06:26:42.000Z",
    lastFailureAt: "2026-08-13T06:26:58.000Z"
  }));
  const runner = spawnRunner({
    directory,
    id: "no-listener-fixture",
    sshPort: preflight.address().port,
    localPort,
    command: "exec /bin/sleep 30",
    stableWindowMs: 80
  });
  t.after(async () => {
    await stopRunner(runner);
    await close(preflight);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const connecting = await waitForState(
    stateFile,
    (state) => state.phase === "connecting" && state.sshPid && state.listenerCheck?.ok === false,
    5000
  );
  assert.equal(connecting.consecutiveFailures, 3);
  assert.equal(connecting.stableAt, null);
});

test("two tunnels recover independently with separate counters", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "local-ops-independent-"));
  const preflight = net.createServer();
  await listen(preflight);
  const commandFile = writeHttpFixture(directory);
  const fixtures = await Promise.all([2, 4].map(async (failures, index) => {
    const id = `independent-${index + 1}`;
    const localPort = await reservePort();
    const subdirectory = path.join(directory, id);
    fs.mkdirSync(subdirectory);
    const attemptsFile = path.join(subdirectory, "attempts.txt");
    const runner = spawnRunner({
      directory: subdirectory,
      id,
      sshPort: preflight.address().port,
      localPort,
      healthUrl: `http://127.0.0.1:${localPort}/health`,
      command: `exec ${shellArg(process.execPath)} ${shellArg(commandFile)} ${localPort} ${shellArg(attemptsFile)} ${failures}`,
      retryBackoffMs: 50,
      stableWindowMs: 80
    });
    return { id, failures, runner, attemptsFile, stateFile: path.join(subdirectory, "state.json") };
  }));
  t.after(async () => {
    await Promise.all(fixtures.map((fixture) => stopRunner(fixture.runner)));
    await close(preflight);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const states = await Promise.all(fixtures.map((fixture) => waitForState(
    fixture.stateFile,
    (state) => state.phase === "connected" && state.consecutiveFailures === 0,
    8000,
    5
  )));
  assert.deepEqual(states.map((state) => state.tunnelId), fixtures.map((fixture) => fixture.id));
  assert.deepEqual(
    fixtures.map((fixture) => readAttemptTimes(fixture.attemptsFile).length),
    fixtures.map((fixture) => fixture.failures + 1)
  );
});

function spawnRunner({
  directory,
  id,
  sshPort,
  localPort,
  command,
  healthUrl = "",
  retryBackoffMs = 50,
  stableWindowMs = 100
}) {
  return spawn(process.execPath, [
    RUNNER,
    "--id", id,
    "--state", path.join(directory, "state.json"),
    "--lifecycle", path.join(directory, "lifecycle.json"),
    "--host", "127.0.0.1",
    "--port", String(sshPort),
    "--bind-address", "127.0.0.1",
    "--local-port", String(localPort),
    "--health-url", healthUrl,
    "--retry-limit", "10",
    "--retry-backoff-ms", String(retryBackoffMs),
    "--readiness-poll-ms", "10",
    "--listener-probe-timeout-ms", "40",
    "--health-probe-timeout-ms", "80",
    "--stable-window-ms", String(stableWindowMs),
    "--destination", "fixture@127.0.0.1",
    "--working-dir", directory,
    "--command", command
  ], { stdio: ["ignore", "pipe", "pipe"] });
}

function writeHttpFixture(directory) {
  const file = path.join(directory, "http-fixture.cjs");
  fs.writeFileSync(file, [
    "const fs = require('node:fs');",
    "const http = require('node:http');",
    "const port = Number(process.argv[2]);",
    "const attemptsFile = process.argv[3];",
    "const failUntil = Number(process.argv[4]);",
    "let attempts = 0;",
    "try { attempts = fs.readFileSync(attemptsFile, 'utf8').trim().split(/\\s+/).filter(Boolean).length; } catch {}",
    "attempts += 1;",
    "fs.appendFileSync(attemptsFile, `${Date.now()}\\n`);",
    "if (attempts <= failUntil) process.exit(1);",
    "http.createServer((_request, response) => { response.writeHead(200); response.end('ready'); }).listen(port, '127.0.0.1');"
  ].join("\n"));
  return file;
}

function shellArg(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function readAttemptTimes(file) {
  return fs.readFileSync(file, "utf8").trim().split(/\s+/).filter(Boolean).map(Number);
}

async function reservePort() {
  const server = net.createServer();
  await listen(server);
  const port = server.address().port;
  await close(server);
  return port;
}

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

async function stopRunner(child) {
  if (child.exitCode != null) return child.exitCode;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    waitForExit(child).then((code) => ({ exited: true, code })),
    new Promise((resolve) => setTimeout(() => resolve({ exited: false }), 2500))
  ]);
  if (exited.exited) return exited.code;
  child.kill("SIGKILL");
  return waitForExit(child);
}

async function waitForState(file, predicate, timeoutMs, pollMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const state = JSON.parse(fs.readFileSync(file, "utf8"));
      if (predicate(state)) return state;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`Timed out waiting for tunnel state in ${file}`);
}
