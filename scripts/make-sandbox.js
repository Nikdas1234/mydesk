#!/usr/bin/env node
// Creates a sandbox folder with example files for trying out the clean-up
// features without touching real data:
//   node scripts/make-sandbox.js <folder>
//   $env:MYDESK_SANDBOX = '<folder>'; npm start
// Refuses to write into a folder that already has content. The marker file
// `.mydesk-sandbox` it creates is what lets the app accept the folder as sandbox.

const fs = require('node:fs');
const path = require('node:path');

const { SANDBOX_MARKER } = require('../src/main/paths');

const KB = 1024;
const MB = 1024 * KB;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function assertUsableFolder(folder) {
  let stat = null;
  try {
    stat = fs.statSync(folder);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (!stat) return;
  if (!stat.isDirectory()) throw new Error(`${folder} exists and is not a folder`);
  if (fs.readdirSync(folder).length > 0) {
    throw new Error(`${folder} is not empty; refusing to write into it`);
  }
}

// Writes `sizeBytes` of the byte `fill` and dates the file back by `ageMs`.
function put(root, relPath, sizeBytes, { ageMs = 0, fill = 0 } = {}) {
  const file = path.join(root, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(sizeBytes, fill));
  const when = new Date(Date.now() - ageMs);
  fs.utimesSync(file, when, when);
}

function makeSandbox(folderArg) {
  const root = path.resolve(folderArg);
  assertUsableFolder(root);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, SANDBOX_MARKER),
    'Marks this folder as a sandbox of MyDesk (MYDESK_SANDBOX). Do not delete.\n',
    'utf8',
  );
  const old = (days) => ({ ageMs: days * DAY_MS });

  // Temporary files: old ones go, the fresh one (< 24 h) must stay.
  put(root, 'Temp\\alt-1.tmp', 3 * MB, old(5));
  put(root, 'Temp\\Unterordner\\alt-2.tmp', 1 * MB, old(30));
  put(root, 'Temp\\frisch.tmp', 200 * KB, { ageMs: HOUR_MS });

  // Edge: cache goes, History (user data) must stay.
  const edge = 'LocalAppData\\Microsoft\\Edge\\User Data\\Default';
  put(root, `${edge}\\Cache\\data_0`, 2 * MB);
  put(root, `${edge}\\Code Cache\\js\\index`, 512 * KB);
  put(root, `${edge}\\GPUCache\\data_1`, 256 * KB);
  put(root, `${edge}\\History`, 100 * KB, old(1));
  put(root, 'LocalAppData\\CrashDumps\\example.dmp', 1 * MB);

  // Admin categories.
  put(root, 'Windows\\Temp\\alt.tmp', 2 * MB, old(10));
  put(root, 'Windows\\SoftwareDistribution\\Download\\update.cab', 4 * MB);
  put(root, 'ProgramData\\Microsoft\\Windows\\WER\\ReportArchive\\Report1\\report.wer', 300 * KB);

  // Downloads: two old (200 and 120 days, one of them a folder), two recent.
  // Sizes differ from each other and from the duplicate files below.
  put(root, 'Downloads\\Setup-alt.exe', 5 * MB, old(200));
  put(root, 'Downloads\\Archiv-2025\\a.bin', 1 * MB, { ...old(120), fill: 7 });
  put(root, 'Downloads\\Archiv-2025\\b.bin', 512 * KB, { ...old(120), fill: 8 });
  put(root, 'Downloads\\Rechnung.pdf', 300 * KB, old(3));
  put(root, 'Downloads\\Notizen.txt', 40 * KB, old(10));

  // Two duplicate groups of two 2 MB files each.
  put(root, 'Dokumente\\Vertrag.bin', 2 * MB, { ...old(40), fill: 1 });
  put(root, 'Bilder\\Kopie von Vertrag.bin', 2 * MB, { ...old(20), fill: 1 });
  put(root, 'Desktop\\Foto.bin', 2 * MB, { ...old(15), fill: 2 });
  put(root, 'Videos\\Foto-Sicherung.bin', 2 * MB, { ...old(8), fill: 2 });

  // Folders that exist but stay empty.
  for (const name of ['settings', 'Musik']) fs.mkdirSync(path.join(root, name), { recursive: true });

  // The old folder dates would otherwise be "now" because files were just written.
  const archive = path.join(root, 'Downloads', 'Archiv-2025');
  const archiveDate = new Date(Date.now() - 120 * DAY_MS);
  fs.utimesSync(archive, archiveDate, archiveDate);

  return root;
}

module.exports = { makeSandbox };

if (require.main === module) {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node scripts/make-sandbox.js <folder>');
    process.exit(2);
  }
  try {
    const root = makeSandbox(target);
    console.log(`Sandbox created: ${root}`);
    console.log(`Start: $env:MYDESK_SANDBOX = '${root}'; npm start`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
