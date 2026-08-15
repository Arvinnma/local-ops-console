"use strict";

function isTraySnapshotActionable({ online, hasSnapshot, snapshotState }) {
  return Boolean(
    online
    && hasSnapshot
    && (snapshotState === "fresh" || snapshotState === "refreshing")
  );
}

module.exports = { isTraySnapshotActionable };
