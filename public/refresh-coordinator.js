export function createSnapshotRefreshCoordinator({ load, apply, onStateChange = () => {} }) {
  let current = null;
  let pending = null;
  let generation = 0;
  let appliedGeneration = 0;

  function refresh({ force = false, includeDocker = false } = {}) {
    if (!current) return start({ force, includeDocker });

    const needsFollowUp = (force && !current.force) || (includeDocker && !current.includeDocker);
    if (!needsFollowUp) return current.promise;

    if (!pending) {
      pending = { force, includeDocker, waiters: [] };
    } else {
      pending.force ||= force;
      pending.includeDocker ||= includeDocker;
    }
    return new Promise((resolve, reject) => pending.waiters.push({ resolve, reject }));
  }

  function start(options) {
    const requestGeneration = ++generation;
    onStateChange({ state: "refreshing", generation: requestGeneration, ...options });
    const promise = Promise.resolve()
      .then(() => load(options))
      .then((snapshot) => {
        if (requestGeneration >= appliedGeneration) {
          apply(snapshot, options);
          appliedGeneration = requestGeneration;
        }
        onStateChange({ state: "fresh", generation: requestGeneration, ...options });
        return snapshot;
      })
      .catch((error) => {
        onStateChange({ state: "stale", generation: requestGeneration, error, ...options });
        throw error;
      });
    current = { ...options, promise };
    promise.finally(() => {
      if (current?.promise !== promise) return;
      current = null;
      const queued = pending;
      pending = null;
      if (!queued) return;
      const queuedPromise = start({ force: queued.force, includeDocker: queued.includeDocker });
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
