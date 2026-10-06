const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { buildShortcutSpec, SHORTCUT_NAME } = require('../scripts/create-shortcut');

const projectDir = 'C:\\Projekte\\MyDesk';
const electronExe = path.join(projectDir, 'node_modules', 'electron', 'dist', 'electron.exe');

test('buildShortcutSpec points the shortcut at electron.exe with the quoted project folder', () => {
  const spec = buildShortcutSpec(projectDir, (p) => p === electronExe);
  assert.equal(spec.env.MYDESK_LNK_TARGET, electronExe);
  assert.equal(spec.env.MYDESK_LNK_ARGS, `"${projectDir}"`);
  assert.equal(spec.env.MYDESK_LNK_WORKDIR, projectDir);
  assert.equal(spec.env.MYDESK_LNK_NAME, 'MyDesk.lnk');
  assert.equal(SHORTCUT_NAME, 'MyDesk.lnk');
});

test('buildShortcutSpec keeps paths out of the script text', () => {
  const spec = buildShortcutSpec(projectDir, () => true);
  assert.ok(!spec.script.includes('Projekte'));
  assert.ok(!spec.script.includes('MyDesk'));
  assert.match(spec.script, /GetFolderPath\('Desktop'\)/);
  assert.match(spec.script, /MYDESK_LNK_TARGET/);
});

test('buildShortcutSpec tells the user to run npm install when electron.exe is missing', () => {
  assert.throws(() => buildShortcutSpec(projectDir, () => false), /npm install/);
});

test('buildShortcutSpec uses the program icon when it exists, else the one of electron.exe', () => {
  const icon = path.join(projectDir, 'build', 'icon.ico');
  assert.equal(buildShortcutSpec(projectDir, () => true).env.MYDESK_LNK_ICON, icon);
  assert.equal(buildShortcutSpec(projectDir, (p) => p === electronExe).env.MYDESK_LNK_ICON, `${electronExe},0`);
});
