import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  canManageLoginItem,
  createLoginItemSettings,
  createStartupPresentation,
  shouldStartSilently
} = require("../desktop/startup-mode.cjs");

test("only a packaged macOS login-item launch starts silently", () => {
  assert.equal(shouldStartSilently({ platform: "darwin", isPackaged: true, wasOpenedAtLogin: true }), true);
  assert.equal(shouldStartSilently({ platform: "darwin", isPackaged: true, wasOpenedAtLogin: false }), false);
  assert.equal(shouldStartSilently({ platform: "darwin", isPackaged: true, requestedSilent: true }), true);
  assert.equal(shouldStartSilently({ platform: "darwin", isPackaged: false, wasOpenedAtLogin: true }), false);
  assert.equal(shouldStartSilently({ platform: "win32", isPackaged: true, wasOpenedAtLogin: true }), false);
});

test("a silent startup remains hidden until the user explicitly reveals it", () => {
  const presentation = createStartupPresentation(true);

  assert.equal(presentation.isSilent(), true);
  assert.equal(presentation.shouldShowWindow(), false);
  presentation.reveal();
  assert.equal(presentation.isSilent(), false);
  assert.equal(presentation.shouldShowWindow(), true);
});

test("development builds never manage the macOS login item", () => {
  assert.equal(canManageLoginItem("darwin", true), true);
  assert.equal(canManageLoginItem("darwin", false), false);
  assert.equal(canManageLoginItem("linux", true), false);
});

test("login items request hidden launch on macOS versions that support it", () => {
  assert.deepEqual(createLoginItemSettings(true), { openAtLogin: true, openAsHidden: true });
  assert.deepEqual(createLoginItemSettings(false), { openAtLogin: false, openAsHidden: true });
});
