import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const HELPER = process.env.LOCAL_OPS_KEYCHAIN_HELPER || path.join(ROOT, "bin", "local-ops-keychain");
const ASKPASS = process.env.LOCAL_OPS_SSH_ASKPASS
  || path.join(ROOT, "scripts", "local-ops-ssh-askpass.zsh");
const reference = crypto.randomUUID();
const passphrase = `Local-Ops-integration-${crypto.randomBytes(18).toString("base64url")}`;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "local-ops-keychain-"));
const privateKey = path.join(temporary, "encrypted_ed25519");

if (process.platform !== "darwin") {
  console.log("Keychain integration test skipped: macOS is required");
  process.exit(0);
}
if (!fs.existsSync(HELPER)) throw new Error(`Keychain Helper 不存在：${HELPER}`);
if (!fs.existsSync(ASKPASS)) throw new Error(`SSH AskPass 脚本不存在：${ASKPASS}`);

try {
  await execFileAsync("/usr/bin/ssh-keygen", [
    "-q", "-t", "ed25519", "-N", passphrase, "-C", "local-ops-integration-test", "-f", privateKey
  ], { timeout: 20000 });

  await runHelperWithInput("store", reference, `${passphrase}-wrong`);
  await assert.rejects(unlockPrivateKey());

  await runHelperWithInput("store", reference, passphrase);
  await execFileAsync(HELPER, ["exists", reference], { timeout: 10000 });

  const { stdout } = await unlockPrivateKey();
  const expected = fs.readFileSync(`${privateKey}.pub`, "utf8").trim().split(/\s+/).slice(0, 2).join(" ");
  const actual = stdout.trim().split(/\s+/).slice(0, 2).join(" ");
  assert.equal(actual, expected);

  await execFileAsync(HELPER, ["delete", reference], { timeout: 10000 });
  await assert.rejects(execFileAsync(HELPER, ["exists", reference], { timeout: 10000 }));
  console.log("Keychain integration passed: wrong passphrase rejected; encrypted Ed25519 key unlocked through Local Ops AskPass");
} finally {
  await execFileAsync(HELPER, ["delete", reference], { timeout: 10000 }).catch(() => {});
  fs.rmSync(temporary, { recursive: true, force: true });
}

function unlockPrivateKey() {
  return execFileAsync("/usr/bin/ssh-keygen", ["-y", "-f", privateKey], {
    timeout: 20000,
    env: {
      ...process.env,
      SSH_ASKPASS: ASKPASS,
      SSH_ASKPASS_REQUIRE: "force",
      DISPLAY: "local-ops:0",
      LC_ALL: "C",
      LOCAL_OPS_KEYCHAIN_HELPER: HELPER,
      LOCAL_OPS_KEYCHAIN_ACCOUNT: reference
    }
  });
}

function runHelperWithInput(command, account, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(HELPER, [command, account], { stdio: ["pipe", "ignore", "pipe"] });
    const stderr = [];
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `Helper exited ${code}`));
    });
    child.stdin.end(input, "utf8");
  });
}
