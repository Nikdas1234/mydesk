const path = require('node:path');

// Full paths of the Windows tools the app starts. A bare name like
// "powershell.exe" is searched in the working directory first, so a planted
// file there could run instead (and, with the UAC launcher, run elevated).

function systemRoot(env) {
  const root = env.SystemRoot;
  return typeof root === 'string' && path.win32.isAbsolute(root) ? root : 'C:\\Windows';
}

function powershellPath(env = process.env) {
  return path.win32.join(systemRoot(env), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function whoamiPath(env = process.env) {
  return path.win32.join(systemRoot(env), 'System32', 'whoami.exe');
}

module.exports = { powershellPath, whoamiPath };
