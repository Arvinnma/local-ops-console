const sectionsRoot = document.querySelector("#resource-sections");
const summary = document.querySelector("#summary");
const connectionStatus = document.querySelector("#connection-status");
const offlineBanner = document.querySelector("#offline-banner");
const offlineTitle = document.querySelector("#offline-title");
const offlineDetail = document.querySelector("#offline-detail");
const refreshButton = document.querySelector("#refresh-button");
const showMainButton = document.querySelector("#show-main-button");
const openBrowserButton = document.querySelector("#open-browser-button");
const openLogsButton = document.querySelector("#open-logs-button");
const quitAppButton = document.querySelector("#quit-app-button");
const toast = document.querySelector("#toast");

let latestState = null;
let toastTimer = null;
let overflowRefreshFrame = null;

document.addEventListener("DOMContentLoaded", async () => {
  bindStaticActions();
  window.localOpsDesktop.onTrayPanelState((state) => render(state));
  try {
    render(await window.localOpsDesktop.getTrayPanelState());
  } catch (error) {
    showToast(error.message || "读取资源状态失败");
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.localOpsDesktop.closeTrayPanel();
});

window.addEventListener("resize", scheduleOverflowRefresh);

function bindStaticActions() {
  refreshButton.addEventListener("click", () => runPanelAction({ type: "refresh" }, refreshButton));
  document.querySelectorAll("[data-panel-action]").forEach((button) => {
    button.addEventListener("click", () => runPanelAction({ type: button.dataset.panelAction }, button));
  });
}

function render(state) {
  latestState = state;
  document.documentElement.lang = state.language === "en-US" ? "en" : "zh-CN";
  const english = state.language === "en-US";

  connectionStatus.textContent = state.online
    ? (english ? "Online" : "在线")
    : (english ? "Offline" : "离线");
  connectionStatus.className = `connection-status ${state.online ? "is-online" : "is-offline"}`;
  summary.textContent = state.summary;
  offlineBanner.hidden = state.online;
  refreshButton.textContent = state.labels.refresh;
  showMainButton.textContent = state.labels.showMain;
  openBrowserButton.textContent = state.labels.openBrowser;
  openLogsButton.textContent = state.labels.openLogs;
  quitAppButton.textContent = state.labels.quitApp;
  offlineTitle.textContent = state.labels.offlineTitle;
  offlineDetail.textContent = state.labels.offlineDetail;
  refreshButton.disabled = Boolean(state.refreshing);

  sectionsRoot.replaceChildren(...state.sections.map((section) => renderSection(section, english)));
  scheduleOverflowRefresh();
}

function renderSection(section, english) {
  const card = document.createElement("section");
  card.className = "resource-card";
  card.dataset.section = section.id;

  const header = document.createElement("header");
  header.className = "section-header";

  const title = document.createElement("span");
  title.className = "section-title";
  title.textContent = section.title;

  const count = document.createElement("span");
  count.className = "section-count";
  count.textContent = section.count;

  header.append(title, count);

  const list = document.createElement("div");
  list.className = "resource-list";
  if (!section.items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-row";
    empty.textContent = english ? "Not configured" : "尚未配置";
    list.append(empty);
  } else {
    section.items.forEach((item) => list.append(renderResourceRow(section.id, item)));
  }

  card.append(header, list);
  return card;
}

function renderResourceRow(sectionId, item) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = sectionId === "routes"
    ? "resource-row resource-row-route"
    : "resource-row resource-row-standard";
  row.disabled = Boolean(item.disabled || item.busy);
  row.title = item.description || item.name;

  const name = renderOverflowText(item.name, "resource-name");
  row.append(name);

  if (sectionId === "routes") {
    const address = renderOverflowText(item.address, "route-address");
    row.append(address);
  } else {
    row.append(renderStatus(item));
  }

  if (!item.disabled) {
    row.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      runPanelAction({
        ...item.action,
        eventName: "tray-panel.resource-row.click",
        gestureType: event.type,
        gestureAt: new Date().toISOString()
      }, row);
    });
  }
  return row;
}

function renderOverflowText(value, className) {
  const viewport = document.createElement("span");
  viewport.className = `${className} overflow-text`;

  const track = document.createElement("span");
  track.className = "overflow-text-track";
  track.textContent = value;

  viewport.append(track);
  return viewport;
}

function scheduleOverflowRefresh() {
  cancelAnimationFrame(overflowRefreshFrame);
  overflowRefreshFrame = requestAnimationFrame(() => {
    sectionsRoot.querySelectorAll(".overflow-text").forEach((viewport) => {
      const track = viewport.querySelector(".overflow-text-track");
      if (!track) return;

      viewport.classList.remove("is-overflowing");
      viewport.style.removeProperty("--overflow-distance");
      viewport.style.removeProperty("--overflow-duration");
      viewport.removeAttribute("title");

      const distance = Math.ceil(track.scrollWidth - viewport.clientWidth);
      if (distance <= 1) return;

      const duration = Math.min(12, Math.max(6, 5 + distance / 32));
      viewport.style.setProperty("--overflow-distance", `${distance}px`);
      viewport.style.setProperty("--overflow-duration", `${duration}s`);
      viewport.classList.add("is-overflowing");
      viewport.title = track.textContent;
    });
  });
}

function renderStatus(item) {
  const status = document.createElement("span");
  const tone = item.tone || (item.busy ? "busy" : item.running ? "running" : "stopped");
  const stateClass = `is-${tone}`;
  status.className = `resource-status ${stateClass}`;

  const text = document.createElement("span");
  text.textContent = item.status;
  const dot = document.createElement("span");
  dot.className = "status-dot";
  dot.setAttribute("aria-hidden", "true");
  status.append(text, dot);
  return status;
}

async function runPanelAction(action, control) {
  if (!action?.type) return;
  if (control) control.disabled = true;
  try {
    const result = await window.localOpsDesktop.performTrayPanelAction(action);
    if (result?.message) showToast(result.message);
  } catch (error) {
    showToast(error.message || "操作失败");
  } finally {
    // The panel is hidden while the main window is raised, but its renderer is
    // kept alive. Always release the button so reopening the panel can invoke
    // the same action again.
    if (control) control.disabled = false;
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = String(message || "");
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}
