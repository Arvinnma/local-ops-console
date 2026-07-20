import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const BASE = process.env.LOCAL_OPS_TEST_URL || "http://127.0.0.1:19090";
const CHROME = process.env.LOCAL_OPS_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "local-ops-browser-qa-"));
let chrome;

try {
  await fs.access(CHROME);
  chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });

  let chromeStderr = "";
  chrome.stderr.setEncoding("utf8");
  chrome.stderr.on("data", (chunk) => { chromeStderr += chunk; });

  const [port] = (await waitForFile(path.join(profile, "DevToolsActivePort"))).trim().split("\n");
  const targets = await waitForTargets(Number(port));
  const pageTarget = targets.find((item) => item.type === "page");
  assert.ok(pageTarget?.webSocketDebuggerUrl, "Chrome did not expose a page target");

  const cdp = await createCdpClient(pageTarget.webSocketDebuggerUrl);
  const browserMessages = [];
  cdp.on("Log.entryAdded", ({ entry }) => {
    if (["error", "warning"].includes(entry.level)) browserMessages.push(`${entry.level}: ${entry.text}`);
  });
  cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    browserMessages.push(`exception: ${exceptionDetails.text || exceptionDetails.exception?.description || "unknown"}`);
  });

  await Promise.all([
    cdp.send("Page.enable"),
    cdp.send("Runtime.enable"),
    cdp.send("Log.enable")
  ]);
  const loaded = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url: `${BASE}/#overview` });
  await loaded;
  await waitFor(async () => cdp.evaluate(`document.querySelectorAll(".resource-icon").length > 0`));

  const initial = await cdp.evaluate(`(() => {
    const icon = document.querySelector(".resource-icon");
    const iconStyle = icon ? getComputedStyle(icon) : null;
    return {
      title: document.title,
      iconCount: document.querySelectorAll(".resource-icon").length,
      inlineIconStyles: document.querySelectorAll(".resource-icon[style], .resource-icon svg[style]").length,
      iconColor: iconStyle?.color || "",
      iconBackground: iconStyle?.backgroundColor || ""
    };
  })()`);
  assert.match(initial.title, /Local Ops/);
  assert.ok(initial.iconCount > 0, "No resource icons rendered");
  assert.equal(initial.inlineIconStyles, 0, "Resource icons must not depend on CSP-blocked inline styles");
  assert.notEqual(initial.iconColor, "", "Resource icon color was not computed");
  assert.notEqual(initial.iconBackground, "", "Resource icon background was not computed");

  const menu = await cdp.evaluate(`(async () => {
    document.querySelector('[data-view="services"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const trigger = [...document.querySelectorAll(".action-more:not(:disabled)")]
      .find((item) => item.getClientRects().length && item.getBoundingClientRect().width > 0);
    if (!trigger) return { error: "No enabled action menu trigger" };
    trigger.scrollIntoView({ block: "center", inline: "center" });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    trigger.click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const popup = document.querySelector("#action-menu");
    const triggerRect = trigger.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    return {
      hidden: popup.hidden,
      itemCount: popup.querySelectorAll('[role="menuitem"]').length,
      viewport: { width: innerWidth, height: innerHeight },
      trigger: { left: triggerRect.left, top: triggerRect.top, right: triggerRect.right, bottom: triggerRect.bottom },
      popup: { left: popupRect.left, top: popupRect.top, right: popupRect.right, bottom: popupRect.bottom },
      inlineStyle: popup.getAttribute("style") || ""
    };
  })()`);
  assert.equal(menu.error, undefined, menu.error);
  assert.equal(menu.hidden, false);
  assert.ok(menu.itemCount > 0, "Action menu opened without items");
  assert.equal(menu.inlineStyle, "", "Action menu must not depend on CSP-blocked inline positioning");
  assert.ok(menu.popup.left >= 0 && menu.popup.top >= 0, `Action menu is outside the viewport: ${JSON.stringify(menu)}`);
  assert.ok(menu.popup.right <= menu.viewport.width && menu.popup.bottom <= menu.viewport.height, `Action menu overflows the viewport: ${JSON.stringify(menu)}`);
  assert.ok(Math.abs(menu.popup.top - menu.trigger.bottom) < 260 || Math.abs(menu.trigger.top - menu.popup.bottom) < 260, "Action menu is not anchored near its trigger");

  const tunnels = await cdp.evaluate(`(async () => {
    document.querySelector('[data-view="tunnels"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    return [...document.querySelectorAll("#tunnel-cards .tunnel-card")].map((card) => {
      const state = [...card.querySelector(".tunnel-card-head .status-pill").classList]
        .find((name) => ["connected", "connecting", "connection_failed", "stopped"].includes(name));
      const primary = card.querySelector(".tunnel-card-foot .row-actions > .mini-button:first-child");
      return {
        state,
        diagnosticCount: card.querySelectorAll(".tunnel-runtime > div").length,
        hasError: Boolean(card.querySelector(".tunnel-error-line")),
        primaryDisabled: Boolean(primary?.disabled),
        primaryAction: primary?.dataset.action || "",
        primaryClasses: [...(primary?.classList || [])]
      };
    });
  })()`);
  assert.ok(tunnels.length > 0, "No SSH tunnel cards rendered");
  for (const tunnel of tunnels) {
    assert.ok(tunnel.state, `Tunnel exposed an unsupported state: ${JSON.stringify(tunnel)}`);
    assert.equal(tunnel.diagnosticCount, 4, "Tunnel cards must retain exactly four diagnostic fields");
    assert.equal(tunnel.hasError, tunnel.state === "connection_failed", "Only final tunnel failures may display error text");
    if (tunnel.state === "connecting") {
      assert.equal(tunnel.primaryDisabled, true, "Connecting tunnel action must be disabled");
      assert.ok(tunnel.primaryClasses.includes("action-pending"), "Connecting tunnel action must use the grey pending style");
    }
    if (tunnel.state === "connection_failed") {
      assert.equal(tunnel.primaryAction, "retry-tunnel", "Failed tunnel must expose immediate retry");
      assert.ok(tunnel.primaryClasses.includes("action-restart"), "Failed tunnel retry must use the yellow style");
    }
    if (tunnel.state === "connected") assert.equal(tunnel.primaryAction, "stop", "Connected tunnel must expose stop");
    if (tunnel.state === "stopped") assert.equal(tunnel.primaryAction, "start", "Stopped tunnel must expose start");
  }

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 720,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });
  const responsive = await cdp.evaluate(`(async () => {
    document.querySelector('[data-view="services"]')?.click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const wrapper = document.querySelector('[data-page="services"] .table-wrap');
    return {
      overflowX: getComputedStyle(wrapper).overflowX,
      scrollWidth: wrapper.scrollWidth,
      clientWidth: wrapper.clientWidth
    };
  })()`);
  assert.equal(responsive.overflowX, "auto");
  assert.ok(responsive.scrollWidth > responsive.clientWidth, "Narrow service table is not horizontally scrollable");

  const relevantMessages = browserMessages.filter((message) => /content security policy|uncaught|exception|typeerror|referenceerror/i.test(message));
  assert.deepEqual(relevantMessages, [], `Browser errors detected:\n${relevantMessages.join("\n")}`);
  assert.doesNotMatch(chromeStderr, /content security policy/i);

  cdp.close();
  console.log("Browser QA passed: strict CSP, icons, action menus, tunnel state controls, and narrow-table scrolling");
} finally {
  if (chrome && chrome.exitCode == null) {
    const exited = new Promise((resolve) => chrome.once("exit", resolve));
    chrome.kill("SIGTERM");
    await Promise.race([exited, delay(3000)]);
  }
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
}

async function waitForFile(file, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { return await fs.readFile(file, "utf8"); } catch {}
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${file}`);
}

async function waitForTargets(port, timeout = 10000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) return response.json();
    } catch (error) { lastError = error; }
    await delay(100);
  }
  throw lastError || new Error("Timed out waiting for Chrome DevTools targets");
}

async function waitFor(predicate, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error("Timed out waiting for browser state");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createCdpClient(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result || {});
      return;
    }
    for (const listener of listeners.get(message.method) || []) listener(message.params || {});
  });
  return {
    send(method, params = {}) {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    async evaluate(expression) {
      const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed");
      }
      return result.result?.value;
    },
    on(method, listener) {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(listener);
    },
    once(method) {
      return new Promise((resolve) => {
        const listener = (params) => {
          listeners.set(method, (listeners.get(method) || []).filter((item) => item !== listener));
          resolve(params);
        };
        this.on(method, listener);
      });
    },
    close() { socket.close(); }
  };
}
