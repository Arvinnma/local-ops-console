"use strict";

const MIN_UNPRIVILEGED_PORT = 1024;
const MAX_PORT = 65535;
const ANCHOR_PORT_TOKEN = "{{PROXY_PORT}}";

function normalizeProxyPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < MIN_UNPRIVILEGED_PORT || port > MAX_PORT) {
    throw new Error(`Caddy 内部端口必须是 ${MIN_UNPRIVILEGED_PORT}-${MAX_PORT} 之间的整数`);
  }
  return port;
}

function renderPortlessAnchor(template, proxyPort) {
  const port = normalizeProxyPort(proxyPort);
  const source = String(template || "");
  if (!source.includes(ANCHOR_PORT_TOKEN)) {
    throw new Error("无端口访问规则模板缺少端口占位符");
  }
  return source.replaceAll(ANCHOR_PORT_TOKEN, String(port));
}

function conflictingRuntimePort(settings, proxyPort) {
  const port = normalizeProxyPort(proxyPort);
  const labels = new Map([
    ["consolePort", "网页控制台"],
    ["processComposePort", "Process Compose API"],
    ["workerComposePort", "服务调度 API"],
    ["caddyAdminPort", "Caddy Admin API"]
  ]);
  for (const [key, label] of labels) {
    if (Number(settings?.[key]) === port) return label;
  }
  return "";
}

module.exports = {
  ANCHOR_PORT_TOKEN,
  MAX_PORT,
  MIN_UNPRIVILEGED_PORT,
  conflictingRuntimePort,
  normalizeProxyPort,
  renderPortlessAnchor
};
