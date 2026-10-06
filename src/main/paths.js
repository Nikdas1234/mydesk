const fs = require('node:fs');
const path = require('node:path');

// Decides which folders the app works on. Normally these are the real folders
// of the current user. If MYDESK_SANDBOX is set, every one of them lives
// inside that sandbox folder instead, so that nothing real can be touched.
// Electron-specific values (getPath, the environment) are handed in, which
// keeps this file free of `require('electron')` and testable with node:test.

const TRASH_FOLDER_NAME = 'Papierkorb';

// scripts/make-sandbox.js puts this file into every sandbox. Without it the
// app refuses to treat a folder as sandbox: MYDESK_SANDBOX switches off the
// UAC prompt and enables the test scripts, so a mistyped value (a drive root,
// the user profile, ...) must never be accepted.
const SANDBOX_MARKER = '.mydesk-sandbox';

// Returns the absolute sandbox folder from env.MYDESK_SANDBOX, or null if the
// variable is not set. Throws if it is set but not a real sandbox: not a
// local absolute path, a drive root, or without the marker file. This is the
// only place where the sandbox folder is derived.
function resolveSandboxDir(env) {
  const value = env.MYDESK_SANDBOX;
  if (value === undefined) return null;
  const refuse = (reason) => {
    throw new Error(`MYDESK_SANDBOX=${JSON.stringify(value)} is not usable: ${reason}`);
  };

  if (typeof value !== 'string' || value.trim() === '') refuse('the value is empty');
  if (!/^[A-Za-z]:[\\/]/.test(value)) refuse('it must be an absolute path with a drive letter');
  const dir = path.resolve(value);
  if (path.parse(dir).root === dir) refuse('a drive root cannot be a sandbox');

  let marker = null;
  try {
    marker = fs.lstatSync(path.join(dir, SANDBOX_MARKER));
  } catch {
    // reported below
  }
  if (!marker || !marker.isFile()) {
    refuse(`the folder has no ${SANDBOX_MARKER} marker file; create it with scripts/make-sandbox.js`);
  }
  return dir;
}

function sandboxPaths(sandboxDir) {
  const at = (...parts) => path.join(sandboxDir, ...parts);
  const downloadsDir = at('Downloads');
  return {
    settingsDir: at('settings'),
    downloadsDir,
    // Same order as the real folders: desktop, documents, downloads, pictures, videos, music.
    duplicateDefaults: [at('Desktop'), at('Dokumente'), downloadsDir, at('Bilder'), at('Videos'), at('Musik')],
    junkEnv: {
      TEMP: at('Temp'),
      LOCALAPPDATA: at('LocalAppData'),
      ProgramData: at('ProgramData'),
      SystemRoot: at('Windows'),
      recycleRoots: [],
    },
    sandbox: true,
    sandboxDir,
  };
}

function realPaths({ getPath, env, recycleRoots }) {
  return {
    settingsDir: getPath('userData'),
    downloadsDir: getPath('downloads'),
    duplicateDefaults: ['desktop', 'documents', 'downloads', 'pictures', 'videos', 'music'].map((name) => getPath(name)),
    junkEnv: {
      TEMP: env.TEMP,
      LOCALAPPDATA: env.LOCALAPPDATA,
      ProgramData: env.ProgramData,
      SystemRoot: env.SystemRoot,
      recycleRoots,
    },
    sandbox: false,
    sandboxDir: null,
  };
}

// getPath: Electron's app.getPath. env: process.env. recycleRoots: the user's
// recycle bin folders (ignored in the sandbox, which has none). Throws if
// MYDESK_SANDBOX is set to something that is not a valid sandbox; there is
// no fallback to real paths in that case.
function resolvePaths({ getPath, env, recycleRoots }) {
  const sandboxDir = resolveSandboxDir(env);
  if (sandboxDir) return sandboxPaths(sandboxDir);
  return realPaths({ getPath, env, recycleRoots });
}

// "Move to recycle bin" for the sandbox: moves the item into <sandbox>\Papierkorb
// (a unique name if one exists already) instead of the real Windows recycle bin.
function createSandboxTrashItem(sandboxDir) {
  const root = path.resolve(sandboxDir);
  const trashDir = path.join(root, TRASH_FOLDER_NAME);

  return async function trashItem(itemPath) {
    const source = path.resolve(itemPath);
    const rel = path.relative(root, source);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Refusing to move an item outside the sandbox: ${itemPath}`);
    }

    await fs.promises.mkdir(trashDir, { recursive: true });
    const { name, ext } = path.parse(source);
    for (let n = 0; ; n += 1) {
      const target = path.join(trashDir, n === 0 ? `${name}${ext}` : `${name} (${n})${ext}`);
      try {
        await fs.promises.lstat(target);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        await fs.promises.rename(source, target);
        return;
      }
    }
  };
}

module.exports = { resolvePaths, resolveSandboxDir, createSandboxTrashItem, SANDBOX_MARKER };
