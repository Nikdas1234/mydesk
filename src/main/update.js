// Update check: tells the page when a newer version is published and
// downloads and installs it on request. Nothing is ever downloaded or
// installed without a click.
// autoUpdater is electron-updater's object (passed in, so this module can be
// tested without Electron). send(state) forwards every change to the page.
function createUpdater({ autoUpdater, enabled, currentVersion, send }) {
  let current = { status: enabled ? 'idle' : 'disabled', version: null, percent: null, message: null };

  const state = () => ({ status: current.status, currentVersion, version: current.version, percent: current.percent, message: current.message });
  const change = (patch) => {
    current = { ...current, ...patch };
    send(state());
  };

  if (enabled) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on('checking-for-update', () => change({ status: 'checking', message: null }));
    autoUpdater.on('update-available', (info) => change({ status: 'available', version: info?.version ?? null }));
    autoUpdater.on('update-not-available', () => change({ status: 'none' }));
    autoUpdater.on('download-progress', (progress) => change({ status: 'downloading', percent: Math.round(progress?.percent ?? 0) }));
    autoUpdater.on('update-downloaded', () => change({ status: 'ready', percent: 100 }));
    autoUpdater.on('error', (err) => change({ status: 'error', message: err?.message ?? String(err) }));
  }

  return {
    state,
    // Never rejects: being offline must not disturb the start.
    async check() {
      if (!enabled) return;
      try {
        await autoUpdater.checkForUpdates();
      } catch (err) {
        change({ status: 'error', message: err?.message ?? String(err) });
      }
    },
    async download() {
      if (current.status !== 'available') throw new Error('Kein Update zum Herunterladen vorhanden.');
      change({ status: 'downloading', percent: 0 });
      await autoUpdater.downloadUpdate();
    },
    install() {
      if (current.status !== 'ready') throw new Error('Das Update ist noch nicht heruntergeladen.');
      autoUpdater.quitAndInstall();
    },
  };
}

module.exports = { createUpdater };
