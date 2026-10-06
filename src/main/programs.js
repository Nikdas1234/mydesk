// Installed programs with the time they were last started, so the user can
// spot what has not been used for a long time and uninstall it.
// "Last used" is an estimate: Windows only records starts through the Start
// menu, taskbar and Explorer (the "UserAssist" list); a program started in
// another way shows up as unknown.
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const { powershellPath } = require('./system-tools');

const execFileAsync = promisify(execFile);

// Reads the three "Uninstall" lists of the registry and the raw UserAssist
// entries. Read-only; prints one JSON object.
const QUERY_SCRIPT = [
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  "$keys = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
  '$p = foreach ($k in $keys) { Get-ItemProperty $k -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ key = [string]$_.PSPath; name = $_.DisplayName; version = $_.DisplayVersion; publisher = $_.Publisher; installDate = $_.InstallDate; sizeKb = $_.EstimatedSize; uninstall = $_.UninstallString; location = $_.InstallLocation; icon = $_.DisplayIcon; system = $_.SystemComponent; parent = $_.ParentKeyName; release = $_.ReleaseType } } }',
  "$uas = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\UserAssist\\{CEBFF5CD-ACE2-4F4F-9178-9926F41749EA}\\Count','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\UserAssist\\{F4E57C4B-2036-45F0-A9AB-443BCFE33D9F}\\Count'",
  '$r = @()',
  'foreach ($ua in $uas) { $k = Get-Item $ua -ErrorAction SilentlyContinue; if ($k) { foreach ($n in $k.GetValueNames()) { $d = $k.GetValue($n); if ($d -is [byte[]] -and $d.Length -ge 68) { $r += [pscustomobject]@{ name = $n; data = [Convert]::ToBase64String($d) } } } } }',
  '[pscustomobject]@{ programs = @($p); runs = @($r) } | ConvertTo-Json -Depth 4 -Compress',
  'exit 0',
].join('\n');

// Windows stores the UserAssist names shifted by 13 letters.
function rot13(text) {
  return text.replace(/[a-z]/gi, (ch) => {
    const base = ch <= 'Z' ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + 13) % 26) + base);
  });
}

// Folder ids Windows uses instead of the real path.
function knownFolders(env) {
  const root = env.SystemRoot || 'C:\\Windows';
  return {
    '{6D809377-6AF0-444B-8957-A3773F02200E}': env.ProgramW6432 || env.ProgramFiles,
    '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}': env['ProgramFiles(x86)'],
    '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}': `${root}\\System32`,
    '{D65231B0-B2F1-4857-A4CE-A8E7C6EA7D27}': `${root}\\SysWOW64`,
    '{F38BF404-1D43-42F2-9305-67DE0B28FC23}': root,
    '{F1B32785-6FBA-4FCF-9D55-7B8E7F157091}': env.LOCALAPPDATA,
    '{5CD7AEE2-2219-4A67-B85D-6C9CE15660CB}': env.LOCALAPPDATA ? `${env.LOCALAPPDATA}\\Programs` : undefined,
    '{3EB685DB-65F9-4CF6-A03A-E3EF65729F3D}': env.APPDATA,
  };
}

const FILETIME_EPOCH_MS = 11_644_473_600_000;

// raw: [{ name (shifted), data (base64) }] -> [{ path (lower case), lastRunMs }]
function decodeRuns(raw, env = process.env) {
  const folders = knownFolders(env);
  const runs = [];
  for (const entry of raw ?? []) {
    let data;
    try {
      data = Buffer.from(String(entry.data), 'base64');
    } catch {
      continue;
    }
    if (data.length < 68) continue;
    const lastRunMs = Number(data.readBigUInt64LE(60) / 10_000n) - FILETIME_EPOCH_MS;
    if (!(lastRunMs > 0)) continue;
    let name = rot13(String(entry.name));
    // A used Start menu shortcut: only its name is of interest.
    const shortcut = /([^\\]+)\.lnk$/i.exec(name);
    if (shortcut) {
      runs.push({ path: null, shortcut: shortcut[1].trim().toLowerCase(), lastRunMs });
      continue;
    }
    const guid = /^\{[0-9A-F-]{36}\}/i.exec(name);
    if (guid) {
      const folder = folders[guid[0].toUpperCase()];
      if (!folder) continue;
      name = folder + name.slice(guid[0].length);
    }
    if (!/^[a-z]:\\/i.test(name)) continue;
    runs.push({ path: name.toLowerCase(), shortcut: null, lastRunMs });
  }
  return runs;
}

function parseInstallDate(value) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(String(value ?? ''));
  if (!match) return null;
  const ms = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// "C:\x\app.exe,0" or '"C:\x\app.exe"' -> c:\x\app.exe
function iconPath(value) {
  const text = String(value ?? '').trim().replace(/,\s*-?\d+$/, '').replace(/^"|"$/g, '');
  return /\.exe$/i.test(text) ? text.toLowerCase() : null;
}

// The folder a program lives in, taken from its uninstaller or icon when the
// registry names no install folder. Folders shared by many programs (Windows
// itself, installer caches) tell nothing and are left out.
function folderOf(exePath, env) {
  if (!exePath) return '';
  const folder = exePath.slice(0, exePath.lastIndexOf('\\'));
  const root = String(env.SystemRoot || 'C:\\Windows').toLowerCase();
  if (folder.length <= 3 || folder.startsWith(root) || /package cache|\\installer$|\\common files/.test(folder)) return '';
  const shared = [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432, env.ProgramData, env.LOCALAPPDATA, env.APPDATA]
    .filter(Boolean).map((p) => String(p).toLowerCase());
  return shared.includes(folder) ? '' : folder;
}

// "C:\x\unins000.exe" /S -> c:\x\unins000.exe
function exeOf(commandLine) {
  const match = /^\s*"([^"]+\.exe)"|^\s*([a-z]:\\[^"]*?\.exe)/i.exec(String(commandLine ?? ''));
  return match ? (match[1] ?? match[2]).toLowerCase() : null;
}

// Turns the raw registry data into the list for the page: only real programs
// that can be uninstalled, the longest unused first, unknown ones last.
function buildPrograms(raw, { env = process.env } = {}) {
  const runs = decodeRuns(raw?.runs, env);
  const seen = new Set();
  const programs = [];
  for (const item of raw?.programs ?? []) {
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const uninstall = typeof item.uninstall === 'string' ? item.uninstall.trim() : '';
    if (!name || !uninstall) continue;
    if (item.system === 1 || item.parent || item.release) continue; // Windows parts, updates, hotfixes
    const dedupe = `${name.toLowerCase()}|${item.version ?? ''}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const location = typeof item.location === 'string' ? item.location.trim().replace(/^"|"$/g, '').replace(/\\+$/, '').toLowerCase() : '';
    const icon = iconPath(item.icon);
    const folder = location.length > 3 ? location : folderOf(exeOf(uninstall), env) || folderOf(icon, env);
    const lowerName = name.toLowerCase();
    let lastUsedMs = null;
    for (const run of runs) {
      const hit = run.path !== null
        ? (folder !== '' && run.path.startsWith(`${folder}\\`)) || (icon !== null && run.path === icon)
        : run.shortcut.length >= 4 && (lowerName === run.shortcut || lowerName.startsWith(`${run.shortcut} `) || run.shortcut.startsWith(`${lowerName} `));
      if (hit && (lastUsedMs === null || run.lastRunMs > lastUsedMs)) lastUsedMs = run.lastRunMs;
    }
    programs.push({
      id: String(item.key),
      name,
      version: item.version ? String(item.version) : '',
      publisher: item.publisher ? String(item.publisher) : '',
      sizeBytes: Number.isFinite(item.sizeKb) && item.sizeKb > 0 ? item.sizeKb * 1024 : null,
      installedMs: parseInstallDate(item.installDate),
      lastUsedMs,
      uninstall,
    });
  }
  return programs.sort((a, b) => {
    if ((a.lastUsedMs === null) !== (b.lastUsedMs === null)) return a.lastUsedMs === null ? 1 : -1;
    if (a.lastUsedMs !== null) return a.lastUsedMs - b.lastUsedMs;
    return (a.installedMs ?? Infinity) - (b.installedMs ?? Infinity) || a.name.localeCompare(b.name);
  });
}

// Windows Installer entries often say "/I{...}" (repair or change) in their
// uninstall command; "/X" is the real uninstall.
function uninstallCommand(text) {
  return /^\s*msiexec(\.exe)?\s/i.test(text) ? text.replace(/\/I\s*\{/i, '/X{') : text;
}

async function queryRegistry() {
  const { stdout } = await execFileAsync(
    powershellPath(),
    ['-NoProfile', '-NonInteractive', '-Command', QUERY_SCRIPT],
    { windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(stdout.replace(/^\uFEFF/, ''));
}

// Starts the program's own uninstaller. The command line comes from the
// registry entry of that program and has to be run exactly as written there,
// which is why it goes through the command interpreter. The page never sends
// a command, only the id of a program from the last list.
function runUninstaller(command) {
  const child = spawn(command, { shell: true, detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => {});
  child.unref();
}

// query(): raw registry data, run(command): start an uninstaller.
function createPrograms({ query = queryRegistry, run = runUninstaller, env = process.env } = {}) {
  let known = new Map();
  return {
    async list() {
      const programs = buildPrograms(await query(), { env });
      known = new Map(programs.map((program) => [program.id, program]));
      // The uninstall command stays in the main process.
      return programs.map(({ uninstall, ...shown }) => shown);
    },
    async uninstall(id) {
      const program = known.get(id);
      if (!program) throw new Error('Dieses Programm stammt nicht aus der letzten Liste.');
      run(uninstallCommand(program.uninstall));
      return { started: true, name: program.name };
    },
  };
}

// Made-up programs for the practice mode: nothing is read from the registry
// and "uninstalling" only removes the entry from this list.
function createDemoPrograms({ now = Date.now } = {}) {
  const day = 86_400_000;
  let list = [
    { id: 'demo-1', name: 'Fotobuch-Designer', version: '4.2', publisher: 'Beispiel Druck GmbH', sizeBytes: 780 * 1024 * 1024, installedMs: now() - 900 * day, lastUsedMs: now() - 640 * day },
    { id: 'demo-2', name: 'Alter Videokonverter', version: '1.9.3', publisher: 'Freeware Beispiel', sizeBytes: 210 * 1024 * 1024, installedMs: now() - 700 * day, lastUsedMs: now() - 410 * day },
    { id: 'demo-3', name: 'Steuer 2023', version: '28.1', publisher: 'Beispiel Software AG', sizeBytes: 1300 * 1024 * 1024, installedMs: now() - 600 * day, lastUsedMs: now() - 380 * day },
    { id: 'demo-4', name: 'Textprogramm', version: '7.5', publisher: 'Beispiel Office', sizeBytes: 450 * 1024 * 1024, installedMs: now() - 400 * day, lastUsedMs: now() - 3 * day },
    { id: 'demo-5', name: 'Druckertreiber-Paket', version: '3.0', publisher: 'Beispiel Drucker', sizeBytes: 95 * 1024 * 1024, installedMs: now() - 500 * day, lastUsedMs: null },
    { id: 'demo-6', name: 'Spiel aus dem Sommer', version: '1.0.4', publisher: 'Beispiel Games', sizeBytes: 12 * 1024 * 1024 * 1024, installedMs: now() - 300 * day, lastUsedMs: now() - 120 * day },
  ];
  return {
    // Same order as the real list: longest unused first, unknown last.
    list: async () => list.map((program) => ({ ...program })).sort((a, b) => {
      if ((a.lastUsedMs === null) !== (b.lastUsedMs === null)) return a.lastUsedMs === null ? 1 : -1;
      return (a.lastUsedMs ?? 0) - (b.lastUsedMs ?? 0);
    }),
    async uninstall(id) {
      const program = list.find((entry) => entry.id === id);
      if (!program) throw new Error('Dieses Programm stammt nicht aus der letzten Liste.');
      list = list.filter((entry) => entry.id !== id);
      return { started: true, name: program.name };
    },
  };
}

module.exports = {
  createPrograms, createDemoPrograms, buildPrograms, decodeRuns, uninstallCommand, rot13,
};
