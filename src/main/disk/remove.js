const fs = require('node:fs');
const path = require('node:path');

const { measurePath } = require('./walk');

const KINDS = ['downloads', 'duplicates'];

// Modification dates may differ a little between the scan and the check
// (file system timestamp resolution); anything beyond this counts as changed.
const MTIME_TOLERANCE_MS = 2000;

// Windows paths are case-insensitive and accept both slash styles.
function keyOf(p) {
  return path.win32.normalize(String(p)).toLowerCase();
}

function assertKind(kind) {
  if (!KINDS.includes(kind)) throw new Error(`Unknown kind: ${JSON.stringify(kind)}`);
}

// Last line of defence before deleting: only paths from the latest scan are
// accepted, only if they are unchanged since then, and never every file of a
// duplicate group. The actual move to the recycle bin is injected as
// `trashItem` (Electron's shell.trashItem in the app).
function createRemover({ trashItem }) {
  // kind -> Map(key -> { path, size, mtimeMs, isDirectory, group })
  const registry = new Map(KINDS.map((kind) => [kind, new Map()]));
  // group -> Set(key) of the files of that group that still exist. Replaced
  // (never mutated across scans) by register, so a running trash keeps the
  // maps it started with.
  let groups = new Map();
  // Requests run one after another, so two overlapping requests cannot each
  // pass the group check and then together delete the whole group.
  let queue = Promise.resolve();

  function register(kind, entries) {
    assertKind(kind);
    const next = new Map();
    for (const entry of entries) {
      if (kind === 'duplicates' && !entry.group) {
        throw new Error(`Duplicate entry without group: ${JSON.stringify(entry.path)}`);
      }
      next.set(keyOf(entry.path), {
        path: entry.path,
        size: entry.size,
        mtimeMs: entry.mtimeMs,
        isDirectory: entry.isDirectory === true,
        group: entry.group,
      });
    }
    registry.set(kind, next);

    if (kind === 'duplicates') {
      const nextGroups = new Map();
      for (const [key, entry] of next) {
        if (!nextGroups.has(entry.group)) nextGroups.set(entry.group, new Set());
        nextGroups.get(entry.group).add(key);
      }
      groups = nextGroups;
    }
  }

  function isRegistered(p) {
    const key = keyOf(p);
    return KINDS.some((kind) => registry.get(kind).has(key));
  }

  // Compares the current state on disk with the registered one. Links are
  // never followed, so lstat is used.
  async function isUnchanged(entry) {
    let stat;
    try {
      stat = await fs.promises.lstat(entry.path);
    } catch {
      return false;
    }
    if (entry.isDirectory) {
      if (!stat.isDirectory()) return false;
      // A folder is only as old as its newest content: measure it again, so a
      // file added, removed or changed since the scan keeps the folder here.
      const now = await measurePath(entry.path);
      return (
        !now.unreadable &&
        now.bytes === entry.size &&
        Math.abs(now.newestMtimeMs - entry.mtimeMs) <= MTIME_TOLERANCE_MS
      );
    }
    return (
      stat.isFile() &&
      stat.size === entry.size &&
      Math.abs(stat.mtimeMs - entry.mtimeMs) <= MTIME_TOLERANCE_MS
    );
  }

  // Identity of the file on disk (volume + file index), so two paths to the
  // same file (hard link, junction, subst drive) can be told from two copies.
  // null if it cannot be determined.
  async function identityOf(p) {
    try {
      const stat = await fs.promises.stat(p, { bigint: true });
      return stat.ino === 0n ? null : `${stat.dev}:${stat.ino}`;
    } catch {
      return null;
    }
  }

  // True if the group has another member that is not waiting to be deleted in
  // this call and is still on disk, unchanged. Checked right before deleting,
  // because a copy that vanished or changed since the scan is no safe backup.
  async function hasIntactSibling(state, entry, key, pending) {
    // Without a known identity nothing proves the sibling is another file.
    const ownId = await identityOf(entry.path);
    if (ownId === null) return false;
    for (const siblingKey of state.groups.get(entry.group) || []) {
      if (siblingKey === key || pending.has(siblingKey)) continue;
      const sibling = state.entries.get(siblingKey);
      if (!sibling || !(await isUnchanged(sibling))) continue;
      const siblingId = await identityOf(sibling.path);
      // The same file under another path is not a backup.
      if (siblingId !== null && siblingId !== ownId) return true;
    }
    return false;
  }

  async function run(kind, paths) {
    assertKind(kind);
    // Work on the state as of now; a register during this call replaces the
    // state for later calls but must not change this one.
    const state = { entries: registry.get(kind), groups };
    const { entries } = state;

    // Validate everything first, so a refused request deletes nothing.
    const selected = new Map();
    for (const p of paths) {
      const key = keyOf(p);
      const entry = entries.get(key);
      if (!entry) throw new Error(`Path is not registered for ${kind}: ${JSON.stringify(p)}`);
      selected.set(key, entry);
    }

    if (kind === 'duplicates') {
      const requestedPerGroup = new Map();
      for (const entry of selected.values()) {
        requestedPerGroup.set(entry.group, (requestedPerGroup.get(entry.group) || 0) + 1);
      }
      for (const [group, requested] of requestedPerGroup) {
        if (requested >= state.groups.get(group).size) {
          throw new Error(`Refusing to delete every file of duplicate group ${group}`);
        }
      }
    }

    let freedBytes = 0;
    let deleted = 0;
    let skipped = 0;
    const pending = new Set(selected.keys());
    for (const [key, entry] of selected) {
      pending.delete(key);
      if (!(await isUnchanged(entry))) {
        skipped += 1;
        continue;
      }
      if (kind === 'duplicates' && !(await hasIntactSibling(state, entry, key, pending))) {
        skipped += 1;
        continue;
      }
      try {
        await trashItem(entry.path);
      } catch {
        skipped += 1;
        continue;
      }
      freedBytes += entry.size;
      deleted += 1;
      entries.delete(key);
      if (entry.group !== undefined) state.groups.get(entry.group)?.delete(key);
    }
    return { freedBytes, deleted, skipped };
  }

  function trash(kind, paths) {
    const result = queue.then(() => run(kind, paths));
    queue = result.catch(() => {});
    return result;
  }

  return { register, isRegistered, trash };
}

module.exports = { createRemover };
