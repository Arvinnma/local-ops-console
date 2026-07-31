const SERVICE_HEALTH_TIMEOUT_MS = 6000;
const probesInFlight = new Map();

export async function enrichServiceProcess(definition, process, options = {}) {
  if (!definition.healthUrl) return process;

  const healthCheck = serviceHealthDescriptor(definition.healthUrl);
  if (process.managedService?.phase === "port_conflict") {
    return {
      ...process,
      health: "degraded",
      serviceReady: false,
      healthCheck: {
        ...healthCheck,
        error: process.managedService.error || "服务端口已被其他进程占用"
      }
    };
  }
  if (process.status !== "running" || !process.active) {
    return {
      ...process,
      serviceReady: false,
      healthCheck
    };
  }

  const result = await probeServiceHealth(definition.healthUrl, options);
  return {
    ...process,
    health: result.ok ? "healthy" : "degraded",
    serviceReady: result.ok,
    healthCheck: result
  };
}

export function probeServiceHealth(url, options = {}) {
  const timeoutMs = positiveMilliseconds(options.timeoutMs, SERVICE_HEALTH_TIMEOUT_MS);
  const key = `${url}:${timeoutMs}`;
  const existing = probesInFlight.get(key);
  if (existing) return existing;

  const probe = runHttpProbe(url, timeoutMs);
  probesInFlight.set(key, probe);
  return probe.finally(() => {
    if (probesInFlight.get(key) === probe) probesInFlight.delete(key);
  });
}

function runHttpProbe(url, timeoutMs) {
  return new Promise(async (resolve) => {
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "User-Agent": "Local-Ops-Service-Health/1.0" }
      });
      const ok = response.status >= 100 && response.status < 500;
      response.body?.cancel().catch(() => {});
      resolve({
        mode: "http",
        target: url,
        ok,
        statusCode: response.status,
        latencyMs: Math.round(performance.now() - started),
        error: ok ? "" : `HTTP ${response.status} ${response.statusText || ""}`.trim()
      });
    } catch (error) {
      resolve({
        mode: "http",
        target: url,
        ok: false,
        statusCode: null,
        latencyMs: null,
        error: error?.name === "AbortError"
          ? `HTTP 健康检查超时（${formatSeconds(timeoutMs)} 秒）`
          : String(error?.cause?.code || error?.message || error)
      });
    } finally {
      clearTimeout(timer);
    }
  });
}

function serviceHealthDescriptor(target) {
  return {
    mode: "http",
    target,
    ok: false,
    statusCode: null,
    latencyMs: null,
    error: ""
  };
}

function positiveMilliseconds(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function formatSeconds(milliseconds) {
  const seconds = milliseconds / 1000;
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}
