import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { absolute } from './paths.mjs';
import { check, refuse, shape, canonicalJson, parse } from './common.mjs';

// No supplied path is interpolated into PowerShell syntax. Metadata only.
const script = `
$ErrorActionPreference = 'Stop'
try {
  [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  $paths = ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
  if ($paths -isnot [array] -or $paths.Count -lt 1 -or $paths.Count -gt 1024) { throw 'refused' }
  $result = @()
  foreach ($literal in $paths) {
    if ($literal -isnot [string]) { throw 'refused' }
    $item = Get-Item -LiteralPath $literal -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'refused' }
    $length = 0
    if (-not $item.PSIsContainer) { $length = $item.Length }
    $result += @{ path = $item.FullName; attributes = [uint32]$item.Attributes; directory = [bool]$item.PSIsContainer;
      size = $length.ToString(); creationTicks = $item.CreationTimeUtc.Ticks.ToString(); writeTicks = $item.LastWriteTimeUtc.Ticks.ToString() }
  }
  ConvertTo-Json -InputObject $result -Compress -Depth 4
} catch { [Console]::Error.WriteLine('RECOVERY_METADATA_REFUSED'); exit 1 }
`;

export async function readWindowsMetadata(paths, systemRoot) {
  check(process.platform === 'win32' && typeof process.env.SystemRoot === 'string');
  paths = parse(canonicalJson(paths));
  absolute(systemRoot); check(systemRoot.toLowerCase() === process.env.SystemRoot.toLowerCase());
  const executable = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  check(fs.lstatSync(executable).isFile() && !fs.lstatSync(executable).isSymbolicLink());
  check(fs.realpathSync.native(executable).toLowerCase() === executable.toLowerCase());
  check(Array.isArray(paths) && paths.length > 0 && paths.length <= 1024);
  for (const file of paths) { check(typeof file === 'string' && /^[A-Z]:\\/.test(file)); if (!/^[A-Z]:\\$/.test(file)) absolute(file); }
  const input = JSON.stringify(paths); check(Buffer.byteLength(input) <= 128 * 1024);
  const output = await new Promise((resolve, reject) => {
    const child = childProcess.execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, shell: false, timeout: 5000, maxBuffer: 2 * 1024 * 1024,
      env: { SystemRoot: systemRoot }, encoding: 'utf8',
    }, (error, stdout) => error ? reject(new Error('RECOVERY_METADATA_REFUSED')) : resolve(stdout));
    child.stdin.on('error', () => reject(new Error('RECOVERY_METADATA_REFUSED')));
    child.stdin.end(input);
  });
  let rows; try { rows = JSON.parse(output); } catch { refuse(); }
  check(Array.isArray(rows) && rows.length === paths.length);
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]; shape(row, ['path', 'attributes', 'directory', 'size', 'creationTicks', 'writeTicks']);
    check(typeof row.path === 'string' && row.path.toLowerCase() === paths[index].toLowerCase());
    check(Number.isInteger(row.attributes) && row.attributes >= 0 && row.attributes <= 0xffffffff && (row.attributes & 0x400) === 0);
    check(typeof row.directory === 'boolean');
    for (const key of ['size', 'creationTicks', 'writeTicks']) check(typeof row[key] === 'string' && /^\d{1,20}$/.test(row[key]));
  }
  return rows;
}
