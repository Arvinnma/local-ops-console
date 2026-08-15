import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createPortlessRecoveryCoordinator,
  createPortlessRepairTrigger,
  portlessRecoveryFailureMessage
} = require("../desktop/portless-recovery.cjs");

function healthyContext(overrides = {}) {
  return {
    source: "runtime",
    platform: "darwin",
    configured: true,
    installed: true,
    synchronized: true,
    proxyPort: 19080,
    ...overrides
  };
}

test("skips recovery unless portless access is configured and synchronized", async () => {
  let probes = 0;
  let repairs = 0;
  const coordinator = createPortlessRecoveryCoordinator({
    probe: async () => { probes += 1; return { ok: true }; },
    triggerRepair: async () => { repairs += 1; }
  });

  assert.equal((await coordinator.check(healthyContext({ configured: false }))).status, "disabled");
  assert.equal((await coordinator.check(healthyContext({ installed: false }))).status, "not_installed_or_synchronized");
  assert.equal((await coordinator.check(healthyContext({ synchronized: false }))).status, "not_installed_or_synchronized");
  assert.equal(probes, 0);
  assert.equal(repairs, 0);
});

test("does not repair PF when the internal Caddy endpoint is unhealthy", async () => {
  let repairs = 0;
  const coordinator = createPortlessRecoveryCoordinator({
    probe: async (port) => ({ ok: false, error: `unhealthy:${port}` }),
    triggerRepair: async () => { repairs += 1; }
  });

  const result = await coordinator.check(healthyContext());
  assert.equal(result.status, "internal_unhealthy");
  assert.equal(result.internal.error, "unhealthy:19080");
  assert.equal(repairs, 0);
});

test("does not repair PF while port 80 is already healthy", async () => {
  let repairs = 0;
  const coordinator = createPortlessRecoveryCoordinator({
    probe: async () => ({ ok: true }),
    triggerRepair: async () => { repairs += 1; }
  });

  const result = await coordinator.check(healthyContext());
  assert.equal(result.status, "healthy");
  assert.equal(repairs, 0);
  assert.deepEqual(coordinator.state(), { inFlight: false, attempts: 0, cooldownUntil: 0 });
});

test("does not reload PF when port 80 is served by a foreign HTTP endpoint", async () => {
  let repairs = 0;
  const coordinator = createPortlessRecoveryCoordinator({
    probe: async (port) => port === 19080
      ? { ok: true }
      : { ok: false, repairable: false, error: "invalid health response" },
    triggerRepair: async () => { repairs += 1; }
  });

  const result = await coordinator.check(healthyContext());
  assert.equal(result.status, "port80_foreign_endpoint");
  assert.equal(repairs, 0);
  assert.equal(coordinator.state().attempts, 0);
});

test("repairs only when Caddy is healthy and port 80 fails, then verifies recovery", async () => {
  let repaired = false;
  let repairs = 0;
  const coordinator = createPortlessRecoveryCoordinator({
    probe: async (port) => ({ ok: port === 19080 || repaired, error: repaired ? "" : "ECONNREFUSED" }),
    triggerRepair: async () => { repairs += 1; repaired = true; },
    wait: async () => {},
    verifyIntervalMs: 0,
    verifyTimeoutMs: 0
  });

  const result = await coordinator.check(healthyContext({ source: "startup" }));
  assert.equal(result.status, "recovered");
  assert.equal(repairs, 1);
  assert.equal(result.attempts, 0);
  assert.equal(coordinator.state().attempts, 0);
});

test("coalesces concurrent checks into one repair", async () => {
  let releaseRepair;
  const repairGate = new Promise((resolve) => { releaseRepair = resolve; });
  let repairs = 0;
  const coordinator = createPortlessRecoveryCoordinator({
    probe: async (port) => ({ ok: port === 19080 }),
    triggerRepair: async () => { repairs += 1; await repairGate; },
    wait: async () => {},
    verifyIntervalMs: 0,
    verifyTimeoutMs: 0
  });

  const first = coordinator.check(healthyContext());
  const second = coordinator.check(healthyContext());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(repairs, 1);
  assert.equal(coordinator.state().inFlight, true);
  releaseRepair();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.status, "repair_unverified");
  assert.equal(b.status, "repair_unverified");
  assert.equal(repairs, 1);
});

test("applies increasing cooldown and a bounded repair budget", async () => {
  let timestamp = 1000;
  let repairs = 0;
  const coordinator = createPortlessRecoveryCoordinator({
    probe: async (port) => ({ ok: port === 19080, error: "ECONNREFUSED" }),
    triggerRepair: async () => { repairs += 1; },
    now: () => timestamp,
    wait: async () => {},
    cooldownMs: 100,
    budgetWindowMs: 1000,
    maxAttempts: 3,
    verifyIntervalMs: 0,
    verifyTimeoutMs: 0
  });

  assert.equal((await coordinator.check(healthyContext())).status, "repair_unverified");
  timestamp = 1050;
  assert.equal((await coordinator.check(healthyContext())).status, "cooldown");
  timestamp = 1100;
  assert.equal((await coordinator.check(healthyContext())).status, "repair_unverified");
  timestamp = 1300;
  assert.equal((await coordinator.check(healthyContext())).status, "repair_unverified");
  timestamp = 1600;
  const exhausted = await coordinator.check(healthyContext());
  assert.equal(exhausted.status, "budget_exhausted");
  assert.equal(exhausted.attempts, 3);
  assert.equal(repairs, 3);

  timestamp = 2001;
  assert.equal((await coordinator.check(healthyContext())).status, "repair_unverified");
  assert.equal(repairs, 4);
});

test("persists the App repair budget across coordinator restarts", async () => {
  let timestamp = 1000;
  let persisted = {};
  let repairs = 0;
  const makeCoordinator = () => createPortlessRecoveryCoordinator({
    probe: async (port) => ({ ok: port === 19080, error: "ECONNREFUSED" }),
    triggerRepair: async () => { repairs += 1; },
    loadBudgetState: async () => persisted,
    saveBudgetState: async (state) => { persisted = structuredClone(state); },
    now: () => timestamp,
    wait: async () => {},
    cooldownMs: 10,
    budgetWindowMs: 1000,
    maxAttempts: 3,
    verifyIntervalMs: 0,
    verifyTimeoutMs: 0
  });

  const firstApp = makeCoordinator();
  assert.equal((await firstApp.check(healthyContext())).status, "repair_unverified");
  timestamp = 1010;
  assert.equal((await firstApp.check(healthyContext())).status, "repair_unverified");
  assert.equal(persisted.attemptTimes.length, 2);

  timestamp = 1030;
  const restartedApp = makeCoordinator();
  assert.equal((await restartedApp.check(healthyContext())).status, "repair_unverified");
  timestamp = 1060;
  const exhausted = await restartedApp.check(healthyContext());
  assert.equal(exhausted.status, "budget_exhausted");
  assert.equal(exhausted.attempts, 3);
  assert.equal(repairs, 3);
});

test("does not touch PF when the persistent App budget cannot be loaded or saved", async () => {
  let repairs = 0;
  const loadFailure = createPortlessRecoveryCoordinator({
    probe: async (port) => ({ ok: port === 19080, error: "ECONNREFUSED" }),
    triggerRepair: async () => { repairs += 1; },
    loadBudgetState: async () => { throw new Error("read failed"); }
  });
  const loadResult = await loadFailure.check(healthyContext());
  assert.equal(loadResult.status, "state_unavailable");

  const saveFailure = createPortlessRecoveryCoordinator({
    probe: async (port) => ({ ok: port === 19080, error: "ECONNREFUSED" }),
    triggerRepair: async () => { repairs += 1; },
    saveBudgetState: async () => { throw new Error("write failed"); }
  });
  const saveResult = await saveFailure.check(healthyContext());
  assert.equal(saveResult.status, "state_unavailable");
  assert.equal(repairs, 0);
});

test("only a healthy or recovered portless endpoint can report enable success", () => {
  assert.equal(portlessRecoveryFailureMessage({ status: "healthy" }), "");
  assert.equal(portlessRecoveryFailureMessage({ status: "recovered" }), "");
  assert.match(portlessRecoveryFailureMessage({ status: "state_unavailable" }), /无法安全保存/);
  assert.match(portlessRecoveryFailureMessage({ status: "budget_exhausted" }), /过于频繁/);
  assert.match(portlessRecoveryFailureMessage({
    status: "repair_unverified",
    portless: { error: "ECONNREFUSED" }
  }), /ECONNREFUSED/);
});

test("the repair trigger restores Apple PF before writing one launchd request", async () => {
  const events = [];
  const writes = [];
  const trigger = createPortlessRepairTrigger({
    requestPath: "/tmp/local-ops-repair.request",
    restoreMainRules: async () => { events.push("main"); },
    writeRequest: async (file, content) => { events.push("request"); writes.push([file, content]); }
  });
  await trigger({ source: "runtime" });
  assert.deepEqual(events, ["main", "request"]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "/tmp/local-ops-repair.request");
  assert.match(writes[0][1], / runtime\n$/);
});

test("the repair trigger requires an absolute request path", () => {
  assert.throws(() => createPortlessRepairTrigger({
    requestPath: "relative.request",
    restoreMainRules: async () => {},
    writeRequest: async () => {}
  }), /absolute requestPath/);
});

test("the privileged helper only loads the child anchor after Apple PF is ready", () => {
  const helper = fs.readFileSync(new URL("../desktop/portless/com.arvin.localops.portless", import.meta.url), "utf8");
  const daemon = fs.readFileSync(new URL("../desktop/portless/com.arvin.localops.portless.plist", import.meta.url), "utf8");
  const childAnchorIndex = helper.indexOf("pfctl -a com.apple/local-ops -f");
  assert.ok(childAnchorIndex >= 0, "helper must load the child anchor");
  assert.doesNotMatch(daemon, /<key>RunAtLoad<\/key>/, "daemon must not bypass the explicit request path at login");
  assert.match(daemon, /<key>WatchPaths<\/key>/);
  assert.match(helper, /if \[ ! -f "\$REQUEST_PATH" \]/);
  assert.ok(helper.indexOf('if [ ! -f "$REQUEST_PATH" ]') < childAnchorIndex, "an explicit request must be consumed before PF is changed");
  assert.doesNotMatch(helper, /pfctl -f \/etc\/pf\.conf/);
  assert.doesNotMatch(helper, /\/usr\/sbin\/lsof/);
  assert.match(helper, /Status: Enabled/);
  assert.match(helper, /pfctl -e/);
  assert.ok(helper.indexOf("pfctl -e") < childAnchorIndex, "PF must be enabled before loading the child anchor");
  assert.match(helper, /probe_health "\$PROXY_PORT"/);
  assert.match(helper, /probe_health 80/);
  assert.match(helper, /MAX_ATTEMPTS=3/);
  assert.match(helper, /LOCK_DIR=/);
  assert.match(helper, /LOCK_PID=/);
  assert.match(helper, /kill -0 "\$holder"/);
  assert.match(helper, /repair lock is unavailable/);
});
