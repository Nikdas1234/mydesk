const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { powershellPath } = require('../system-tools');

const execFileAsync = promisify(execFile);

// Cleaning the admin-only categories (C:\Windows\Temp, Windows Update leftovers,
// Windows crash reports) needs an elevated process. This module builds a FIXED
// PowerShell script for it and starts it through UAC. The script runs with
// administrator rights and deletes for good, so:
//  - it contains no paths except the given roots and the result file,
//  - it applies the same rules as removeContents() in walk.js: age rule on the
//    newest modification time inside an entry, bottom-up, links (reparse points)
//    are never entered and only removed themselves, failures count as skipped,
//  - it never enters a root that is itself a link.

const POWERSHELL_ARGS = ['-NoProfile', '-NonInteractive'];

// 1970-01-01T00:00:00Z as .NET ticks (100 ns units).
const UNIX_EPOCH_TICKS = '621355968000000000';

// PowerShell treats the typographic quotes U+2018..U+201B like a plain '.
// Doubling any of them keeps the literal intact, so a folder name can never
// end the string and inject code.
function psQuote(value) {
  return `'${String(value).replace(/['\u2018\u2019\u201A\u201B]/g, (c) => c + c)}'`;
}

// The fixed part of the script. `$script:` variables are the counters and the
// cutoff of the item being processed. Function names avoid built-in aliases.
// Gone() looks at the InnerException because PowerShell wraps .NET method errors.
const SCRIPT_HEAD = `$ErrorActionPreference='SilentlyContinue'
function Gone($x){$y=$x.InnerException;if($y -eq $null){$y=$x};($y -is [IO.FileNotFoundException]) -or ($y -is [IO.DirectoryNotFoundException])}
function Newest($p){
try{$a=[int][IO.File]::GetAttributes($p);$t=[IO.File]::GetLastWriteTimeUtc($p).Ticks}catch{$script:u=1;return [long]0}
if(($a -band 1024) -or -not ($a -band 16)){return $t}
try{$m=[long]0;foreach($k in [IO.Directory]::GetFileSystemEntries($p)){$v=Newest $k;if($v -gt $m){$m=$v}}}catch{$script:u=1;return $t}
if($m -eq 0){$m=$t}
return $m}
function Purge($p){
try{$a=[int][IO.File]::GetAttributes($p)}catch{if(Gone $_.Exception){return $true};$script:s++;return $false}
$dir=($a -band 16) -ne 0;$link=($a -band 1024) -ne 0
if($link -or -not $dir){
try{
$t=[IO.File]::GetLastWriteTimeUtc($p).Ticks;$z=0
if(-not $link){$z=([IO.FileInfo]$p).Length}
if($t -gt $script:c){$script:s++;return $false}
if($a -band 1){[IO.File]::SetAttributes($p,[IO.FileAttributes]::Normal)}
if($dir){[IO.Directory]::Delete($p)}else{[IO.File]::Delete($p)}
}catch{if(Gone $_.Exception){return $true};$script:s++;return $false}
$script:d++;$script:f+=$z;return $true}
try{$n=[IO.Directory]::GetFileSystemEntries($p)}catch{if(Gone $_.Exception){return $true};$script:s++;return $false}
$g=$true
foreach($e in $n){if(-not (Purge $e)){$g=$false}}
if(-not $g){return $false}
try{if($a -band 1){[IO.File]::SetAttributes($p,[IO.FileAttributes]::Normal)};[IO.Directory]::Delete($p)}catch{if(Gone $_.Exception){return $true};$script:s++;return $false}
return $true}`;

const SCRIPT_RUN = `$out=@()
foreach($i in $items){
$script:f=[long]0;$script:d=0;$script:s=0
$script:c=[long]${UNIX_EPOCH_TICKS}+([long]$now-[long]$i.age)*10000
foreach($r in $i.roots){
try{
if(([int][IO.File]::GetAttributes($r)) -band 1024){$script:s++;continue}
foreach($e in [IO.Directory]::GetFileSystemEntries($r)){
$script:u=0;$n=Newest $e
if($script:u){$script:s++;continue}
if($n -gt $script:c){continue}
[void](Purge $e)}
}catch{if(-not (Gone $_.Exception)){$script:s++}}
}
$out+=@{id=$i.id;freedBytes=$script:f;deleted=$script:d;skipped=$script:s}
}
$j=ConvertTo-Json -InputObject @($out) -Compress -Depth 3`;

// A root is only accepted if it is an absolute local path (drive letter) that is
// neither a drive root nor a UNC path nor contains ".." segments. Anything else
// (empty string, "Temp", "C:\", "\\srv\share") would be resolved against the
// elevated process or wipe far more than a junk folder, so it is refused before
// any script text exists.
function assertSafeRoot(root) {
  const fail = () => {
    throw new Error(`Refusing unsafe root for elevated cleaning: ${JSON.stringify(root)}`);
  };
  if (typeof root !== 'string' || root.trim() === '') fail();
  if (!/^[A-Za-z]:[\\/]/.test(root)) fail();
  const segments = root.split(/[\\/]+/);
  if (segments.includes('..')) fail();
  // Windows drops trailing dots and spaces from a name, so "C:\ " or "C:\..."
  // would quietly mean the drive root.
  if (segments.some((segment) => /[. ]$/.test(segment))) fail();
  const normalized = path.win32.normalize(root);
  if (path.win32.parse(normalized).root === normalized) fail();
}

// items: { id, roots: string[], minAgeMs }[]. `now` is Unix milliseconds; the
// script compares in UTC ticks, so time zones play no role.
function buildElevatedScript(items, resultPath, now) {
  if (!Number.isFinite(now)) throw new Error('now must be a number of milliseconds');
  for (const item of items) item.roots.forEach(assertSafeRoot);
  const itemLines = items.map((item) => {
    if (!Number.isFinite(item.minAgeMs) || item.minAgeMs < 0) {
      throw new Error(`Invalid minAgeMs for ${item.id}`);
    }
    const roots = item.roots.map(psQuote).join(',');
    return `@{id=${psQuote(item.id)};age=${Math.trunc(item.minAgeMs)};roots=@(${roots})}`;
  });

  return [
    SCRIPT_HEAD,
    `$now=${Math.trunc(now)}`,
    `$items=@(\n${itemLines.join('\n')}\n)`,
    SCRIPT_RUN,
    `[IO.File]::WriteAllText(${psQuote(resultPath)},$j,(New-Object Text.UTF8Encoding($false)))`,
  ].join('\n');
}

// Default launcher: asks Windows for elevation (UAC prompt) and waits until the
// elevated PowerShell is done. Rejects if the user declines. Never run by tests.
function buildUacCommand(encoded) {
  return `Start-Process ${psQuote(powershellPath())} -Verb RunAs -WindowStyle Hidden -Wait `
    + `-ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded}'`;
}

async function launchWithUac(encoded) {
  const command = buildUacCommand(encoded);
  await execFileAsync(powershellPath(), [...POWERSHELL_ARGS, '-Command', command], { windowsHide: true });
}

function toResultRow(row) {
  const number = (v) => (Number.isFinite(v) ? v : 0);
  return {
    id: String(row.id),
    freedBytes: number(row.freedBytes),
    deleted: number(row.deleted),
    skipped: number(row.skipped),
  };
}

// Cleans admin categories in one elevated run. Resolves with declined: true if
// the launcher failed (the user said no to UAC), and with unknown: true if it
// ended normally but left no usable result file.
async function runElevated(categories, { launch = launchWithUac } = {}) {
  for (const cat of categories) {
    if (!cat.admin) {
      throw new Error(`Category ${cat.id} does not need administrator rights and must not be cleaned elevated`);
    }
  }
  if (categories.length === 0) return { declined: false, results: [] };

  const items = [];
  for (const cat of categories) {
    items.push({ id: cat.id, roots: await cat.roots(), minAgeMs: cat.minAgeMs });
  }

  // Random name: the elevated process writes here, so it must not be guessable.
  const resultPath = path.join(os.tmpdir(), `mydesk-${crypto.randomBytes(8).toString('hex')}.json`);
  const script = buildElevatedScript(items, resultPath, Date.now());
  const encoded = Buffer.from(script, 'utf16le').toString('base64');

  try {
    try {
      await launch(encoded);
    } catch {
      return { declined: true, results: [] };
    }

    // The launcher ended without an error, but there is no usable result:
    // the clean-up may or may not have run, so say "unknown", not "declined".
    let rows;
    try {
      const text = (await fs.promises.readFile(resultPath, 'utf8')).replace(/^\uFEFF/, '');
      rows = JSON.parse(text);
    } catch {
      return { declined: false, unknown: true, results: [] };
    }
    if (!Array.isArray(rows)) return { declined: false, unknown: true, results: [] };
    return { declined: false, results: rows.map(toResultRow) };
  } finally {
    await fs.promises.rm(resultPath, { force: true });
  }
}

module.exports = { buildElevatedScript, buildUacCommand, runElevated };
