import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { BINARIES } from "./config.mjs";

const execFileAsync = promisify(execFile);
const SECRET_REFERENCE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_SECRET_BYTES = 16 * 1024;

export function validateSecretReference(value) {
  const reference = String(value || "").trim().toLowerCase();
  if (!SECRET_REFERENCE.test(reference)) throw new Error("SSH 私钥口令引用无效");
  return reference;
}

export function normalizePrivateKeyPassphrase(value) {
  const passphrase = String(value ?? "");
  const bytes = Buffer.byteLength(passphrase, "utf8");
  if (bytes > MAX_SECRET_BYTES) throw new Error("SSH 私钥口令不能超过 16 KB");
  if (passphrase.includes("\0")) throw new Error("SSH 私钥口令不能包含空字符");
  return passphrase;
}

export async function storePrivateKeyPassphrase(reference, passphrase) {
  const account = validateSecretReference(reference);
  const secret = normalizePrivateKeyPassphrase(passphrase);
  if (!secret) throw new Error("SSH 私钥口令不能为空");
  await runHelperWithInput("store", account, secret);
}

export async function readPrivateKeyPassphrase(reference) {
  const account = validateSecretReference(reference);
  const { stdout } = await runHelper("get", account, { encoding: "buffer" });
  return Buffer.isBuffer(stdout) ? stdout.toString("utf8") : String(stdout || "");
}

export async function hasPrivateKeyPassphrase(reference) {
  if (!reference) return false;
  try {
    await runHelper("exists", validateSecretReference(reference));
    return true;
  } catch (error) {
    if (/item could not be found|errSecItemNotFound|-25300/i.test(helperError(error))) return false;
    throw error;
  }
}

export async function deletePrivateKeyPassphrase(reference) {
  if (!reference) return;
  await runHelper("delete", validateSecretReference(reference));
}

function runHelper(command, reference, extra = {}) {
  assertAvailable();
  return execFileAsync(BINARIES.keychain, [command, reference], {
    timeout: 15000,
    maxBuffer: 32 * 1024,
    ...extra
  });
}

function runHelperWithInput(command, reference, input) {
  assertAvailable();
  return new Promise((resolve, reject) => {
    const child = spawn(BINARIES.keychain, [command, reference], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("macOS 钥匙串操作超时"));
    }, 15000);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
      const message = Buffer.concat(stderr).toString("utf8").trim() || `Keychain Helper 退出状态 ${code}`;
      reject(new Error(message));
    });
    child.stdin.end(input, "utf8");
  });
}

function assertAvailable() {
  if (process.platform !== "darwin") throw new Error("SSH 私钥口令的钥匙串存储仅支持 macOS");
  if (!BINARIES.keychain || BINARIES.keychain === "local-ops-keychain") {
    throw new Error("Local Ops Keychain Helper 尚未安装，请重新构建或安装 App");
  }
}

function helperError(error) {
  return `${error?.stderr || ""}\n${error?.message || ""}`;
}
