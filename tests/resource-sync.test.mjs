import test from "node:test";
import assert from "node:assert/strict";

import { bootstrapConfigChanged } from "../public/resource-sync.js";

function bootstrap(config, csrfToken = "token-a") {
  return {
    csrfToken,
    app: { name: "Local Ops" },
    config
  };
}

const baseConfig = {
  settings: { language: "zh-CN" },
  services: [],
  tunnels: [{ id: "existing-tunnel" }],
  externalServices: [],
  routes: [],
  terminalTasks: []
};

test("ignores bootstrap metadata changes when the catalog is unchanged", () => {
  assert.equal(
    bootstrapConfigChanged(bootstrap(baseConfig, "token-a"), bootstrap(structuredClone(baseConfig), "token-b")),
    false
  );
});

test("detects tunnels added through the HTTP API", () => {
  const nextConfig = structuredClone(baseConfig);
  nextConfig.tunnels.push({ id: "new-tunnel" });
  assert.equal(bootstrapConfigChanged(bootstrap(baseConfig), bootstrap(nextConfig)), true);
});

test("detects routes, terminal tasks, and settings changed outside the main window", () => {
  for (const mutate of [
    (config) => config.routes.push({ id: "new-route" }),
    (config) => config.terminalTasks.push({ id: "new-terminal-task" }),
    (config) => { config.settings.language = "en-US"; }
  ]) {
    const nextConfig = structuredClone(baseConfig);
    mutate(nextConfig);
    assert.equal(bootstrapConfigChanged(bootstrap(baseConfig), bootstrap(nextConfig)), true);
  }
});
