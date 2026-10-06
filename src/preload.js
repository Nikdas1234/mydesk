const { contextBridge, ipcRenderer } = require('electron');

// Electron prefixes errors of invoke() with "Error invoking remote method '<channel>': Error: ".
// The views only want the readable message.
const REMOTE_PREFIX = /^Error invoking remote method '[^']*': (?:Error: )?/;

function invoke(channel, arg) {
  return ipcRenderer.invoke(channel, arg).catch((err) => {
    throw new Error(String(err && err.message).replace(REMOTE_PREFIX, ''));
  });
}

// The only door between the views and the main process.
contextBridge.exposeInMainWorld('api', {
  // { sandbox: boolean, sandboxDir: string | null }
  info: () => invoke('app:info'),
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch),
  },
  junk: {
    scan: () => invoke('junk:scan'),
    clean: (ids) => invoke('junk:clean', ids),
  },
  downloads: {
    scan: () => invoke('downloads:scan'),
    trash: (paths) => invoke('downloads:trash', paths),
  },
  mail: {
    accounts: {
      list: () => invoke('mail:accounts:list'),
      save: (account) => invoke('mail:accounts:save', account),
      remove: (id) => invoke('mail:accounts:remove', id),
      test: (id) => invoke('mail:accounts:test', id),
    },
    scan: () => invoke('mail:scan'),
    text: (ref) => invoke('mail:text', ref),
    unsubscribe: (key) => invoke('mail:unsubscribe', key),
    unsubscribeInBrowser: (key) => invoke('mail:unsubscribe', { key, browser: true }),
    removeSender: (key) => invoke('mail:removeSender', key),
    removeUnsubscribed: () => invoke('mail:removeUnsubscribed'),
    label: (decision) => invoke('mail:label', decision),
    resetLearning: () => invoke('mail:resetLearning'),
    learned: () => invoke('mail:learned'),
    // Returns a function that removes the listener again.
    onProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on('mail:progress', listener);
      return () => ipcRenderer.removeListener('mail:progress', listener);
    },
  },
  update: {
    state: () => invoke('update:state'),
    check: () => invoke('update:check'),
    download: () => invoke('update:download'),
    install: () => invoke('update:install'),
    // Returns a function that removes the listener again.
    onChange: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('update:changed', listener);
      return () => ipcRenderer.removeListener('update:changed', listener);
    },
  },
  programs: {
    scan: () => invoke('programs:scan'),
    uninstall: (id) => invoke('programs:uninstall', id),
  },
  history: () => invoke('history:get'),
  drives: () => invoke('drives:list'),
  cancel: (name) => invoke('scan:cancel', name),
  showInFolder: (path) => invoke('shell:show', path),
});
