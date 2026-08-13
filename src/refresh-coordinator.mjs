export function createRefreshCoordinator({ cacheTtlMs = 0 } = {}) {
  let epoch = 0;
  let cache = null;
  let current = null;
  const pending = [];

  function invalidate() {
    epoch += 1;
    cache = null;
  }

  function request({ key, force = false, compute }) {
    if (typeof compute !== "function") throw new TypeError("compute must be a function");
    const normalizedKey = String(key || "");
    const now = Date.now();
    if (
      !force
      && cache
      && cache.key === normalizedKey
      && cache.epoch === epoch
      && now - cache.at < cacheTtlMs
    ) {
      return Promise.resolve(cache.value);
    }

    if (!current) return start({ key: normalizedKey, force, compute });

    if (!force && current.key === normalizedKey) return current.promise;
    if (force && current.force && current.key === normalizedKey) return current.promise;

    return enqueue({ key: normalizedKey, force, compute });
  }

  function enqueue(next) {
    let queued = pending.find((item) => item.key === next.key);
    if (!queued) {
      queued = { ...next, waiters: [] };
      pending.push(queued);
    } else if (next.force && !queued.force) {
      queued.force = true;
      queued.compute = next.compute;
    }
    return new Promise((resolve, reject) => queued.waiters.push({ resolve, reject }));
  }

  function start(job) {
    const startedEpoch = epoch;
    const promise = Promise.resolve()
      .then(() => job.compute())
      .then((value) => {
        if (startedEpoch === epoch) {
          cache = { key: job.key, epoch: startedEpoch, at: Date.now(), value };
        }
        return value;
      });
    current = { ...job, promise };
    promise.finally(() => {
      if (current?.promise !== promise) return;
      current = null;
      const queued = pending.shift();
      if (!queued) return;
      const queuedPromise = start(queued);
      queuedPromise.then(
        (value) => queued.waiters.forEach(({ resolve }) => resolve(value)),
        (error) => queued.waiters.forEach(({ reject }) => reject(error))
      );
    }).catch(() => {});
    return promise;
  }

  return {
    request,
    invalidate,
    get epoch() { return epoch; },
    get active() { return Boolean(current); }
  };
}
