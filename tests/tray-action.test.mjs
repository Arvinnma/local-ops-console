import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

function element() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) { listeners.set(type, listener); },
    append() {},
    classList: { add() {}, remove() {} },
    dataset: {},
    disabled: false,
    hidden: true,
    querySelector() { return null; },
    querySelectorAll() { return []; },
    removeAttribute() {},
    replaceChildren() {},
    setAttribute() {},
    style: { removeProperty() {}, setProperty() {} },
    textContent: "",
    dispatch(type, event = {}) { return listeners.get(type)?.({ type, ...event }); }
  };
}

async function loadTrayRenderer(performTrayPanelAction) {
  const elements = new Map();
  const document = {
    addEventListener() {},
    createElement: element,
    documentElement: { lang: "" },
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, element());
      return elements.get(selector);
    },
    querySelectorAll() { return []; }
  };
  const window = {
    addEventListener() {},
    localOpsDesktop: {
      closeTrayPanel() {},
      getTrayPanelState: async () => ({}),
      onTrayPanelState() {},
      performTrayPanelAction
    }
  };
  const context = vm.createContext({
    cancelAnimationFrame() {},
    clearTimeout,
    document,
    requestAnimationFrame(callback) { callback(); return 1; },
    setTimeout,
    window
  });
  const source = await readFile(new URL("../desktop/tray.js", import.meta.url), "utf8");
  vm.runInContext(source, context, { filename: "desktop/tray.js" });
  return context;
}

test("the control-panel button is reusable after every show-main action", async () => {
  let calls = 0;
  const context = await loadTrayRenderer(async ({ type }) => {
    assert.equal(type, "show-main");
    calls += 1;
    return {};
  });
  const control = element();

  await context.runPanelAction({ type: "show-main" }, control);
  assert.equal(control.disabled, false);
  await context.runPanelAction({ type: "show-main" }, control);

  assert.equal(control.disabled, false);
  assert.equal(calls, 2);
});

test("resource rows only dispatch actions from a trusted click and include audit context", async () => {
  const calls = [];
  const context = await loadTrayRenderer(async (payload) => {
    calls.push(payload);
    return {};
  });
  const row = context.renderResourceRow("tunnels", {
    id: "panel-office",
    name: "1Panel",
    disabled: false,
    status: "已连接",
    action: { type: "process", id: "panel-office", kind: "tunnel", expectedOperation: "stop" }
  });

  row.dispatch("click", { isTrusted: false });
  assert.equal(calls.length, 0);
  row.dispatch("click", { isTrusted: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].eventName, "tray-panel.resource-row.click");
  assert.equal(calls[0].gestureType, "click");
  assert.equal(calls[0].expectedOperation, "stop");
  assert.match(calls[0].gestureAt, /^\d{4}-/);
});

test("desktop tray stop mutations require confirmation and send lifecycle audit headers", async () => {
  const source = await readFile(new URL("../desktop/main.cjs", import.meta.url), "utf8");
  assert.match(source, /confirmTrayProcessStop\(definition, "tray-panel"\)/);
  assert.match(source, /X-Local-Ops-Event-Name/);
  assert.match(source, /X-Local-Ops-Action-Id/);
  assert.match(source, /X-Local-Ops-Call-Path/);
  assert.match(source, /X-Local-Ops-User-Intent-Confirmed/);
});

test("desktop rejects a tray click whose expected operation no longer matches current state", async () => {
  const source = await readFile(new URL("../desktop/main.cjs", import.meta.url), "utf8");
  assert.match(source, /operationMatches\(payload\.expectedOperation, action\)/);
  assert.match(source, /tray stale-action refresh failed/);
});
