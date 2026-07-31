import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { enrichServiceProcess } from "../src/service-health.mjs";

test("an unavailable dashboard upstream degrades the service without stopping its process", async (t) => {
  let ready = false;
  const server = http.createServer((_request, response) => {
    response.writeHead(ready ? 200 : 503);
    response.end(ready ? "healthy" : "upstream unavailable");
  });
  await listen(server);
  t.after(() => close(server));
  const definition = {
    id: "hardware-dashboard-office",
    kind: "node",
    healthUrl: `http://127.0.0.1:${server.address().port}/api/health`
  };

  const degraded = await enrichServiceProcess(definition, runningProcess());
  assert.equal(degraded.status, "running");
  assert.equal(degraded.active, true);
  assert.equal(degraded.pid, 9876);
  assert.equal(degraded.health, "degraded");
  assert.equal(degraded.serviceReady, false);
  assert.equal(degraded.healthCheck.statusCode, 503);

  ready = true;
  const recovered = await enrichServiceProcess(definition, runningProcess());
  assert.equal(recovered.status, "running");
  assert.equal(recovered.active, true);
  assert.equal(recovered.health, "healthy");
  assert.equal(recovered.serviceReady, true);
});

test("a slow service health endpoint times out without changing process lifecycle", async (t) => {
  const server = http.createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200);
      response.end("late");
    }, 150);
  });
  await listen(server);
  t.after(() => close(server));
  const result = await enrichServiceProcess({
    id: "slow-dashboard",
    kind: "node",
    healthUrl: `http://127.0.0.1:${server.address().port}/health`
  }, runningProcess(), { timeoutMs: 30 });
  assert.equal(result.status, "running");
  assert.equal(result.active, true);
  assert.equal(result.health, "degraded");
  assert.equal(result.serviceReady, false);
  assert.match(result.healthCheck.error, /超时/);
});

test("services without healthUrl are unchanged", async () => {
  const process = runningProcess();
  assert.equal(await enrichServiceProcess({ id: "plain-service" }, process), process);
});

test("a managed port conflict stays active but degraded", async () => {
  const process = await enrichServiceProcess({
    id: "dashboard",
    healthUrl: "http://127.0.0.1:9119/"
  }, {
    ...runningProcess(),
    managedService: {
      phase: "port_conflict",
      error: "Local port 127.0.0.1:9119 is already in use by an unmanaged process"
    }
  });
  assert.equal(process.active, true);
  assert.equal(process.health, "degraded");
  assert.equal(process.serviceReady, false);
  assert.match(process.healthCheck.error, /9119/);
});

function runningProcess() {
  return {
    id: "fixture",
    status: "running",
    active: true,
    health: "running",
    pid: 9876
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}
