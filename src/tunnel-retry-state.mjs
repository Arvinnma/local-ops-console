export const TUNNEL_RETRY_LIMIT = 10;
export const TUNNEL_RETRY_BACKOFF_MS = 3000;
export const TUNNEL_STABLE_WINDOW_MS = 10_000;

const RESUMABLE_PHASES = new Set([
  "waiting_network",
  "connecting",
  "stabilizing",
  "retrying",
  "ssh_exited",
  "connection_failed"
]);

export function createTunnelRetryState(previous = null, {
  retryLimit = TUNNEL_RETRY_LIMIT
} = {}) {
  const limit = normalizeLimit(retryLimit);
  const previousCount = Number(previous?.consecutiveFailures || 0);
  const resumable = RESUMABLE_PHASES.has(String(previous?.phase || ""));
  const consecutiveFailures = resumable && Number.isInteger(previousCount)
    ? Math.min(Math.max(previousCount, 0), limit)
    : 0;
  const exhausted = consecutiveFailures >= limit;
  return {
    retryLimit: limit,
    consecutiveFailures,
    failureEpisodeStartedAt: consecutiveFailures ? previous?.failureEpisodeStartedAt || previous?.lastFailureAt || null : null,
    lastFailureAt: consecutiveFailures ? previous?.lastFailureAt || null : null,
    stableAt: consecutiveFailures ? null : previous?.phase === "connected" ? previous?.stableAt || null : null,
    exhausted,
    shouldRetry: !exhausted
  };
}

export function registerTunnelFailure(state, at = new Date().toISOString()) {
  const retryLimit = normalizeLimit(state?.retryLimit);
  const consecutiveFailures = Math.min(Number(state?.consecutiveFailures || 0) + 1, retryLimit);
  return {
    retryLimit,
    consecutiveFailures,
    failureEpisodeStartedAt: state?.failureEpisodeStartedAt || at,
    lastFailureAt: at,
    stableAt: null,
    exhausted: consecutiveFailures >= retryLimit,
    shouldRetry: consecutiveFailures < retryLimit
  };
}

export function resetTunnelFailures(state, at = new Date().toISOString()) {
  return {
    retryLimit: normalizeLimit(state?.retryLimit),
    consecutiveFailures: 0,
    failureEpisodeStartedAt: null,
    lastFailureAt: state?.lastFailureAt || null,
    stableAt: at,
    exhausted: false,
    shouldRetry: true
  };
}

export function retryStateSnapshot(state) {
  return {
    retryLimit: normalizeLimit(state?.retryLimit),
    consecutiveFailures: Math.max(0, Number(state?.consecutiveFailures || 0)),
    failureEpisodeStartedAt: state?.failureEpisodeStartedAt || null,
    lastFailureAt: state?.lastFailureAt || null,
    stableAt: state?.stableAt || null
  };
}

function normalizeLimit(value) {
  const requested = Number(value);
  return Number.isInteger(requested) && requested > 0 ? requested : TUNNEL_RETRY_LIMIT;
}
