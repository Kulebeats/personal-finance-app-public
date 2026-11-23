import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { PLAN, check, refuse, hash, assertOwnedListener } from './pg-tls-contract.mjs';

const systemRoot = 'C:\\Windows';
// No caller-provided script, path, command, service name or process filter.
const script = `
$ErrorActionPreference = 'Stop'
try {
  $v = ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
  if ($v.action -eq 'metadata') {
    if ($v.paths -isnot [array] -or $v.paths.Count -lt 1 -or $v.paths.Count -gt 512) { throw 'refused' }
    $rows = @()
    foreach ($literal in $v.paths) {
      if ($literal -isnot [string]) { throw 'refused' }
      $item = Get-Item -LiteralPath $literal -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'refused' }
      $rows += @{ path = $item.FullName; attributes = [uint32]$item.Attributes; directory = [bool]$item.PSIsContainer }
    }
    ConvertTo-Json -InputObject $rows -Compress
  } elseif ($v.action -eq 'port') {
    $rows = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -eq 55461 } | ForEach-Object {
      @{ address = $_.LocalAddress; port = [int]$_.LocalPort; pid = [int]$_.OwningProcess }
    })
    ConvertTo-Json -InputObject $rows -Compress
  } elseif ($v.action -eq 'identity' -and $v.pid -is [int] -and $v.pid -gt 0) {
    $p = Get-Process -Id $v.pid -ErrorAction Stop
    ConvertTo-Json -InputObject @{ pid = $p.Id; executable = $p.Path; ticks = $p.StartTime.ToUniversalTime().Ticks.ToString() } -Compress
  } elseif ($v.action -eq 'restrict') {
    $literal = '${PLAN.root}'
    $item = Get-Item -LiteralPath $literal -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'refused' }
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $literal -AclObject $acl
    $actual = Get-Acl -LiteralPath $literal
    if (-not $actual.AreAccessRulesProtected -or $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'refused' }
    $rules = @($actual.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    if ($rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow' -or $rules[0].FileSystemRights -ne 'FullControl') { throw 'refused' }
    [Console]::WriteLine('{"restricted":true}')
  } else { throw 'refused' }
} catch { [Console]::Error.WriteLine('PG_TLS_COMPONENT_REFUSED'); exit 1 }
`;
export function runFile(executable, args, env, { timeout = 10000, input, cwd, executor = execFile } = {}) {
  check(env && Object.getPrototypeOf(env) === Object.prototype && Object.values(env).every((value) => typeof value === 'string'));
  return new Promise((resolve, reject) => {
    const child = executor(executable, args, { env, cwd, timeout, shell: false, windowsHide: true, encoding: 'utf8', maxBuffer: 128 * 1024 },
      (error, stdout) => error ? reject(new Error('PG_TLS_COMPONENT_REFUSED')) : resolve(stdout));
    child.stdin.on('error', () => reject(new Error('PG_TLS_COMPONENT_REFUSED')));
    child.stdin.end(input);
  });
}
export async function bridge(action, env, details, transport = runFile) {
  check(['port', 'identity', 'restrict', 'metadata'].includes(action) && (action !== 'identity' || Number.isSafeInteger(details) && details > 0));
  if (action === 'metadata') check(Array.isArray(details) && details.length > 0 && details.length <= 512 &&
    details.every((file) => typeof file === 'string' && /^[A-Z]:\\/.test(file) && !/[\r\n\x00]/.test(file)));
  const executable = `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const text = await transport(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], env,
    { input: JSON.stringify({ action, ...(action === 'identity' ? { pid: details } : action === 'metadata' ? { paths: details } : {}) }), timeout: 5000 });
  try { return JSON.parse(text); } catch { refuse(); }
}
const ancestors = (file) => {
  const result = [file];
  while (path.dirname(result[0]) !== result[0]) result.unshift(path.dirname(result[0]));
  return result;
};
export function inspectNodeAncestors(paths, filesystem = fs) {
  const entries = [...new Set(paths.flatMap(ancestors))];
  return entries.map((file) => {
    const stat = filesystem.lstatSync(file, { bigint: true });
    check(!stat.isSymbolicLink() && (stat.isDirectory() || stat.isFile() && stat.nlink === 1n) &&
      filesystem.realpathSync.native(file).toLowerCase() === file.toLowerCase());
    return { path: file, directory: stat.isDirectory(), id: [stat.dev, stat.ino, stat.birthtimeNs].map(String).join(':') };
  });
}
export async function inspect(paths, env, filesystem = fs, metadata = bridge) {
  const before = inspectNodeAncestors(paths, filesystem); // Full ancestry before the first metadata child.
  for (let start = 0; start < before.length; start += 512) {
    const nodes = before.slice(start, start + 512);
    const rows = await metadata('metadata', env, nodes.map((node) => node.path));
    check(Array.isArray(rows) && rows.length === nodes.length);
    rows.forEach((row, index) => check(typeof row.path === 'string' && row.path.toLowerCase() === nodes[index].path.toLowerCase() &&
      row.directory === nodes[index].directory && Number.isInteger(row.attributes) && row.attributes >= 0 &&
      row.attributes <= 0xffffffff && (row.attributes & 0x400) === 0));
  }
  check(JSON.stringify(before) === JSON.stringify(inspectNodeAncestors(paths, filesystem)));
  return before;
}
/** Fixed source pins are reviewed expectations, not an authenticated software supply chain. */
export async function verifyTools(env) {
  const files = Object.values(PLAN.tools).map((tool) => tool.path);
  const before = await inspect(files, env);
  for (const [name, tool] of Object.entries(PLAN.tools)) {
    const stat = fs.statSync(tool.path); check(stat.size > 0 && stat.size <= 32 * 1024 * 1024);
    check(hash(fs.readFileSync(tool.path)) === tool.sha256);
    const version = await runFile(tool.path, [name === 'openssl' ? 'version' : '--version'], env);
    check(name === 'openssl' ? /^OpenSSL 3\.5\.7\s/.test(version) : /\(PostgreSQL\) 18\.6\s*$/.test(version));
  }
  check(JSON.stringify(before) === JSON.stringify(await inspect(files, env)));
}
export function launch(args, env) {
  check(env && Object.getPrototypeOf(env) === Object.prototype && Object.values(env).every((value) => typeof value === 'string'));
  const child = spawn(PLAN.tools.postgres.path, args, { env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let exit; let spawnError = false;
  child.on('error', () => { spawnError = true; });
  const closed = new Promise((resolve) => child.once('close', (code, signal) => { exit = { code, signal }; resolve(exit); }));
  // Drain without retaining/logging native stderr: no raw SQL/server payload evidence.
  child.stdout.resume(); child.stderr.resume();
  return { child, closed, status: () => ({ exit, spawnError }) };
}
export async function ownedProcess(handle, env) {
  check(handle?.child.pid && !handle.status().exit && !handle.status().spawnError);
  const identity = await bridge('identity', env, handle.child.pid);
  check(identity.pid === handle.child.pid && identity.executable?.toLowerCase() === PLAN.tools.postgres.path.toLowerCase() && /^\d{18}$/.test(identity.ticks));
  if (handle.identity) check(JSON.stringify(identity) === JSON.stringify(handle.identity)); else handle.identity = identity;
  const lines = fs.readFileSync(`${PLAN.root}\\pgdata\\postmaster.pid`, 'utf8').split(/\r?\n/);
  check(+lines[0] === handle.child.pid && path.normalize(lines[1]).toLowerCase() === `${PLAN.root}\\pgdata`.toLowerCase() && +lines[3] === PLAN.target.port);
}
export async function bounded(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PG_TLS_COMPONENT_REFUSED')), ms); })]); }
  finally { clearTimeout(timer); }
}
export async function waitListening(handle, env) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    check(!handle.status().exit && !handle.status().spawnError);
    const rows = await bridge('port', env);
    if (rows.length) {
      assertOwnedListener(rows, handle.child.pid);
      await ownedProcess(handle, env); return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  refuse();
}
export async function removeDescendant(relative, env) {
  check(['pgdata', 'private'].includes(relative));
  const root = path.join(PLAN.root, relative); const paths = [root];
  for (let index = 0; index < paths.length; index++) {
    check(paths.length < 10000);
    const stat = fs.lstatSync(paths[index]); check(!stat.isSymbolicLink());
    if (stat.isDirectory()) {
      await inspect([paths[index]], env); // Refuse generic reparse directories before traversing them.
      paths.push(...fs.readdirSync(paths[index]).map((name) => path.join(paths[index], name)));
    }
  }
  await inspect(paths, env); // Any generic Windows reparse attribute refuses before recursive removal.
  check(!fs.existsSync(`${PLAN.root}\\pgdata\\postmaster.pid`));
  check((await bridge('port', env)).length === 0);
  check(root.startsWith(`${PLAN.root}\\`) && fs.realpathSync.native(root).toLowerCase() === root.toLowerCase());
  fs.rmSync(root, { recursive: true, force: false });
}
