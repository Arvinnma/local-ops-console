import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  processMutationActor,
  processMutationAudit,
  readProcessLifecycle,
  reconcileRememberedProcessIds,
  recordProcessActionRequest,
  recordProcessLifecycle,
  shouldAuditObservedStop
} from "../src/process-lifecycle.mjs";

test("UI/API process stop requests resolve to auditable actors", () => {
  assert.equal(processMutationActor({ "x-local-ops-requested-by": "ui" }), "ui");
  assert.equal(processMutationActor({}), "api");
  assert.equal(processMutationActor({ "x-local-ops-requested-by": "untrusted-source" }), "api");
  const browserSource = fs.readFileSync(
    path.resolve(import.meta.dirname, "../public/app.js"),
    "utf8"
  );
  assert.match(browserSource, /X-Local-Ops-Requested-By"\]\s*=\s*"ui"/);
});

test("tray mutation audit keeps the event, action id, call path, and explicit intent", () => {
  assert.deepEqual(processMutationAudit({
    "x-local-ops-event-name": "tray-panel.resource-row.click",
    "x-local-ops-action-id": "action-123",
    "x-local-ops-call-path": "tray.renderer>desktop.ipc>control-api",
    "x-local-ops-user-intent-confirmed": "true"
  }), {
    eventName: "tray-panel.resource-row.click",
    actionId: "action-123",
    callPath: "tray.renderer>desktop.ipc>control-api",
    userIntentConfirmed: true
  });
  assert.equal(processMutationAudit({}).userIntentConfirmed, undefined);
});

test("explicit UI and API stops retain their source, reason, and timestamp", (t) => {
  const fixture = lifecycleFixture(t);
  const uiAt = "2026-07-25T04:00:00.000Z";
  recordProcessActionRequest(fixture.file, {
    id: "panel-office",
    kind: "tunnel",
    action: "stop",
    requestedBy: "ui",
    at: uiAt
  });
  const apiAt = "2026-07-25T04:01:00.000Z";
  recordProcessActionRequest(fixture.file, {
    id: "hardware-monitor-office",
    kind: "tunnel",
    action: "stop",
    requestedBy: "api",
    at: apiAt
  });

  const state = readProcessLifecycle(fixture.file);
  assert.equal(state.processes["panel-office"].desiredState, "stopped");
  assert.deepEqual(state.processes["panel-office"].lastStop, {
    requestedBy: "ui",
    reason: "ui_stop",
    at: uiAt
  });
  assert.equal(state.processes["hardware-monitor-office"].desiredState, "stopped");
  assert.deepEqual(state.processes["hardware-monitor-office"].lastStop, {
    requestedBy: "api",
    reason: "api_stop",
    at: apiAt
  });
});

test("stale Completed state immediately after a requested start is not audited as a real stop", (t) => {
  const fixture = lifecycleFixture(t);
  const startedAt = "2026-07-25T06:53:08.963Z";
  const lifecycle = recordProcessActionRequest(fixture.file, {
    id: "restic-documents-office",
    kind: "tunnel",
    action: "start",
    requestedBy: "app-startup",
    at: startedAt
  });
  const staleCompleted = {
    active: false,
    status: "stopped",
    rawStatus: "completed",
    exitCode: 0
  };
  assert.equal(shouldAuditObservedStop(lifecycle, staleCompleted, {
    now: Date.parse(startedAt) + 234
  }), false);
  assert.equal(shouldAuditObservedStop(lifecycle, staleCompleted, {
    now: Date.parse(startedAt) + 5001
  }), true);
});

test("session capture preserves desired running resources across a transient stopped window", (t) => {
  const fixture = lifecycleFixture(t);
  const definitions = [
    { id: "panel-office", kind: "tunnel" },
    { id: "plain-tunnel", kind: "tunnel" }
  ];
  recordProcessLifecycle(fixture.file, {
    id: "panel-office",
    kind: "tunnel",
    desiredState: "running",
    action: "start",
    requestedBy: "app-startup",
    reason: "restore_last_session"
  });
  recordProcessLifecycle(fixture.file, {
    id: "panel-office",
    kind: "tunnel",
    action: "stop",
    requestedBy: "orchestrator",
    reason: "observed_restarting"
  });

  const remembered = reconcileRememberedProcessIds({
    file: fixture.file,
    definitions,
    activeIds: [],
    previousIds: ["panel-office"]
  });
  assert.deepEqual(remembered, ["panel-office"]);
  assert.equal(readProcessLifecycle(fixture.file).processes["panel-office"].desiredState, "running");
});

test("an explicit stop removes a resource from the remembered session", (t) => {
  const fixture = lifecycleFixture(t);
  const definitions = [{ id: "panel-office", kind: "tunnel" }];
  recordProcessLifecycle(fixture.file, {
    id: "panel-office",
    kind: "tunnel",
    desiredState: "stopped",
    action: "stop",
    requestedBy: "ui",
    reason: "ui_stop"
  });
  const remembered = reconcileRememberedProcessIds({
    file: fixture.file,
    definitions,
    activeIds: [],
    previousIds: ["panel-office"]
  });
  assert.deepEqual(remembered, []);
});

test("session capture preserves a previously remembered tunnel after an unconfirmed tray stop", (t) => {
  const fixture = lifecycleFixture(t);
  const definitions = [{ id: "panel-office", kind: "tunnel" }];
  recordProcessLifecycle(fixture.file, {
    id: "panel-office",
    kind: "tunnel",
    desiredState: "stopped",
    action: "stop",
    requestedBy: "tray",
    reason: "tray_stop"
  });
  const remembered = reconcileRememberedProcessIds({
    file: fixture.file,
    definitions,
    activeIds: [],
    previousIds: ["panel-office"],
    now: "2026-08-04T15:34:33.000Z"
  });
  assert.deepEqual(remembered, ["panel-office"]);
  const entry = readProcessLifecycle(fixture.file).processes["panel-office"];
  assert.equal(entry.desiredState, "running");
  assert.equal(entry.lastAction.reason, "preserved_unconfirmed_tray_stop");
});

test("session capture honors a confirmed tray stop", (t) => {
  const fixture = lifecycleFixture(t);
  const definitions = [{ id: "panel-office", kind: "tunnel" }];
  recordProcessActionRequest(fixture.file, {
    id: "panel-office",
    kind: "tunnel",
    action: "stop",
    requestedBy: "tray",
    userIntentConfirmed: true,
    eventName: "tray-panel.resource-row.click",
    actionId: "action-456",
    callPath: "tray.renderer>desktop.ipc>control-api"
  });
  const remembered = reconcileRememberedProcessIds({
    file: fixture.file,
    definitions,
    activeIds: [],
    previousIds: ["panel-office"]
  });
  assert.deepEqual(remembered, []);
  const stop = readProcessLifecycle(fixture.file).processes["panel-office"].lastStop;
  assert.equal(stop.userIntentConfirmed, true);
  assert.equal(stop.eventName, "tray-panel.resource-row.click");
  assert.equal(stop.actionId, "action-456");
});

test("a legacy remembered resource is migrated to desired running even while inactive", (t) => {
  const fixture = lifecycleFixture(t);
  const remembered = reconcileRememberedProcessIds({
    file: fixture.file,
    definitions: [{ id: "legacy-service", kind: "node" }],
    activeIds: [],
    previousIds: ["legacy-service"],
    now: "2026-07-25T04:02:00.000Z"
  });
  assert.deepEqual(remembered, ["legacy-service"]);
  const entry = readProcessLifecycle(fixture.file).processes["legacy-service"];
  assert.equal(entry.desiredState, "running");
  assert.equal(entry.lastAction.reason, "preserved_previous_session");
});

function lifecycleFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "local-ops-lifecycle-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, file: path.join(directory, "process-lifecycle.json") };
}
