const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPrograms, createDemoPrograms, buildPrograms, decodeRuns, uninstallCommand, rot13,
} = require('../src/main/programs');

const ENV = {
  SystemRoot: 'C:\\Windows',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local',
  APPDATA: 'C:\\Users\\x\\AppData\\Roaming',
};
const FILETIME_EPOCH_MS = 11_644_473_600_000n;

// One UserAssist entry as Windows stores it: shifted name, 72 bytes of data
// with the time of the last start at offset 60.
function run(clearName, lastRunMs) {
  const data = Buffer.alloc(72);
  data.writeUInt32LE(3, 4);
  data.writeBigUInt64LE((BigInt(lastRunMs) + FILETIME_EPOCH_MS) * 10_000n, 60);
  return { name: rot13(clearName), data: data.toString('base64') };
}

const program = (overrides) => ({
  key: `HKLM\\...\\${overrides.name}`, name: 'Programm', version: '1.0', publisher: 'Firma', installDate: '20240115',
  sizeKb: 2048, uninstall: '"C:\\Program Files\\P\\unins000.exe"', location: 'C:\\Program Files\\P\\', icon: null,
  system: null, parent: null, release: null, ...overrides,
});

test('rot13 shifts letters and is its own inverse', () => {
  assert.equal(rot13('Abc-xyz 123'), 'Nop-klm 123');
  assert.equal(rot13(rot13('C:\\Program Files\\Tool.exe')), 'C:\\Program Files\\Tool.exe');
});

test('decodeRuns reads the last start and expands the folder ids', () => {
  const runs = decodeRuns([
    run('{6D809377-6AF0-444B-8957-A3773F02200E}\\Tool\\Tool.exe', 1_700_000_000_000),
    run('C:\\Spiele\\Spiel\\Start.exe', 1_600_000_000_000),
    run('{00000000-0000-0000-0000-000000000000}\\x.exe', 1_600_000_000_000),
    run('Microsoft.WindowsCalculator_8wekyb3d8bbwe!App', 1_600_000_000_000),
    { name: 'kaputt', data: 'AAAA' },
    run('C:\\Nie\\gestartet.exe', -11_644_473_600_000),
  ], ENV);
  assert.deepEqual(runs, [
    { path: 'c:\\program files\\tool\\tool.exe', shortcut: null, lastRunMs: 1_700_000_000_000 },
    { path: 'c:\\spiele\\spiel\\start.exe', shortcut: null, lastRunMs: 1_600_000_000_000 },
  ]);
});

test('buildPrograms keeps real, uninstallable programs and finds their last use', () => {
  const raw = {
    programs: [
      program({ name: 'Tool', location: 'C:\\Program Files\\Tool' }),
      program({ name: 'Spiel', location: '', icon: '"C:\\Spiele\\Spiel\\Start.exe",0', sizeKb: null, installDate: '' }),
      program({ name: 'Nie benutzt', location: 'C:\\Program Files\\Nie' }),
      program({ name: 'Windows-Teil', system: 1 }),
      program({ name: 'Update KB1', parent: 'Tool' }),
      program({ name: 'Hotfix', release: 'Hotfix' }),
      program({ name: 'Ohne Deinstallation', uninstall: null }),
      program({ name: '', uninstall: 'x' }),
      program({ name: 'Tool', location: 'C:\\Program Files\\Tool' }),
    ],
    runs: [
      run('{6D809377-6AF0-444B-8957-A3773F02200E}\\Tool\\bin\\Tool.exe', 1_700_000_000_000),
      run('{6D809377-6AF0-444B-8957-A3773F02200E}\\Tool\\Updater.exe', 1_650_000_000_000),
      run('{6D809377-6AF0-444B-8957-A3773F02200E}\\Toolbox\\Anderes.exe', 1_790_000_000_000),
      run('C:\\Spiele\\Spiel\\Start.exe', 1_600_000_000_000),
    ],
  };
  const list = buildPrograms(raw, { env: ENV });
  assert.deepEqual(list.map((p) => [p.name, p.lastUsedMs]), [
    ['Spiel', 1_600_000_000_000],
    ['Tool', 1_700_000_000_000],
    ['Nie benutzt', null],
  ]);
  const tool = list[1];
  assert.equal(tool.sizeBytes, 2048 * 1024);
  assert.equal(tool.installedMs, new Date(2024, 0, 15).getTime());
  assert.deepEqual([list[0].sizeBytes, list[0].installedMs], [null, null]);
  assert.deepEqual(buildPrograms(null), []);
});

test('without an install folder the uninstaller, the icon or a Start menu shortcut gives the last use', () => {
  const raw = {
    programs: [
      program({ name: 'Per Deinstallierer', location: '', uninstall: '"C:\\Tools\\Alpha\\uninstall.exe" /S' }),
      program({ name: 'Beta Player', location: '', uninstall: 'MsiExec.exe /X{B-1}' }),
      program({ name: 'Treiber', location: '', uninstall: 'C:\\Windows\\System32\\treiber-uninst.exe' }),
    ],
    runs: [
      run('C:\\Tools\\Alpha\\Alpha.exe', 1_700_000_000_000),
      run('{0139D44E-6AFE-49F2-8690-3DAFCAE6FFB8}\\Beta\\Beta Player.lnk', 1_650_000_000_000),
      run('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\notepad.exe', 1_790_000_000_000),
    ],
  };
  assert.deepEqual(buildPrograms(raw, { env: ENV }).map((p) => [p.name, p.lastUsedMs]), [
    ['Beta Player', 1_650_000_000_000],
    ['Per Deinstallierer', 1_700_000_000_000],
    ['Treiber', null],
  ]);
});

test('uninstallCommand turns the Windows Installer repair switch into uninstall', () => {
  assert.equal(uninstallCommand('MsiExec.exe /I{ABC-1}'), 'MsiExec.exe /X{ABC-1}');
  assert.equal(uninstallCommand('MsiExec.exe /X{ABC-1}'), 'MsiExec.exe /X{ABC-1}');
  assert.equal(uninstallCommand('"C:\\P\\unins000.exe" /I{x}'), '"C:\\P\\unins000.exe" /I{x}');
});

test('list never hands the uninstall command to the page; uninstall only takes ids from the last list', async () => {
  const started = [];
  const programs = createPrograms({
    env: ENV,
    query: async () => ({ programs: [program({ name: 'Tool', uninstall: 'MsiExec.exe /I{T-1}' })], runs: [] }),
    run: (command) => started.push(command),
  });
  await assert.rejects(programs.uninstall('HKLM\\...\\Tool'));
  const list = await programs.list();
  assert.equal(list[0].uninstall, undefined);
  await assert.rejects(programs.uninstall('C:\\Windows\\System32\\format.com'));
  assert.deepEqual(await programs.uninstall(list[0].id), { started: true, name: 'Tool' });
  assert.deepEqual(started, ['MsiExec.exe /X{T-1}']);
});

test('demo programs can be listed and removed without touching the system', async () => {
  const demo = createDemoPrograms({ now: () => 1_800_000_000_000 });
  const list = await demo.list();
  assert.ok(list.length >= 5);
  assert.ok(list.some((p) => p.lastUsedMs === null));
  await demo.uninstall(list[0].id);
  assert.equal((await demo.list()).length, list.length - 1);
  await assert.rejects(demo.uninstall('fremd'));
});
