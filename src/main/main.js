const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, nativeTheme, ipcMain, shell, dialog, safeStorage } = require('electron');

const { createSettingsStore } = require('./settings');
const { resolvePaths, resolveSandboxDir, createSandboxTrashItem } = require('./paths');
const { createHandlers } = require('./ipc');
const junk = require('./disk/junk');
const elevated = require('./disk/elevated');
const { findOldDownloads } = require('./disk/downloads');
const { createRemover } = require('./disk/remove');
const { createAccountStore } = require('./mail/accounts');
const { createMailbox } = require('./mail/imap');
const { sendUnsubscribeMail } = require('./mail/smtp');
const { createMailService, createJsonLog } = require('./mail/service');
const { createDemoBackend } = require('./mail/demo');
const { createTrainingStore } = require('./mail/learn');
const { createUpdater } = require('./update');
const { migrateUserData } = require('./migrate');
const { createHistory } = require('./history');
const { listDrives } = require('./disk/drives');
const { createPrograms, createDemoPrograms } = require('./programs');

// First of all: if MYDESK_SANDBOX is set it must name a real sandbox. If not,
// nothing starts (no window, no handlers, no test scripts) and there is no
// fallback to real folders.
let sandboxDir = null;
let startupError = null;
try {
  sandboxDir = resolveSandboxDir(process.env);
} catch (err) {
  startupError = err;
}

function refuseToStart(err) {
  console.error(`Start abgebrochen: ${err.message}`);
  // The error box blocks until it is closed; scripted runs must not hang on it.
  if (!process.env.MYDESK_CAPTURE && !process.env.MYDESK_UI_SCRIPT) {
    dialog.showErrorBox('MyDesk startet nicht', err.message);
  }
  app.exit(1);
}

app.setName('MyDesk');
// Take over the data of the old program name (Aufräumzentrale, up to 0.2.x).
migrateUserData({
  from: path.join(app.getPath('appData'), 'Aufräumzentrale'),
  to: app.getPath('userData'),
});

// Test aid: force a colour scheme ('light' | 'dark') to check both themes.
if (process.env.MYDESK_THEME === 'light' || process.env.MYDESK_THEME === 'dark') {
  nativeTheme.themeSource = process.env.MYDESK_THEME;
}

const TITLE_BAR_HEIGHT = 40;

function themeColors() {
  return nativeTheme.shouldUseDarkColors
    ? { background: '#1c1c1e', symbol: '#f5f5f7' }
    : { background: '#ffffff', symbol: '#1d1d1f' };
}

// Runs the file as the body of an async function inside the page, so it may
// use await and return a value, e.g. "return await window.api.junk.scan();".
async function executeUiScript(win, file) {
  try {
    const code = fs.readFileSync(file, 'utf8');
    const result = await win.webContents.executeJavaScript(`(async () => {\n${code}\n})()`, true);
    console.log(`UI_SCRIPT_RESULT ${JSON.stringify(result ?? null)}`);
  } catch (err) {
    const text = String(err && err.message ? err.message : err);
    console.log(`UI_SCRIPT_ERROR ${text.replace(/\s*\n\s*/g, ' ')}`);
  }
}

function captureWindow(win, file) {
  return new Promise((resolve, reject) => {
    setTimeout(async () => {
      try {
        const image = await win.webContents.capturePage();
        fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
        fs.writeFileSync(file, image.toPNG());
        resolve();
      } catch (err) {
        reject(err);
      }
    }, 800);
  });
}

function createWindow() {
  const colors = themeColors();
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    title: 'MyDesk',
    backgroundColor: colors.background,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: colors.symbol, height: TITLE_BAR_HEIGHT },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();

  // The page never navigates away and never opens windows: a stray link or
  // script cannot load foreign content into a window that has the bridge.
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const applyTheme = () => {
    const c = themeColors();
    win.setBackgroundColor(c.background);
    win.setTitleBarOverlay({ color: '#00000000', symbolColor: c.symbol, height: TITLE_BAR_HEIGHT });
  };
  nativeTheme.on('updated', applyTheme);
  win.on('closed', () => nativeTheme.removeListener('updated', applyTheme));

  // Test aid: MYDESK_VIEW picks the start view.
  const query = process.env.MYDESK_VIEW ? { view: process.env.MYDESK_VIEW } : {};
  // Scripted starts (screenshot, UI script) skip the start animation.
  if (process.env.MYDESK_CAPTURE || process.env.MYDESK_UI_SCRIPT) query.splash = '0';
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query });

  // Test aids, run once the page has loaded:
  //  MYDESK_UI_SCRIPT=<file.js> runs the file in the page (only together with
  //    MYDESK_SANDBOX, because the script can call every bridge function) and
  //    prints the result as one line on stdout.
  //  MYDESK_CAPTURE=<file.png> saves a screenshot.
  // With either one set, the app quits afterwards.
  const capturePath = process.env.MYDESK_CAPTURE;
  const uiScriptPath = process.env.MYDESK_UI_SCRIPT;
  const runUiScript = Boolean(uiScriptPath) && sandboxDir !== null;
  if (uiScriptPath && !runUiScript) {
    console.warn('MYDESK_UI_SCRIPT is ignored: it only works together with MYDESK_SANDBOX.');
  }
  if (capturePath || runUiScript) {
    win.webContents.once('did-finish-load', async () => {
      try {
        if (runUiScript) await executeUiScript(win, uiScriptPath);
        if (capturePath) await captureWindow(win, capturePath);
      } finally {
        app.quit();
      }
    });
  }
  return win;
}

// The mail side. Practising (sandbox): a built-in sample mailbox, nothing
// leaves the computer. Otherwise: real mailboxes; passwords are encrypted by
// Windows (safeStorage) and bound to this user account.
function createMail(paths, settings) {
  const logStore = createJsonLog(path.join(paths.settingsDir, 'unsubscribed.json'));
  // The user's decisions (important / not important), words only, never mail text.
  const training = createTrainingStore(path.join(paths.settingsDir, 'training.json'));
  if (paths.sandbox) return createMailService({ ...createDemoBackend(), settings, logStore, training });

  const accounts = createAccountStore(paths.settingsDir, {
    encrypt: (text) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Verschlüsselung nicht verfügbar');
      return safeStorage.encryptString(text);
    },
    decrypt: (buffer) => safeStorage.decryptString(buffer),
  });
  return createMailService({
    accounts,
    settings,
    logStore,
    training,
    openMailbox: (account, password) => createMailbox({ account, password }),
    sendMail: sendUnsubscribeMail,
    fetch: (url, options) => fetch(url, options),
    openExternal: async (url) => {
      // Only web links ever reach the browser.
      if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('Kein Web-Link');
      await shell.openExternal(url);
    },
  });
}

// Connects the file-system modules to the channels of the page (window.api).
// In the sandbox (MYDESK_SANDBOX) every folder lives inside the sandbox, the
// "recycle bin" is <sandbox>\Papierkorb and there is no UAC prompt.
let updater = null;

// Colour scheme from the settings: 'system' follows Windows. The test aid
// MYDESK_THEME wins, so screenshots of both schemes stay possible.
function applyTheme(theme) {
  const forced = process.env.MYDESK_THEME;
  if (forced === 'light' || forced === 'dark') return;
  nativeTheme.themeSource = ['light', 'dark'].includes(theme) ? theme : 'system';
}

async function registerIpc() {
  let recycleRoots = [];
  if (!sandboxDir) {
    try {
      recycleRoots = await junk.getRecycleRoots();
    } catch (err) {
      console.warn(`Recycle bin folders unknown, the recycle bin is not offered: ${err.message}`);
    }
  }

  const paths = resolvePaths({ getPath: (name) => app.getPath(name), env: process.env, recycleRoots });
  const trashItem = paths.sandboxDir ? createSandboxTrashItem(paths.sandboxDir) : (p) => shell.trashItem(p);

  const settings = createSettingsStore(paths.settingsDir);
  const send = (channel, payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  };
  // Updates only exist for the installed program, never while practising.
  const updatesEnabled = app.isPackaged && !paths.sandbox;
  updater = createUpdater({
    autoUpdater: updatesEnabled ? require('electron-updater').autoUpdater : null,
    enabled: updatesEnabled,
    currentVersion: app.getVersion(),
    send: (state) => send('update:changed', state),
  });
  applyTheme(settings.load().theme);
  const handlers = createHandlers({
    settings,
    history: createHistory(path.join(paths.settingsDir, 'history.json')),
    drives: { listDrives },
    // Practising: made-up programs, nothing is read from the registry or uninstalled.
    programs: paths.sandbox ? createDemoPrograms() : createPrograms(),
    applyTheme,
    updater,
    mail: createMail(paths, settings),
    paths,
    junk,
    elevated,
    downloads: { findOldDownloads },
    remover: createRemover({ trashItem }),
    showItemInFolder: (p) => shell.showItemInFolder(p),
    send,
  });
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, arg) => handler(arg));
  }
}

if (startupError) {
  refuseToStart(startupError);
} else {
  app.whenReady().then(async () => {
    await registerIpc();
    const win = createWindow();
    // Look for a newer version once the window is there; failures stay quiet.
    win.webContents.once('did-finish-load', () => {
      updater.check();
      // Test aid, practice mode only: MYDESK_FAKE_UPDATE=<version> announces a
      // made-up update, so the update card and the dot can be looked at.
      const fake = process.env.MYDESK_FAKE_UPDATE;
      if (sandboxDir !== null && fake) {
        const state = { status: 'available', currentVersion: app.getVersion(), version: fake, percent: null, message: null };
        let repeats = 0;
        const timer = setInterval(() => {
          repeats += 1;
          if (win.isDestroyed() || repeats > 6) clearInterval(timer);
          else win.webContents.send('update:changed', state);
        }, 700);
      }
    });
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => app.quit());
}
