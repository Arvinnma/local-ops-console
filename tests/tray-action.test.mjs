import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

function element() {
  return {
    addEventListener() {},
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
    textContent: ""
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
