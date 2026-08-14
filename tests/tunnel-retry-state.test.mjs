import test from "node:test";
import assert from "node:assert/strict";

import {
  TUNNEL_RETRY_LIMIT,
  createTunnelRetryState,
  registerTunnelFailure,
  resetTunnelFailures
} from "../src/tunnel-retry-state.mjs";

test("nine consecutive failures remain retryable and the tenth exhausts the episode", () => {
  let state = createTunnelRetryState();
  for (let attempt = 1; attempt <= 9; attempt += 1) {
    state = registerTunnelFailure(state, `2026-08-14T00:00:0${attempt}.000Z`);
    assert.equal(state.consecutiveFailures, attempt);
    assert.equal(state.shouldRetry, true);
    assert.equal(state.exhausted, false);
  }
  state = registerTunnelFailure(state, "2026-08-14T00:00:10.000Z");
  assert.equal(state.retryLimit, TUNNEL_RETRY_LIMIT);
  assert.equal(state.consecutiveFailures, 10);
  assert.equal(state.shouldRetry, false);
  assert.equal(state.exhausted, true);
});

test("a stable confirmation clears earlier failures and a later outage starts at one", () => {
  let state = createTunnelRetryState();
  for (let attempt = 0; attempt < 3; attempt += 1) state = registerTunnelFailure(state);
  state = resetTunnelFailures(state, "2026-08-14T06:27:11.000Z");
  assert.equal(state.consecutiveFailures, 0);
  assert.equal(state.stableAt, "2026-08-14T06:27:11.000Z");

  state = registerTunnelFailure(state, "2026-08-14T12:27:12.000Z");
  assert.equal(state.consecutiveFailures, 1);
  assert.equal(state.shouldRetry, true);
});

test("a wrapper restart resumes an unfinished failure episode but not a stable one", () => {
  const unfinished = createTunnelRetryState({
    phase: "retrying",
    consecutiveFailures: 4,
    failureEpisodeStartedAt: "2026-08-14T00:00:00.000Z",
    lastFailureAt: "2026-08-14T00:00:09.000Z"
  });
  assert.equal(unfinished.consecutiveFailures, 4);
  assert.equal(registerTunnelFailure(unfinished).consecutiveFailures, 5);

  const stable = createTunnelRetryState({
    phase: "connected",
    consecutiveFailures: 3,
    stableAt: "2026-08-14T01:00:00.000Z"
  });
  assert.equal(stable.consecutiveFailures, 0);
  assert.equal(stable.stableAt, "2026-08-14T01:00:00.000Z");
});

test("an exhausted episode remains terminal across a wrapper restart", () => {
  const terminal = createTunnelRetryState({
    phase: "connection_failed",
    consecutiveFailures: 10,
    retryLimit: 10,
    failureEpisodeStartedAt: "2026-08-14T00:00:00.000Z",
    lastFailureAt: "2026-08-14T00:00:30.000Z"
  });
  assert.equal(terminal.consecutiveFailures, 10);
  assert.equal(terminal.exhausted, true);
  assert.equal(terminal.shouldRetry, false);
});

test("failure counters are isolated per tunnel", () => {
  let first = createTunnelRetryState();
  let second = createTunnelRetryState();
  first = registerTunnelFailure(registerTunnelFailure(first));
  second = registerTunnelFailure(second);
  assert.equal(first.consecutiveFailures, 2);
  assert.equal(second.consecutiveFailures, 1);

  first = resetTunnelFailures(first);
  assert.equal(first.consecutiveFailures, 0);
  assert.equal(second.consecutiveFailures, 1);
});
