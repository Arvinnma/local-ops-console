import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const checker = path.resolve(import.meta.dirname, "../scripts/check-version-consistency.mjs");

test("version consistency gate accepts aligned inputs and rejects a mixed bundle version", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "local-ops-version-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "desktop"), { recursive: true });
  await fs.mkdir(path.join(root, "public"), { recursive: true });
  const version = "9.8.7";
  await writeJson(root, "package.json", { version });
  await writeJson(root, "package-lock.json", { version, packages: { "": { version } } });
  await writeJson(root, "desktop/package.json", {
    version,
    build: {
      files: ["control-health.cjs", "refresh-coordinator.cjs", "tunnel-action.cjs"],
      mac: { bundleVersion: version }
    }
  });
  await writeJson(root, "desktop/package-lock.json", { version, packages: { "": { version } } });
  await fs.writeFile(path.join(root, "public/index.html"), `<script src="/app.js?v=${version}"></script>\n`);
  await fs.writeFile(path.join(root, "public/app.js"), `import "/i18n.js?v=${version}";\n`);

  const passed = await execFileAsync(process.execPath, [checker, root]);
  assert.match(passed.stdout, /consistent 9\.8\.7/);

  const desktopPackage = JSON.parse(await fs.readFile(path.join(root, "desktop/package.json"), "utf8"));
  desktopPackage.build.mac.bundleVersion = "9.8.6";
  await writeJson(root, "desktop/package.json", desktopPackage);
  await assert.rejects(
    execFileAsync(process.execPath, [checker, root]),
    (error) => /bundleVersion=9\.8\.6 does not match 9\.8\.7/.test(error.stderr)
  );
});

async function writeJson(root, relative, value) {
  await fs.writeFile(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`);
}
