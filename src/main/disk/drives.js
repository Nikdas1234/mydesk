// Free and total space of the local drives. Read-only.
const fs = require('node:fs');

const LETTERS = 'CDEFGHIJKLMNOPQRSTUVWXYZAB'.split('');

// Resolves to [{ letter, totalBytes, freeBytes }] for every drive that
// answers. statfs is passed in for the tests.
async function listDrives({ statfs = fs.promises.statfs, letters = LETTERS } = {}) {
  const drives = [];
  for (const letter of letters) {
    try {
      const info = await statfs(`${letter}:\\`);
      const totalBytes = Number(info.blocks) * Number(info.bsize);
      const freeBytes = Number(info.bavail) * Number(info.bsize);
      if (totalBytes > 0) drives.push({ letter, totalBytes, freeBytes });
    } catch {
      // no such drive, or not ready (empty card reader)
    }
  }
  return drives.sort((a, b) => a.letter.localeCompare(b.letter));
}

module.exports = { listDrives };
