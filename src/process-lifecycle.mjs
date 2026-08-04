import fs from "node:fs";
import path from "node:path";

const VERSION = 1;
const ALLOWED_DESIRED_STATES = new Set(["running", "stopped"]);
export const OBSERVED_STOP_GRACE_MS = 5000;
const ALLOWED_REQUEST_ACTORS = new Set([
  "ui",
  "tray",
  "api",
  "app-startup",
  "app-quit",
  "orchestrator",
  "health"
]);

export function readProcessLifecycle(file) {
  return readProcessLifecycleUnlocked(file);
}

function readProcessLifecycleUnlocked(file) {
  const empty = { version: VERSION, updatedAt: "", processes: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!parsed || Number(parsed.version) !== VERSION || typeof parsed.processes !== "object") return empty;
    return {
      version: VERSION,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      processes: Object.fromEntries(
        Object.entries(parsed.processes)
          .filter(([id, entry]) => id && entry && typeof entry === "object")
          .map(([id, entry]) => [id, normalizeEntry(id, entry)])
      )
    };
  } catch {
    return empty;
  }
}

export function recordProcessLifecycle(file, event) {
  return withLifecycleLock(file, () => {
    const at = validTimestamp(event.at);
    const state = readProcessLifecycleUnlocked(file);
    const previous = state.processes[event.id] || normalizeEntry(event.id, {});
    const desiredState = ALLOWED_DESIRED_STATES.has(event.desiredState)
      ? event.desiredState
      : previous.desiredState;
    const action = String(event.action || "").trim();
    const audit = {
      requestedBy: normalizeActor(event.requestedBy),
      reason: String(event.reason || action || "unknown").trim().slice(0, 240),
      at
    };
    appendOptionalAuditFields(audit, event);
    const next = {
      ...previous,
      id: event.id,
      kind: String(event.kind || previous.kind || "service"),
      desiredState,
      updatedAt: at,
      lastAction: action ? { action, ...audit } : previous.lastAction
    };
    if (action === "start" || action === "restart") next.lastStart = audit;
    if (action === "stop" || action === "restart") next.lastStop = audit;
    state.processes[event.id] = next;
    state.updatedAt = at;
    writeProcessLifecycle(file, state);
    return next;
  });
}

export function recordProcessActionRequest(file, {
  id,
  kind,
  action,
  requestedBy,
  at,
  eventName,
  actionId,
  callPath,
  userIntentConfirmed
}) {
  if (!["start", "stop", "restart"].includes(action)) {
    throw new Error(`Unsupported process lifecycle action: ${action}`);
  }
  const actor = normalizeActor(requestedBy);
  return recordProcessLifecycle(file, {
    id,
    kind,
    desiredState: action === "stop" ? "stopped" : "running",
    action,
    requestedBy: actor,
    reason: `${actor}_${action}`,
    at,
    eventName,
    actionId,
    callPath,
    userIntentConfirmed
  });
}

export function processMutationActor(headers = {}) {
  const value = String(headers["x-local-ops-requested-by"] || "api").trim().toLowerCase();
  return ALLOWED_REQUEST_ACTORS.has(value) ? value : "api";
}

export function processMutationAudit(headers = {}) {
  const userIntentHeader = String(headers["x-local-ops-user-intent-confirmed"] || "").trim().toLowerCase();
  return {
    eventName: normalizeAuditText(headers["x-local-ops-event-name"], 120),
    actionId: normalizeAuditText(headers["x-local-ops-action-id"], 120),
    callPath: normalizeAuditText(headers["x-local-ops-call-path"], 240),
    userIntentConfirmed: userIntentHeader ? userIntentHeader === "true" : undefined
  };
}

export function shouldAuditObservedStop(lifecycle, process, options = {}) {
  if (process.active || lifecycle?.desiredState !== "running") return false;
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const graceMs = Number.isFinite(Number(options.graceMs))
    ? Math.max(0, Number(options.graceMs))
    : OBSERVED_STOP_GRACE_MS;
  const lastStartAt = Date.parse(lifecycle.lastStart?.at || lifecycle.lastAction?.at || "");
  if (Number.isFinite(lastStartAt) && now - lastStartAt < graceMs) return false;
  const lastStopAt = Date.parse(lifecycle.lastStop?.at || "");
  return !(Number.isFinite(lastStopAt) && (!Number.isFinite(lastStartAt) || lastStopAt >= lastStartAt));
}

export function reconcileRememberedProcessIds({
  file,
  definitions,
  activeIds = [],
  previousIds = [],
  now = new Date().toISOString()
}) {
  return withLifecycleLock(file, () => {
    const state = readProcessLifecycleUnlocked(file);
    const active = new Set(activeIds.map(String));
    const previous = new Set(previousIds.map(String));
    const remembered = [];
    let changed = false;

    for (const definition of definitions) {
      const id = String(definition.id);
      let entry = state.processes[id];
      if (
        previous.has(id)
        && entry?.desiredState === "stopped"
        && entry.lastStop?.requestedBy === "tray"
        && entry.lastStop?.userIntentConfirmed !== true
      ) {
        const audit = {
          action: "observe",
          requestedBy: "session-capture",
          reason: "preserved_unconfirmed_tray_stop",
          at: now
        };
        entry = {
          ...entry,
          desiredState: "running",
          updatedAt: now,
          lastAction: audit
        };
        state.processes[id] = entry;
        changed = true;
      }
      if (!entry && (active.has(id) || previous.has(id))) {
        entry = normalizeEntry(id, {
          kind: definition.kind,
          desiredState: "running",
          updatedAt: now,
          lastAction: {
            action: "observe",
            requestedBy: "session-capture",
            reason: active.has(id) ? "observed_running" : "preserved_previous_session",
            at: now
          }
        });
        state.processes[id] = entry;
        changed = true;
      }
      if (entry?.desiredState === "running" || (!entry && active.has(id))) remembered.push(id);
    }

    if (changed) {
      state.updatedAt = now;
      writeProcessLifecycle(file, state);
    }
    return remembered;
  });
}

export function lifecycleForProcess(state, id) {
  const entry = state?.processes?.[id];
  return entry ? structuredClone(entry) : null;
}

function writeProcessLifecycle(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

function withLifecycleLock(file, operation) {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
      try {
        return operation();
      } finally {
        fs.rmSync(lock, { recursive: true, force: true });
      }
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const age = Date.now() - fs.statSync(lock).mtimeMs;
        if (age > 10000) {
          fs.rmSync(lock, { recursive: true, force: true });
          continue;
        }
      } catch {}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  throw new Error(`Timed out waiting for process lifecycle lock: ${lock}`);
}

function normalizeEntry(id, entry) {
  return {
    id,
    kind: String(entry.kind || "service"),
    desiredState: ALLOWED_DESIRED_STATES.has(entry.desiredState) ? entry.desiredState : "",
    updatedAt: validTimestamp(entry.updatedAt, ""),
    lastAction: normalizeAudit(entry.lastAction, true),
    lastStart: normalizeAudit(entry.lastStart),
    lastStop: normalizeAudit(entry.lastStop)
  };
}

function normalizeAudit(value, includeAction = false) {
  if (!value || typeof value !== "object") return null;
  const result = {
    requestedBy: normalizeActor(value.requestedBy),
    reason: String(value.reason || "").slice(0, 240),
    at: validTimestamp(value.at, "")
  };
  appendOptionalAuditFields(result, value);
  if (includeAction) result.action = String(value.action || "");
  return result;
}

function appendOptionalAuditFields(target, value = {}) {
  const eventName = normalizeAuditText(value.eventName, 120);
  const actionId = normalizeAuditText(value.actionId, 120);
  const callPath = normalizeAuditText(value.callPath, 240);
  if (eventName) target.eventName = eventName;
  if (actionId) target.actionId = actionId;
  if (callPath) target.callPath = callPath;
  if (typeof value.userIntentConfirmed === "boolean") {
    target.userIntentConfirmed = value.userIntentConfirmed;
  }
}

function normalizeAuditText(value, limit) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, limit);
}

function normalizeActor(value) {
  return String(value || "unknown").trim().slice(0, 64) || "unknown";
}

function validTimestamp(value, fallback = new Date().toISOString()) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}
