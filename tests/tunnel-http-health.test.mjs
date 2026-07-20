import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROBE = path.join(ROOT, "scripts", "tunnel-http-health.mjs");

test("the Process Compose tunnel probe accepts any non-server HTTP response", async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(403, { "Content-Type": "text/plain" });
    response.end("authentication required");
  });
  await listen(server);
  t.after(() => close(server));

  await assert.doesNotReject(() => execFileAsync(process.execPath, [PROBE, localUrl(server)], { timeout: 5000 }));
});

test("the Process Compose tunnel probe rejects server errors", async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(503, { "Content-Type": "text/plain" });
    response.end("not ready");
  });
  await listen(server);
  t.after(() => close(server));

  await assert.rejects(
    () => execFileAsync(process.execPath, [PROBE, localUrl(server)], { timeout: 5000 }),
    (error) => {
      assert.match(error.stderr, /HTTP 503/);
      return true;
    }
  );
});

test("the Process Compose tunnel probe rejects non-loopback targets", async () => {
  await assert.rejects(
    () => execFileAsync(process.execPath, [PROBE, "https://example.com/"], { timeout: 5000 }),
    (error) => {
      assert.match(error.stderr, /只能访问本机回环地址/);
      return true;
    }
  );
});

test("the liveness probe keeps an actively network-waiting gate alive", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "local-ops-liveness-"));
  const stateFile = path.join(directory, "state.json");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(stateFile, JSON.stringify({
    phase: "waiting_network",
    updatedAt: new Date().toISOString()
  }));
  await assert.doesNotReject(() => execFileAsync(process.execPath, [
    PROBE,
    "http://127.0.0.1:9/",
    "--allow-waiting-network",
    stateFile
  ], { timeout: 5000 }));
});

test("the readiness probe grants SSH a bounded connecting grace period", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "local-ops-readiness-"));
  const stateFile = path.join(directory, "state.json");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(stateFile, JSON.stringify({
    phase: "connecting",
    updatedAt: new Date().toISOString()
  }));
  await assert.doesNotReject(() => execFileAsync(process.execPath, [
    PROBE,
    "http://127.0.0.1:9/",
    "--allow-waiting-network",
    stateFile,
    "--connecting-grace-ms",
    "7000"
  ], { timeout: 5000 }));
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function localUrl(server) {
  return `http://127.0.0.1:${server.address().port}/`;
}
