function bringWindowToFront(app, window, platform = process.platform) {
  if (!window || window.isDestroyed()) return false;

  // A menu-bar panel can leave NSApplication inactive even though app.isHidden()
  // is false. Always unhide the app before promoting its regular window.
  if (platform === "darwin") app?.show?.();
  if (window.isMinimized()) window.restore();

  window.show();
  if (platform === "darwin") app?.focus?.({ steal: true });
  // Reassert visibility after activating the app. macOS may otherwise retain
  // the Dock-minimized state while a non-activating panel is resigning focus.
  if (window.isMinimized()) window.restore();
  window.show();
  if (typeof window.moveTop === "function") window.moveTop();
  window.focus();
  return true;
}

module.exports = { bringWindowToFront };
