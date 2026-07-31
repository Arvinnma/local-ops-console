#!/usr/bin/env node

import crypto from "node:crypto";
import { spawn } from "node:child_process";

import {
  isProcessAlive,
  localHealthEndpoint,
  probeTcpListener,
  readManagedServiceState,
  terminateProcessTree,
  writeManagedServiceState
} from "../src/managed-service.mjs";

const options = parseArguments(process.argv.slice(2));
const commandHash = crypto.createHash("sha256").update(options.command).digest("hex");
let child = null;
let adoptedPid = null;
let duplicateOwnerPid = null;
let stopping = false;
let exitHandled = false;

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => void stop(signal));
}

await supervise();

async function supervise() {
  const previous = readManagedServiceState(options.stateFile);
  if (
    previous?.serviceId === options.id
    && previous.commandHash === commandHash
    && isProcessAlive(previous.wrapperPid)
    && isProcessAlive(previous.childPid)
  ) {
    duplicateOwnerPid = Number(previous.wrapperPid);
    adoptedPid = Number(previous.childPid);
    process.stderr.write(`Local Ops: ${options.id} already has a live managed instance; duplicate start is blocked\n`);
    await waitUntilStopped(duplicateOwnerPid, adoptedPid);
    return;
  }
  if (
    previous?.serviceId === options.id
    && previous.commandHash === commandHash
    && !isProcessAlive(previous.wrapperPid)
    && isProcessAlive(previous.childPid)
  ) {
    adoptedPid = Number(previous.childPid);
    updateState("running", {
      childPid: adoptedPid,
      adopted: true,
      startedAt: previous.startedAt || new Date().toISOString(),
      error: ""
    });
    process.stderr.write(`Local Ops: adopted existing ${options.id} process PID ${adoptedPid}\n`);
    await monitorAdoptedChild();
    return;
  }

  const endpoint = localHealthEndpoint(options.healthUrl);
  if (endpoint && await probeTcpListener(endpoint.host, endpoint.port)) {
    updateState("port_conflict", {
      childPid: null,
      adopted: false,
      conflict: endpoint,
      error: `Local port ${endpoint.host}:${endpoint.port} is already in use by an unmanaged process`
    });
    process.stderr.write(`Local Ops: ${options.id} start blocked because ${endpoint.host}:${endpoint.port} is already in use\n`);
    while (!stopping && await probeTcpListener(endpoint.host, endpoint.port)) await delay(2000);
    if (stopping) return;
  }

  startChild();
}

function startChild() {
  child = spawn("/bin/zsh", ["-c", options.command], {
    cwd: options.workingDir,
    detached: true,
    stdio: "inherit",
    env: process.env
  });
  updateState("running", {
    childPid: child.pid,
    adopted: false,
    conflict: null,
    startedAt: new Date().toISOString(),
    error: ""
  });
  child.once("error", (error) => finish(1, `Unable to start managed service: ${error.message}`));
  child.once("exit", (code, signal) => finish(Number.isInteger(code) ? code : 1, signal ? `Exited after ${signal}` : ""));
}

async function monitorAdoptedChild() {
  while (!stopping && isProcessAlive(adoptedPid)) await delay(250);
  if (!stopping) finish(1, "Adopted service process exited");
}

async function waitUntilStopped(wrapperPid, childPid) {
  while (!stopping && (isProcessAlive(wrapperPid) || isProcessAlive(childPid))) await delay(250);
}

async function stop(signal) {
  if (stopping) return;
  stopping = true;
  const target = duplicateOwnerPid && isProcessAlive(duplicateOwnerPid)
    ? duplicateOwnerPid
    : child?.pid || adoptedPid;
  if (target && isProcessAlive(target)) await terminateProcessTree(target, { graceMs: 4000 });
  updateState("stopped", {
    childPid: null,
    stoppedAt: new Date().toISOString(),
    stopSignal: signal,
    error: ""
  });
  process.exit(0);
}

function finish(code, error) {
  if (exitHandled || stopping) return;
  exitHandled = true;
  updateState("exited", {
    childPid: null,
    exitedAt: new Date().toISOString(),
    exitCode: code,
    error
  });
  process.exit(code);
}

function updateState(phase, extra = {}) {
  const previous = readManagedServiceState(options.stateFile) || {};
  writeManagedServiceState(options.stateFile, {
    ...previous,
    ...extra,
    serviceId: options.id,
    commandHash,
    wrapperPid: process.pid,
    phase
  });
}

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) values.set(args[index], args[index + 1]);
  for (const key of ["--id", "--state", "--working-dir", "--command"]) {
    if (!values.get(key)) fail(`Missing required argument: ${key}`);
  }
  return {
    id: values.get("--id"),
    stateFile: values.get("--state"),
    workingDir: values.get("--working-dir"),
    healthUrl: values.get("--health-url") || "",
    command: values.get("--command")
  };
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
