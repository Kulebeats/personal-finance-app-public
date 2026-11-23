import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { requireRecord, canonicalJson } from './contracts.mjs';
import { check, shape, parse, freeze, refuse } from './common.mjs';
import { absolute, child } from './paths.mjs';
import { readWindowsMetadata } from './windows-metadata.mjs';

function selectedFiles(record, sizes) {
  const intent = record.kind === 'producer' ? record.document : record.document.producer;
  shape(sizes, ['dump', 'restore']);
  const files = ['dump', 'restore'].map((name) => {
    check(Number.isSafeInteger(sizes[name]) && sizes[name] > 0 && sizes[name] <= 64 * 1024 * 1024);
    return { path: intent.tools[name].path, sha256: intent.tools[name].sha256, size: sizes[name] };
  });
  if (record.kind === 'restore') {
    const bundle = record.document.bundle;
    files.push(...[bundle.database, bundle.objectManifest, ...bundle.objects].map((entry) => ({
      path: child(intent.artifactRoot, entry.file), sha256: entry.sha256, size: entry.size,
    })));
    files.push({ path: child(intent.artifactRoot, intent.outputs.bundleManifest), sha256: record.document.authorization.bundleSha256,
      size: Buffer.byteLength(canonicalJson(bundle)) });
  }
  const unique = new Map();
  for (const file of files) {
    const key = file.path.toLowerCase(); const prior = unique.get(key);
    check(!prior || (prior.path === file.path && prior.sha256 === file.sha256 && prior.size === file.size)); unique.set(key, file);
  }
  return [...unique.values()];
}
const identity = (stat) => (stat.isDirectory() ? [stat.dev, stat.ino, stat.mode, stat.birthtimeNs]
  : [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.birthtimeNs, stat.ctimeNs, stat.mtimeNs]).map(String);
const metadataIdentity = (rows) => rows.map((row) => row.directory ? { path: row.path, attributes: row.attributes, directory: true, creationTicks: row.creationTicks } : row);
function snapshot(paths, files) {
  return paths.map((file) => {
    const stat = fs.lstatSync(file, { bigint: true });
    check(!stat.isSymbolicLink() && (files.has(file) ? stat.isFile() && stat.nlink === 1n : stat.isDirectory()));
    check(stat.ino > 0n && fs.realpathSync.native(file).toLowerCase() === file.toLowerCase());
    return stat;
  });
}
function ancestors(file) {
  absolute(file); check(path.win32.isAbsolute(file) && /^[A-Z]:\\/.test(file));
  const parts = [file]; let parent = path.win32.dirname(file);
  while (parent !== parts[0]) { parts.unshift(parent); const next = path.win32.dirname(parent); if (next === parent) break; parent = next; }
  return parts;
}
function bindMetadata(metadata, nodes) {
  const epochTicks = 621355968000000000n;
  metadata.forEach((row, index) => {
    const node = nodes[index]; check(row.directory === node.isDirectory());
    if (node.isFile()) check(BigInt(row.size) === node.size);
    check(BigInt(row.creationTicks) === node.birthtimeNs / 100n + epochTicks);
    if (node.isFile()) check(BigInt(row.writeTicks) === node.mtimeNs / 100n + epochTicks);
  });
}

/** Read-only closed-descriptor observation; never authorizes native path reopening. */
export async function attestRecoveryFiles(record, suppliedOptions) {
  const opened = [];
  try {
    check(record?.kind === 'producer' || record?.kind === 'restore'); requireRecord(record, record.kind);
    const options = parse(canonicalJson(suppliedOptions)); shape(options, ['toolSizes', 'systemRoot']);
    const files = selectedFiles(record, options.toolSizes);
    const fileNames = new Set(files.map((file) => file.path));
    const paths = [...new Set(files.flatMap((file) => ancestors(file.path)))];
    const before = snapshot(paths, fileNames); const metadata = await readWindowsMetadata(paths, options.systemRoot);
    bindMetadata(metadata, before);
    for (const expected of files) {
      const fd = fs.openSync(expected.path, fs.constants.O_RDONLY); opened.push(fd);
      const start = fs.fstatSync(fd, { bigint: true }); const node = before[paths.indexOf(expected.path)];
      check(JSON.stringify(identity(start)) === JSON.stringify(identity(node)) && start.size === BigInt(expected.size));
      const hasher = createHash('sha256'); const buffer = Buffer.alloc(64 * 1024); let offset = 0;
      while (offset < expected.size) {
        const length = fs.readSync(fd, buffer, 0, Math.min(buffer.length, expected.size - offset), offset); check(length > 0);
        hasher.update(buffer.subarray(0, length)); offset += length;
      }
      check(hasher.digest('hex') === expected.sha256);
      check(JSON.stringify(identity(start)) === JSON.stringify(identity(fs.fstatSync(fd, { bigint: true }))));
    }
    const metadataAfter = await readWindowsMetadata(paths, options.systemRoot); const after = snapshot(paths, fileNames);
    bindMetadata(metadataAfter, after); check(canonicalJson(metadataIdentity(metadata)) === canonicalJson(metadataIdentity(metadataAfter)));
    before.forEach((node, index) => check(JSON.stringify(identity(node)) === JSON.stringify(identity(after[index]))));
    opened.forEach((fd, index) => check(JSON.stringify(identity(fs.fstatSync(fd, { bigint: true }))) === JSON.stringify(identity(before[paths.indexOf(files[index].path)]))));
    return freeze({ stage: record.kind, authorizationSha256: record.sha256,
      files: files.map((file) => ({ ...file, identity: identity(before[paths.indexOf(file.path)]) })),
      certifications: { descriptorReadback: true, windowsReparseAttributes: true, laterNativeReopenSafe: false,
        provenanceAuthenticated: false, ownershipOrAcl: false, liveDatabaseIdentity: false, executionAuthorized: false },
    });
  } catch { refuse(); }
  finally {
    let failed = false;
    for (const fd of opened) { try { fs.closeSync(fd); } catch { failed = true; } }
    check(!failed);
  }
}
