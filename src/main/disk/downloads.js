const fs = require('node:fs');
const path = require('node:path');

const { measurePath } = require('./walk');

const DAY_MS = 86_400_000;

// Read-only: lists entries directly inside `dir` whose newest modification
// time is more than `maxAgeDays` days ago. A folder is one entry; its date is
// the newest date of the files inside it, so a folder with a fresh file is not
// old. Links are entries of size 0 and are never followed (see walk.js).
async function findOldDownloads(dir, { maxAgeDays, now = Date.now(), signal } = {}) {
  // With NaN every comparison below is false, which would list everything.
  if (typeof maxAgeDays !== 'number' || !Number.isFinite(maxAgeDays)) {
    throw new Error(`maxAgeDays must be a finite number, got ${JSON.stringify(maxAgeDays)}`);
  }

  let names;
  try {
    names = await fs.promises.readdir(dir);
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return [];
    throw err;
  }

  const entries = [];
  for (const name of names) {
    if (name.toLowerCase() === 'desktop.ini') continue;

    const entryPath = path.join(dir, name);
    const measured = await measurePath(entryPath, { signal });
    // Unknown content or vanished since listing: do not report it as old.
    if (measured.unreadable || measured.newestMtimeMs === 0) continue;

    const ageDays = Math.floor((now - measured.newestMtimeMs) / DAY_MS);
    if (ageDays <= maxAgeDays) continue;

    let stat;
    try {
      stat = await fs.promises.lstat(entryPath);
    } catch {
      continue;
    }
    entries.push({
      path: entryPath,
      name,
      isDirectory: stat.isDirectory() && !stat.isSymbolicLink(),
      size: measured.bytes,
      mtimeMs: measured.newestMtimeMs,
      ageDays,
    });
  }

  entries.sort((a, b) => b.size - a.size);
  return entries;
}

module.exports = { findOldDownloads };
