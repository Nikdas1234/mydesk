const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { powershellPath, whoamiPath } = require('../src/main/system-tools');

test('powershellPath is an absolute path below SystemRoot\\System32', () => {
  const p = powershellPath({ SystemRoot: 'D:\\Win' });
  assert.equal(p, 'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.ok(path.win32.isAbsolute(p));
});

test('whoamiPath is an absolute path below SystemRoot\\System32', () => {
  assert.equal(whoamiPath({ SystemRoot: 'D:\\Win' }), 'D:\\Win\\System32\\whoami.exe');
});

test('without SystemRoot the paths fall back to C:\\Windows', () => {
  assert.equal(whoamiPath({}), 'C:\\Windows\\System32\\whoami.exe');
  assert.ok(powershellPath({}).startsWith('C:\\Windows\\System32\\'));
});

test('a relative or empty SystemRoot is ignored', () => {
  assert.equal(whoamiPath({ SystemRoot: '' }), 'C:\\Windows\\System32\\whoami.exe');
  assert.equal(whoamiPath({ SystemRoot: 'Windows' }), 'C:\\Windows\\System32\\whoami.exe');
});

test('the real paths exist on this machine', () => {
  assert.ok(fs.existsSync(powershellPath()));
  assert.ok(fs.existsSync(whoamiPath()));
});
