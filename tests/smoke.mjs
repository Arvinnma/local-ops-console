import assert from "node:assert/strict";

const BASE = "http://console.localhost:19080";
const ID = "local-ops-smoke";
const bootstrap = await get("/api/bootstrap");

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  if (options.method && options.method !== "GET") headers["X-Local-Ops-Token"] = bootstrap.csrfToken;
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`);
  return payload;
}

function get(path) {
  return fetch(`${BASE}${path}`).then(async (response) => {
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || response.statusText);
    return payload;
  });
}

async function waitFor(predicate, timeout = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Timed out waiting for smoke process state");
}

try {
  const current = await api("/api/state?fresh=1");
  assert.equal(current.orchestrator.online, true);
  assert.ok(current.processes.some((item) => item.id === "caddy" && item.status === "running"));

  await api("/api/services", {
    method: "POST",
    body: {
      id: ID,
      name: "Smoke Worker",
      kind: "command",
      description: "Temporary end-to-end test process",
      command: "/opt/homebrew/bin/node -e 'console.log(\"smoke-ready\"); setInterval(() => console.log(\"smoke-tick\"), 1000)'",
      workingDir: "/tmp",
      namespace: "tests",
      autoStart: true,
      restartPolicy: "always"
    }
  });

  await waitFor(async () => {
    const state = await api("/api/state?fresh=1");
    return state.processes.find((item) => item.id === ID && item.status === "running");
  });

  const logs = await api(`/api/logs/${ID}?tail=30`);
  assert.match(logs.logs, /smoke-ready/);
  await api(`/api/processes/${ID}/restart`, { method: "POST" });
  console.log("Smoke test passed: state, create, start, logs, restart");
} finally {
  try { await api(`/api/services/${ID}`, { method: "DELETE" }); } catch {}
}
