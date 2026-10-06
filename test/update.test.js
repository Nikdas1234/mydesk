const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { createUpdater } = require('../src/main/update');

function fakeAutoUpdater() {
  const updater = new EventEmitter();
  updater.calls = [];
  updater.checkForUpdates = async () => { updater.calls.push('check'); };
  updater.downloadUpdate = async () => { updater.calls.push('download'); };
  updater.quitAndInstall = () => { updater.calls.push('install'); };
  return updater;
}

function setup({ enabled = true } = {}) {
  const autoUpdater = fakeAutoUpdater();
  const sent = [];
  const updater = createUpdater({ autoUpdater, enabled, currentVersion: '0.1.0', send: (state) => sent.push(state) });
  return { autoUpdater, sent, updater };
}

test('disabled updater does nothing and says so', async () => {
  const { autoUpdater, updater } = setup({ enabled: false });
  await updater.check();
  assert.deepEqual(autoUpdater.calls, []);
  assert.deepEqual(updater.state(), { status: 'disabled', currentVersion: '0.1.0', version: null, percent: null, message: null });
  await assert.rejects(updater.download());
});

test('never downloads on its own', () => {
  const { autoUpdater } = setup();
  assert.equal(autoUpdater.autoDownload, false);
  assert.equal(autoUpdater.autoInstallOnAppQuit, false);
});

test('reports a new version, the download and readiness to the page', async () => {
  const { autoUpdater, sent, updater } = setup();
  await updater.check();
  autoUpdater.emit('checking-for-update');
  autoUpdater.emit('update-available', { version: '0.2.0' });
  assert.deepEqual(updater.state(), { status: 'available', currentVersion: '0.1.0', version: '0.2.0', percent: null, message: null });

  await updater.download();
  autoUpdater.emit('download-progress', { percent: 41.7 });
  assert.deepEqual([updater.state().status, updater.state().percent], ['downloading', 42]);
  autoUpdater.emit('update-downloaded', { version: '0.2.0' });
  assert.equal(updater.state().status, 'ready');

  updater.install();
  assert.deepEqual(autoUpdater.calls, ['check', 'download', 'install']);
  assert.deepEqual(sent.map((s) => s.status), ['checking', 'available', 'downloading', 'downloading', 'ready']);
});

test('no new version and errors end quietly', async () => {
  const { autoUpdater, updater } = setup();
  autoUpdater.emit('update-not-available', { version: '0.1.0' });
  assert.equal(updater.state().status, 'none');
  autoUpdater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'));
  assert.deepEqual([updater.state().status, updater.state().message], ['error', 'net::ERR_INTERNET_DISCONNECTED']);

  // A failing check never throws into the start of the program.
  autoUpdater.checkForUpdates = async () => { throw new Error('offline'); };
  await updater.check();
  assert.equal(updater.state().message, 'offline');
});

test('download and install are only possible in the right state', async () => {
  const { autoUpdater, updater } = setup();
  await assert.rejects(updater.download(), /Kein Update/);
  assert.throws(() => updater.install(), /nicht heruntergeladen/);
  assert.deepEqual(autoUpdater.calls, []);
});
