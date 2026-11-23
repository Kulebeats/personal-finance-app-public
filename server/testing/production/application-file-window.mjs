import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { absolute, shape, hash, freeze } from './primitives.mjs';
import { graphCheck as check, graphStable as stable, graphDigest as digest, parseCanonicalGraphJson as parse } from './application-root-json.mjs';
import { applicationEntryPath } from './application-paths.mjs';

const windows = new WeakMap();
const MiB = 1024 * 1024;
const refuse = () => { throw new Error('APPLICATION_FILE_WINDOW_REFUSED'); };
const within = (root, file) => file === root || file.startsWith(root+'\\');
const bounded = (value, max, min = 0) => check(Array.isArray(value) && value.length >= min && value.length <= max);
const unchanged = (a, b) => check(stable(a) === stable(b));
const tick = state => check(!state.closed && performance.now() <= state.deadline);
// Literal metadata-only script. Paths are JSON on stdin, never shell fragments.
const metadataScript = `
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
} catch { [Console]::Error.WriteLine('APPLICATION_METADATA_REFUSED'); exit 1 }
`;
async function readMetadataBatch(state, paths) {
  tick(state); const input = JSON.stringify(paths); check(Buffer.byteLength(input) <= 128 * 1024);
  const stdout = await new Promise((resolve, reject) => {
    let outcome, closed = false, pipeFailed = false;
    const settle = () => { if (closed && outcome) outcome.error ? reject(new Error('APPLICATION_METADATA_REFUSED')) : resolve(outcome.output); };
    const child = execFile(state.request.metadataExecutable.path, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', metadataScript], {
      windowsHide: true, shell: false, encoding: 'utf8', maxBuffer: 2 * MiB,
      timeout: Math.max(1, Math.min(5000, Math.floor(state.deadline-performance.now()))), signal: state.abort.signal,
      env: { SystemRoot: state.request.systemRoot },
    }, (error, output) => { outcome = { error: error || pipeFailed, output }; settle(); });
    child.once('close', () => { closed = true; settle(); });
    child.stdin.on('error', () => { pipeFailed = true; outcome = { error: true }; child.kill(); settle(); });
    child.stdin.end(input);
  });
  tick(state); const rows = JSON.parse(stdout); check(Array.isArray(rows) && rows.length === paths.length);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]; shape(row, ['path', 'attributes', 'directory', 'size', 'creationTicks', 'writeTicks']);
    check(row.path === paths[i] && typeof row.directory === 'boolean');
    check(Number.isInteger(row.attributes) && row.attributes >= 0 && row.attributes <= 0xffffffff && (row.attributes & 0x400) === 0);
    for (const key of ['size', 'creationTicks', 'writeTicks']) check(typeof row[key] === 'string' && /^\d{1,20}$/.test(row[key]));
  }
  return rows;
}
function unique(values, key) {
  const seen = new Set();
  for (const value of values) { const name = key(value).toLowerCase(); check(!seen.has(name)); seen.add(name); }
}
function pin(value, maximum, withKind = false) {
  shape(value, ['path', 'sizeBytes', 'sha256', ...(withKind ? ['kind'] : [])]); absolute(value.path); hash(value.sha256);
  check(Number.isSafeInteger(value.sizeBytes) && value.sizeBytes >= 0 && value.sizeBytes <= maximum);
}
function validate(text, expectedHash) {
  hash(expectedHash); check(typeof text === 'string' && Buffer.byteLength(text) <= MiB && digest(text) === expectedHash);
  const request = parse(text, MiB);
  shape(request, ['kind', 'version', 'approvedRoots', 'files', 'directories', 'absent', 'systemRoot', 'metadataExecutable', 'deadlineMs']);
  check(request.kind === 'application-file-window' && request.version === 1);
  check(process.platform === 'win32' && process.arch === 'arm64' && process.version === 'v24.22.0');
  check(Number.isSafeInteger(request.deadlineMs) && request.deadlineMs > 0 && request.deadlineMs <= 60000);
  absolute(request.systemRoot); check(typeof process.env.SystemRoot === 'string');
  // This exception is pinned to this host's reviewed OS tool, not an arbitrary
  // executable tree supplied through a replaced SystemRoot environment value.
  check(request.systemRoot === 'C:\\Windows');
  check(request.systemRoot === fs.realpathSync.native(process.env.SystemRoot));
  shape(request.metadataExecutable, ['path', 'sizeBytes', 'sha256', 'dev', 'ino']);
  const { dev, ino, ...toolBytes } = request.metadataExecutable;
  pin(toolBytes, 32 * MiB);
  for (const value of [dev, ino]) check(typeof value === 'string' && /^(?:0|[1-9][0-9]{0,29})$/.test(value));
  check(BigInt(ino) > 0n);
  check(request.metadataExecutable.path === path.win32.join(request.systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
  bounded(request.approvedRoots, 32, 1); request.approvedRoots.forEach(absolute); unique(request.approvedRoots, root => root);
  const allowed = file => check(request.approvedRoots.some(root => within(root, file)));
  bounded(request.files, 512, 1); unique(request.files, file => file.path);
  let total = request.metadataExecutable.sizeBytes;
  for (const file of request.files) {
    pin(file, file.kind === 'runtime' ? 128 * MiB : 32 * MiB, true); check(['runtime', 'data'].includes(file.kind)); allowed(file.path);
    check(file.path.toLowerCase() !== request.metadataExecutable.path.toLowerCase()); total += file.sizeBytes;
  }
  check(total <= 256 * MiB);
  bounded(request.directories, 4096); bounded(request.absent, 4096);
  unique([...request.directories, ...request.absent], row => row.path);
  let entryCount = 0;
  for (const directory of request.directories) {
    shape(directory, ['path', 'entries']); absolute(directory.path); allowed(directory.path);
    bounded(directory.entries, 4096); check((entryCount += directory.entries.length) <= 4096); unique(directory.entries, entry => entry.name);
    for (const entry of directory.entries) {
      shape(entry, ['name', 'kind']); check(typeof entry.name === 'string' && !entry.name.includes('/'));
      applicationEntryPath(directory.path, entry.name); check(['file', 'directory'].includes(entry.kind));
    }
  }
  for (const absent of request.absent) {
    shape(absent, ['path', 'parent']); absolute(absent.path); absolute(absent.parent); allowed(absent.path);
    check(path.win32.dirname(absent.path) === absent.parent && request.directories.some(directory => directory.path === absent.parent));
  }
  return request;
}
function ancestors(file) {
  const values = [file]; let current = file;
  while (path.win32.dirname(current) !== current) { current = path.win32.dirname(current); values.push(current); }
  return values;
}
function identity(node) {
  return (node.isDirectory() ? [node.dev, node.ino, node.mode, node.birthtimeNs]
    : [node.dev, node.ino, node.mode, node.nlink, node.size, node.birthtimeNs, node.ctimeNs, node.mtimeNs]).map(String);
}
function snapshot(state) {
  const result = new Map();
  for (const file of state.paths) {
    tick(state); const node = fs.lstatSync(file, { bigint: true });
    check(!node.isSymbolicLink() && node.ino > 0n && fs.realpathSync.native(file) === file);
    if (state.filePins.has(file)) {
      check(node.isFile() && node.size === BigInt(state.filePins.get(file).sizeBytes));
      // Separate architecture-approved OS tool exception: Windows owns two
      // hardlinks to this exact pinned executable. No selected file inherits it.
      check(node.nlink === (file === state.request.metadataExecutable.path ? 2n : 1n));
      if (file === state.request.metadataExecutable.path) {
        check(String(node.dev) === state.request.metadataExecutable.dev && String(node.ino) === state.request.metadataExecutable.ino);
      }
    } else check(node.isDirectory());
    result.set(file, node);
  }
  return result;
}
function inspectLookups(state) {
  let paths = new Set(state.paths);
  for (const directory of state.request.directories) {
    tick(state);
    const actual = [], handle = fs.opendirSync(directory.path);
    try {
      let entry;
      while ((entry = handle.readSync()) !== null) {
        tick(state); check(actual.length < 4096);
        check(!entry.isSymbolicLink() && (entry.isDirectory() || entry.isFile()));
        const file = applicationEntryPath(directory.path, entry.name); paths.add(file); check(paths.size <= 4096);
        actual.push({ name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file' });
      }
    } finally { handle.closeSync(); }
    const sorted = rows => [...rows].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    unchanged(sorted(actual), sorted(directory.entries));
  }
  for (const absent of state.request.absent) {
    tick(state); paths.add(absent.path);
    let missing = false;
    try { fs.lstatSync(absent.path); } catch (error) { if (error?.code === 'ENOENT') missing = true; else throw error; }
    check(missing);
  }
  check(paths.size <= 4096);
}
function readPinned(state, file, fd) {
  tick(state); const start = fs.fstatSync(fd, { bigint: true });
  unchanged(identity(start), identity(state.before.get(file.path)));
  const hasher = createHash('sha256'), buffer = Buffer.alloc(64 * 1024); let offset = 0;
  while (offset < file.sizeBytes) {
    tick(state); const length = fs.readSync(fd, buffer, 0, Math.min(buffer.length, file.sizeBytes-offset), offset);
    check(length > 0); hasher.update(buffer.subarray(0, length)); offset += length;
  }
  check(hasher.digest('hex') === file.sha256); unchanged(identity(start), identity(fs.fstatSync(fd, { bigint: true })));
}
async function metadata(state, nodes) {
  const result = [];
  for (let offset = 0; offset < state.paths.length; offset += 1024) {
    tick(state);
    // Recheck the pinned OS tool's handle and path immediately before launch.
    const tool = state.request.metadataExecutable;
    readPinned(state, tool, state.descriptors.get(tool.path));
    unchanged(identity(fs.lstatSync(tool.path, { bigint: true })), identity(state.before.get(tool.path)));
    const rows = await readMetadataBatch(state, state.paths.slice(offset, offset+1024));
    tick(state);
    for (const row of rows) {
      const node = nodes.get(row.path); check(node && row.directory === node.isDirectory());
      check(BigInt(row.creationTicks) === 621355968000000000n + node.birthtimeNs / 100n);
      if (node.isFile()) check(BigInt(row.size) === node.size && BigInt(row.writeTicks) === 621355968000000000n + node.mtimeNs / 100n);
      result.push(row.directory ? { path: row.path, directory: true, attributes: row.attributes, creationTicks: row.creationTicks } : row);
    }
  }
  return result;
}
function release(state) {
  if (state.closed) return !state.cleanupFailed;
  state.closed = true; clearTimeout(state.timer);
  try { state.abort.abort(); } catch { state.cleanupFailed = true; }
  for (const fd of state.descriptors.values()) { try { fs.closeSync(fd); } catch { state.cleanupFailed = true; } }
  state.descriptors.clear(); return !state.cleanupFailed;
}

/** Retain measured descriptors for a bounded before/after check; never grants custody. */
export async function openApplicationFileWindow(text, expectedHash) {
  let state;
  try {
    const request = validate(text, expectedHash);
    const files = [...request.files, request.metadataExecutable];
    const paths = [...new Set([...files.flatMap(file => ancestors(file.path)), ...request.directories.flatMap(directory => ancestors(directory.path))])].sort();
    check(paths.length + request.absent.length <= 4096);
    state = { request, requestSha256: expectedHash, paths, filePins: new Map(files.map(file => [file.path, file])), descriptors: new Map(), busy: false,
      deadline: performance.now()+request.deadlineMs, closed: false, cleanupFailed: false, abort: new AbortController() };
    state.timer = setTimeout(() => { release(state); }, request.deadlineMs); state.timer.unref();
    state.before = snapshot(state); inspectLookups(state);
    for (const file of files) {
      tick(state); const fd = fs.openSync(file.path, fs.constants.O_RDONLY); state.descriptors.set(file.path, fd); readPinned(state, file, fd);
    }
    state.metadata = await metadata(state, state.before);
    const after = snapshot(state);
    for (const file of paths) unchanged(identity(after.get(file)), identity(state.before.get(file)));
    inspectLookups(state); tick(state);
    const record = freeze({ kind: 'application-file-measurement-window', requestSha256: expectedHash });
    windows.set(record, state); return record;
  } catch {
    if (state) release(state);
    refuse();
  }
}

async function verifyWindow(state) {
    tick(state);
    const after = snapshot(state); inspectLookups(state);
    for (const file of state.paths) unchanged(identity(after.get(file)), identity(state.before.get(file)));
    for (const file of state.filePins.values()) readPinned(state, file, state.descriptors.get(file.path));
    unchanged(await metadata(state, after), state.metadata);
    const final = snapshot(state); inspectLookups(state);
    for (const file of state.paths) unchanged(identity(final.get(file)), identity(state.before.get(file)));
    for (const file of state.filePins.values()) readPinned(state, file, state.descriptors.get(file.path));
    const finalPaths = snapshot(state); inspectLookups(state);
    for (const file of state.paths) unchanged(identity(finalPaths.get(file)), identity(state.before.get(file)));
    tick(state);
}
function measuredIdentities(state) {
  const directoryMetadata = new Map(state.metadata.filter(row => row.directory).map(row => [row.path,row]));
  return {
    fileIdentities: state.request.files.map(file => {
      const node = state.before.get(file.path); return { path: file.path, dev: String(node.dev), ino: String(node.ino) };
    }),
    directoryIdentities: state.request.directories.map(directory => {
        const node = state.before.get(directory.path), metadata = directoryMetadata.get(directory.path); check(metadata);
        return { path:directory.path, identity:{ dev:String(node.dev),ino:String(node.ino),birthtimeNs:String(node.birthtimeNs),attributes:metadata.attributes } };
      }),
  };
}
/** Immutable evidence from a genuine open window; no descriptors or new lineage. */
export function inspectApplicationFileWindow(record) {
  const state = windows.get(record);
  try {
    check(state); tick(state);
    return freeze({ requestSha256: state.requestSha256, remainingMs: Math.max(0, Math.floor(state.deadline-performance.now())), ...measuredIdentities(state) });
  } catch { refuse(); }
}
/** Recheck while retaining the same descriptors, deadline and private lineage. */
export async function checkApplicationFileWindow(record) {
  const state = windows.get(record);
  try {
    check(state && !state.busy); tick(state); state.busy = true;
    await verifyWindow(state);
  } catch { if (state) release(state); refuse(); }
  finally { if (state) state.busy = false; }
}
export async function finishApplicationFileWindow(record) {
  const state = windows.get(record);
  try {
    check(state && !state.busy); tick(state); state.busy = true;
    await verifyWindow(state);
    const result = freeze({ kind: 'application-file-measurement-result', requestSha256: record.requestSha256,
      filesChecked: state.request.files.length, metadataToolChecked: true, ...measuredIdentities(state),
      certifications: { custodyHeld: false, runtimeDependencyIdentity: false, executionAuthorized: false } });
    check(release(state)); return result;
  } catch { if (state) release(state); refuse(); }
  finally { if (state) state.busy = false; }
}

/** Explicit abandonment; idempotent for a previously consumed genuine record. */
export function closeApplicationFileWindow(record) {
  const state = windows.get(record);
  if (!state || !release(state)) refuse();
}
