// Shared scan results, so a view shows the last result again after the user
// switched away and back. Pure logic without DOM access (the only DOM contact
// is the `isConnected` flag of the element passed to watch()).

const KEYS = ['junk', 'downloads', 'mail', 'programs'];

const NO_STATUS = Object.freeze({ running: false, error: null });

/**
 * @param {() => object} getApi returns the bridge object (window.api); read on
 *   every call so tests can pass a fake.
 */
export function createStore(getApi) {
  const values = new Map(KEYS.map((key) => [key, null]));
  const statuses = new Map(KEYS.map((key) => [key, NO_STATUS]));
  const listeners = new Map(KEYS.map((key) => [key, new Set()]));
  const running = new Map();
  // Keys whose running scan was overtaken by invalidate(): its result is stale.
  const stale = new Set();
  const cleaning = new Set();

  function check(key) {
    if (!KEYS.includes(key)) throw new Error(`Unknown store key: ${key}`);
  }

  // A listener that throws (a view that is half torn down) must not stop the
  // others, and must never make a scan reject or stay "running".
  function notify(key) {
    for (const callback of [...listeners.get(key)]) {
      try {
        callback(values.get(key), statuses.get(key));
      } catch (err) {
        console.error('Store listener failed:', err);
      }
    }
  }

  const store = {
    /** Last result of a scan; `null` = not checked yet. */
    get(key) {
      check(key);
      return values.get(key);
    },

    set(key, value) {
      check(key);
      values.set(key, value);
      notify(key);
    },

    /**
     * Forgets the result for `key` (back to "not checked yet"), e.g. because
     * the files it described were moved. A scan that is running right now
     * started before the change, so its result is dropped, too.
     */
    invalidate(key) {
      check(key);
      if (running.has(key)) stale.add(key);
      values.set(key, null);
      notify(key);
    },

    /** Marks a clean-up of `key` as running / finished (shared between views). */
    setCleaning(key, active) {
      check(key);
      if (active) cleaning.add(key);
      else cleaning.delete(key);
      notify(key);
    },

    isCleaning(key) {
      check(key);
      return cleaning.has(key);
    },

    /** `{ running: boolean, error: string | null }` of the scan for `key`. */
    getStatus(key) {
      check(key);
      return statuses.get(key);
    },

    /**
     * Calls `callback(value, status)` whenever the value or the status of `key`
     * changes. Returns a function that removes the listener.
     */
    subscribe(key, callback) {
      check(key);
      listeners.get(key).add(callback);
      return () => listeners.get(key).delete(callback);
    },

    /**
     * Calls `callback()` on every change of one of `keys` for as long as
     * `element` is part of the page; the first change after it was removed
     * (view replaced) removes the listeners.
     */
    watch(element, keys, callback) {
      const offs = [];
      const off = () => offs.forEach((fn) => fn());
      for (const key of keys) {
        offs.push(
          store.subscribe(key, () => {
            if (!element.isConnected) off();
            else callback();
          }),
        );
      }
      return off;
    },

    /**
     * Runs the scan for `key` (junk | downloads | mail | programs) and stores the
     * result. A running scan of the same key is not started twice (the same
     * promise is returned). Never rejects: a failure ends up in the status as
     * `error`; a cancelled scan keeps the previous value.
     */
    scan(key) {
      check(key);
      if (running.has(key)) return running.get(key);
      const api = getApi();
      stale.delete(key);
      statuses.set(key, { running: true, error: null });
      notify(key);
      // Starts in a microtask so that `running` is set before anything can finish.
      const promise = Promise.resolve().then(async () => {
        try {
          const result = await api[key].scan();
          if ((result && result.cancelled) || stale.has(key)) {
            statuses.set(key, NO_STATUS);
          } else {
            values.set(key, result);
            statuses.set(key, NO_STATUS);
          }
        } catch (err) {
          statuses.set(key, { running: false, error: String((err && err.message) || err) });
        } finally {
          running.delete(key);
          stale.delete(key);
        }
        notify(key);
      });
      running.set(key, promise);
      return promise;
    },

    /** Asks the main process to stop the running scan for `key`; no-op otherwise. */
    async cancel(key) {
      check(key);
      if (!running.has(key)) return;
      try {
        await getApi().cancel(key);
      } catch {
        // The scan may have finished in the meantime; nothing to undo.
      }
    },
  };

  return store;
}

export const store = createStore(() => window.api);
