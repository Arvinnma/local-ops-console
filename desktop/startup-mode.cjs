function canManageLoginItem(platform = process.platform, isPackaged = false) {
  return platform === "darwin" && Boolean(isPackaged);
}

function shouldStartSilently({
  platform = process.platform,
  isPackaged = false,
  wasOpenedAtLogin = false,
  requestedSilent = false
} = {}) {
  return canManageLoginItem(platform, isPackaged) && Boolean(wasOpenedAtLogin || requestedSilent);
}

function createStartupPresentation(startSilent = false) {
  let silent = Boolean(startSilent);
  return Object.freeze({
    isSilent: () => silent,
    shouldShowWindow: () => !silent,
    reveal: () => { silent = false; }
  });
}

function createLoginItemSettings(enabled) {
  return {
    openAtLogin: Boolean(enabled),
    // Electron's openAsHidden flag is ignored on macOS 13+, so the app also
    // suppresses its own window when wasOpenedAtLogin is true.
    openAsHidden: true
  };
}

module.exports = {
  canManageLoginItem,
  createLoginItemSettings,
  createStartupPresentation,
  shouldStartSilently
};
