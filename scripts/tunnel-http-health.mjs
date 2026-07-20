import fs from "node:fs";

const target = process.argv[2];
const allowWaitingIndex = process.argv.indexOf("--allow-waiting-network");
const waitingStateFile = allowWaitingIndex >= 0 ? process.argv[allowWaitingIndex + 1] : "";
const connectingGraceIndex = process.argv.indexOf("--connecting-grace-ms");
const connectingGraceMs = connectingGraceIndex >= 0 ? Number(process.argv[connectingGraceIndex + 1] || 0) : 0;

if (!target) fail("缺少隧道健康检查 URL");

if (waitingStateFile && isAllowedGateState(waitingStateFile, connectingGraceMs)) process.exit(0);

let url;
try {
  url = new URL(target);
} catch {
  fail("隧道健康检查 URL 无效");
}

if (!["http:", "https:"].includes(url.protocol)) fail("隧道健康检查仅支持 HTTP/HTTPS");
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname)) {
  fail("隧道健康检查只能访问本机回环地址");
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 2000);

try {
  const response = await fetch(url, {
    signal: controller.signal,
    redirect: "manual",
    headers: { "User-Agent": "Local-Ops-Tunnel-Health/1.0" }
  });
  response.body?.cancel().catch(() => {});
  if (response.status >= 100 && response.status < 500) process.exit(0);
  fail(`HTTP ${response.status} ${response.statusText || ""}`.trim());
} catch (error) {
  fail(error?.name === "AbortError" ? "HTTP 健康检查超时（2 秒）" : String(error?.message || error));
} finally {
  clearTimeout(timeout);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function isAllowedGateState(file, connectingGrace) {
  try {
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    const age = Date.now() - Date.parse(state.updatedAt || "");
    if (!Number.isFinite(age) || age < 0) return false;
    if (state.phase === "waiting_network") return age < 12000;
    return state.phase === "connecting" && connectingGrace > 0 && age < connectingGrace;
  } catch {
    return false;
  }
}
