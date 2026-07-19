const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const { promisify } = require("node:util");
const path = require("node:path");

const execFileAsync = promisify(execFile);

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const resourcesPath = path.join(appPath, "Contents", "Resources");
  const infoPlistPath = path.join(appPath, "Contents", "Info.plist");
  const iconName = "LocalOpsGateway.icns";
  await fs.copyFile(path.join(resourcesPath, "icon.icns"), path.join(resourcesPath, iconName));
  await execFileAsync("/usr/libexec/PlistBuddy", [
    "-c",
    `Set :CFBundleIconFile ${iconName}`,
    infoPlistPath
  ]);
  await execFileAsync("/usr/bin/xattr", ["-cr", appPath]).catch(() => {});
  await execFileAsync("/usr/bin/codesign", [
    "--force",
    "--deep",
    "--sign",
    "-",
    appPath
  ]);
};
