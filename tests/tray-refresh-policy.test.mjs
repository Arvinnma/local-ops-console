import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { isTraySnapshotActionable } = require("../desktop/tray-refresh-policy.cjs");

test("background refresh keeps the last successful tray snapshot actionable", () => {
  assert.equal(isTraySnapshotActionable({
    online: true,
    hasSnapshot: true,
    snapshotState: "refreshing"
  }), true);
});

test("initial loading without a snapshot stays disabled", () => {
  assert.equal(isTraySnapshotActionable({
    online: true,
    hasSnapshot: false,
    snapshotState: "refreshing"
  }), false);
});

test("stale and offline tray snapshots stay disabled", () => {
  assert.equal(isTraySnapshotActionable({
    online: true,
    hasSnapshot: true,
    snapshotState: "stale"
  }), false);
  assert.equal(isTraySnapshotActionable({
    online: false,
    hasSnapshot: true,
    snapshotState: "fresh"
  }), false);
});
