import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  conflictingRuntimePort,
  normalizeProxyPort,
  renderPortlessAnchor
} = require("../desktop/portless-config.cjs");

const template = [
  "rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 80 -> 127.0.0.1 port {{PROXY_PORT}}",
  "rdr pass on lo0 inet6 proto tcp from any to ::1 port 80 -> ::1 port {{PROXY_PORT}}",
  ""
].join("\n");

test("renders both PF loopback rules from the configured Caddy port", () => {
  const packagedTemplate = fs.readFileSync(new URL("../desktop/portless/com.arvin.localops.anchor", import.meta.url), "utf8");
  const anchor = renderPortlessAnchor(packagedTemplate, 19079);
  assert.match(anchor, /127\.0\.0\.1 port 80 -> 127\.0\.0\.1 port 19079/);
  assert.match(anchor, /::1 port 80 -> ::1 port 19079/);
  assert.doesNotMatch(anchor, /\{\{PROXY_PORT\}\}/);
});

test("rejects privileged, fractional, and out-of-range Caddy ports", () => {
  for (const value of [80, 1023, 19079.5, 65536, "not-a-port"]) {
    assert.throws(() => normalizeProxyPort(value), /1024-65535/);
  }
  assert.equal(normalizeProxyPort("19080"), 19080);
});

test("rejects a portless template that cannot follow the runtime port", () => {
  assert.throws(() => renderPortlessAnchor("port 19080\n", 19079), /缺少端口占位符/);
});

test("detects collisions with the other Local Ops runtime ports", () => {
  const settings = {
    consolePort: 19090,
    processComposePort: 19091,
    caddyAdminPort: 19092,
    workerComposePort: 19093
  };
  assert.equal(conflictingRuntimePort(settings, 19090), "网页控制台");
  assert.equal(conflictingRuntimePort(settings, 19093), "服务调度 API");
  assert.equal(conflictingRuntimePort(settings, 19080), "");
});
