import assert from "node:assert/strict";
import test from "node:test";

import { createSnapshotRefreshCoordinator } from "../public/refresh-coordinator.js";

test("browser ordinary refreshes coalesce and a force request drains afterward", async () => {
  const calls = [];
  const releases = [];
  const coordinator = createSnapshotRefreshCoordinator({
    load(options) {
      calls.push(options);
      return new Promise((resolve) => releases.push(resolve));
    },
    apply() {}
  });
  const ordinary = coordinator.refresh();
  const duplicate = coordinator.refresh();
  const forced = coordinator.refresh({ force: true, includeDocker: true });
  await Promise.resolve();
  assert.equal(calls.length, 1);
  releases.shift()({ value: "ordinary" });
  assert.equal((await Promise.all([ordinary, duplicate]))[0].value, "ordinary");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { force: true, includeDocker: true });
  releases.shift()({ value: "fresh" });
  assert.equal((await forced).value, "fresh");
});

test("a failed ordinary refresh does not consume a queued force refresh", async () => {
  let calls = 0;
  let rejectOrdinary;
  const coordinator = createSnapshotRefreshCoordinator({
    load({ force }) {
      calls += 1;
      return force ? Promise.resolve({ fresh: true }) : new Promise((_resolve, reject) => { rejectOrdinary = reject; });
    },
    apply() {}
  });
  const ordinary = coordinator.refresh();
  await Promise.resolve();
  const forced = coordinator.refresh({ force: true });
  rejectOrdinary(new Error("offline"));
  await assert.rejects(ordinary, /offline/);
  assert.deepEqual(await forced, { fresh: true });
  assert.equal(calls, 2);
});

test("refresh state reports stale without clearing the last applied snapshot", async () => {
  const applied = [];
  const states = [];
  let fail = false;
  const coordinator = createSnapshotRefreshCoordinator({
    load: async () => {
      if (fail) throw new Error("timeout");
      return { revision: "a" };
    },
    apply: (snapshot) => applied.push(snapshot),
    onStateChange: (state) => states.push(state.state)
  });
  await coordinator.refresh({ force: true });
  fail = true;
  await assert.rejects(coordinator.refresh({ force: true }), /timeout/);
  assert.deepEqual(applied, [{ revision: "a" }]);
  assert.deepEqual(states, ["refreshing", "fresh", "refreshing", "stale"]);
});

test("opening Docker during an ordinary refresh queues one Docker snapshot", async () => {
  const calls = [];
  const releases = [];
  const coordinator = createSnapshotRefreshCoordinator({
    load(options) {
      calls.push(options);
      return new Promise((resolve) => releases.push(resolve));
    },
    apply() {}
  });
  const ordinary = coordinator.refresh({ includeDocker: false });
  await Promise.resolve();
  const docker = coordinator.refresh({ includeDocker: true });
  releases.shift()({ value: "ordinary" });
  await ordinary;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [
    { force: false, includeDocker: false },
    { force: false, includeDocker: true }
  ]);
  releases.shift()({ value: "docker" });
  assert.equal((await docker).value, "docker");
});

test("a queued fresh refresh resolves only after its snapshot has been applied", async () => {
  const releases = [];
  const applied = [];
  const coordinator = createSnapshotRefreshCoordinator({
    load: ({ force }) => new Promise((resolve) => releases.push(() => resolve({ force }))),
    apply: (snapshot) => applied.push(snapshot)
  });
  const ordinary = coordinator.refresh();
  await Promise.resolve();
  const forced = coordinator.refresh({ force: true });
  releases.shift()();
  await ordinary;
  await new Promise((resolve) => setImmediate(resolve));
  releases.shift()();
  const freshSnapshot = await forced;
  assert.deepEqual(freshSnapshot, { force: true });
  assert.deepEqual(applied, [{ force: false }, { force: true }]);
});

test("two force callers queued behind an ordinary refresh share one fresh apply", async () => {
  const releases = [];
  const calls = [];
  const applied = [];
  const coordinator = createSnapshotRefreshCoordinator({
    load: (options) => {
      calls.push(options);
      return new Promise((resolve) => releases.push(resolve));
    },
    apply: (snapshot) => applied.push(snapshot)
  });
  const ordinary = coordinator.refresh();
  await Promise.resolve();
  const firstForce = coordinator.refresh({ force: true });
  const secondForce = coordinator.refresh({ force: true });
  releases.shift()({ revision: "old" });
  await ordinary;
  await new Promise((resolve) => setImmediate(resolve));
  releases.shift()({ revision: "new" });
  assert.deepEqual(await Promise.all([firstForce, secondForce]), [
    { revision: "new" },
    { revision: "new" }
  ]);
  assert.equal(calls.length, 2);
  assert.deepEqual(applied, [{ revision: "old" }, { revision: "new" }]);
});
