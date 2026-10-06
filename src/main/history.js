// What the dashboard needs to remember across restarts: how much space was
// freed in total and when each area was last checked. Only numbers and
// dates, never file names or mail data.
const fs = require('node:fs');
const path = require('node:path');

const CHECK_KEYS = ['mail', 'junk', 'downloads', 'programs'];

function createHistory(filePath, { now = Date.now } = {}) {
  function read() {
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      // missing or corrupt: start empty
    }
    const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const lastChecked = {};
    for (const key of CHECK_KEYS) {
      const value = source.lastChecked?.[key];
      lastChecked[key] = Number.isFinite(value) ? value : null;
    }
    return {
      freedBytes: Number.isFinite(source.freedBytes) && source.freedBytes > 0 ? source.freedBytes : 0,
      since: Number.isFinite(source.since) ? source.since : null,
      lastChecked,
    };
  }

  function write(state) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      fs.rmSync(tmpPath, { force: true });
      throw err;
    }
  }

  // Bookkeeping must never make a clean-up or a scan fail.
  const quietly = (work) => {
    try {
      work();
    } catch {
      // the numbers on the dashboard are then simply not updated
    }
  };

  return {
    get: read,
    addFreed(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return;
      quietly(() => {
        const state = read();
        write({ ...state, freedBytes: state.freedBytes + bytes, since: state.since ?? now() });
      });
    },
    markChecked(key) {
      if (!CHECK_KEYS.includes(key)) return;
      quietly(() => {
        const state = read();
        write({ ...state, lastChecked: { ...state.lastChecked, [key]: now() } });
      });
    },
  };
}

module.exports = { createHistory, CHECK_KEYS };
