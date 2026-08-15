import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createPortlessRecoveryCoordinator,
  createPortlessRepairTrigger
} = require("../desktop/portless-recovery.cjs");
const installDir = path.join(os.homedir(), ".local", "share", "local-ops");
const requestPath = path.join(installDir, "runtime", "portless-repair.request");
const catalog = JSON.parse(fs.readFileSync(path.join(installDir, "config", "catalog.json"), "utf8"));
const proxyPort = Number(catalog.settings?.proxyPort || 19080);
const publicProxyPort = Number(catalog.settings?.publicProxyPort || proxyPort);

if (process.env.LOCAL_OPS_PORTLESS_SYNTHETIC !== "1") {
  throw new Error("Set LOCAL_OPS_PORTLESS_SYNTHETIC=1 only after intentionally making port 80 unavailable.");
}
assert.equal(process.platform, "darwin");
assert.equal(publicProxyPort, 80, "portless access must be configured before running the synthetic test");

function probe(port) {
  return new Promise((resolve) => {
    const request = http.get({
      hostname: "127.0.0.1",
      port,
      path: "/api/health",
      headers: { Host: "console.localhost" },
      timeout: 1500
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { if (body.length < 2048) body += chunk; });
      response.on("end", () => {
        try {
          const payload = JSON.parse(body);
          const ok = response.statusCode === 200 && payload.ok === true;
          resolve({ ok, error: ok ? "" : `HTTP ${response.statusCode}` });
        } catch {
          resolve({ ok: false, error: "invalid health response" });
        }
      });
    });
    request.on("timeout", () => { request.destroy(); resolve({ ok: false, error: "timeout" }); });
    request.on("error", (error) => resolve({ ok: false, error: error.code || error.message }));
  });
}

const internalBefore = await probe(proxyPort);
const portlessBefore = await probe(80);
assert.equal(internalBefore.ok, true, "Caddy internal health must be good before PF recovery");
assert.equal(portlessBefore.ok, false, "port 80 must be unavailable to exercise PF recovery");

const coordinator = createPortlessRecoveryCoordinator({
  probe,
  triggerRepair: createPortlessRepairTrigger({
    requestPath,
    restoreMainRules: async () => {
      const { execFile } = await import("node:child_process");
      await new Promise((resolve, reject) => execFile(
        "/bin/launchctl",
        ["kickstart", "-k", "system/com.apple.pfctl"],
        (error) => error ? reject(error) : resolve()
      ));
    },
    writeRequest: async (file, content) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, { encoding: "utf8", mode: 0o600 });
    }
  })
});
const result = await coordinator.check({
  source: "synthetic-live-test",
  platform: process.platform,
  configured: true,
  installed: true,
  synchronized: true,
  proxyPort
});
assert.equal(result.status, "recovered");
assert.equal((await probe(80)).ok, true);

console.log(JSON.stringify({
  internalBefore: internalBefore.ok,
  portlessBefore: portlessBefore.ok,
  recoveryStatus: result.status,
  portlessAfter: true
}));
