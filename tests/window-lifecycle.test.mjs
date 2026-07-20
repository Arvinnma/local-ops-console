import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { bringWindowToFront } = require("../desktop/window-lifecycle.cjs");

function createMocks({ hidden = false, minimized = false, destroyed = false } = {}) {
  const calls = [];
  let isMinimized = minimized;
  const app = {
    isHidden: () => hidden,
    show: () => calls.push("app.show"),
    focus: (options) => calls.push(["app.focus", options])
  };
  const window = {
    isDestroyed: () => destroyed,
    isMinimized: () => isMinimized,
    restore: () => {
      isMinimized = false;
      calls.push("window.restore");
    },
    show: () => calls.push("window.show"),
    moveTop: () => calls.push("window.moveTop"),
    focus: () => calls.push("window.focus")
  };
  return { app, window, calls };
}

test("restores and activates a hidden macOS window from the menu-bar panel", () => {
  const { app, window, calls } = createMocks({ hidden: true, minimized: true });

  assert.equal(bringWindowToFront(app, window, "darwin"), true);
  assert.deepEqual(calls, [
    "app.show",
    "window.restore",
    "window.show",
    ["app.focus", { steal: true }],
    "window.show",
    "window.moveTop",
    "window.focus"
  ]);
});

test("activates an inactive macOS app even when its window is already visible", () => {
  const { app, window, calls } = createMocks();

  assert.equal(bringWindowToFront(app, window, "darwin"), true);
  assert.deepEqual(calls, [
    "app.show",
    "window.show",
    ["app.focus", { steal: true }],
    "window.show",
    "window.moveTop",
    "window.focus"
  ]);
});

test("ignores a destroyed window", () => {
  const { app, window, calls } = createMocks({ destroyed: true });

  assert.equal(bringWindowToFront(app, window, "darwin"), false);
  assert.deepEqual(calls, []);
});
