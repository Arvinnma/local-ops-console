import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..");
export const CATALOG_PATH = path.join(ROOT, "config", "catalog.json");
export const CATALOG_EXAMPLE_PATH = path.join(ROOT, "config", "catalog.example.json");
export const TOKEN_PATH = path.join(ROOT, "config", "process-compose.token");
export const PROCESS_COMPOSE_PATH = path.join(ROOT, "generated", "process-compose.yaml");
export const WORKER_COMPOSE_PATH = path.join(ROOT, "generated", "services.yaml");
export const CADDYFILE_PATH = path.join(ROOT, "generated", "Caddyfile");
export const RUNTIME_DIR = path.join(ROOT, "runtime");

export const BINARIES = {
  processCompose: findBinary("process-compose"),
  caddy: findBinary("caddy"),
  node: process.env.LOCAL_OPS_NODE || process.execPath,
  ssh: "/usr/bin/ssh",
  docker: findBinary("docker", ["/Applications/Docker.app/Contents/Resources/bin/docker"])
};

export const PORTABLE_CONFIG_FORMAT = "local-ops-portable-config";
export const PORTABLE_CONFIG_VERSION = 1;

const PORTABLE_BOOLEAN_SETTING_KEYS = [
  "launchAppAtLogin",
  "startServicesOnAppLaunch",
  "startTunnelsOnAppLaunch"
];

const SUPPORTED_LANGUAGES = new Set(["zh-CN", "en-US"]);

const STARTUP_SETTING_KEYS = [
  ...PORTABLE_BOOLEAN_SETTING_KEYS,
  "startDockerOnAppLaunch"
];

export const SYSTEM_PROCESS_DEFINITIONS = [
  {
    id: "local-ops-console",
    name: "Local Ops 控制台",
    icon: "localops",
    kind: "system",
    namespace: "system",
    description: "本机服务、隧道和域名的可视化管理入口",
    protected: true
  },
  {
    id: "caddy",
    name: "Caddy 反向代理",
    icon: "caddy",
    kind: "system",
    namespace: "system",
    description: "将 *.localhost 域名转发到本机服务",
    protected: true
  },
  {
    id: "local-ops-worker",
    name: "服务调度器",
    icon: "server",
    kind: "system",
    namespace: "system",
    description: "独立管理用户服务和 SSH 隧道，热更新不会中断网页",
    protected: false
  }
];

export function loadCatalog() {
  const source = fs.existsSync(CATALOG_PATH) ? CATALOG_PATH : CATALOG_EXAMPLE_PATH;
  const original = JSON.parse(fs.readFileSync(source, "utf8"));
  const catalog = migrateCatalog(original);
  validateCatalog(catalog);
  if (source === CATALOG_PATH && JSON.stringify(original) !== JSON.stringify(catalog)) {
    atomicWrite(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, 0o600);
  }
  return catalog;
}

export function saveCatalog(catalog) {
  validateCatalog(catalog);
  atomicWrite(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, 0o600);
}

export function createPortableConfigExport(catalog, exportedAt = new Date().toISOString()) {
  validateCatalog(catalog);
  return {
    format: PORTABLE_CONFIG_FORMAT,
    formatVersion: PORTABLE_CONFIG_VERSION,
    exportedAt,
    config: {
      settings: {
        ...Object.fromEntries(PORTABLE_BOOLEAN_SETTING_KEYS.map((key) => [key, Boolean(catalog.settings[key])])),
        language: normalizeLanguage(catalog.settings.language)
      },
      services: structuredClone(catalog.services.filter((item) => item.kind !== "docker")),
      tunnels: structuredClone(catalog.tunnels),
      externalServices: structuredClone(catalog.externalServices),
      routes: structuredClone(catalog.routes.filter((item) => !item.system)),
      terminalTasks: structuredClone(catalog.terminalTasks)
    }
  };
}

export function applyPortableConfigImport(document, currentCatalog) {
  validateCatalog(currentCatalog);
  if (!document || document.format !== PORTABLE_CONFIG_FORMAT) {
    throw new Error("这不是 Local Ops 导出的配置文件");
  }
  if (Number(document.formatVersion) !== PORTABLE_CONFIG_VERSION) {
    throw new Error(`配置文件版本不受支持：${document.formatVersion ?? "未知"}`);
  }
  const source = document.config;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("配置文件缺少 config 内容");
  }
  if (!source.settings || typeof source.settings !== "object" || Array.isArray(source.settings)) {
    throw new Error("配置文件缺少启动设置");
  }
  for (const key of PORTABLE_BOOLEAN_SETTING_KEYS) {
    if (typeof source.settings[key] !== "boolean") throw new Error(`配置项 ${key} 必须是布尔值`);
  }
  if (source.settings.language !== undefined && !SUPPORTED_LANGUAGES.has(source.settings.language)) {
    throw new Error(`不支持的界面语言：${source.settings.language}`);
  }
  for (const key of ["services", "tunnels", "externalServices", "routes", "terminalTasks"]) {
    if (!Array.isArray(source[key])) throw new Error(`配置项 ${key} 必须是数组`);
  }

  const next = structuredClone(currentCatalog);
  for (const key of PORTABLE_BOOLEAN_SETTING_KEYS) next.settings[key] = source.settings[key];
  next.settings.language = normalizeLanguage(source.settings.language || next.settings.language);
  const localDockerServices = next.services.filter((item) => item.kind === "docker");
  next.services = [
    ...source.services.filter((item) => item?.kind !== "docker").map((item) => normalizeService(item)),
    ...localDockerServices
  ];
  next.tunnels = source.tunnels.map((item) => normalizeTunnel(item));
  next.externalServices = source.externalServices.map((item) => normalizeExternalService(item));
  next.routes = [
    ...next.routes.filter((item) => item.system),
    ...source.routes.filter((item) => !item?.system).map((item) => normalizeRoute(item))
  ];
  next.terminalTasks = source.terminalTasks.map((item) => normalizeTerminalTask(item));
  validateCatalog(next);
  return next;
}

export function portableConfigCounts(catalog) {
  return {
    services: catalog.services.filter((item) => item.kind !== "docker").length,
    tunnels: catalog.tunnels.length,
    externalServices: catalog.externalServices.length,
    routes: catalog.routes.filter((item) => !item.system).length,
    terminalTasks: catalog.terminalTasks.length
  };
}

export function renderAll(catalog = loadCatalog()) {
  validateCatalog(catalog);
  fs.mkdirSync(path.dirname(PROCESS_COMPOSE_PATH), { recursive: true });
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  atomicWrite(PROCESS_COMPOSE_PATH, renderProcessCompose(catalog), 0o600);
  atomicWrite(WORKER_COMPOSE_PATH, renderWorkerCompose(catalog), 0o600);
  atomicWrite(CADDYFILE_PATH, renderCaddyfile(catalog), 0o600);
  return { processCompose: PROCESS_COMPOSE_PATH, workerCompose: WORKER_COMPOSE_PATH, caddyfile: CADDYFILE_PATH };
}

export function validateCatalog(catalog) {
  if (!catalog || catalog.version !== 1) throw new Error("配置版本不受支持");
  const { settings } = catalog;
  for (const key of ["consolePort", "processComposePort", "workerComposePort", "caddyAdminPort", "proxyPort"]) {
    assertPort(settings?.[key], `settings.${key}`);
  }
  if (settings?.publicProxyPort !== undefined) {
    assertPort(settings.publicProxyPort, "settings.publicProxyPort");
  }
  for (const key of STARTUP_SETTING_KEYS) {
    if (typeof settings?.[key] !== "boolean") throw new Error(`settings.${key} 必须是布尔值`);
  }
  if (!SUPPORTED_LANGUAGES.has(settings?.language)) throw new Error("settings.language 不受支持");

  for (const listName of ["services", "tunnels", "externalServices", "routes", "terminalTasks"]) {
    if (!Array.isArray(catalog[listName])) throw new Error(`${listName} 必须是数组`);
  }

  const ids = new Set(SYSTEM_PROCESS_DEFINITIONS.map((item) => item.id));
  for (const service of catalog.services) {
    assertId(service.id);
    if (ids.has(service.id)) throw new Error(`名称重复：${service.id}`);
    ids.add(service.id);
    assertText(service.name, "服务名称", 80);
    assertIcon(service.icon);
    assertText(service.command, "启动命令", 2000);
    assertAbsoluteDirectory(service.workingDir);
    if (!['always', 'on_failure', 'no'].includes(service.restartPolicy)) {
      throw new Error(`服务 ${service.id} 的重启策略无效`);
    }
    if (service.healthUrl) assertLocalUrl(service.healthUrl);
  }

  for (const tunnel of catalog.tunnels) {
    assertId(tunnel.id);
    if (ids.has(tunnel.id)) throw new Error(`名称重复：${tunnel.id}`);
    ids.add(tunnel.id);
    assertText(tunnel.name, "隧道名称", 80);
    assertIcon(tunnel.icon);
    assertSafeHost(tunnel.sshHost, "SSH 主机");
    assertSafeUser(tunnel.sshUser);
    assertPort(tunnel.sshPort, "SSH 端口");
    assertSafeHost(tunnel.remoteHost, "远端目标");
    assertPort(tunnel.localPort, "本地端口");
    assertPort(tunnel.remotePort, "远端端口");
    if (!['127.0.0.1', 'localhost'].includes(tunnel.bindAddress)) {
      throw new Error("隧道只允许绑定到本机回环地址");
    }
    if (tunnel.identityFile && !path.isAbsolute(tunnel.identityFile)) {
      throw new Error("SSH 密钥路径必须是绝对路径");
    }
  }

  for (const item of catalog.externalServices) {
    assertId(item.id);
    assertText(item.name, "外部服务名称", 80);
    assertLocalTarget(item.target);
    if (item.healthPath && !String(item.healthPath).startsWith('/')) {
      throw new Error(`外部服务 ${item.id} 的健康检查路径必须以 / 开头`);
    }
  }

  const routeIds = new Set();
  const routeHosts = new Set();
  for (const route of catalog.routes) {
    assertId(route.id);
    if (routeIds.has(route.id)) throw new Error(`域名 ID 重复：${route.id}`);
    routeIds.add(route.id);
    assertText(route.name, "域名名称", 80);
    assertIcon(route.icon);
    assertLocalhostDomain(route.host);
    if (routeHosts.has(route.host)) throw new Error(`域名重复：${route.host}`);
    routeHosts.add(route.host);
    assertLocalTarget(route.target);
  }

  const terminalIds = new Set();
  for (const task of catalog.terminalTasks) {
    assertId(task.id);
    if (terminalIds.has(task.id)) throw new Error(`终端任务 ID 重复：${task.id}`);
    terminalIds.add(task.id);
    assertText(task.name, "终端任务名称", 80);
    assertIcon(task.icon);
    if (!["terminal", "iterm2"].includes(task.terminalApp)) throw new Error(`终端任务 ${task.id} 的终端类型无效`);
    if (!["command", "ssh"].includes(task.kind)) throw new Error(`终端任务 ${task.id} 的操作类型无效`);
    if (task.workingDir && !path.isAbsolute(task.workingDir)) throw new Error("终端任务工作目录必须是绝对路径");
    if (task.kind === "command") {
      assertText(task.command, "终端命令", 4000);
    } else {
      assertSafeHost(task.sshHost, "SSH 主机");
      assertSafeUser(task.sshUser);
      assertPort(task.sshPort, "SSH 端口");
      if (task.identityFile && !path.isAbsolute(task.identityFile)) throw new Error("SSH 密钥路径必须是绝对路径");
      const hasLocalPort = task.localPort !== null;
      const hasRemotePort = task.remotePort !== null;
      if (hasLocalPort !== hasRemotePort) throw new Error("终端 SSH 转发必须同时填写本地端口和远端端口");
      if (hasLocalPort) {
        assertPort(task.localPort, "本地端口");
        assertPort(task.remotePort, "远端端口");
        assertSafeHost(task.remoteHost, "远端目标");
      }
    }
  }
  return catalog;
}

export function normalizeService(input) {
  const service = {
    id: normalizeId(input.id || input.name),
    name: String(input.name || "").trim(),
    icon: normalizeIconId(input.icon, inferIcon(input, input.kind === "docker" ? "docker" : input.kind === "node" ? "nodejs" : "server")),
    kind: input.kind === "docker" ? "docker" : input.kind === "command" ? "command" : "node",
    description: String(input.description || "").trim().slice(0, 240),
    command: String(input.command || "").trim(),
    workingDir: String(input.workingDir || "").trim(),
    namespace: normalizeId(input.namespace || "services"),
    autoStart: Boolean(input.autoStart),
    restartPolicy: ['always', 'on_failure', 'no'].includes(input.restartPolicy)
      ? input.restartPolicy
      : "always",
    healthUrl: String(input.healthUrl || "").trim()
  };
  validateCatalog(validationCatalog({ services: [service] }));
  return service;
}

export function normalizeTunnel(input) {
  const tunnel = {
    id: normalizeId(input.id || input.name),
    name: String(input.name || "").trim(),
    icon: normalizeIconId(input.icon, inferIcon(input, "ssh")),
    description: String(input.description || "").trim().slice(0, 240),
    sshHost: String(input.sshHost || "").trim(),
    sshUser: String(input.sshUser || "").trim(),
    sshPort: Number(input.sshPort || 22),
    localPort: Number(input.localPort),
    remoteHost: String(input.remoteHost || "127.0.0.1").trim(),
    remotePort: Number(input.remotePort),
    bindAddress: "127.0.0.1",
    identityFile: normalizeHomePath(input.identityFile),
    autoStart: Boolean(input.autoStart)
  };
  validateCatalog(validationCatalog({ tunnels: [tunnel] }));
  return tunnel;
}

export function normalizeRoute(input) {
  const route = {
    id: normalizeId(input.id || input.name || input.host),
    name: String(input.name || "").trim(),
    icon: normalizeIconId(input.icon, inferIcon(input, "link")),
    host: String(input.host || "").trim().toLowerCase(),
    target: String(input.target || "").trim(),
    enabled: input.enabled !== false,
    system: false
  };
  validateCatalog(validationCatalog({ routes: [route] }));
  return route;
}

export function normalizeTerminalTask(input) {
  const kind = input.kind === "ssh" ? "ssh" : "command";
  const localPort = optionalPort(input.localPort);
  const remotePort = optionalPort(input.remotePort);
  const task = {
    id: normalizeId(input.id || input.name),
    name: String(input.name || "").trim(),
    icon: normalizeIconId(input.icon, inferIcon(input, kind === "ssh" ? "ssh" : "terminal")),
    description: String(input.description || "").trim().slice(0, 240),
    terminalApp: input.terminalApp === "iterm2" ? "iterm2" : "terminal",
    kind,
    command: kind === "command" ? String(input.command || "").trim() : "",
    workingDir: String(input.workingDir || "").trim(),
    sshHost: kind === "ssh" ? String(input.sshHost || "").trim() : "",
    sshUser: kind === "ssh" ? String(input.sshUser || "").trim() : "",
    sshPort: kind === "ssh" ? Number(input.sshPort || 22) : 22,
    identityFile: kind === "ssh" ? normalizeHomePath(input.identityFile) : "",
    localPort: kind === "ssh" ? localPort : null,
    remoteHost: kind === "ssh" ? String(input.remoteHost || "127.0.0.1").trim() : "127.0.0.1",
    remotePort: kind === "ssh" ? remotePort : null
  };
  validateCatalog(validationCatalog({ terminalTasks: [task] }));
  return task;
}

function normalizeExternalService(input) {
  return {
    id: normalizeId(input?.id || input?.name),
    name: String(input?.name || "").trim(),
    kind: "external",
    description: String(input?.description || "").trim().slice(0, 240),
    target: String(input?.target || "").trim(),
    healthPath: String(input?.healthPath || "/").trim() || "/"
  };
}

export function processDefinitions(catalog) {
  return [
    ...SYSTEM_PROCESS_DEFINITIONS,
    ...catalog.services.map((item) => ({ ...item, protected: false })),
    ...catalog.tunnels.map((item) => ({ ...item, kind: "tunnel", namespace: "tunnels", protected: false }))
  ];
}

export function routeUrl(catalog, route) {
  const port = publicProxyPort(catalog);
  const suffix = port === 80 ? "" : `:${port}`;
  return `http://${route.host}${suffix}`;
}

export function publicProxyPort(catalog) {
  return Number(catalog.settings.publicProxyPort || catalog.settings.proxyPort);
}

function renderProcessCompose(catalog) {
  const { settings } = catalog;
  const lines = [
    'version: "0.5"',
    'is_tui_disabled: true',
    'log_level: info',
    'log_length: 1600',
    'ordered_shutdown: true',
    'processes:'
  ];

  appendProcess(lines, "local-ops-console", {
    command: `exec ${shellQuote(BINARIES.node)} ${shellQuote(path.join(ROOT, "src", "server.mjs"))}`,
    workingDir: ROOT,
    namespace: "system",
    description: "Local Ops browser console",
    restart: "always",
    disabled: false,
    readiness: { host: "127.0.0.1", port: settings.consolePort, path: "/api/health" }
  });

  appendProcess(lines, "caddy", {
    command: `exec ${shellQuote(BINARIES.caddy)} run --config ${shellQuote(CADDYFILE_PATH)} --adapter caddyfile`,
    workingDir: ROOT,
    namespace: "system",
    description: "Local reverse proxy",
    restart: "always",
    disabled: false,
    readinessExec: `/usr/bin/nc -z 127.0.0.1 ${settings.caddyAdminPort}`,
    dependsOn: "local-ops-console"
  });

  appendProcess(lines, "local-ops-worker", {
    command: [
      "exec", shellQuote(BINARIES.processCompose),
      "--address", "127.0.0.1",
      "--port", String(settings.workerComposePort),
      "--token-file", shellQuote(TOKEN_PATH),
      "--config", shellQuote(WORKER_COMPOSE_PATH),
      "--log-file", shellQuote(path.join(RUNTIME_DIR, "services-process-compose.log")),
      "--log-no-color", "--disable-dotenv", "--keep-project", "--tui=false", "up"
    ].join(" "),
    workingDir: ROOT,
    namespace: "system",
    description: "User services and tunnels orchestrator",
    restart: "always",
    disabled: false
  });

  return `${lines.join("\n")}\n`;
}

function renderWorkerCompose(catalog) {
  const lines = [
    'version: "0.5"',
    'is_tui_disabled: true',
    'log_level: info',
    'log_length: 1600',
    'ordered_shutdown: true',
    'processes:'
  ];

  appendProcess(lines, "local-ops-worker-sentinel", {
    command: "exec /usr/bin/tail -f /dev/null",
    workingDir: ROOT,
    namespace: "system",
    description: "Keeps the user services project available when it is empty",
    restart: "always",
    disabled: false
  });

  for (const service of catalog.services) {
    appendProcess(lines, service.id, {
      command: service.command,
      workingDir: service.workingDir,
      namespace: service.namespace || "services",
      description: service.description || service.name,
      restart: service.restartPolicy,
      disabled: !service.autoStart,
      readiness: service.healthUrl ? parseHealthUrl(service.healthUrl) : null
    });
  }

  for (const tunnel of catalog.tunnels) {
    const args = [
      BINARIES.ssh,
      "-N", "-T",
      "-o", "ExitOnForwardFailure=yes",
      "-o", "ServerAliveInterval=30",
      "-o", "ServerAliveCountMax=3",
      "-o", "TCPKeepAlive=yes"
    ];
    if (tunnel.identityFile) args.push("-o", "IdentitiesOnly=yes", "-i", tunnel.identityFile);
    if (Number(tunnel.sshPort || 22) !== 22) args.push("-p", String(tunnel.sshPort));
    args.push(
      "-L",
      `${tunnel.bindAddress}:${tunnel.localPort}:${tunnel.remoteHost}:${tunnel.remotePort}`,
      `${tunnel.sshUser}@${tunnel.sshHost}`
    );
    appendProcess(lines, tunnel.id, {
      command: `exec ${args.map(shellQuote).join(" ")}`,
      workingDir: ROOT,
      namespace: "tunnels",
      description: tunnel.description || tunnel.name,
      restart: "always",
      disabled: !tunnel.autoStart
    });
  }
  return `${lines.join("\n")}\n`;
}

function appendProcess(lines, id, definition) {
  lines.push(`  ${id}:`);
  lines.push(`    command: ${yamlString(definition.command)}`);
  lines.push(`    working_dir: ${yamlString(definition.workingDir)}`);
  lines.push(`    namespace: ${yamlString(definition.namespace)}`);
  lines.push(`    description: ${yamlString(definition.description || id)}`);
  lines.push(`    disabled: ${definition.disabled ? "true" : "false"}`);
  lines.push('    disable_ansi_colors: true');
  lines.push('    availability:');
  lines.push(`      restart: ${yamlString(definition.restart || "no")}`);
  lines.push('      backoff_seconds: 2');
  if (definition.dependsOn) {
    lines.push('    depends_on:');
    lines.push(`      ${definition.dependsOn}:`);
    lines.push('        condition: process_healthy');
  }
  if (definition.readiness) {
    lines.push('    readiness_probe:');
    lines.push('      http_get:');
    lines.push(`        host: ${yamlString(definition.readiness.host)}`);
    lines.push(`        port: ${Number(definition.readiness.port)}`);
    lines.push(`        path: ${yamlString(definition.readiness.path || "/")}`);
    lines.push(`        scheme: ${yamlString(definition.readiness.scheme || "http")}`);
    lines.push('      initial_delay_seconds: 1');
    lines.push('      period_seconds: 5');
    lines.push('      timeout_seconds: 2');
    lines.push('      failure_threshold: 3');
  }
  if (definition.readinessExec) {
    lines.push('    readiness_probe:');
    lines.push('      exec:');
    lines.push(`        command: ${yamlString(definition.readinessExec)}`);
    lines.push('      initial_delay_seconds: 1');
    lines.push('      period_seconds: 5');
    lines.push('      timeout_seconds: 2');
    lines.push('      failure_threshold: 3');
  }
}

function renderCaddyfile(catalog) {
  const { caddyAdminPort, proxyPort } = catalog.settings;
  const lines = [
    '{',
    `\tadmin 127.0.0.1:${caddyAdminPort}`,
    '\tauto_https off',
    '\tpersist_config off',
    '}',
    ''
  ];
  for (const route of catalog.routes.filter((item) => item.enabled)) {
    lines.push(`http://${route.host}:${proxyPort} {`);
    lines.push('\tbind 127.0.0.1 ::1');
    lines.push('\tencode zstd gzip');
    lines.push('\theader {');
    lines.push('\t\t-Server');
    lines.push('\t\tX-Content-Type-Options "nosniff"');
    lines.push('\t\tReferrer-Policy "no-referrer"');
    lines.push('\t}');
    lines.push(`\treverse_proxy ${route.target}`);
    lines.push('}');
    lines.push('');
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function parseHealthUrl(value) {
  const url = new URL(value);
  return {
    host: url.hostname,
    port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
    path: `${url.pathname}${url.search}`,
    scheme: url.protocol.replace(":", "")
  };
}

function atomicWrite(file, content, mode) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, content, { encoding: "utf8", mode });
  fs.renameSync(temp, file);
  fs.chmodSync(file, mode);
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ""));
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function normalizeId(value) {
  const result = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  assertId(result);
  return result;
}

function assertId(value) {
  if (!/^[a-z][a-z0-9-]{1,47}$/.test(String(value || ""))) {
    throw new Error("ID 只能使用小写字母、数字和连字符，并且必须以字母开头");
  }
}

function assertText(value, label, max) {
  const text = String(value || "").trim();
  if (!text || text.length > max) throw new Error(`${label}不能为空且不能超过 ${max} 个字符`);
}

function assertPort(value, label) {
  if (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(`${label} 不是有效端口`);
  }
}

function assertAbsoluteDirectory(value) {
  if (!path.isAbsolute(String(value || ""))) throw new Error("工作目录必须是绝对路径");
}

function assertLocalUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("健康检查 URL 无效"); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("健康检查仅支持 HTTP/HTTPS");
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error("健康检查只能访问本机地址");
  }
}

function assertLocalTarget(value) {
  const match = /^(127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})$/.exec(String(value || ""));
  if (!match) throw new Error("转发目标必须是 127.0.0.1:端口 或 localhost:端口");
  assertPort(Number(match[2]), "转发目标端口");
}

function assertLocalhostDomain(value) {
  const host = String(value || "").toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.localhost$/.test(host)) {
    throw new Error("域名必须是有效的 *.localhost 地址");
  }
}

function assertSafeHost(value, label) {
  if (!/^[a-zA-Z0-9._:-]+$/.test(String(value || ""))) throw new Error(`${label} 格式无效`);
}

function assertSafeUser(value) {
  if (!/^[a-zA-Z0-9._-]+$/.test(String(value || ""))) throw new Error("SSH 用户名格式无效");
}

function assertIcon(value) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(value || ""))) throw new Error("资源图标格式无效");
}

function normalizeIconId(value, fallback = "server") {
  const icon = String(value || fallback).trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(icon) ? icon : fallback;
}

function inferIcon(input, fallback) {
  const text = `${input?.id || ""} ${input?.name || ""} ${input?.command || ""}`.toLowerCase();
  const matches = [
    ["openclaw", "openclaw"], ["hermes", "hermes"], ["caddy", "caddy"],
    ["docker", "docker"], ["node", "nodejs"], ["python", "python"],
    ["postgres", "postgresql"], ["mysql", "mysql"], ["redis", "redis"],
    ["mongodb", "mongodb"], ["github", "github"], ["ssh", "ssh"], ["terminal", "terminal"]
  ];
  return matches.find(([keyword]) => text.includes(keyword))?.[1] || fallback;
}

function normalizeHomePath(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text === "~") return os.homedir();
  if (text.startsWith("~/")) return path.join(os.homedir(), text.slice(2));
  return text;
}

function migrateCatalog(input) {
  const catalog = structuredClone(input || {});
  catalog.version = catalog.version || 1;
  catalog.settings = catalog.settings || {};
  for (const key of STARTUP_SETTING_KEYS) {
    if (typeof catalog.settings[key] !== "boolean") catalog.settings[key] = false;
  }
  catalog.settings.language = normalizeLanguage(catalog.settings.language);
  for (const key of ["services", "tunnels", "externalServices", "routes", "terminalTasks"]) {
    if (!Array.isArray(catalog[key])) catalog[key] = [];
  }
  catalog.services = catalog.services.map((item) => normalizeService(item));
  catalog.tunnels = catalog.tunnels.map((item) => normalizeTunnel({ ...item, sshPort: Number(item.sshPort || 22) }));
  catalog.routes = catalog.routes.map((item) => item.system
    ? { ...item, icon: normalizeIconId(item.icon, item.id === "console" ? "localops" : "link") }
    : normalizeRoute(item));
  catalog.terminalTasks = catalog.terminalTasks.map((item) => normalizeTerminalTask(item));
  return catalog;
}

function validationCatalog(overrides = {}) {
  return {
    version: 1,
    settings: {
      consolePort: 1,
      processComposePort: 2,
      workerComposePort: 5,
      caddyAdminPort: 3,
      proxyPort: 4,
      launchAppAtLogin: false,
      startServicesOnAppLaunch: false,
      startTunnelsOnAppLaunch: false,
      startDockerOnAppLaunch: false,
      language: "zh-CN"
    },
    services: [],
    tunnels: [],
    externalServices: [],
    routes: [],
    terminalTasks: [],
    ...overrides
  };
}

function normalizeLanguage(value) {
  return SUPPORTED_LANGUAGES.has(value) ? value : "zh-CN";
}

function optionalPort(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  return Number(value);
}

function findBinary(name, extraCandidates = []) {
  const envName = `LOCAL_OPS_${name.replaceAll("-", "_").toUpperCase()}`;
  const candidates = [
    process.env[envName],
    path.join(ROOT, "bin", name),
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    ...extraCandidates
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || name;
}
