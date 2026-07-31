import { ICON_LIBRARY, ICON_BY_ID } from "./icon-library.js?v=1.8.3";
import { getLocale, localizeDocument, normalizeLocale, setLocale, tr } from "./i18n.js?v=1.8.3";
import {
  tunnelDisplayState,
  tunnelFailureMessage,
  tunnelPrimaryAction
} from "./tunnel-ui.js?v=1.8.3";
import { bootstrapConfigChanged } from "./resource-sync.js?v=1.8.3";

const LANGUAGE_STORAGE_KEY = "local-ops-language";
setLocale(normalizeLocale(localStorage.getItem(LANGUAGE_STORAGE_KEY)));

document.documentElement.classList.toggle(
  "desktop-shell",
  location.hostname === "127.0.0.1" && location.port === "19090"
);

const ui = {
  bootstrap: null,
  state: null,
  docker: null,
  activeView: "overview",
  activeForm: "service",
  activeLogId: null,
  editing: null,
  dragging: null,
  actionMenuTrigger: null,
  iconField: null,
  orderWrites: new Map(),
  orderVersions: new Map(),
  tunnelBusy: new Set(),
  polling: null,
  busy: false,
  portless: {
    available: false,
    installed: false,
    configured: false,
    active: false,
    busy: false
  },
  loginItem: { available: false, enabled: false }
};

const titles = {
  overview: "运行总览",
  services: "服务进程",
  tunnels: "SSH 隧道",
  routes: "反向代理",
  docker: "Docker",
  terminal: "终端操作",
  settings: "控制台设置"
};

const subtitles = {
  overview: "查看本机服务、隧道和域名的实时状态。",
  services: "集中启动、停止、编辑和排序由控制面托管的进程。",
  tunnels: "管理会自动重连、仅绑定本机的 SSH 转发。",
  routes: "用容易记忆的 .localhost 域名访问本机服务。",
  docker: "查看并控制本机 Docker Engine 中的容器。",
  terminal: "保存常用命令和 SSH 连接，在选定终端中一键执行。",
  settings: "配置启动自动化、访问方式和控制面安全边界。"
};

const contexts = {
  overview: "总览",
  services: "服务",
  tunnels: "SSH 隧道",
  routes: "反向代理",
  docker: "Docker",
  terminal: "终端",
  settings: "设置"
};

const bulkStartModes = {
  overview: { scope: "all", label: "开启所有服务和 SSH 隧道", noun: "服务和 SSH 隧道" },
  services: { scope: "services", label: "开启所有服务", noun: "服务" },
  tunnels: { scope: "tunnels", label: "开启所有 SSH 隧道", noun: "SSH 隧道" },
  docker: { scope: "docker", label: "开启所有 Docker", noun: "Docker 容器" }
};

const sortDefinitions = {
  service: { configKey: "services", endpoint: "services" },
  tunnel: { configKey: "tunnels", endpoint: "tunnels" },
  route: { configKey: "routes", endpoint: "routes", filter: (item) => !item.system },
  terminal: { configKey: "terminalTasks", endpoint: "terminal-tasks" }
};

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  bindEvents();
  localizeDocument();
  try {
    ui.bootstrap = await request("/api/bootstrap");
    applyLanguage(ui.bootstrap.config.settings.language);
    renderSettings();
    await Promise.allSettled([refreshPortlessAccess(), refreshLoginItemStatus()]);
    navigate(location.hash.slice(1) || "overview");
    await refresh(true);
    ui.polling = window.setInterval(() => refresh(false), 3500);
  } catch (error) {
    setConnection(false);
    toast(error.message, "error");
  }
}

function bindEvents() {
  document.addEventListener("invalid", (event) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) return;
    if (field.validity.valueMissing) field.setCustomValidity(tr("请填写此字段。"));
  }, true);

  document.addEventListener("input", clearLocalizedValidation);
  document.addEventListener("change", clearLocalizedValidation);

  document.addEventListener("click", async (event) => {
    const menuTrigger = event.target.closest("[data-action-menu]");
    if (menuTrigger) {
      event.preventDefault();
      return toggleActionMenu(menuTrigger);
    }

    const insideActionMenu = event.target.closest("#action-menu");
    if (!insideActionMenu) closeActionMenu(false);

    const nav = event.target.closest("[data-view]");
    if (nav) return navigate(nav.dataset.view);

    const language = event.target.closest("[data-language]");
    if (language) return saveLanguage(language.dataset.language);

    const attentionJump = event.target.closest("[data-attention-jump]");
    if (attentionJump) return jumpFromAttention(attentionJump.dataset.attentionJump);

    const jump = event.target.closest("[data-jump]");
    if (jump) return navigate(jump.dataset.jump);

    const addKind = event.target.closest("[data-add-kind]");
    if (addKind) return openAddDialog(addKind.dataset.addKind);

    const iconPicker = event.target.closest("[data-icon-picker]");
    if (iconPicker) return openIconPicker(iconPicker.dataset.iconPicker);

    const iconChoice = event.target.closest("[data-icon-choice]");
    if (iconChoice) return chooseResourceIcon(iconChoice.dataset.iconChoice);

    const tab = event.target.closest("[data-form-tab]");
    if (tab && !tab.disabled) return selectFormTab(tab.dataset.formTab);

    const action = event.target.closest("[data-action]");
    if (action) {
      event.preventDefault();
      closeActionMenu(false);
      return handleAction(action.dataset.action, action.dataset.id, action);
    }

    const menuLink = event.target.closest("#action-menu [data-menu-link]");
    if (menuLink) closeActionMenu(false);
  });

  document.addEventListener("change", (event) => {
    if (event.target.id === "terminal-kind-select") updateTerminalSections();
    if (event.target.name === "tunnel-clear-passphrase") togglePassphraseRemoval("tunnel", event.target.checked);
    if (event.target.name === "terminal-clear-passphrase") togglePassphraseRemoval("terminal", event.target.checked);
    if (event.target.matches("[data-setting-key]")) void saveStartupSetting(event.target);
  });
  document.addEventListener("input", (event) => {
    if (event.target.id === "icon-search") renderIconLibrary(event.target.value);
  });

  document.addEventListener("dragstart", handleSortDragStart);
  document.addEventListener("dragover", handleSortDragOver);
  document.addEventListener("drop", handleSortDrop);
  document.addEventListener("dragend", clearSortDrag);
  document.addEventListener("keydown", (event) => {
    const menu = document.querySelector("#action-menu");
    if (event.key === "Escape" && !menu?.hidden) {
      event.preventDefault();
      closeActionMenu(true);
      return;
    }
    if (!menu?.hidden && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      const items = [...menu.querySelectorAll("[role=menuitem]")];
      if (!items.length) return;
      event.preventDefault();
      const current = items.indexOf(document.activeElement);
      const index = event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (current + 1 + items.length) % items.length
            : (current - 1 + items.length) % items.length;
      items[index].focus({ preventScroll: true });
    }
  });
  document.addEventListener("focusin", (event) => {
    const menu = document.querySelector("#action-menu");
    if (menu?.hidden || event.target.closest("#action-menu") || event.target === ui.actionMenuTrigger) return;
    closeActionMenu(false);
  });
  window.addEventListener("resize", () => closeActionMenu(false));
  window.addEventListener("scroll", () => closeActionMenu(false), true);

  document.querySelector("#refresh-button").addEventListener("click", () => refresh(true));
  document.querySelector("#attention-button").addEventListener("click", openAttentionDialog);
  document.querySelector("#attention-close").addEventListener("click", () => document.querySelector("#attention-dialog").close());
  document.querySelector("#bulk-start-button").addEventListener("click", startAllForActiveView);
  document.querySelector("#add-button").addEventListener("click", () => openAddDialog(defaultAddKind()));
  document.querySelector("#resource-form").addEventListener("submit", saveResource);
  document.querySelector("#add-close").addEventListener("click", closeResourceDialog);
  document.querySelector("#add-cancel").addEventListener("click", closeResourceDialog);
  document.querySelector("#icon-close").addEventListener("click", closeIconPicker);
  document.querySelector("#reload-button").addEventListener("click", reloadConfiguration);
  document.querySelector("#config-export-button").addEventListener("click", exportConfiguration);
  document.querySelector("#config-import-button").addEventListener("click", chooseConfigurationImport);
  document.querySelector("#config-import-file").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void importConfigurationContent(file.name, file.text());
  });
  document.querySelector("#portless-button").addEventListener("click", togglePortlessAccess);
  document.querySelector("#docker-desktop-button").addEventListener("click", startDockerDesktop);
  document.querySelector("#logs-close").addEventListener("click", () => document.querySelector("#logs-dialog").close());
  document.querySelector("#logs-refresh").addEventListener("click", () => loadLogs(ui.activeLogId));
  document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("close", restoreToastStack));
  window.addEventListener("hashchange", () => navigate(location.hash.slice(1) || "overview", false));
}

function clearLocalizedValidation(event) {
  const field = event.target;
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) {
    field.setCustomValidity("");
  }
}

function navigate(view, updateHash = true) {
  if (!titles[view]) view = "overview";
  ui.activeView = view;
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  document.querySelectorAll(".view").forEach((item) => item.classList.toggle("active", item.dataset.page === view));
  document.querySelector("#page-title").textContent = tr(titles[view]);
  document.querySelector("#page-subtitle").textContent = tr(subtitles[view]);
  document.querySelector("#page-context").textContent = tr(contexts[view]);
  document.querySelector("#add-button").hidden = ["docker", "settings"].includes(view);
  updateBulkStartButton();
  if (view === "docker") void refreshDocker(false);
  if (view === "terminal") renderTerminalTable();
  if (view === "settings") void refreshPortlessAccess();
  if (updateHash && location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
  localizeDocument();
}

async function refresh(force = false) {
  if (ui.busy && !force) return;
  try {
    const tasks = [
      request(`/api/state${force ? "?fresh=1" : ""}`),
      request("/api/bootstrap")
    ];
    if (ui.activeView === "docker") tasks.push(request(`/api/docker${force ? "?fresh=1" : ""}`));
    const [state, bootstrap, docker] = await Promise.all(tasks);
    const configChanged = bootstrapConfigChanged(ui.bootstrap, bootstrap);
    ui.bootstrap = bootstrap;
    ui.state = state;
    if (docker) ui.docker = docker;
    if (configChanged) {
      applyLanguage(bootstrap.config.settings.language);
      renderSettings();
      renderTerminalTable();
    }
    setConnection(state.orchestrator.online);
    renderState();
    if (docker) renderDocker();
  } catch (error) {
    setConnection(false);
    if (force) toast(error.message, "error");
  }
}

function renderState() {
  const { state } = ui;
  if (!state) return;
  document.querySelector("#last-sync").textContent = tr("同步于 {time}", { time: formatTime(state.generatedAt) });
  document.querySelector("#host-name").textContent = state.system.hostname;
  document.querySelector("#host-uptime").textContent = formatUptime(state.system.uptimeSeconds);
  document.querySelector("#metric-running").textContent = state.summary.running;
  document.querySelector("#metric-total").textContent = tr("共 {count} 个托管进程", { count: state.summary.total });
  document.querySelector("#metric-external").textContent = `${state.summary.externalOnline}/${state.external.length}`;
  document.querySelector("#metric-routes").textContent = state.summary.routes;
  document.querySelector("#metric-attention").textContent = attentionItems().length;
  document.querySelector("#proxy-port-label").textContent = ui.bootstrap.app.portlessAccess
    ? "Caddy · 无端口访问"
    : `Caddy · :${ui.bootstrap.app.proxyPort}`;
  document.querySelector("#hero-label").textContent = state.orchestrator.online ? "控制面运行正常" : "控制面连接异常";
  document.querySelector("#hero-beacon").className = `status-beacon ${state.orchestrator.online ? "online" : "offline"}`;

  renderOverviewProcesses();
  renderQuickRoutes();
  renderExternalTable();
  renderServicesTable();
  renderTunnelCards();
  renderRoutesTable();
  renderTerminalTable();
  updateSettingsMetrics();
  updateBulkStartButton();
  if (document.querySelector("#attention-dialog").open) renderAttentionDialog();
  localizeDocument();
}

function attentionItems() {
  if (!ui.state) return [];
  const processItems = ui.state.processes
    .filter((item) => !isProcessHealthy(item))
    .map((item) => {
      const stopped = !isProcessActive(item);
      const unhealthy = ["unhealthy", "degraded"].includes(item.health);
      return {
        id: item.id,
        name: item.name,
        icon: item.icon,
        fallbackIcon: item.kind === "tunnel" ? "ssh" : "server",
        view: item.kind === "tunnel" ? "tunnels" : "services",
        status: stopped ? item.status : "unhealthy",
        reason: item.kind === "tunnel" && item.status === "waiting_network"
          ? item.networkCheck?.error || tr("等待 SSH 主机网络恢复")
          : item.kind === "tunnel" && item.domainEntry?.configured && !item.domainEntry?.ready && item.status === "connected"
            ? item.domainEntry?.lastError || tr("域名入口尚未就绪")
          : item.kind === "tunnel" && item.lastConnectionError
            ? item.lastConnectionError
          : stopped && unhealthy
          ? `${statusLabel(item.status)} · ${tr("健康检查异常")}`
          : stopped
            ? tr("托管进程已停止")
            : tr("健康检查异常")
      };
    });
  const externalItems = ui.state.external
    .filter((item) => !item.online)
    .map((item) => {
      const route = ui.state.routes.find((candidate) => candidate.target === item.target);
      return {
        id: item.id,
        name: item.name,
        icon: route?.icon,
        fallbackIcon: "server",
        view: "external",
        status: "offline",
        reason: item.error || tr("现有服务离线")
      };
    });
  return [...processItems, ...externalItems];
}

function openAttentionDialog() {
  renderAttentionDialog();
  document.querySelector("#attention-dialog").showModal();
}

function renderAttentionDialog() {
  const list = document.querySelector("#attention-list");
  const items = attentionItems();
  list.innerHTML = items.length ? items.map((item) => `
    <article class="attention-item">
      <div class="attention-identity">
        ${resourceIcon(item.icon, item.fallbackIcon)}
        <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.reason)}</small></span>
      </div>
      <span class="status-pill ${escapeHtml(item.status)}">${statusLabel(item.status)}</span>
      <button type="button" class="text-button" data-attention-jump="${escapeAttribute(item.view)}">${tr("前往查看")}</button>
    </article>
  `).join("") : `<p class="attention-empty">${tr("当前没有需要关注的项目。")}</p>`;
  localizeDocument(list);
}

function jumpFromAttention(target) {
  document.querySelector("#attention-dialog").close();
  if (target === "external") {
    navigate("overview");
    window.setTimeout(() => document.querySelector(".external-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    return;
  }
  navigate(target);
}

function updateBulkStartButton() {
  const button = document.querySelector("#bulk-start-button");
  const label = document.querySelector("#bulk-start-label");
  const mode = bulkStartModes[ui.activeView];
  button.hidden = !mode;
  if (!mode) return;
  label.textContent = tr(mode.label);
  button.dataset.scope = mode.scope;
  const candidates = bulkStartCandidates(mode.scope);
  const waiting = mode.scope === "docker" ? !ui.docker : !ui.state;
  button.disabled = ui.busy || waiting || candidates.length === 0;
  button.title = waiting
    ? tr("等待运行状态")
    : candidates.length
      ? tr("启动 {items}", { items: bulkItemsLabel(mode, candidates) })
      : tr("所有{noun}均已运行", { noun: mode.noun });
}

function bulkStartCandidates(scope) {
  if (scope === "docker") return ui.docker?.daemonOnline ? ui.docker.containers.filter((item) => !item.running) : [];
  if (!ui.state || !ui.bootstrap) return [];
  const configured = scope === "services"
    ? ui.bootstrap.config.services
    : scope === "tunnels"
      ? ui.bootstrap.config.tunnels
      : [...ui.bootstrap.config.services, ...ui.bootstrap.config.tunnels];
  const processMap = new Map(ui.state.processes.map((item) => [item.id, item]));
  return configured.map((item) => processMap.get(item.id)).filter((item) => item && !isProcessActive(item));
}

function bulkCandidateCounts(items) {
  return items.reduce((counts, item) => {
    if (item.kind === "tunnel") counts.tunnels += 1;
    else counts.services += 1;
    return counts;
  }, { services: 0, tunnels: 0 });
}

function bulkItemsLabel(mode, items) {
  if (mode.scope === "docker") return tr("{count} 个 Docker 容器", { count: items.length });
  if (mode.scope === "services") return tr("{count} 个服务", { count: items.length });
  if (mode.scope === "tunnels") return tr("{count} 个 SSH 隧道", { count: items.length });
  const counts = bulkCandidateCounts(items);
  return getLocale() === "en-US"
    ? `${counts.services} services, ${counts.tunnels} SSH tunnels`
    : `${counts.services} 个服务，${counts.tunnels} 个 SSH 隧道`;
}

async function startAllForActiveView() {
  const mode = bulkStartModes[ui.activeView];
  if (!mode) return;
  const candidates = bulkStartCandidates(mode.scope);
  if (!candidates.length) return;
  ui.busy = true;
  updateBulkStartButton();
  toast(tr("正在启动 {items}…", { items: bulkItemsLabel(mode, candidates) }));
  try {
    if (mode.scope === "docker") {
      const result = await request("/api/docker/start-all", { method: "POST" });
      await refreshDocker(true);
      toast(tr("已启动 {items}", { items: tr("{count} 个 Docker 容器", { count: result.started }) }));
      return;
    }
    const results = await Promise.allSettled(candidates.map((item) => (
      request(`/api/processes/${encodeURIComponent(item.id)}/start`, { method: "POST" })
    )));
    await wait(450);
    await refresh(true);
    const succeeded = candidates.filter((_item, index) => results[index].status === "fulfilled");
    const failures = candidates.filter((_item, index) => results[index].status === "rejected");
    if (failures.length) toast(`已启动 ${bulkItemsLabel(mode, succeeded)}；${bulkItemsLabel(mode, failures)}启动失败`, "error");
    else toast(tr("已启动 {items}", { items: bulkItemsLabel(mode, succeeded) }));
  } catch (error) {
    toast(error.message, "error");
  } finally {
    ui.busy = false;
    updateBulkStartButton();
  }
}

function renderOverviewProcesses() {
  const container = document.querySelector("#overview-processes");
  const orderedIds = [...ui.bootstrap.config.services, ...ui.bootstrap.config.tunnels].map((item) => item.id);
  const byId = new Map(ui.state.processes.map((item) => [item.id, item]));
  const processes = [
    ...ui.state.processes.filter((item) => !orderedIds.includes(item.id)),
    ...orderedIds.map((id) => byId.get(id)).filter(Boolean)
  ].slice(0, 5);
  container.innerHTML = processes.length ? processes.map((item) => `
    <article class="resource-row">
      <div class="resource-identity">
        ${resourceIcon(item.icon, item.kind === "system" ? "server" : "nodejs")}
        <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description || item.id)}</small></span>
      </div>
      <span class="status-pill ${escapeHtml(item.status)}">${statusLabel(item.status)}</span>
      <span class="resource-meta">${item.pid ? `PID ${escapeHtml(item.pid)}` : "—"}</span>
      ${processControls(item, {}, "compact-actions")}
    </article>
  `).join("") : '<p class="empty-card">没有托管进程。</p>';
}

function renderQuickRoutes() {
  const container = document.querySelector("#quick-routes");
  const stateById = new Map(ui.state.routes.map((item) => [item.id, item]));
  const routes = ui.bootstrap.config.routes
    .map((item) => ({ ...item, ...(stateById.get(item.id) || {}) }))
    .filter((item) => item.enabled)
    .slice(0, 6);
  container.innerHTML = routes.length ? routes.map((route) => `
    <a class="route-link" href="${escapeAttribute(route.url)}" target="_blank" rel="noreferrer">
      ${resourceIcon(route.icon, "link", "route-favicon")}
      <span><strong>${escapeHtml(route.name)}</strong><small>${escapeHtml(route.url.replace("http://", ""))}</small></span>
      <span aria-hidden="true">↗</span>
    </a>
  `).join("") : '<p class="empty-card">还没有配置域名。</p>';
}

function renderExternalTable() {
  const body = document.querySelector("#external-table");
  body.innerHTML = ui.state.external.length ? ui.state.external.map((item) => {
    const route = ui.state.routes.find((candidate) => candidate.target === item.target && candidate.enabled);
    return `<tr>
      <td><div class="table-name">${resourceIcon(route?.icon, "server")}<span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description || item.id)}</small></span></div></td>
      <td class="mono">${escapeHtml(item.target)}</td>
      <td><span class="status-pill ${item.online ? "online" : "offline"}">${item.online ? `在线 · ${item.statusCode}` : "离线"}</span></td>
      <td>${item.latencyMs == null ? "—" : `${item.latencyMs} ms`}</td>
      <td class="action-cell">${route
        ? actionControls(actionLink(route.url, tr("打开"), item.name), [], item.name)
        : actionControls(disabledActionButton("open", tr("没有可用入口"), item.name), [], item.name)}</td>
    </tr>`;
  }).join("") : '<tr><td colspan="5" class="empty-cell">没有外部服务。</td></tr>';
}

function renderServicesTable() {
  const body = document.querySelector("#services-table");
  const userIds = ui.bootstrap.config.services.map((item) => item.id);
  const source = ui.state.processes.filter((item) => item.kind !== "tunnel");
  const byId = new Map(source.map((item) => [item.id, item]));
  const processes = [
    ...source.filter((item) => !userIds.includes(item.id)),
    ...userIds.map((id) => byId.get(id)).filter(Boolean)
  ];
  body.innerHTML = processes.length ? processes.map((item) => {
    const index = userIds.indexOf(item.id);
    const editable = index >= 0;
    const displayStatus = item.status === "running" && item.health === "degraded" ? "degraded" : item.status;
    return `<tr ${editable ? sortItemAttributes("service", item.id) : ""}>
      <td><div class="table-name">${resourceIcon(item.icon, item.kind === "docker" ? "docker" : "nodejs")}<span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description || item.id)}</small></span></div></td>
      <td>${escapeHtml(item.namespace)}</td>
      <td><span class="status-pill ${escapeHtml(displayStatus)}">${statusLabel(displayStatus)}</span></td>
      <td class="mono">${item.pid || "—"}</td>
      <td>${item.restarts || 0}</td>
      <td class="action-cell">${processControls(item, editable ? { editAction: "edit-service", deleteAction: "delete-service" } : {})}</td>
      <td class="sort-cell">${sortHandle("service", item.id, !editable)}</td>
    </tr>`;
  }).join("") : '<tr><td colspan="7" class="empty-cell">没有服务进程。</td></tr>';
}

function renderTunnelCards() {
  const container = document.querySelector("#tunnel-cards");
  const tunnels = ui.bootstrap.config.tunnels;
  const processMap = new Map(ui.state.processes.map((item) => [item.id, item]));
  container.innerHTML = tunnels.length ? tunnels.map((tunnel) => {
    const process = processMap.get(tunnel.id) || { id: tunnel.id, name: tunnel.name, status: "unknown", protected: false };
    const displayState = tunnelDisplayState(process, ui.tunnelBusy.has(tunnel.id));
    const failureMessage = tunnelFailureMessage(process, displayState);
    return `<article class="tunnel-card" ${sortItemAttributes("tunnel", tunnel.id)}>
      <div class="tunnel-card-head">
        <div class="tunnel-title-row">${resourceIcon(tunnel.icon, "ssh")}<div><h3>${escapeHtml(tunnel.name)}</h3><p>${escapeHtml(tunnel.description || tunnel.id)}</p></div></div>
        <span class="status-pill ${escapeHtml(displayState)}">${statusLabel(displayState)}</span>
      </div>
      <p class="tunnel-via"><span>经由</span><strong>${escapeHtml(tunnel.sshUser)}@${escapeHtml(tunnel.sshHost)}${Number(tunnel.sshPort || 22) === 22 ? "" : `:${tunnel.sshPort}`}</strong></p>
      <div class="tunnel-flow">
        <div class="tunnel-endpoint"><small>本地监听</small><strong>127.0.0.1:${tunnel.localPort}</strong></div>
        <span class="tunnel-arrow" aria-hidden="true">→</span>
        <div class="tunnel-endpoint"><small>转发目标</small><strong>${escapeHtml(tunnel.remoteHost)}:${tunnel.remotePort}</strong></div>
      </div>
      ${tunnelRuntimeDetails(process, displayState)}
      <div class="tunnel-card-foot">
        ${failureMessage ? `<div class="tunnel-error-line" data-tunnel-error title="${escapeAttribute(tr(failureMessage))}"><span>${escapeHtml(tr(failureMessage))}</span></div>` : ""}
        ${tunnelControls(process, displayState, { editAction: "edit-tunnel", deleteAction: "delete-tunnel" })}${sortHandle("tunnel", tunnel.id)}
      </div>
    </article>`;
  }).join("") : '<p class="empty-card">还没有添加 SSH 隧道。点击右上角开始添加。</p>';
  window.requestAnimationFrame(updateTunnelErrorMarquees);
}

function tunnelRuntimeDetails(process, displayState) {
  const health = process.healthCheck || {};
  const readiness = process.readinessCheck || {};
  const network = process.networkCheck || {};
  const entry = process.domainEntry || {};
  const healthResult = readiness.configured
    ? readiness.ok
      ? `HTTP ${readiness.statusCode}${readiness.latencyMs == null ? "" : ` · ${readiness.latencyMs} ms`}`
      : tr("未就绪")
    : health.ok
      ? `${tr("TCP 已连通")}${health.latencyMs == null ? "" : ` · ${health.latencyMs} ms`}`
      : statusLabel(displayState);
  const sshStatus = health.ok
    ? tr("已连接")
    : displayState === "stopped"
      ? tr("已停止")
      : displayState === "connection_failed"
        ? tr("连接失败")
        : tr("连接中");
  const entryStatus = !entry.configured
    ? tr("未配置")
    : entry.ready
      ? tr("已就绪")
      : tr("未就绪");
  const entryClass = entry.ready ? "runtime-ready" : entry.configured ? "runtime-not-ready" : "runtime-neutral";
  const networkResult = network.delegated || network.mode === "ssh-managed"
    ? tr("由 SSH 建立")
    : process.status === "waiting_network"
    ? tr("等待网络")
    : network.ok
      ? `${tr("可连接")}${network.latencyMs == null ? "" : ` · ${network.latencyMs} ms`}`
      : tr("尚未验证");
  return `<div class="tunnel-runtime">
    <div class="tunnel-layer-state"><small>${tr("SSH 隧道")}</small><strong class="${health.ok ? "runtime-ready" : displayState === "connecting" ? "runtime-pending" : "runtime-not-ready"}" title="${escapeAttribute(health.target || "")}">${escapeHtml(sshStatus)}</strong></div>
    <div class="tunnel-layer-state"><small>${tr("域名入口")}</small><strong class="${entryClass}" title="${escapeAttribute(entry.target || entry.lastError || "")}">${escapeHtml(entryStatus)}</strong></div>
    <div><small>${tr("SSH 主机网络")}</small><strong title="${escapeAttribute(network.target || "")}">${escapeHtml(networkResult)}</strong></div>
    <div><small>${tr("隧道健康检查")}</small><strong title="${escapeAttribute(readiness.target || readiness.error || health.target || "")}">${escapeHtml(healthResult)}</strong></div>
  </div>`;
}

function updateTunnelErrorMarquees() {
  document.querySelectorAll("[data-tunnel-error]").forEach((element) => {
    const content = element.querySelector("span");
    if (!content) return;
    const distance = Math.ceil(content.scrollWidth - element.clientWidth);
    const overflowing = distance > 4;
    element.classList.toggle("is-overflowing", overflowing);
    if (overflowing) {
      element.style.setProperty("--tunnel-error-distance", `${distance}px`);
      element.style.setProperty("--tunnel-error-duration", `${Math.max(6, Math.min(18, distance / 28 + 5))}s`);
    } else {
      element.style.removeProperty("--tunnel-error-distance");
      element.style.removeProperty("--tunnel-error-duration");
    }
  });
}

function renderRoutesTable() {
  const body = document.querySelector("#routes-table");
  const configuredRoutes = ui.bootstrap.config.routes;
  const userRoutes = configuredRoutes.filter((item) => !item.system);
  const userIds = userRoutes.map((item) => item.id);
  const stateById = new Map(ui.state.routes.map((item) => [item.id, item]));
  const routes = configuredRoutes.map((item) => ({ ...item, ...(stateById.get(item.id) || {}) }));
  body.innerHTML = routes.length ? routes.map((route) => {
    const index = userIds.indexOf(route.id);
    const editable = index >= 0;
    return `<tr ${editable ? sortItemAttributes("route", route.id) : ""}>
      <td><div class="table-name">${resourceIcon(route.icon, route.system ? "localops" : "link")}<span><strong>${escapeHtml(route.name)}</strong><small>${escapeHtml(route.id)}</small></span></div></td>
      <td><a class="table-link mono" href="${escapeAttribute(route.url)}" target="_blank" rel="noreferrer">${escapeHtml(route.url)}</a></td>
      <td class="mono">${escapeHtml(route.target)}</td>
      <td><span class="status-pill ${route.entryReady === true ? "online" : route.entryReady === false ? "offline" : route.enabled ? "online" : "disabled"}">${route.entryReady === true ? tr("已就绪") : route.entryReady === false ? tr("未就绪") : route.enabled ? tr("已启用") : tr("已禁用")}</span></td>
      <td class="action-cell">${routeControls(route, editable)}</td>
      <td class="sort-cell">${sortHandle("route", route.id, !editable)}</td>
    </tr>`;
  }).join("") : '<tr><td colspan="6" class="empty-cell">还没有配置本地域名。</td></tr>';
}

function renderTerminalTable() {
  if (!ui.bootstrap) return;
  const body = document.querySelector("#terminal-table");
  const tasks = ui.bootstrap.config.terminalTasks || [];
  body.innerHTML = tasks.length ? tasks.map((task) => `<tr ${sortItemAttributes("terminal", task.id)}>
    <td><div class="table-name">${resourceIcon(task.icon, "terminal")}<span><strong>${escapeHtml(task.name)}</strong><small>${escapeHtml(task.description || task.id)}</small></span></div></td>
    <td><span class="type-badge">${task.kind === "ssh" ? "SSH" : "命令"}</span></td>
    <td>${task.terminalApp === "iterm2" ? "iTerm2" : "系统终端"}</td>
    <td class="mono terminal-summary">${escapeHtml(terminalTaskSummary(task))}</td>
    <td class="action-cell">${actionControls(
      actionButton("run-terminal", task.id, tr("执行"), task.name),
      [menuAction("edit-terminal", task.id, tr("编辑"), task.name), menuAction("delete-terminal", task.id, tr("删除"), task.name)],
      task.name
    )}</td>
    <td class="sort-cell">${sortHandle("terminal", task.id)}</td>
  </tr>`).join("") : '<tr><td colspan="6" class="empty-cell">还没有终端操作。点击右上角开始添加。</td></tr>';
}

function terminalTaskSummary(task) {
  if (task.kind === "command") return task.command;
  const destination = `${task.sshUser}@${task.sshHost}${Number(task.sshPort || 22) === 22 ? "" : `:${task.sshPort}`}`;
  return task.localPort == null ? destination : `${destination} · 127.0.0.1:${task.localPort} → ${task.remoteHost}:${task.remotePort}`;
}

async function refreshDocker(force = false) {
  try {
    ui.docker = await request(`/api/docker${force ? "?fresh=1" : ""}`);
    renderDocker();
    updateBulkStartButton();
  } catch (error) {
    toast(error.message, "error");
  }
}

function renderDocker() {
  const runtime = document.querySelector("#docker-runtime-state");
  const notice = document.querySelector("#docker-notice");
  const title = document.querySelector("#docker-notice-title");
  const copy = document.querySelector("#docker-notice-copy");
  const desktopButton = document.querySelector("#docker-desktop-button");
  const body = document.querySelector("#docker-table");
  const docker = ui.docker;
  if (!docker) return;

  if (!docker.available) {
    runtime.innerHTML = '<span class="status-pill stopped">未安装</span>';
    notice.hidden = false;
    title.textContent = "没有找到 Docker CLI";
    copy.textContent = "请先安装 Docker Desktop，再重新打开 Local Ops。";
    desktopButton.hidden = true;
    body.innerHTML = '<tr><td colspan="6" class="empty-cell">Docker 尚未安装。</td></tr>';
    localizeDocument(document.querySelector('[data-page="docker"]'));
    return;
  }
  if (!docker.daemonOnline) {
    runtime.innerHTML = '<span class="status-pill stopped">Engine 未运行</span>';
    notice.hidden = false;
    title.textContent = "Docker Engine 尚未运行";
    copy.textContent = /cannot connect to the docker daemon/i.test(docker.error || "")
      ? "启动 Docker Desktop，等待 Engine 就绪后即可管理本机容器。"
      : docker.error || "启动 Docker Desktop 后即可管理本机容器。";
    desktopButton.hidden = !docker.appInstalled;
    body.innerHTML = '<tr><td colspan="6" class="empty-cell">等待 Docker Engine 启动。</td></tr>';
    localizeDocument(document.querySelector('[data-page="docker"]'));
    return;
  }
  notice.hidden = true;
  runtime.innerHTML = `<span class="status-pill online">Engine ${escapeHtml(docker.serverVersion || "在线")}</span><span class="muted-label">${docker.containers.length} 个容器</span>`;
  body.innerHTML = docker.containers.length ? docker.containers.map((item) => `<tr>
    <td><div class="table-name">${resourceIcon("docker", "docker")}<span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.shortId)}</small></span></div></td>
    <td class="mono docker-image">${escapeHtml(item.image)}</td>
    <td><span class="status-pill ${item.running ? "running" : "stopped"}">${dockerStateLabel(item.state)}</span><small class="docker-status-copy">${escapeHtml(item.status)}</small></td>
    <td class="mono docker-ports">${escapeHtml(item.ports || "—")}</td>
    <td>${escapeHtml(item.composeProject || "—")}${item.composeService ? `<small class="docker-status-copy">${escapeHtml(item.composeService)}</small>` : ""}</td>
    <td class="action-cell">${dockerControls(item)}</td>
  </tr>`).join("") : '<tr><td colspan="6" class="empty-cell">Docker Engine 在线，但还没有容器。</td></tr>';
  localizeDocument(document.querySelector('[data-page="docker"]'));
}

function dockerStateLabel(state) {
  return tr(({ running: "运行中", exited: "已停止", created: "已创建", paused: "已暂停", restarting: "重启中", dead: "异常" })[state] || state);
}

async function startDockerDesktop() {
  const button = document.querySelector("#docker-desktop-button");
  button.disabled = true;
  try {
    await request("/api/docker/desktop/start", { method: "POST" });
    toast("已请求启动 Docker Desktop，Engine 就绪后列表会自动刷新");
    await wait(1800);
    await refreshDocker(true);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function renderSettings() {
  if (!ui.bootstrap) return;
  const settings = ui.bootstrap.config.settings;
  const publicPort = Number(settings.publicProxyPort || settings.proxyPort);
  document.querySelector("#settings-list").innerHTML = `
    <div><dt>网页控制台</dt><dd>127.0.0.1:${settings.consolePort}</dd></div>
    <div><dt>访问地址</dt><dd>${publicPort === 80 ? "*.localhost" : `*.localhost:${publicPort}`}</dd></div>
    <div><dt>Caddy 内部端口</dt><dd>127.0.0.1:${settings.proxyPort}</dd></div>
    <div><dt>Process Compose API</dt><dd>127.0.0.1:${settings.processComposePort}</dd></div>
    <div><dt>服务调度 API</dt><dd>127.0.0.1:${settings.workerComposePort}</dd></div>
    <div><dt>Caddy Admin API</dt><dd>127.0.0.1:${settings.caddyAdminPort}</dd></div>
    <div><dt>内存占用</dt><dd id="settings-memory">等待同步</dd></div>
  `;
  document.querySelectorAll("[data-setting-key]").forEach((input) => {
    input.checked = Boolean(settings[input.dataset.settingKey]);
    input.disabled = false;
  });
  renderLanguageControls();
  renderPortlessAccess();
  updateSettingsMetrics();
  localizeDocument();
}

function renderLanguageControls() {
  document.querySelectorAll("[data-language]").forEach((button) => {
    const active = button.dataset.language === getLocale();
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function applyLanguage(language) {
  const normalized = setLocale(normalizeLocale(language));
  localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
  if (ui.bootstrap?.config?.settings) ui.bootstrap.config.settings.language = normalized;
  document.title = tr("Local Ops · 本机服务控制台");
  renderLanguageControls();
  navigate(ui.activeView, false);
  if (ui.state) renderState();
  if (ui.docker) renderDocker();
  localizeDocument();
  return normalized;
}

async function saveLanguage(language) {
  const previous = getLocale();
  const next = normalizeLocale(language);
  if (next === previous) return;
  document.querySelectorAll("[data-language]").forEach((button) => { button.disabled = true; });
  applyLanguage(next);
  try {
    const result = await request("/api/settings", { method: "PATCH", body: { language: next } });
    ui.bootstrap.config.settings = result.settings;
    renderSettings();
    toast(tr("界面语言已切换"));
  } catch (error) {
    applyLanguage(previous);
    toast(tr(error.message), "error");
  } finally {
    document.querySelectorAll("[data-language]").forEach((button) => { button.disabled = false; });
    renderLanguageControls();
  }
}

async function exportConfiguration() {
  setConfigTransferBusy(true);
  try {
    const configuration = await request("/api/config/export");
    const content = `${JSON.stringify(configuration, null, 2)}\n`;
    const suggestedName = `local-ops-config-${localDateStamp()}.json`;
    if (window.localOpsDesktop?.saveConfigurationFile) {
      const result = await window.localOpsDesktop.saveConfigurationFile(content, suggestedName);
      if (result?.canceled) return;
      toast(tr("配置已导出为 {name}", { name: result.fileName || suggestedName }));
      return;
    }
    const blobUrl = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = suggestedName;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
    toast(tr("配置已导出，Docker 内容未包含"));
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setConfigTransferBusy(false);
  }
}

async function chooseConfigurationImport() {
  try {
    if (window.localOpsDesktop?.openConfigurationFile) {
      const result = await window.localOpsDesktop.openConfigurationFile();
      if (result?.canceled) return;
      return importConfigurationContent(result.fileName || tr("配置文件"), Promise.resolve(result.content || ""));
    }
    document.querySelector("#config-import-file").click();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function importConfigurationContent(fileName, contentPromise) {
  setConfigTransferBusy(true);
  try {
    const content = await contentPromise;
    if (content.length > 2 * 1024 * 1024) throw new Error(tr("配置文件不能超过 2 MB"));
    let configuration;
    try { configuration = JSON.parse(content); } catch { throw new Error(tr("配置文件不是有效的 JSON")); }
    const confirmed = window.confirm(getLocale() === "en-US"
      ? `Importing “${fileName}” will replace the current services, SSH tunnels, existing-service monitors, reverse proxies, terminal actions, interface language, and startup preferences.\n\nDocker resources, remembered runtime state, system ports, and local administrator authorization will not change. Export a backup first if needed.\n\nContinue?`
      : `将从“${fileName}”替换当前的服务、SSH 隧道、现有服务、反向代理、终端操作、界面语言和启动偏好。\n\nDocker 资源、记忆的运行状态、系统端口和本机管理员授权不会改变。建议导入前先导出一份备份。\n\n确定继续吗？`
    );
    if (!confirmed) return;
    const result = await request("/api/config/import", { method: "POST", body: configuration });
    if (window.localOpsDesktop?.setLoginItemEnabled && result.settings) {
      await window.localOpsDesktop.setLoginItemEnabled(Boolean(result.settings.launchAppAtLogin));
    }
    await reloadBootstrap();
    await refresh(true);
    const counts = result.counts || {};
    const total = [counts.services, counts.tunnels, counts.externalServices, counts.routes, counts.terminalTasks]
      .reduce((sum, value) => sum + Number(value || 0), 0);
    toast(tr("已导入 {count} 项配置，Docker 保持原状", { count: total }));
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setConfigTransferBusy(false);
  }
}

function setConfigTransferBusy(busy) {
  document.querySelector("#config-export-button").disabled = busy;
  document.querySelector("#config-import-button").disabled = busy;
}

function localDateStamp(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function saveStartupSetting(input) {
  const key = input.dataset.settingKey;
  const enabled = input.checked;
  input.disabled = true;
  try {
    await request("/api/settings", { method: "PATCH", body: { [key]: enabled } });
    if (key === "launchAppAtLogin" && window.localOpsDesktop?.setLoginItemEnabled) {
      ui.loginItem = await window.localOpsDesktop.setLoginItemEnabled(enabled);
    }
    await reloadBootstrap();
    toast(tr("启动设置已保存"));
  } catch (error) {
    input.checked = !enabled;
    input.disabled = false;
    toast(error.message, "error");
  }
}

async function refreshLoginItemStatus() {
  if (!window.localOpsDesktop?.getLoginItemStatus) return;
  try { ui.loginItem = await window.localOpsDesktop.getLoginItemStatus(); } catch {}
}

async function refreshPortlessAccess() {
  if (!window.localOpsDesktop?.getPortlessStatus) {
    ui.portless = {
      ...ui.portless,
      available: false,
      installed: Boolean(ui.bootstrap?.app.portlessAccess),
      configured: Boolean(ui.bootstrap?.app.portlessAccess),
      active: Boolean(ui.bootstrap?.app.portlessAccess),
      busy: false
    };
    renderPortlessAccess();
    return;
  }
  try {
    ui.portless = { ...ui.portless, ...await window.localOpsDesktop.getPortlessStatus(), available: true, busy: false };
  } catch (error) {
    ui.portless = { ...ui.portless, available: true, active: false, busy: false, error: error.message };
  }
  renderPortlessAccess();
}

function renderPortlessAccess() {
  const status = document.querySelector("#portless-status");
  const description = document.querySelector("#portless-description");
  const button = document.querySelector("#portless-button");
  if (!status || !description || !button) return;
  const ready = ui.portless.installed && ui.portless.configured && ui.portless.active;
  status.className = `status-pill ${ready ? "online" : ui.portless.error ? "stopped" : "unknown"}`;
  if (ui.portless.busy) {
    status.textContent = "等待授权";
    description.textContent = "请在 macOS 系统窗口中输入管理员密码。";
    button.textContent = "正在处理…";
    button.disabled = true;
    localizeDocument(button.closest(".portless-card"));
    return;
  }
  if (ready) {
    status.textContent = "已启用";
    description.textContent = "现在可以直接使用 http://openclaw.localhost 等地址。";
    button.textContent = ui.portless.available ? "关闭无端口访问" : "请在 Local Ops App 内管理";
    button.className = "secondary-button portless-disable-button";
  } else if (ui.portless.installed || ui.portless.configured) {
    status.textContent = "需要修复";
    description.textContent = ui.portless.error || "系统转发规则没有生效，可以重新授权修复。";
    button.textContent = "修复无端口访问";
    button.className = "primary-button";
  } else {
    status.textContent = "未启用";
    description.textContent = ui.portless.available
      ? "启用后可直接访问 http://openclaw.localhost，不再显示 :19080。"
      : "请在 Local Ops App 内启用，浏览器页面不能请求系统授权。";
    button.textContent = ui.portless.available ? "启用无端口访问" : "请在 Local Ops App 内启用";
    button.className = "primary-button";
  }
  button.disabled = !ui.portless.available;
  localizeDocument(button.closest(".portless-card"));
}

async function togglePortlessAccess() {
  if (!window.localOpsDesktop?.setPortlessAccess || ui.portless.busy) return;
  const ready = ui.portless.installed && ui.portless.configured && ui.portless.active;
  const enable = !ready;
  if (!enable && !window.confirm(tr("关闭后，本地域名将恢复显示 :19080。确定继续吗？"))) return;
  ui.portless.busy = true;
  ui.portless.error = "";
  renderPortlessAccess();
  try {
    const result = await window.localOpsDesktop.setPortlessAccess(enable);
    ui.portless = { ...ui.portless, ...result, available: true, busy: false };
    await reloadBootstrap();
    await refresh(true);
    renderPortlessAccess();
    toast(tr(enable ? "无端口访问已启用" : "无端口访问已关闭"));
  } catch (error) {
    ui.portless.busy = false;
    ui.portless.error = error.message;
    renderPortlessAccess();
    toast(error.message, "error");
  }
}

function updateSettingsMetrics() {
  if (!ui.state) return;
  const element = document.querySelector("#settings-memory");
  if (element) element.textContent = `${formatBytes(ui.state.system.memoryUsed)} / ${formatBytes(ui.state.system.memoryTotal)}`;
}

function processControls(item, resourceActions = {}, extraClass = "") {
  const resourceName = item.name || item.id;
  const active = isProcessActive(item);
  const menuItems = [];
  if (resourceActions.editAction) menuItems.push(menuAction(resourceActions.editAction, item.id, tr("编辑"), resourceName));
  if (!item.protected && active) menuItems.push(menuAction("restart", item.id, tr("重启"), resourceName));
  menuItems.push(menuAction("logs", item.id, tr("查看日志"), resourceName));
  if (resourceActions.deleteAction) menuItems.push(menuAction(resourceActions.deleteAction, item.id, tr("删除"), resourceName));

  const primary = item.protected
    ? ""
    : active
      ? actionButton("stop", item.id, tr("关闭"), resourceName)
      : actionButton("start", item.id, tr("开启"), resourceName);
  return actionControls(primary, menuItems, resourceName, extraClass);
}

function tunnelControls(item, displayState, resourceActions = {}) {
  const resourceName = item.name || item.id;
  const menuItems = [];
  if (resourceActions.editAction) menuItems.push(menuAction(resourceActions.editAction, item.id, tr("编辑"), resourceName));
  if (displayState === "connected") menuItems.push(menuAction("restart", item.id, tr("重启"), resourceName));
  menuItems.push(menuAction("logs", item.id, tr("查看日志"), resourceName));
  if (resourceActions.deleteAction) menuItems.push(menuAction(resourceActions.deleteAction, item.id, tr("删除"), resourceName));

  const primaryAction = tunnelPrimaryAction(displayState);
  const primary = primaryAction.disabled
    ? disabledActionButton(primaryAction.style, tr(primaryAction.label), resourceName)
    : actionButton(primaryAction.action, item.id, tr(primaryAction.label), resourceName, { style: primaryAction.style });
  return actionControls(primary, menuItems, resourceName);
}

function routeControls(route, editable) {
  const menuItems = editable
    ? [menuAction("edit-route", route.id, tr("编辑"), route.name), menuAction("delete-route", route.id, tr("删除"), route.name)]
    : [];
  return actionControls(actionLink(route.url, tr("打开"), route.name), menuItems, route.name);
}

function dockerControls(item) {
  const primary = item.running
    ? actionButton("docker-stop", item.id, tr("关闭"), item.name)
    : actionButton("docker-start", item.id, tr("开启"), item.name);
  const menuItems = item.running ? [menuAction("docker-restart", item.id, tr("重启"), item.name)] : [];
  return actionControls(primary, menuItems, item.name);
}

function actionControls(primary, menuItems, resourceName = "", extraClass = "") {
  const primaryMarkup = primary || "";
  const singleClass = primaryMarkup ? "" : "single-action";
  return `<div class="row-actions action-pair ${singleClass} ${escapeAttribute(extraClass)}">${primaryMarkup}${actionMenuButton(menuItems, resourceName)}</div>`;
}

function menuAction(action, id, label, resourceName = "") {
  return { type: "action", action, id, label, resourceName, style: actionStyle(action) };
}

function actionMenuButton(items, resourceName = "") {
  const hasItems = Array.isArray(items) && items.length > 0;
  const label = hasItems ? `${tr("更多操作")} ${resourceName}` : `${resourceName} ${tr("暂无更多操作")}`;
  const payload = hasItems ? ` data-action-menu="${escapeAttribute(JSON.stringify(items))}"` : "";
  return `<button type="button" class="mini-button action-more" title="${escapeAttribute(hasItems ? tr("更多操作") : tr("暂无更多操作"))}" aria-label="${escapeAttribute(label)}" aria-haspopup="menu" aria-expanded="false" aria-controls="action-menu"${payload}${hasItems ? "" : " disabled"}>${actionIcon("more")}</button>`;
}

function disabledActionButton(style, label, resourceName = "") {
  return actionButton(style, "", label, resourceName, { disabled: true, style });
}

function actionButton(action, id, label, resourceName = "", options = {}) {
  const style = options.style || actionStyle(action);
  const suffix = resourceName ? ` ${resourceName}` : "";
  const behavior = options.disabled
    ? " disabled aria-disabled=\"true\""
    : ` data-action="${escapeAttribute(action)}" data-id="${escapeAttribute(id)}"`;
  return `<button type="button" class="mini-button action-${style}" title="${escapeAttribute(label)}" aria-label="${escapeAttribute(label + suffix)}"${behavior}>${actionIcon(style)}</button>`;
}

function actionLink(url, label = tr("打开"), resourceName = "") {
  const suffix = resourceName ? ` ${resourceName}` : "";
  return `<a class="mini-button action-open" title="${escapeAttribute(label)}" aria-label="${escapeAttribute(label + suffix)}" href="${escapeAttribute(url)}" target="_blank" rel="noreferrer">${actionIcon("open")}</a>`;
}

function actionStyle(action) {
  if (action.startsWith("edit-")) return "edit";
  if (action.startsWith("delete-")) return "delete";
  if (action === "run-terminal") return "run";
  if (action.startsWith("docker-")) return action.slice(7);
  return action;
}

function actionIcon(name) {
  const paths = {
    start: '<path d="m8 5 11 7-11 7V5Z"/>',
    run: '<path d="M5 4h14v16H5V4Zm2 2v12h10V6H7Zm2 3 3 3-3 3-1.4-1.4L9.2 12 7.6 10.4 9 9Zm4 5h3v2h-3v-2Z"/>',
    restart: '<path d="M18.6 6.4A9 9 0 1 0 21 12h-2a7 7 0 1 1-2.1-5l-2.4 2.5H21V3l-2.4 3.4Z"/>',
    pending: '<path d="M18.6 6.4A9 9 0 1 0 21 12h-2a7 7 0 1 1-2.1-5l-2.4 2.5H21V3l-2.4 3.4Z"/>',
    stop: '<path d="M7 7h10v10H7V7Z"/>',
    edit: '<path d="m15.8 4.2 4 4L9 19H5v-4L15.8 4.2Zm0 2.8L7 15.8V17h1.2L17 8.2 15.8 7Z"/>',
    delete: '<path d="M8 4h8l1 2h4v2H3V6h4l1-2Zm-2 6h12l-1 10H7L6 10Zm3 2v6h2v-6H9Zm4 0v6h2v-6h-2Z"/>',
    logs: '<path d="M5 4h14v16H5V4Zm2 2v12h10V6H7Zm2 3h6v2H9V9Zm0 4h6v2H9v-2Z"/>',
    open: '<path d="M14 4h6v6h-2V7.4l-8.3 8.3-1.4-1.4L16.6 6H14V4ZM5 7h6v2H6v9h9v-5h2v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"/>',
    more: '<path d="M5 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"/>',
    drag: '<path d="M8 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/>'
  };
  return `<svg aria-hidden="true" viewBox="0 0 24 24">${paths[name] || paths.open}</svg>`;
}

function toggleActionMenu(trigger) {
  const menu = document.querySelector("#action-menu");
  if (!menu) return;
  if (ui.actionMenuTrigger === trigger && !menu.hidden) return closeActionMenu(true);

  let items = [];
  try {
    items = JSON.parse(trigger.dataset.actionMenu || "[]");
  } catch {
    return;
  }
  if (!items.length) return;

  closeActionMenu(false);
  ui.actionMenuTrigger = trigger;
  trigger.setAttribute("aria-expanded", "true");
  menu.innerHTML = items.map(actionMenuItemMarkup).join("");
  menu.hidden = false;

  menu.querySelector("[role=menuitem]")?.focus({ preventScroll: true });
}

function actionMenuItemMarkup(item) {
  const style = item.style || actionStyle(item.action || "open");
  const suffix = item.resourceName ? ` ${item.resourceName}` : "";
  const className = `action-menu-item action-menu-${escapeAttribute(style)}${style === "delete" ? " is-danger" : ""}`;
  if (item.type === "link") {
    return `<a class="${className}" role="menuitem" data-menu-link href="${escapeAttribute(item.url)}" target="_blank" rel="noreferrer">${actionIcon(style)}<span>${escapeHtml(item.label)}</span></a>`;
  }
  return `<button type="button" class="${className}" role="menuitem" aria-label="${escapeAttribute(item.label + suffix)}" data-action="${escapeAttribute(item.action)}" data-id="${escapeAttribute(item.id)}">${actionIcon(style)}<span>${escapeHtml(item.label)}</span></button>`;
}

function closeActionMenu(restoreFocus = false) {
  const menu = document.querySelector("#action-menu");
  const trigger = ui.actionMenuTrigger;
  if (menu) {
    menu.hidden = true;
    menu.innerHTML = "";
  }
  if (trigger?.isConnected) {
    trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger.focus({ preventScroll: true });
  }
  ui.actionMenuTrigger = null;
}

async function handleAction(action, id, element) {
  if (!id) return;
  if (action === "logs") return openLogs(id);
  if (action.startsWith("edit-")) return openEditDialog(action.slice(5), id);
  if (action.startsWith("delete-")) return deleteResource(action, id);
  if (action === "run-terminal") return runTerminalTask(id);
  if (action === "retry-tunnel") return retryTunnel(id);
  if (action.startsWith("docker-")) return controlDocker(id, action.slice(7));
  const process = ui.state?.processes?.find((item) => item.id === id);
  if (process?.kind === "tunnel" && (action === "start" || action === "restart")) {
    return runTunnelConnectionAction(id, action);
  }
  try {
    ui.busy = true;
    updateBulkStartButton();
    toast(`${actionLabel(action)} ${id}…`);
    await request(`/api/processes/${encodeURIComponent(id)}/${action}`, { method: "POST" });
    await wait(450);
    await refresh(true);
    toast(tr("{name} 已{action}", { name: id, action: ({ start: "启动", stop: "停止", restart: "重启" })[action] || action }));
  } catch (error) {
    toast(error.message, "error");
  } finally {
    ui.busy = false;
    updateBulkStartButton();
  }
}

async function runTunnelConnectionAction(id, action) {
  if (ui.tunnelBusy.has(id)) return;
  ui.tunnelBusy.add(id);
  renderTunnelCards();
  localizeDocument(document.querySelector("#tunnel-cards"));
  try {
    await request(`/api/processes/${encodeURIComponent(id)}/${action}`, { method: "POST" });
    await wait(450);
    await refresh(true);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    ui.tunnelBusy.delete(id);
    await refresh(true);
  }
}

async function retryTunnel(id) {
  const process = ui.state?.processes?.find((item) => item.id === id);
  if (!process || ui.tunnelBusy.has(id)) return;
  ui.tunnelBusy.add(id);
  renderTunnelCards();
  localizeDocument(document.querySelector("#tunnel-cards"));
  try {
    const action = isProcessActive(process) ? "restart" : "start";
    await request(`/api/processes/${encodeURIComponent(id)}/${action}`, { method: "POST" });
    await wait(450);
    await refresh(true);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    ui.tunnelBusy.delete(id);
    await refresh(true);
  }
}

async function controlDocker(id, action) {
  try {
    ui.busy = true;
    updateBulkStartButton();
    await request(`/api/docker/${encodeURIComponent(id)}/${action}`, { method: "POST" });
    await wait(350);
    await refreshDocker(true);
    toast(`Docker 容器已${actionLabel(action)}`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    ui.busy = false;
    updateBulkStartButton();
  }
}

async function runTerminalTask(id) {
  try {
    await request(`/api/terminal-tasks/${encodeURIComponent(id)}/run`, { method: "POST" });
    toast(tr("已在所选终端中执行"));
  } catch (error) {
    toast(error.message, "error");
  }
}

async function deleteResource(action, id) {
  const definitions = {
    "delete-service": ["服务", "services"],
    "delete-tunnel": ["SSH 隧道", "tunnels"],
    "delete-route": ["域名", "routes"],
    "delete-terminal": ["终端操作", "terminal-tasks"]
  };
  const [noun, endpoint] = definitions[action] || [];
  if (!endpoint) return;
  const suffix = action === "delete-terminal" || action === "delete-route" ? "" : "相关进程会被停止。";
  if (!window.confirm(tr(`确定删除${noun}“${id}”吗？${suffix}`))) return;
  try {
    ui.busy = true;
    await request(`/api/${endpoint}/${encodeURIComponent(id)}`, { method: "DELETE" });
    await reloadBootstrap();
    await refresh(true);
    toast(tr("{noun}已删除", { noun }));
  } catch (error) {
    toast(error.message, "error");
  } finally {
    ui.busy = false;
  }
}

function openAddDialog(kind = "service") {
  const form = document.querySelector("#resource-form");
  form.reset();
  ui.editing = null;
  document.querySelector("#resource-tabs").hidden = false;
  document.querySelector("#resource-modal-label").textContent = "新资源";
  document.querySelector("#resource-modal-title").textContent = "添加资源";
  document.querySelector("#save-resource").textContent = "保存并应用";
  setFormValue("service-namespace", "services");
  setFormValue("service-kind", "node");
  setFormValue("service-restart", "always");
  setFormValue("tunnel-remote-host", "127.0.0.1");
  setFormValue("tunnel-ssh-port", "22");
  setFormValue("terminal-ssh-port", "22");
  setFormValue("terminal-remote-host", "127.0.0.1");
  setResourceIcon("service-icon", "nodejs");
  setResourceIcon("tunnel-icon", "ssh");
  setResourceIcon("route-icon", "link");
  setResourceIcon("terminal-icon", "terminal");
  configurePassphraseField("tunnel", false);
  configurePassphraseField("terminal", false);
  form.elements.namedItem("service-autostart").checked = true;
  form.elements.namedItem("route-enabled").checked = true;
  document.querySelector(".service-route-fields").hidden = false;
  selectFormTab(kind);
  localizeDocument(document.querySelector("#add-dialog"));
  document.querySelector("#add-dialog").showModal();
}

function openEditDialog(kind, id) {
  const mapping = {
    service: ["services", "服务"],
    tunnel: ["tunnels", "SSH 隧道"],
    route: ["routes", "本地域名"],
    terminal: ["terminalTasks", "终端操作"]
  };
  const [key, label] = mapping[kind] || [];
  const resource = key && ui.bootstrap.config[key]?.find((item) => item.id === id);
  if (!resource) return toast("没有找到要编辑的资源", "error");
  const form = document.querySelector("#resource-form");
  form.reset();
  ui.editing = { kind, id };
  document.querySelector("#resource-tabs").hidden = true;
  document.querySelector("#resource-modal-label").textContent = `编辑${label}`;
  document.querySelector("#resource-modal-title").textContent = resource.name;
  document.querySelector("#save-resource").textContent = "保存更改";
  selectFormTab(kind);
  document.querySelector(".service-route-fields").hidden = kind === "service";
  populateResourceForm(kind, resource);
  const idInput = form.elements.namedItem(`${kind}-id`);
  if (idInput) idInput.disabled = true;
  localizeDocument(document.querySelector("#add-dialog"));
  document.querySelector("#add-dialog").showModal();
}

function populateResourceForm(kind, item) {
  const form = document.querySelector("#resource-form");
  if (kind === "service") {
    setFormValue("service-name", item.name);
    setResourceIcon("service-icon", item.icon || "nodejs");
    setFormValue("service-id", item.id);
    setFormValue("service-dir", item.workingDir);
    setFormValue("service-command", item.command);
    setFormValue("service-description", item.description);
    setFormValue("service-health", item.healthUrl);
    setFormValue("service-namespace", item.namespace);
    setFormValue("service-kind", item.kind);
    setFormValue("service-restart", item.restartPolicy);
    form.elements.namedItem("service-autostart").checked = item.autoStart;
  } else if (kind === "tunnel") {
    setFormValue("tunnel-name", item.name);
    setResourceIcon("tunnel-icon", item.icon || "ssh");
    setFormValue("tunnel-id", item.id);
    setFormValue("tunnel-user", item.sshUser);
    setFormValue("tunnel-host", item.sshHost);
    setFormValue("tunnel-ssh-port", item.sshPort || 22);
    setFormValue("tunnel-description", item.description);
    setFormValue("tunnel-local-port", item.localPort);
    setFormValue("tunnel-remote-host", item.remoteHost);
    setFormValue("tunnel-remote-port", item.remotePort);
    setFormValue("tunnel-key", item.identityFile);
    setFormValue("tunnel-health", item.healthUrl || "");
    configurePassphraseField("tunnel", item.hasKeyPassphrase);
  } else if (kind === "route") {
    setFormValue("route-name", item.name);
    setResourceIcon("route-icon", item.icon || "link");
    setFormValue("route-id", item.id);
    setFormValue("route-host", `${item.host}${item.path || ""}`);
    setFormValue("route-target", item.target);
    form.elements.namedItem("route-enabled").checked = item.enabled;
  } else {
    setFormValue("terminal-name", item.name);
    setResourceIcon("terminal-icon", item.icon || "terminal");
    setFormValue("terminal-id", item.id);
    setFormValue("terminal-description", item.description);
    setFormValue("terminal-app", item.terminalApp);
    setFormValue("terminal-kind", item.kind);
    setFormValue("terminal-dir", item.workingDir);
    setFormValue("terminal-command", item.command);
    setFormValue("terminal-ssh-user", item.sshUser);
    setFormValue("terminal-ssh-host", item.sshHost);
    setFormValue("terminal-ssh-port", item.sshPort || 22);
    setFormValue("terminal-ssh-key", item.identityFile);
    configurePassphraseField("terminal", item.hasKeyPassphrase);
    setFormValue("terminal-local-port", item.localPort ?? "");
    setFormValue("terminal-remote-host", item.remoteHost || "127.0.0.1");
    setFormValue("terminal-remote-port", item.remotePort ?? "");
    updateTerminalSections();
  }
}

function closeResourceDialog() {
  document.querySelector("#add-dialog").close();
  ui.editing = null;
}

function selectFormTab(kind) {
  if (!["service", "tunnel", "route", "terminal"].includes(kind)) kind = "service";
  ui.activeForm = kind;
  document.querySelectorAll("[data-form-tab]").forEach((item) => item.classList.toggle("active", item.dataset.formTab === kind));
  document.querySelectorAll("[data-form-panel]").forEach((panel) => {
    const active = panel.dataset.formPanel === kind;
    panel.classList.toggle("active", active);
    panel.querySelectorAll("input, select, textarea").forEach((control) => { control.disabled = !active; });
  });
  updateTerminalSections();
}

function updateTerminalSections() {
  const form = document.querySelector("#resource-form");
  const kind = form.elements.namedItem("terminal-kind")?.value || "command";
  const terminalActive = ui.activeForm === "terminal";
  document.querySelectorAll("[data-terminal-section]").forEach((section) => {
    const active = section.dataset.terminalSection === kind;
    section.hidden = !active;
    section.querySelectorAll("input, select, textarea").forEach((control) => { control.disabled = !terminalActive || !active; });
  });
}

async function saveResource(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const button = document.querySelector("#save-resource");
  button.disabled = true;
  try {
    const editing = ui.editing;
    const method = editing ? "PUT" : "POST";
    let endpoint;
    let body;
    if (ui.activeForm === "service") {
      const domain = editing ? "" : normalizeDomain(data.get("service-domain"));
      const port = String(data.get("service-port") || "").trim();
      if (domain && !port) throw new Error(tr("配置本地域名时必须填写服务端口"));
      endpoint = editing ? `/api/services/${encodeURIComponent(editing.id)}` : "/api/services";
      body = {
        name: data.get("service-name"),
        icon: data.get("service-icon"),
        id: editing?.id || data.get("service-id"),
        workingDir: data.get("service-dir"),
        command: data.get("service-command"),
        description: data.get("service-description"),
        healthUrl: data.get("service-health"),
        namespace: data.get("service-namespace"),
        autoStart: data.get("service-autostart") === "on",
        restartPolicy: data.get("service-restart"),
        kind: data.get("service-kind"),
        domain,
        port
      };
    } else if (ui.activeForm === "tunnel") {
      endpoint = editing ? `/api/tunnels/${encodeURIComponent(editing.id)}` : "/api/tunnels";
      body = {
        name: data.get("tunnel-name"),
        icon: data.get("tunnel-icon"),
        id: editing?.id || data.get("tunnel-id"),
        description: data.get("tunnel-description"),
        sshUser: data.get("tunnel-user"),
        sshHost: data.get("tunnel-host"),
        sshPort: data.get("tunnel-ssh-port"),
        localPort: data.get("tunnel-local-port"),
        remoteHost: data.get("tunnel-remote-host"),
        remotePort: data.get("tunnel-remote-port"),
        identityFile: data.get("tunnel-key"),
        healthUrl: data.get("tunnel-health"),
        identityPassphrase: data.get("tunnel-key-passphrase"),
        removeIdentityPassphrase: data.get("tunnel-clear-passphrase") === "on"
      };
    } else if (ui.activeForm === "route") {
      endpoint = editing ? `/api/routes/${encodeURIComponent(editing.id)}` : "/api/routes";
      body = {
        name: data.get("route-name"),
        icon: data.get("route-icon"),
        id: editing?.id || data.get("route-id"),
        host: normalizeDomain(data.get("route-host")),
        target: data.get("route-target"),
        enabled: data.get("route-enabled") === "on"
      };
    } else {
      endpoint = editing ? `/api/terminal-tasks/${encodeURIComponent(editing.id)}` : "/api/terminal-tasks";
      body = {
        name: data.get("terminal-name"),
        icon: data.get("terminal-icon"),
        id: editing?.id || data.get("terminal-id"),
        description: data.get("terminal-description"),
        terminalApp: data.get("terminal-app"),
        kind: data.get("terminal-kind"),
        workingDir: data.get("terminal-dir"),
        command: data.get("terminal-command"),
        sshUser: data.get("terminal-ssh-user"),
        sshHost: data.get("terminal-ssh-host"),
        sshPort: data.get("terminal-ssh-port"),
        identityFile: data.get("terminal-ssh-key"),
        identityPassphrase: data.get("terminal-key-passphrase"),
        removeIdentityPassphrase: data.get("terminal-clear-passphrase") === "on",
        localPort: data.get("terminal-local-port"),
        remoteHost: data.get("terminal-remote-host"),
        remotePort: data.get("terminal-remote-port")
      };
    }
    await request(endpoint, { method, body });
    document.querySelector("#add-dialog").close();
    ui.editing = null;
    await reloadBootstrap();
    await refresh(true);
    toast(tr(editing ? "更改已保存并应用" : "资源已保存并应用"));
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function setFormValue(name, value) {
  const control = document.querySelector("#resource-form").elements.namedItem(name);
  if (control) control.value = value ?? "";
}

function configurePassphraseField(kind, stored) {
  const prefix = kind === "tunnel" ? "tunnel" : "terminal";
  const inputName = kind === "tunnel" ? "tunnel-key-passphrase" : "terminal-key-passphrase";
  const clearName = kind === "tunnel" ? "tunnel-clear-passphrase" : "terminal-clear-passphrase";
  const form = document.querySelector("#resource-form");
  const input = form.elements.namedItem(inputName);
  const clear = form.elements.namedItem(clearName);
  const row = document.querySelector(`[data-passphrase-clear-row="${prefix}"]`);
  const status = document.querySelector(`[data-passphrase-status="${prefix}"]`);
  if (input) {
    input.value = "";
    input.disabled = false;
    input.placeholder = tr(stored ? "已安全保存在 macOS 钥匙串；留空保持不变" : "仅在私钥已加密时填写");
  }
  if (clear) clear.checked = false;
  if (row) row.hidden = !stored;
  if (status) {
    status.textContent = tr(stored
      ? "私钥口令已保存在 macOS 钥匙串中；输入新口令可以替换它。"
      : "口令只会保存到 macOS 钥匙串，不会写入配置、日志或导出文件。");
  }
}

function togglePassphraseRemoval(kind, remove) {
  const inputName = kind === "tunnel" ? "tunnel-key-passphrase" : "terminal-key-passphrase";
  const input = document.querySelector("#resource-form").elements.namedItem(inputName);
  if (!input) return;
  input.disabled = Boolean(remove);
  if (remove) input.value = "";
}

function setResourceIcon(fieldName, iconId) {
  const field = document.querySelector(`#resource-form [name="${fieldName}"]`);
  if (!field) return;
  const fallback = fieldName.startsWith("tunnel") ? "ssh" : fieldName.startsWith("route") ? "link" : fieldName.startsWith("terminal") ? "terminal" : "server";
  const icon = ICON_BY_ID.get(iconId) || ICON_BY_ID.get(fallback);
  field.value = icon.id;
  const container = field.closest(".resource-icon-field");
  const preview = container?.querySelector("[data-icon-preview]");
  const label = container?.querySelector("[data-icon-label]");
  if (preview) preview.innerHTML = iconMarkup(icon);
  if (label) label.textContent = icon.label;
}

function openIconPicker(fieldName) {
  ui.iconField = fieldName;
  const search = document.querySelector("#icon-search");
  search.value = "";
  renderIconLibrary();
  document.querySelector("#icon-dialog").showModal();
  window.setTimeout(() => search.focus(), 20);
}

function closeIconPicker() {
  document.querySelector("#icon-dialog").close();
  ui.iconField = null;
}

function chooseResourceIcon(iconId) {
  if (!ui.iconField) return;
  setResourceIcon(ui.iconField, iconId);
  closeIconPicker();
}

function renderIconLibrary(query = "") {
  const normalized = String(query).trim().toLowerCase();
  const selected = document.querySelector(`#resource-form [name="${ui.iconField || ""}"]`)?.value;
  const icons = normalized ? ICON_LIBRARY.filter((icon) => icon.keywords.includes(normalized)) : ICON_LIBRARY;
  document.querySelector("#icon-library").innerHTML = icons.length ? icons.map((icon) => `
    <button type="button" class="icon-choice ${icon.id === selected ? "selected" : ""}" data-icon-choice="${escapeAttribute(icon.id)}" title="${escapeAttribute(icon.label)}">
      <span class="icon-choice-preview">${iconMarkup(icon)}</span><span>${escapeHtml(icon.label)}</span><small>${escapeHtml(icon.group)}</small>
    </button>
  `).join("") : '<p class="icon-empty">没有匹配的图标。</p>';
  localizeDocument(document.querySelector("#icon-library"));
}

function sortItemAttributes(kind, id) {
  return `data-sort-item data-sort-kind="${kind}" data-sort-id="${escapeAttribute(id)}"`;
}

function sortHandle(kind, id, disabled = false) {
  if (disabled) {
    return `<span class="sort-handle is-disabled" aria-disabled="true" title="${escapeAttribute(tr("系统固定资源不可排序"))}" aria-label="${escapeAttribute(tr("系统固定资源不可排序"))}">${actionIcon("drag")}</span>`;
  }
  return `<span class="sort-handle" draggable="true" data-sort-drag data-kind="${escapeAttribute(kind)}" data-id="${escapeAttribute(id)}" title="${escapeAttribute(tr("拖动排序"))}" aria-label="${escapeAttribute(tr("拖动排序"))}">${actionIcon("drag")}</span>`;
}

function sortIds(kind) {
  const definition = sortDefinitions[kind];
  const list = ui.bootstrap.config[definition.configKey] || [];
  return (definition.filter ? list.filter(definition.filter) : list).map((item) => item.id);
}

function saveOrder(kind, ids) {
  const definition = sortDefinitions[kind];
  if (!definition) return;
  applyBootstrapOrder(kind, ids);
  renderSortedKind(kind);

  const version = (ui.orderVersions.get(kind) || 0) + 1;
  ui.orderVersions.set(kind, version);
  const previous = ui.orderWrites.get(kind) || Promise.resolve();
  const write = previous.catch(() => {}).then(() => request(`/api/order/${definition.endpoint}`, { method: "PUT", body: { ids } }));
  ui.orderWrites.set(kind, write);
  write.then(() => {
    if (ui.orderVersions.get(kind) === version) toast(tr("排序已保存"));
  }).catch(async (error) => {
    if (ui.orderVersions.get(kind) !== version) return;
    await reloadBootstrap().catch(() => {});
    renderSortedKind(kind);
    toast(`排序保存失败：${error.message}`, "error");
  });
}

function applyBootstrapOrder(kind, ids) {
  const definition = sortDefinitions[kind];
  const list = ui.bootstrap.config[definition.configKey] || [];
  const movable = definition.filter ? list.filter(definition.filter) : list;
  const fixed = definition.filter ? list.filter((item) => !definition.filter(item)) : [];
  const byId = new Map(movable.map((item) => [item.id, item]));
  ui.bootstrap.config[definition.configKey] = [...fixed, ...ids.map((id) => byId.get(id)).filter(Boolean)];
}

function renderSortedKind(kind) {
  if (kind === "service") {
    renderServicesTable();
    renderOverviewProcesses();
  } else if (kind === "tunnel") renderTunnelCards();
  else if (kind === "route") {
    renderRoutesTable();
    renderQuickRoutes();
  } else if (kind === "terminal") renderTerminalTable();
}

function handleSortDragStart(event) {
  const handle = event.target.closest("[data-sort-drag]");
  if (!handle) return;
  const item = handle.closest("[data-sort-item]");
  if (!item) return;
  ui.dragging = { kind: item.dataset.sortKind, id: item.dataset.sortId, item };
  item.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", item.dataset.sortId);
}

function handleSortDragOver(event) {
  if (!ui.dragging) return;
  const target = event.target.closest("[data-sort-item]");
  if (!target || target.dataset.sortKind !== ui.dragging.kind || target === ui.dragging.item) return;
  event.preventDefault();
  document.querySelectorAll(".drag-over").forEach((item) => item.classList.remove("drag-over"));
  target.classList.add("drag-over");
}

function handleSortDrop(event) {
  if (!ui.dragging) return;
  const target = event.target.closest("[data-sort-item]");
  if (!target || target.dataset.sortKind !== ui.dragging.kind || target === ui.dragging.item) return clearSortDrag();
  event.preventDefault();
  const ids = sortIds(ui.dragging.kind);
  const sourceIndex = ids.indexOf(ui.dragging.id);
  ids.splice(sourceIndex, 1);
  let targetIndex = ids.indexOf(target.dataset.sortId);
  const rect = target.getBoundingClientRect();
  const after = event.clientY > rect.top + rect.height / 2;
  if (after) targetIndex += 1;
  ids.splice(targetIndex, 0, ui.dragging.id);
  const kind = ui.dragging.kind;
  clearSortDrag();
  saveOrder(kind, ids);
}

function clearSortDrag() {
  document.querySelectorAll(".is-dragging, .drag-over").forEach((item) => item.classList.remove("is-dragging", "drag-over"));
  ui.dragging = null;
}

async function openLogs(id) {
  ui.activeLogId = id;
  const process = ui.state?.processes.find((item) => item.id === id);
  document.querySelector("#logs-title").textContent = process?.name || id;
  document.querySelector("#logs-output").textContent = tr("正在读取日志…");
  document.querySelector("#logs-dialog").showModal();
  await loadLogs(id);
}

async function loadLogs(id) {
  if (!id) return;
  try {
    const result = await request(`/api/logs/${encodeURIComponent(id)}?tail=300`);
    const output = document.querySelector("#logs-output");
    output.textContent = result.logs || tr("暂时没有日志输出。");
    output.scrollTop = output.scrollHeight;
  } catch (error) {
    document.querySelector("#logs-output").textContent = tr(error.message);
  }
}

async function reloadConfiguration() {
  const button = document.querySelector("#reload-button");
  button.disabled = true;
  try {
    await request("/api/reload", { method: "POST" });
    await refresh(true);
    toast(tr("配置已重新加载"));
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function reloadBootstrap() {
  ui.bootstrap = await request("/api/bootstrap");
  applyLanguage(ui.bootstrap.config.settings.language);
  renderSettings();
  renderTerminalTable();
}

async function request(url, options = {}) {
  const init = { method: options.method || "GET", headers: {} };
  if (options.body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  if (init.method !== "GET" && init.method !== "HEAD" && ui.bootstrap?.csrfToken) {
    init.headers["X-Local-Ops-Token"] = ui.bootstrap.csrfToken;
    init.headers["X-Local-Ops-Requested-By"] = "ui";
  }
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload;
}

function setConnection(online) {
  document.querySelector("#sidebar-dot").className = `pulse-dot ${online ? "online" : "offline"}`;
  document.querySelector("#sidebar-status").textContent = tr(online ? "控制面在线" : "控制面离线");
  updateSettingsMetrics();
}

function defaultAddKind() {
  if (ui.activeView === "tunnels") return "tunnel";
  if (ui.activeView === "routes") return "route";
  if (ui.activeView === "terminal") return "terminal";
  return "service";
}

function resourceIcon(iconId, fallback = "server", className = "") {
  const icon = ICON_BY_ID.get(iconId) || ICON_BY_ID.get(fallback) || ICON_LIBRARY[0];
  return `<span class="resource-icon ${escapeAttribute(iconColorClass(icon))} ${escapeAttribute(className)}" aria-hidden="true">${iconMarkup(icon)}</span>`;
}

function iconMarkup(icon) {
  return `<svg class="${escapeAttribute(iconColorClass(icon))}" viewBox="${escapeAttribute(icon.viewBox)}" aria-hidden="true">${icon.svg}</svg>`;
}

function iconColorClass(icon) {
  return `icon-color-${String(icon.id).toLowerCase().replace(/[^a-z0-9_-]/g, "-")}`;
}

function kindSymbol(kind) {
  if (kind === "tunnel") return "⇄";
  if (kind === "system") return "◆";
  if (kind === "docker") return "▣";
  return "◫";
}

function statusLabel(status) {
  return tr(({
    running: "运行中",
    connected: "已连接",
    connection_failed: "连接失败",
    waiting_network: "等待网络",
    connecting: "连接中",
    retrying: "重试中",
    restarting: "重启中",
    stopped: "已停止",
    disabled: "未启用",
    unhealthy: "健康检查异常",
    degraded: "服务降级",
    offline: "离线",
    online: "在线",
    unknown: "未知"
  })[status] || status);
}

function isProcessActive(item) {
  return Boolean(item?.active ?? item?.status === "running");
}

function isProcessHealthy(item) {
  if (item.kind === "tunnel") {
    return item.status === "connected"
      && item.healthCheck?.ok
      && (!item.domainEntry?.configured || item.fullyAvailable);
  }
  return item.status === "running" && !["unhealthy", "degraded"].includes(item.health);
}

function actionLabel(action) {
  return tr(({ start: "启动", stop: "停止", restart: "重启" })[action] || action);
}

function normalizeDomain(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const withoutProtocol = text.replace(/^https?:\/\//i, "");
  const slashIndex = withoutProtocol.indexOf("/");
  const rawHost = slashIndex >= 0 ? withoutProtocol.slice(0, slashIndex) : withoutProtocol;
  const accessPath = slashIndex >= 0 ? withoutProtocol.slice(slashIndex) : "";
  const host = rawHost.toLowerCase().endsWith(".localhost")
    ? rawHost.toLowerCase()
    : `${rawHost.toLowerCase()}.localhost`;
  return `${host}${accessPath}`;
}

function formatTime(value) {
  return new Intl.DateTimeFormat(getLocale(), { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (getLocale() === "en-US") return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  return days ? `${days} 天 ${hours} 小时` : hours ? `${hours} 小时 ${minutes} 分` : `${minutes} 分钟`;
}

function formatBytes(value) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = Number(value || 0);
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${amount.toFixed(index < 2 ? 0 : 1)} ${units[index]}`;
}

function toast(message, type = "info") {
  const element = document.createElement("div");
  element.className = `toast ${type}`;
  element.textContent = tr(message);
  restoreToastStack();
  document.querySelector("#toast-stack").append(element);
  window.setTimeout(() => element.remove(), 3600);
}

function restoreToastStack() {
  const stack = document.querySelector("#toast-stack");
  if (!stack) return;
  const dialogs = [...document.querySelectorAll("dialog[open]")];
  const host = dialogs.at(-1) || document.body;
  if (stack.parentElement !== host) host.append(stack);
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
