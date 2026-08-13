import assert from "node:assert/strict";
import test from "node:test";

import { createRefreshCoordinator } from "../src/refresh-coordinator.mjs";

test("concurrent ordinary refreshes share one computation", async () => {
  const coordinator = createRefreshCoordinator();
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const compute = async () => { calls += 1; await gate; return calls; };
  const first = coordinator.request({ key: "a", compute });
  const second = coordinator.request({ key: "a", compute });
  release();
  assert.deepEqual(await Promise.all([first, second]), [1, 1]);
  assert.equal(calls, 1);
});

test("a force refresh arriving during an ordinary refresh runs a second computation", async () => {
  const coordinator = createRefreshCoordinator();
  const releases = [];
  let calls = 0;
  const compute = () => new Promise((resolve) => {
    calls += 1;
    releases.push(() => resolve(calls));
  });
  const ordinary = coordinator.request({ key: "a", compute });
  await Promise.resolve();
  const forced = coordinator.request({ key: "a", force: true, compute });
  releases.shift()();
  assert.equal(await ordinary, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  releases.shift()();
  assert.equal(await forced, 2);
});

test("concurrent force refreshes share the same force computation", async () => {
  const coordinator = createRefreshCoordinator();
  let calls = 0;
  const compute = async () => ++calls;
  const first = coordinator.request({ key: "a", force: true, compute });
  const second = coordinator.request({ key: "a", force: true, compute });
  assert.deepEqual(await Promise.all([first, second]), [1, 1]);
  assert.equal(calls, 1);
});

test("an invalidated in-flight result is returned but never cached", async () => {
  const coordinator = createRefreshCoordinator({ cacheTtlMs: 10_000 });
  let calls = 0;
  let release;
  const first = coordinator.request({
    key: "a",
    compute: async () => {
      calls += 1;
      await new Promise((resolve) => { release = resolve; });
      return "old";
    }
  });
  await Promise.resolve();
  coordinator.invalidate();
  release();
  assert.equal(await first, "old");
  assert.equal(await coordinator.request({ key: "a", compute: async () => { calls += 1; return "new"; } }), "new");
  assert.equal(calls, 2);
});

test("a queued force refresh still runs after an ordinary failure", async () => {
  const coordinator = createRefreshCoordinator();
  let calls = 0;
  let rejectFirst;
  const ordinary = coordinator.request({
    key: "a",
    compute: () => new Promise((_resolve, reject) => { calls += 1; rejectFirst = reject; })
  });
  await Promise.resolve();
  const forced = coordinator.request({ key: "a", force: true, compute: async () => { calls += 1; return "fresh"; } });
  rejectFirst(new Error("ordinary failed"));
  await assert.rejects(ordinary, /ordinary failed/);
  assert.equal(await forced, "fresh");
  assert.equal(calls, 2);
});

test("different catalog revisions keep separate queued computations and results", async () => {
  const coordinator = createRefreshCoordinator();
  const releases = [];
  const compute = (revision) => () => new Promise((resolve) => {
    releases.push(() => resolve(revision));
  });
  const first = coordinator.request({ key: "a", compute: compute("a") });
  await Promise.resolve();
  const second = coordinator.request({ key: "b", compute: compute("b") });
  const third = coordinator.request({ key: "c", compute: compute("c") });
  releases.shift()();
  assert.equal(await first, "a");
  await new Promise((resolve) => setImmediate(resolve));
  releases.shift()();
  assert.equal(await second, "b");
  await new Promise((resolve) => setImmediate(resolve));
  releases.shift()();
  assert.equal(await third, "c");
});
