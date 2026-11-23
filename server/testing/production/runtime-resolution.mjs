import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isBuiltin } from 'node:module';
import { requireProductionManifest } from './manifest.mjs';
import { canonicalJson, parse, digest, shape, check, hash, absolute, within, disjoint, relative, integer, freeze } from './primitives.mjs';
import { readWindowsMetadata } from '../../../scripts/recovery/windows-metadata.mjs';

const inventories = new WeakMap();
const observations = new WeakSet();
const refuse = () => { throw new Error('RUNTIME_RESOLUTION_REFUSED'); };
const MiB = 1024 * 1024;
// Be conservative on Windows directories that enable case-sensitive names.
const exactWithin = (root, file) => file.startsWith(`${root}\\`);
const sorted = (values, key) => {
  let previous = ''; const seen = new Set();
  for (const value of values) { const current = key(value); check(current > previous && !seen.has(current.toLowerCase())); previous = current; seen.add(current.toLowerCase()); }
};
function filePin(value, maximum) {
  shape(value, ['path', 'size', 'sha256']); absolute(value.path); integer(value.size, maximum); hash(value.sha256);
}
function specifier(value) {
  check(typeof value === 'string' && value.length > 0 && value.length <= 256);
  if (isBuiltin(value)) return `node:${value.replace(/^node:/, '')}`;
  check(/^(?:@[A-Za-z0-9_-][A-Za-z0-9._-]*\/)?[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)*$/.test(value));
  check(!value.split('/').some(part => part === '.' || part === '..')); return undefined;
}
function selectedFiles(profile, document) {
  const entry = profile.document.build.artifacts.find(value => value.role === 'server-entry');
  const files = [{ path: relative(profile.document.paths.buildRoot, entry.relativePath), size: entry.size, sha256: entry.sha256 },
    document.runtime.executable, document.metafile.file, ...document.packageMetadata,
    ...document.edges.filter(edge => edge.target.kind === 'file').map(edge => edge.target.file)];
  const unique = new Map(); let total = 0;
  for (const file of files) {
    const key = file.path.toLowerCase(); const prior = unique.get(key);
    check(!prior || (prior.path === file.path && prior.size === file.size && prior.sha256 === file.sha256));
    if (!prior) { unique.set(key, file); total += file.size; }
  }
  check(unique.size <= 256 && total <= 256 * MiB); return Array.from(unique.values());
}

/** Compare supplied independent pins; this does not authenticate their origin. */
export function readRuntimeResolutionInventory(profileRecord, text, callerPins) {
  try {
    const profile = requireProductionManifest(profileRecord);
    const pins = parse(canonicalJson(callerPins));
    shape(pins, ['expectedInventorySha256', 'manifestSha256', 'runId', 'buildCommitSha', 'harnessCommitSha', 'evidenceClass', 'approvalRef']);
    hash(pins.expectedInventorySha256);
    const value = parse(text);
    shape(value, ['kind', 'version', 'evidenceClass', 'manifestSha256', 'runId', 'buildCommitSha', 'harnessCommitSha', 'approvalRef',
      'runtime', 'dependencyRoots', 'metafile', 'packageMetadata', 'edges', 'uncoveredNonliteral']);
    check(value.kind === 'pfa-runtime-root-resolution' && value.version === 1);
    check(['synthetic-fixture', 'declared-installed-candidate'].includes(value.evidenceClass));
    for (const key of ['manifestSha256', 'runId', 'buildCommitSha', 'harnessCommitSha', 'evidenceClass', 'approvalRef']) check(value[key] === pins[key]);
    check(digest(text) === pins.expectedInventorySha256 && value.manifestSha256 === profile.manifestSha256 &&
      value.runId === profile.document.runId && value.buildCommitSha === profile.document.build.commitSha &&
      value.harnessCommitSha === profile.document.harnessCommitSha && value.approvalRef === profile.document.approvalRef);
    shape(value.runtime, ['executable', 'version', 'platform', 'arch', 'flag']); filePin(value.runtime.executable, 128 * MiB);
    check(path.win32.basename(value.runtime.executable.path).toLowerCase() === 'node.exe');
    check(value.runtime.version === '24.22.0' && value.runtime.platform === 'win32' && value.runtime.arch === 'arm64' &&
      value.runtime.flag === '--experimental-import-meta-resolve');
    check(Array.isArray(value.dependencyRoots) && value.dependencyRoots.length > 0 && value.dependencyRoots.length <= 8);
    sorted(value.dependencyRoots, root => root);
    value.dependencyRoots.forEach((root, index) => {
      absolute(root); check(root.toLowerCase() !== profile.document.paths.buildRoot.toLowerCase() && !within(root, profile.document.paths.buildRoot));
      for (const mutable of ['browserProfileRoot', 'pgdataRoot', 'publicTlsRoot', 'privateRoot']) disjoint(root, profile.document.paths[mutable]);
      value.dependencyRoots.slice(index + 1).forEach(other => disjoint(root, other));
    });
    shape(value.metafile, ['file', 'outputKey']); filePin(value.metafile.file, 8 * MiB); relative(profile.document.paths.buildRoot, value.metafile.outputKey);
    check(Array.isArray(value.packageMetadata) && value.packageMetadata.length > 0 && value.packageMetadata.length <= 128);
    sorted(value.packageMetadata, file => file.path);
    for (const file of value.packageMetadata) { filePin(file, MiB); check(path.win32.basename(file.path) === 'package.json'); }
    check(Array.isArray(value.edges) && value.edges.length > 0 && value.edges.length <= 128);
    sorted(value.edges, edge => `${edge.kind}:${edge.specifier}`); let occurrences = 0;
    for (const edge of value.edges) {
      shape(edge, ['specifier', 'kind', 'occurrences', 'target']);
      check(['import-statement', 'dynamic-import', 'require-call'].includes(edge.kind));
      integer(edge.occurrences, 4096); occurrences += edge.occurrences;
      const builtin = specifier(edge.specifier);
      if (builtin) {
        shape(edge.target, ['kind', 'name']); check(edge.target.kind === 'builtin' && edge.target.name === builtin && isBuiltin(edge.target.name));
      } else if (edge.kind === 'require-call') {
        shape(edge.target, ['kind', 'reason']); check(edge.target.kind === 'uncovered' && edge.target.reason === 'require-conditions');
      } else {
        shape(edge.target, ['kind', 'file']); check(edge.target.kind === 'file'); filePin(edge.target.file, 32 * MiB);
        check(value.dependencyRoots.some(root => exactWithin(root, edge.target.file.path)));
      }
    }
    check(occurrences <= 4096 && Array.isArray(value.uncoveredNonliteral) && value.uncoveredNonliteral.length <= 32);
    sorted(value.uncoveredNonliteral, gap => gap.sourceRef);
    for (const gap of value.uncoveredNonliteral) {
      shape(gap, ['sourceRef', 'reason']); check(gap.reason === 'computed-runtime-specifier' && typeof gap.sourceRef === 'string' &&
        /^[A-Za-z0-9_./:-]{1,256}$/.test(gap.sourceRef) && !gap.sourceRef.split('/').includes('..'));
    }
    const files = selectedFiles(profile, value);
    const record = freeze({ kind: 'validated-runtime-root-inventory', inventorySha256: pins.expectedInventorySha256, document: value });
    inventories.set(record, { profile, files }); return record;
  } catch { refuse(); }
}

const identity = node => (node.isDirectory() ? [node.dev, node.ino, node.mode, node.birthtimeNs]
  : [node.dev, node.ino, node.mode, node.nlink, node.size, node.birthtimeNs, node.ctimeNs, node.mtimeNs]).map(String);
function ancestors(file) {
  const result = [file];
  while (path.win32.dirname(result[0]) !== result[0]) result.unshift(path.win32.dirname(result[0]));
  return result;
}
function snapshot(paths, files) {
  return paths.map(file => {
    const node = fs.lstatSync(file, { bigint: true });
    check(!node.isSymbolicLink() && (files.has(file) ? node.isFile() && node.nlink === 1n : node.isDirectory()) && node.ino > 0n);
    check(fs.realpathSync.native(file) === file); return node;
  });
}
function bindMetadata(rows, nodes) {
  rows.forEach((row, index) => {
    const node = nodes[index]; check(row.directory === node.isDirectory());
    check(BigInt(row.creationTicks) === 621355968000000000n + node.birthtimeNs / 100n);
    if (node.isFile()) check(BigInt(row.size) === node.size && BigInt(row.writeTicks) === 621355968000000000n + node.mtimeNs / 100n);
  });
}
const metadataIdentity = rows => rows.map(row => row.directory
  ? { path: row.path, directory: true, attributes: row.attributes, creationTicks: row.creationTicks } : row);
const jsonBytes = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
function verifyMetafile(bytes, document, entry) {
  const meta = jsonBytes(bytes); shape(meta, ['inputs', 'outputs']);
  check(meta.inputs && typeof meta.inputs === 'object' && !Array.isArray(meta.inputs) && Object.keys(meta.inputs).length <= 8192);
  check(meta.outputs && typeof meta.outputs === 'object' && !Array.isArray(meta.outputs) && Object.keys(meta.outputs).length > 0 && Object.keys(meta.outputs).length <= 8);
  check(Object.hasOwn(meta.outputs, document.metafile.outputKey)); const output = meta.outputs[document.metafile.outputKey];
  shape(output, ['entryPoint', 'bytes', 'inputs', 'exports', 'imports']);
  check(output.entryPoint === 'server/index-prod.ts' && output.bytes === entry.size && output.inputs && typeof output.inputs === 'object' && !Array.isArray(output.inputs));
  check(Object.keys(output.inputs).length <= 8192 && Array.isArray(output.exports) && output.exports.length <= 512 &&
    output.exports.every(value => typeof value === 'string' && value.length <= 256));
  check(Array.isArray(output.imports) && output.imports.length <= 4096); const counts = new Map();
  for (const item of output.imports) {
    shape(item, ['path', 'kind', 'external']); specifier(item.path);
    check(item.external === true && ['import-statement', 'dynamic-import', 'require-call'].includes(item.kind));
    const key = `${item.kind}:${item.path}`; counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  check(counts.size === document.edges.length);
  for (const edge of document.edges) check(counts.get(`${edge.kind}:${edge.specifier}`) === edge.occurrences);
}
function runtimePreflight(document, options) {
  shape(options, ['systemRoot']); absolute(options.systemRoot);
  const env = process.env;
  check(Object.keys(env).length === 5 && ['PROCESSOR_ARCHITECTURE', 'SystemRoot', 'TZ', 'TEMP', 'TMP'].every(key => Object.hasOwn(env, key)));
  check(env.PROCESSOR_ARCHITECTURE === 'ARM64' && process.arch === 'arm64');
  check(typeof env.SystemRoot === 'string' && options.systemRoot.toLowerCase() === env.SystemRoot.toLowerCase() && env.TZ === 'UTC');
  absolute(env.TEMP); check(env.TEMP === env.TMP);
  check(process.platform === document.runtime.platform && process.arch === document.runtime.arch && process.version === `v${document.runtime.version}` &&
    process.execPath === document.runtime.executable.path &&
    process.execArgv.length === 1 && process.execArgv[0] === document.runtime.flag);
}
function coverage(document, entry) {
  const result = { esmStatic: [], esmDynamicLiteral: [], builtinIdentifiers: [], uncoveredRequireCalls: [], uncoveredNonliteral: document.uncoveredNonliteral };
  for (const edge of document.edges) {
    if (edge.target.kind === 'builtin') {
      check(isBuiltin(edge.specifier) && isBuiltin(edge.target.name));
      result.builtinIdentifiers.push({ kind: edge.kind, specifier: edge.specifier, name: edge.target.name, occurrences: edge.occurrences });
    } else if (edge.target.kind === 'uncovered') result.uncoveredRequireCalls.push({ specifier: edge.specifier, occurrences: edge.occurrences });
    else {
      const url = new URL(import.meta.resolve(edge.specifier, pathToFileURL(entry.path).href));
      check(url.protocol === 'file:' && !url.hostname && !url.search && !url.hash);
      const resolved = fileURLToPath(url); absolute(resolved);
      check(resolved === edge.target.file.path);
      const root = document.dependencyRoots.find(value => exactWithin(value, resolved)); check(root);
      result[edge.kind === 'import-statement' ? 'esmStatic' : 'esmDynamicLiteral'].push({ specifier: edge.specifier,
        occurrences: edge.occurrences, relativePath: path.win32.relative(root, resolved).replaceAll('\\', '/'), sha256: edge.target.file.sha256 });
    }
  }
  return result;
}

/** Observe declared files and literal ESM roots; never evaluates a selected module. */
export async function observeRuntimeResolution(record, suppliedOptions) {
  const opened = [];
  try {
    check(inventories.has(record)); const stored = inventories.get(record); const document = record.document;
    const options = parse(canonicalJson(suppliedOptions)); runtimePreflight(document, options);
    const deadline = Date.now() + 60000; const tick = () => check(Date.now() <= deadline);
    const files = stored.files; const names = new Set(files.map(file => file.path));
    const paths = Array.from(new Set(files.flatMap(file => ancestors(file.path)))); check(paths.length <= 512);
    const before = snapshot(paths, names); tick();
    const metadata = await readWindowsMetadata(paths, options.systemRoot); bindMetadata(metadata, before); tick();
    const retained = new Map(); const descriptors = new Map();
    const metadataNames = new Set(document.packageMetadata.map(file => file.path)); metadataNames.add(document.metafile.file.path);
    function read(file, fd, retain) {
      const start = fs.fstatSync(fd, { bigint: true }); const expected = before[paths.indexOf(file.path)];
      check(JSON.stringify(identity(start)) === JSON.stringify(identity(expected)) && start.size === BigInt(file.size));
      const hasher = createHash('sha256'); const buffer = Buffer.alloc(64 * 1024); const parts = []; let offset = 0;
      while (offset < file.size) {
        tick(); const length = fs.readSync(fd, buffer, 0, Math.min(buffer.length, file.size - offset), offset); check(length > 0 && length <= file.size - offset);
        const chunk = buffer.subarray(0, length); hasher.update(chunk); if (retain) parts.push(Buffer.from(chunk)); offset += length;
      }
      check(hasher.digest('hex') === file.sha256 && JSON.stringify(identity(start)) === JSON.stringify(identity(fs.fstatSync(fd, { bigint: true }))));
      if (retain) return Buffer.concat(parts, file.size);
    }
    for (const file of files) {
      tick(); const fd = fs.openSync(file.path, fs.constants.O_RDONLY); opened.push(fd); descriptors.set(file.path, fd);
      const bytes = read(file, fd, metadataNames.has(file.path)); if (bytes) retained.set(file.path, bytes);
    }
    const entry = files[0]; verifyMetafile(retained.get(document.metafile.file.path), document, entry);
    for (const file of document.packageMetadata) {
      const value = jsonBytes(retained.get(file.path)); check(value && typeof value === 'object' && !Array.isArray(value));
    }
    tick(); const observed = coverage(document, entry); tick();
    for (const file of [document.metafile.file, ...document.packageMetadata]) read(file, descriptors.get(file.path), false);
    check(JSON.stringify(coverage(document, entry)) === JSON.stringify(observed)); tick();
    const metadataAfter = await readWindowsMetadata(paths, options.systemRoot); const after = snapshot(paths, names);
    bindMetadata(metadataAfter, after); check(JSON.stringify(metadataIdentity(metadata)) === JSON.stringify(metadataIdentity(metadataAfter)));
    before.forEach((node, index) => check(JSON.stringify(identity(node)) === JSON.stringify(identity(after[index]))));
    files.forEach(file => check(JSON.stringify(identity(fs.fstatSync(descriptors.get(file.path), { bigint: true }))) === JSON.stringify(identity(before[paths.indexOf(file.path)])))); tick();
    const result = freeze({ kind: 'observed-runtime-root-resolution', evidenceClass: document.evidenceClass,
      inventorySha256: record.inventorySha256, manifestSha256: document.manifestSha256, buildCommitSha: document.buildCommitSha,
      runtime: document.runtime, coverage: observed, files,
      certifications: { esmRootResolutionsObserved: true, selectedEntryBytesObserved: true, transitiveClosureComplete: false,
        custodyHeld: false, runtimeDependencyIdentity: false, executionAuthorized: false } });
    observations.add(result); return result;
  } catch { refuse(); }
  finally {
    let failed = false; for (const fd of opened) { try { fs.closeSync(fd); } catch { failed = true; } } if (failed) refuse();
  }
}
