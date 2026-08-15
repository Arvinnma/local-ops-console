"use strict";

const DEFAULT_COOLDOWN_MS = 15000;
const DEFAULT_BUDGET_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_VERIFY_INTERVAL_MS = 250;
const DEFAULT_VERIFY_TIMEOUT_MS = 5000;

function createPortlessRepairTrigger({
  requestPath,
  restoreMainRules,
  writeRequest
} = {}) {
  if (!String(requestPath || "").startsWith("/")) throw new TypeError("absolute requestPath is required");
  if (typeof restoreMainRules !== "function") throw new TypeError("restoreMainRules is required");
  if (typeof writeRequest !== "function") throw new TypeError("writeRequest is required");
  return async function triggerPortlessRepair(context = {}) {
    await restoreMainRules();
    await writeRequest(requestPath, `${Date.now()} ${context.source || "unknown"}\n`);
  };
}

function normalizedProbe(result) {
  if (result && typeof result === "object") return result;
  return { ok: Boolean(result), error: result ? "" : "probe failed" };
}

function normalizedBudgetState(value) {
  const attemptTimes = Array.isArray(value?.attemptTimes)
    ? value.attemptTimes.filter((item) => Number.isFinite(item) && item >= 0)
    : [];
  const cooldownUntil = Number.isFinite(value?.cooldownUntil) && value.cooldownUntil >= 0
    ? value.cooldownUntil
    : 0;
  return { attemptTimes, cooldownUntil };
}

function portlessRecoveryFailureMessage(result = {}) {
  switch (result.status) {
    case "healthy":
    case "recovered":
      return "";
    case "state_unavailable":
      return "无端口访问状态无法安全保存，未执行系统转发修复";
    case "budget_exhausted":
      return "无端口访问修复尝试过于频繁，请稍后重试";
    case "cooldown":
      return "无端口访问正在等待下一次安全重试，请稍后再试";
    case "internal_unhealthy":
      return "Caddy 内部端口尚未就绪，未执行系统转发修复";
    case "port80_foreign_endpoint":
      return "本机 80 端口已被其他服务占用";
    case "not_installed_or_synchronized":
      return "无端口访问系统组件尚未正确同步";
    case "repair_failed":
      return `系统转发修复失败：${result.error || "未知错误"}`;
    case "repair_unverified":
      return `系统转发已请求修复，但 80 端口仍不可用${result.portless?.error ? `：${result.portless.error}` : ""}`;
    default:
      return `无端口访问尚未就绪（${result.status || "unknown"}）`;
  }
}

function createPortlessRecoveryCoordinator({
  probe,
  triggerRepair,
  now = () => Date.now(),
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  log = () => {},
  loadBudgetState = async () => ({}),
  saveBudgetState = async () => {},
  cooldownMs = DEFAULT_COOLDOWN_MS,
  budgetWindowMs = DEFAULT_BUDGET_WINDOW_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  verifyIntervalMs = DEFAULT_VERIFY_INTERVAL_MS,
  verifyTimeoutMs = DEFAULT_VERIFY_TIMEOUT_MS
} = {}) {
  if (typeof probe !== "function") throw new TypeError("probe is required");
  if (typeof triggerRepair !== "function") throw new TypeError("triggerRepair is required");
  if (typeof loadBudgetState !== "function") throw new TypeError("loadBudgetState must be a function");
  if (typeof saveBudgetState !== "function") throw new TypeError("saveBudgetState must be a function");

  let inFlight = null;
  let attemptTimes = [];
  let cooldownUntil = 0;
  let budgetLoaded = false;

  async function ensureBudgetLoaded() {
    if (budgetLoaded) return;
    const persisted = normalizedBudgetState(await loadBudgetState());
    attemptTimes = persisted.attemptTimes;
    cooldownUntil = persisted.cooldownUntil;
    budgetLoaded = true;
  }

  async function persistBudget() {
    await saveBudgetState({ attemptTimes: [...attemptTimes], cooldownUntil });
  }

  function pruneAttempts(timestamp) {
    attemptTimes = attemptTimes.filter((value) => timestamp - value < budgetWindowMs);
  }

  async function resetBudget() {
    attemptTimes = [];
    cooldownUntil = 0;
    await persistBudget();
  }

  async function checkOnce(context = {}) {
    if (context.platform !== "darwin") return { status: "unsupported" };
    if (!context.configured) {
      budgetLoaded = true;
      await resetBudget().catch((error) => log(`portless recovery budget reset failed: ${error.message}`));
      return { status: "disabled" };
    }
    if (!context.installed || !context.synchronized) {
      return { status: "not_installed_or_synchronized" };
    }

    try {
      await ensureBudgetLoaded();
    } catch (error) {
      log(`portless recovery budget load failed: ${error.message}`);
      return { status: "state_unavailable", error: error.message };
    }
    const timestamp = now();
    pruneAttempts(timestamp);

    const internal = normalizedProbe(await probe(context.proxyPort));
    if (!internal.ok) {
      return { status: "internal_unhealthy", internal };
    }

    const portless = normalizedProbe(await probe(80));
    if (portless.ok) {
      await resetBudget().catch((error) => log(`portless recovery budget reset failed: ${error.message}`));
      return { status: "healthy", internal, portless };
    }
    if (portless.repairable === false) {
      return { status: "port80_foreign_endpoint", internal, portless };
    }

    const current = now();
    pruneAttempts(current);
    if (current < cooldownUntil) {
      return {
        status: "cooldown",
        internal,
        portless,
        attempts: attemptTimes.length,
        retryAt: cooldownUntil
      };
    }
    if (attemptTimes.length >= maxAttempts) {
      return {
        status: "budget_exhausted",
        internal,
        portless,
        attempts: attemptTimes.length,
        retryAt: attemptTimes[0] + budgetWindowMs
      };
    }

    const attempt = attemptTimes.length + 1;
    attemptTimes.push(current);
    cooldownUntil = current + (cooldownMs * attempt);
    try {
      await persistBudget();
    } catch (error) {
      attemptTimes.pop();
      cooldownUntil = attemptTimes.length
        ? attemptTimes[attemptTimes.length - 1] + (cooldownMs * attemptTimes.length)
        : 0;
      log(`portless recovery budget save failed: ${error.message}`);
      return {
        status: "state_unavailable",
        internal,
        portless,
        attempts: attemptTimes.length,
        error: error.message
      };
    }
    log(`portless recovery attempt ${attempt}/${maxAttempts} source=${context.source || "unknown"}`);

    try {
      await triggerRepair({ attempt, source: context.source || "unknown" });
    } catch (error) {
      log(`portless recovery trigger failed attempt=${attempt} error=${error.message}`);
      return {
        status: "repair_failed",
        internal,
        portless,
        attempts: attemptTimes.length,
        retryAt: cooldownUntil,
        error: error.message
      };
    }

    const verifyStartedAt = now();
    let verified = { ok: false, error: "repair verification timed out" };
    do {
      if (verifyIntervalMs > 0) await wait(verifyIntervalMs);
      verified = normalizedProbe(await probe(80));
      if (verified.ok) break;
    } while (now() - verifyStartedAt < verifyTimeoutMs);
    if (verified.ok) {
      await resetBudget().catch((error) => log(`portless recovery budget reset failed: ${error.message}`));
      log(`portless recovery succeeded attempt=${attempt}`);
      return { status: "recovered", internal, portless: verified, attempts: 0 };
    }

    log(`portless recovery verification failed attempt=${attempt} error=${verified.error || "unavailable"}`);
    return {
      status: "repair_unverified",
      internal,
      portless: verified,
      attempts: attemptTimes.length,
      retryAt: cooldownUntil
    };
  }

  function check(context = {}) {
    if (inFlight) return inFlight;
    inFlight = checkOnce(context).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function state() {
    const timestamp = now();
    pruneAttempts(timestamp);
    return {
      inFlight: Boolean(inFlight),
      attempts: attemptTimes.length,
      cooldownUntil
    };
  }

  return { check, state };
}

module.exports = {
  DEFAULT_BUDGET_WINDOW_MS,
  DEFAULT_COOLDOWN_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_VERIFY_INTERVAL_MS,
  DEFAULT_VERIFY_TIMEOUT_MS,
  createPortlessRecoveryCoordinator,
  createPortlessRepairTrigger,
  portlessRecoveryFailureMessage
};
