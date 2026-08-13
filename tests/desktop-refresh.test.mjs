import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { confirmControlHealth } = require("../desktop/control-health.cjs");
const { createRefreshCoordinator } = require("../desktop/refresh-coordinator.cjs");
const { operationMatches, resolveTunnelOperation } = require("../desktop/tunnel-action.cjs");

test("desktop force refresh is not swallowed by an ordinary in-flight refresh", async () => {
  const releases = [];
  let calls = 0;
  const coordinator = createRefreshCoordinator({
    load: () => new Promise((resolve) => { calls += 1; releases.push(() => resolve(calls)); })
  });
  const ordinary = coordinator.refresh(false);
  await Promise.resolve();
  const forced = coordinator.refresh(true);
  releases.shift()();
  assert.equal(await ordinary, 1);
  await new Promise((resolve) => setImmediate(resolve));
  releases.shift()();
  assert.equal(await forced, 2);
  assert.equal(calls, 2);
});

test("one failed health probe is confirmed before declaring the control plane offline", async () => {
  const probes = [{ ok: false, error: "timeout" }, { ok: true, latencyMs: 5 }];
  let waits = 0;
  const firstFailures = [];
  const result = await confirmControlHealth({
    probe: async () => probes.shift(),
    wait: async () => { waits += 1; },
    onFirstFailure: (failure) => firstFailures.push(failure.error)
  });
  assert.equal(result.ok, true);
  assert.equal(result.confirmed, true);
  assert.equal(waits, 1);
  assert.deepEqual(firstFailures, ["timeout"]);
});

test("two failed health probes declare the control plane offline with the confirmed error", async () => {
  const probes = [
    { ok: false, error: "first timeout" },
    { ok: false, error: "confirmed timeout" }
  ];
  let waits = 0;
  const result = await confirmControlHealth({
    probe: async () => probes.shift(),
    wait: async () => { waits += 1; }
  });
  assert.deepEqual(result, {
    ok: false,
    error: "confirmed timeout",
    confirmed: true,
    firstError: "first timeout"
  });
  assert.equal(waits, 1);
});

test("desktop refresh failure rejects while the owner can retain its last successful snapshot", async () => {
  let snapshot = null;
  const states = [];
  let fail = false;
  const coordinator = createRefreshCoordinator({
    load: async () => {
      if (fail) throw new Error("control plane timeout");
      snapshot = { revision: "last-good" };
      return snapshot;
    },
    onStateChange: ({ state }) => states.push(state)
  });

  await coordinator.refresh(true);
  fail = true;
  await assert.rejects(coordinator.refresh(true), /control plane timeout/);

  assert.deepEqual(snapshot, { revision: "last-good" });
  assert.deepEqual(states, ["refreshing", "fresh", "refreshing", "stale"]);
});

test("a domain-only terminal failure retries the entry without restarting SSH", () => {
  const result = resolveTunnelOperation({
    status: "connection_failed",
    active: true,
    healthCheck: { ok: true },
    domainEntry: { configured: true, ready: false, terminal: true }
  });
  assert.deepEqual(result, { displayState: "connection_failed", operation: "domain-recheck", disabled: false });
});

test("connecting tunnel actions stay disabled", () => {
  assert.deepEqual(resolveTunnelOperation({ status: "retrying", active: true }), {
    displayState: "connecting", operation: "", disabled: true
  });
});

test("a stale tray click cannot turn an old operation into a new action", () => {
  assert.equal(operationMatches("stop", "stop"), true);
  assert.equal(operationMatches("stop", "restart"), false);
  assert.equal(operationMatches("", "start"), false);
});

test("control-plane recovery requests a forced tray refresh", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => (
    readFile(new URL("../desktop/main.cjs", import.meta.url), "utf8")
  ));
  assert.match(source, /updateTray\(online, \{ forceRefresh: online \}\)/);
  assert.match(source, /refreshTraySnapshot\(forceRefresh\)/);
  assert.match(source, /scheduleReconnect[\s\S]*?updateTray\(true, \{ forceRefresh: true \}\)/);
  assert.match(source, /restartControlPlane[\s\S]*?updateTray\(true, \{ forceRefresh: true \}\)/);
});
