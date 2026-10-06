const fs = require('node:fs');
const path = require('node:path');

// Safety rules for everything in this module:
//  - Links (symlinks and junctions) INSIDE a cleaned folder are detected with
//    lstat and are never followed: they count as 0 bytes, and removal only
//    deletes the link itself. The `root` you pass is different: if it is itself
//    a link (e.g. %TEMP% redirected by a junction), listing it follows it and
//    the code works in the target. The elevated script (elevated.js) instead
//    skips a root that is a link.
//  - An entry directly under `root` only counts / is only removed if its newest
//    modification time is at most `now - minAgeMs` (fresh entries stay).
//  - `root` itself is never removed.

const MISSING_CODES = new Set(['ENOENT', 'ENOTDIR']);

function isMissing(err) {
  return MISSING_CODES.has(err && err.code);
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    throw new DOMException('The operation was aborted', 'AbortError');
  }
}

const EMPTY = Object.freeze({ bytes: 0, files: 0, newestMtimeMs: 0, unreadable: false });

// Measures a file or folder recursively. `unreadable` only describes `p`
// itself; entries further down that cannot be read simply add nothing.
async function scan(p, fsp, signal) {
  throwIfAborted(signal);

  let stat;
  try {
    stat = await fsp.lstat(p);
  } catch (err) {
    return isMissing(err) ? { ...EMPTY } : { ...EMPTY, unreadable: true };
  }

  if (stat.isSymbolicLink()) {
    return { bytes: 0, files: 0, newestMtimeMs: stat.mtimeMs, unreadable: false };
  }
  if (!stat.isDirectory()) {
    return { bytes: stat.size, files: 1, newestMtimeMs: stat.mtimeMs, unreadable: false };
  }

  let names;
  try {
    names = await fsp.readdir(p);
  } catch (err) {
    if (isMissing(err)) return { ...EMPTY };
    // Unknown content: use the folder's own date so it is not mistaken for old.
    return { bytes: 0, files: 0, newestMtimeMs: stat.mtimeMs, unreadable: true };
  }

  let bytes = 0;
  let files = 0;
  let newestMtimeMs = 0;
  for (const name of names) {
    const child = await scan(path.join(p, name), fsp, signal);
    bytes += child.bytes;
    files += child.files;
    newestMtimeMs = Math.max(newestMtimeMs, child.newestMtimeMs);
  }
  // An empty folder has no content to date; fall back to its own date.
  if (newestMtimeMs === 0) newestMtimeMs = stat.mtimeMs;
  return { bytes, files, newestMtimeMs, unreadable: false };
}

async function measurePath(p, { signal } = {}) {
  return scan(p, fs.promises, signal);
}

// `ignore(name)` skips entries directly inside `root` by name (e.g. the
// bookkeeping files of the recycle bin).
async function measureContents(root, { minAgeMs = 0, now = Date.now(), signal, ignore } = {}) {
  throwIfAborted(signal);
  const cutoff = now - minAgeMs;

  let names;
  try {
    names = await fs.promises.readdir(root);
  } catch (err) {
    if (isMissing(err)) return { bytes: 0, files: 0, unreadable: false };
    return { bytes: 0, files: 0, unreadable: true };
  }

  let bytes = 0;
  let files = 0;
  for (const name of names) {
    if (ignore && ignore(name)) continue;
    const entry = await scan(path.join(root, name), fs.promises, signal);
    if (entry.unreadable || entry.newestMtimeMs > cutoff) continue;
    bytes += entry.bytes;
    files += entry.files;
  }
  return { bytes, files, unreadable: false };
}

// Removes `p` (bottom-up for folders). Returns true if `p` is gone afterwards.
// Counts every failure in `tally.skipped`. A folder that is left because
// something inside it failed is not counted again.
async function removeEntry(p, ctx, tally) {
  const { fsp, cutoff } = ctx;

  let stat;
  try {
    stat = await fsp.lstat(p);
  } catch (err) {
    if (isMissing(err)) return true;
    tally.skipped += 1;
    return false;
  }

  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    // Re-check the age here: the file may have been touched since the scan.
    if (stat.mtimeMs > cutoff) {
      tally.skipped += 1;
      return false;
    }
    try {
      await fsp.unlink(p);
    } catch (err) {
      if (isMissing(err)) return true;
      tally.skipped += 1;
      return false;
    }
    tally.deleted += 1;
    if (!stat.isSymbolicLink()) tally.freedBytes += stat.size;
    return true;
  }

  let names;
  try {
    names = await fsp.readdir(p);
  } catch (err) {
    if (isMissing(err)) return true;
    tally.skipped += 1;
    return false;
  }

  let allGone = true;
  for (const name of names) {
    if (!(await removeEntry(path.join(p, name), ctx, tally))) allGone = false;
  }
  if (!allGone) return false;

  try {
    await fsp.rmdir(p);
  } catch (err) {
    if (isMissing(err)) return true;
    tally.skipped += 1;
    return false;
  }
  return true;
}

async function removeContents(root, { minAgeMs = 0, now = Date.now(), fsp = fs.promises } = {}) {
  const ctx = { fsp, cutoff: now - minAgeMs };
  const tally = { freedBytes: 0, deleted: 0, skipped: 0 };

  let names;
  try {
    names = await fsp.readdir(root);
  } catch (err) {
    if (!isMissing(err)) tally.skipped += 1;
    return tally;
  }

  for (const name of names) {
    const entryPath = path.join(root, name);
    const entry = await scan(entryPath, fsp);
    if (entry.unreadable) {
      tally.skipped += 1;
      continue;
    }
    if (entry.newestMtimeMs > ctx.cutoff) continue;
    await removeEntry(entryPath, ctx, tally);
  }
  return tally;
}

module.exports = { measurePath, measureContents, removeContents };
