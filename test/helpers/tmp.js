const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Creates a fresh temp directory and removes it after the test finishes.
// `t` is the node:test test context.
function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mydesk-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Creates a file of `sizeBytes` filled with the byte value `fill`, including
// missing parent folders. Sets modified and access time to "now minus daysOld
// days" (fractions allowed). Returns the path.
function writeFile(filePath, sizeBytes, { daysOld = 0, fill = 0 } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.alloc(sizeBytes, fill));
  const when = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  fs.utimesSync(filePath, when, when);
  return filePath;
}

module.exports = { makeTempDir, writeFile };
