import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { tunnelDisplayState, tunnelPrimaryAction } from "../public/tunnel-ui.js";

const require = createRequire(import.meta.url);
const { resolveTunnelOperation } = require("../desktop/tunnel-action.cjs");

const fixtures = [
  {
    name: "connected",
    process: { status: "connected", active: true, healthCheck: { ok: true }, domainEntry: { configured: false } },
    expected: "stop"
  },
  {
    name: "stopped",
    process: { status: "stopped", active: false },
    expected: "start"
  },
  {
    name: "waiting network",
    process: { status: "waiting_network", active: true },
    expected: ""
  },
  {
    name: "retrying",
    process: { status: "retrying", active: true },
    expected: ""
  },
  {
    name: "terminal domain failure keeps SSH alive",
    process: {
      status: "connection_failed",
      active: true,
      healthCheck: { ok: true },
      domainEntry: { configured: true, ready: false, terminal: true }
    },
    expected: "domain-recheck"
  },
  {
    name: "terminal SSH failure starts again",
    process: { status: "connection_failed", active: false, healthCheck: { ok: false } },
    expected: "start"
  }
];

for (const fixture of fixtures) {
  test(`main UI and tray agree for ${fixture.name}`, () => {
    const displayState = tunnelDisplayState(fixture.process);
    const browser = tunnelPrimaryAction(displayState);
    const tray = resolveTunnelOperation(fixture.process);
    const browserOperation = browser.action === "retry-tunnel"
      ? fixture.process.healthCheck?.ok && fixture.process.domainEntry?.configured && !fixture.process.domainEntry?.ready
        ? "domain-recheck"
        : fixture.process.active ? "restart" : "start"
      : browser.action;

    assert.equal(tray.displayState, displayState);
    assert.equal(tray.operation, fixture.expected);
    assert.equal(browserOperation, fixture.expected);
    assert.equal(tray.disabled, browser.disabled);
  });
}

test("busy tunnel actions are disabled in the tray and present as connecting", () => {
  const result = resolveTunnelOperation({
    status: "connected",
    active: true,
    healthCheck: { ok: true },
    domainEntry: { configured: false }
  }, true);
  assert.deepEqual(result, { displayState: "connecting", operation: "", disabled: true });
});
