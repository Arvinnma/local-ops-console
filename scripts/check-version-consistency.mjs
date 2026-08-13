import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(import.meta.dirname, "..");
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const rootPackage = readJson("package.json");
const rootLock = readJson("package-lock.json");
const desktopPackage = readJson("desktop/package.json");
const desktopLock = readJson("desktop/package-lock.json");
const expected = rootPackage.version;
const versions = {
  "package-lock": rootLock.version,
  "package-lock root": rootLock.packages?.[""]?.version,
  "desktop package": desktopPackage.version,
  "desktop lock": desktopLock.version,
  "desktop lock root": desktopLock.packages?.[""]?.version,
  "bundleVersion": desktopPackage.build?.mac?.bundleVersion
};

for (const [name, version] of Object.entries(versions)) {
  if (version !== expected) throw new Error(`${name}=${version} does not match ${expected}`);
}

for (const relative of ["public/index.html", "public/app.js"]) {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  const versionsInSource = [...source.matchAll(/[?&]v=(\d+\.\d+\.\d+)/g)].map((match) => match[1]);
  if (!versionsInSource.length || versionsInSource.some((version) => version !== expected)) {
    throw new Error(`${relative} cache-buster versions do not all match ${expected}`);
  }
}

for (const relative of ["control-health.cjs", "refresh-coordinator.cjs", "tunnel-action.cjs"]) {
  if (!desktopPackage.build?.files?.includes(relative)) {
    throw new Error(`desktop build.files is missing ${relative}`);
  }
}

console.log(`[version] consistent ${expected}`);
