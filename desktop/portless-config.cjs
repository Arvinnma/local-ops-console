"use strict";

const MIN_UNPRIVILEGED_PORT = 1024;
const MAX_PORT = 65535;
const ANCHOR_PORT_TOKEN = "{{PROXY_PORT}}";
const DAEMON_PROXY_PORT_TOKEN = "{{PROXY_PORT}}";
const DAEMON_REQUEST_PATH_TOKEN = "{{REQUEST_PATH}}";

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

function renderPortlessDaemon(template, { proxyPort, requestPath } = {}) {
  const port = normalizeProxyPort(proxyPort);
  const file = String(requestPath || "");
  if (!file.startsWith("/")) throw new Error("无端口修复请求路径必须是绝对路径");
  const source = String(template || "");
  if (!source.includes(DAEMON_PROXY_PORT_TOKEN) || !source.includes(DAEMON_REQUEST_PATH_TOKEN)) {
    throw new Error("无端口 LaunchDaemon 模板缺少必要占位符");
  }
  const escapedPath = file
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
  return source
    .replaceAll(DAEMON_PROXY_PORT_TOKEN, String(port))
    .replaceAll(DAEMON_REQUEST_PATH_TOKEN, escapedPath);
}

function portlessConfigurationMatches({
  anchorTemplate,
  daemonTemplate,
  helperTemplate,
  installedAnchor,
  installedDaemon,
  installedHelper,
  proxyPort,
  requestPath
} = {}) {
  return String(installedAnchor || "") === renderPortlessAnchor(anchorTemplate, proxyPort)
    && String(installedDaemon || "") === renderPortlessDaemon(daemonTemplate, { proxyPort, requestPath })
    && String(installedHelper || "") === String(helperTemplate || "");
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
  portlessConfigurationMatches,
  renderPortlessAnchor,
  renderPortlessDaemon
};
