#!/usr/bin/env node
// Creates "MyDesk.lnk" on the desktop of the current user:
//   npm run shortcut
// The shortcut starts node_modules\electron\dist\electron.exe with the project
// folder as argument, which is what `npm start` does. An existing shortcut of
// the same name is overwritten.

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const { powershellPath } = require('../src/main/system-tools');

const SHORTCUT_NAME = 'MyDesk.lnk';

// The script text contains no paths and no non-ASCII characters: everything
// variable travels through environment variables, so quoting and umlauts
// cannot break it. The desktop folder is asked from Windows because it may be
// redirected (OneDrive).
const POWERSHELL_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  "$desktop = [Environment]::GetFolderPath('Desktop')",
  '$file = Join-Path $desktop $env:MYDESK_LNK_NAME',
  '$shell = New-Object -ComObject WScript.Shell',
  '$link = $shell.CreateShortcut($file)',
  '$link.TargetPath = $env:MYDESK_LNK_TARGET',
  '$link.Arguments = $env:MYDESK_LNK_ARGS',
  '$link.WorkingDirectory = $env:MYDESK_LNK_WORKDIR',
  '$link.Description = $env:MYDESK_LNK_DESC',
  '$link.IconLocation = $env:MYDESK_LNK_ICON',
  '$link.Save()',
  '[Console]::Out.WriteLine($file)',
].join('\n');

// Pure: builds the environment and script for the PowerShell call.
// fileExists is injectable for tests. Throws if electron.exe is missing.
function buildShortcutSpec(projectDir, fileExists = fs.existsSync) {
  const electronExe = path.join(projectDir, 'node_modules', 'electron', 'dist', 'electron.exe');
  if (!fileExists(electronExe)) {
    throw new Error(`${electronExe} not found. Run "npm install" in the project folder first.`);
  }
  // build\icon.ico comes from `npm run icon`; without it the shortcut shows
  // the icon of electron.exe.
  const icon = path.join(projectDir, 'build', 'icon.ico');
  return {
    script: POWERSHELL_SCRIPT,
    env: {
      MYDESK_LNK_NAME: SHORTCUT_NAME,
      MYDESK_LNK_DESC: 'MyDesk',
      MYDESK_LNK_TARGET: electronExe,
      MYDESK_LNK_ARGS: `"${projectDir}"`,
      MYDESK_LNK_WORKDIR: projectDir,
      MYDESK_LNK_ICON: fileExists(icon) ? icon : `${electronExe},0`,
    },
  };
}

function createShortcut(projectDir) {
  const spec = buildShortcutSpec(projectDir);
  return new Promise((resolve, reject) => {
    execFile(
      powershellPath(),
      ['-NoProfile', '-NonInteractive', '-Command', spec.script],
      { env: { ...process.env, ...spec.env }, windowsHide: true, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr.trim() || err.message));
        else resolve(stdout.trim());
      },
    );
  });
}

module.exports = { buildShortcutSpec, createShortcut, SHORTCUT_NAME };

if (require.main === module) {
  createShortcut(path.resolve(__dirname, '..')).then(
    (file) => console.log(`Verknüpfung angelegt: ${file}`),
    (err) => {
      console.error(err.message);
      process.exit(1);
    },
  );
}
