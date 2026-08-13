"use strict";

function createRefreshCoordinator({ load, onStateChange = () => {} }) {
  let current = null;
  let pendingForce = null;

  function refresh(force = false) {
    if (!current) return start(force);
    if (!force || current.force) return current.promise;
    if (!pendingForce) pendingForce = { waiters: [] };
    return new Promise((resolve, reject) => pendingForce.waiters.push({ resolve, reject }));
  }

  function start(force) {
    onStateChange({ state: "refreshing", force });
    const promise = Promise.resolve()
      .then(() => load(force))
      .then((value) => {
        onStateChange({ state: "fresh", force, value });
        return value;
      })
      .catch((error) => {
        onStateChange({ state: "stale", force, error });
        throw error;
      });
    current = { force, promise };
    promise.finally(() => {
      if (current?.promise !== promise) return;
      current = null;
      const queued = pendingForce;
      pendingForce = null;
      if (!queued) return;
      const queuedPromise = start(true);
      queuedPromise.then(
        (value) => queued.waiters.forEach(({ resolve }) => resolve(value)),
        (error) => queued.waiters.forEach(({ reject }) => reject(error))
      );
    }).catch(() => {});
    return promise;
  }

  return {
    refresh,
    get active() { return Boolean(current); }
  };
}

module.exports = { createRefreshCoordinator };
