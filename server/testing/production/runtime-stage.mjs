import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson, parse, shape, absolute, within, disjoint, freeze } from './primitives.mjs';
import { readWindowsMetadata } from '../../../scripts/recovery/windows-metadata.mjs';
import { runtimeFixtureDeclaration, readRuntimeBoundaryProtocol } from './runtime-enforcement.mjs';

const stages = new WeakSet();
const fail = phase => { throw new Error(`RUNTIME_STAGE_REFUSED:${phase}`); };
const check = (value, phase) => { if (!value) fail(phase); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = stat => (stat.isDirectory() ? [stat.dev, stat.ino, stat.mode, stat.birthtimeNs]
  : [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.birthtimeNs, stat.ctimeNs, stat.mtimeNs]).map(String).join('|');
const ancestry = name => { const result = [name]; while (path.win32.dirname(result[0]) !== result[0]) result.unshift(path.win32.dirname(result[0])); return result; };
// Package paths allow scopes and longer topology than the independent production-v1 build helper.
function stagePath(root, value) {
  check(typeof value === 'string' && /^[A-Za-z0-9@._/-]{1,1024}$/.test(value) && !value.split('/').some(part => !part || part === '.' || part === '..'), 'MEMBER_PATH');
  const result = path.win32.join(root, ...value.split('/')); absolute(result); check(within(root, result), 'MEMBER_PATH'); return result;
}
export function requireRuntimeStage(record) { check(stages.has(record), 'LINEAGE'); return record; }

/** Creates only a fresh directory. Failures preserve the partial allocation for adjudication. */
export async function stageRuntimePackageTree(acceptedTreeRecord, stageAllocation) {
  let tree;
  try { tree = (await import('./runtime-package-tree.mjs')).requireRuntimePackageTree(acceptedTreeRecord); } catch { fail('LINEAGE'); }
  // This check intentionally precedes even inspecting allocation descriptors or invoking helpers.
  check(tree.unresolved.length === 0 && tree.edges.every(edge => edge.status !== 'missing-required') &&
    tree.files.every(file => ['module', 'commonjs', 'json'].includes(file.assetKind)), 'CAPABILITY');
  let phase = 'ALLOCATION'; const opened = [];
  try {
    const deadline = Date.now() + 60000; const tick = () => check(Date.now() <= deadline, 'DEADLINE');
    const allocation = parse(canonicalJson(stageAllocation)); shape(allocation, ['stageRoot', 'expectedTreeSha256', 'bootstrapFiles']);
    absolute(allocation.stageRoot); check(allocation.expectedTreeSha256 === tree.treeSha256, phase);
    const fixed = runtimeFixtureDeclaration();
    const scenario = ['normal', 'timeout', 'supervisor-loss', 'preexisting-writer', 'unknown-member'].find(name => runtimeFixtureDeclaration(name).stageRoot === allocation.stageRoot);
    check(scenario && tree.header.evidenceClass === 'synthetic-fixture' && tree.header.sourceRoot === `${fixed.fixtureRoot}\\source` &&
      tree.profile.document.paths.buildRoot === `${fixed.fixtureRoot}\\build`, 'FIXTURE');
    check(Array.isArray(allocation.bootstrapFiles) && allocation.bootstrapFiles.length === 2, phase);
    for (const root of [tree.header.sourceRoot, tree.profile.document.paths.buildRoot, ...Object.values(tree.profile.document.paths)]) disjoint(allocation.stageRoot, root);
    const members = new Map();
    function member(relativePath, source) {
      stagePath(allocation.stageRoot, relativePath); shape(source, ['path', 'size', 'sha256']); absolute(source.path);
      check(Number.isSafeInteger(source.size) && source.size >= 0 && source.size <= 100 * 1024 * 1024 && /^[a-f0-9]{64}$/.test(source.sha256), phase);
      const key = relativePath.toLowerCase(); const prior = members.get(key);
      check(!prior || (prior.relativePath === relativePath && prior.source.path === source.path && prior.source.size === source.size && prior.source.sha256 === source.sha256), 'COLLISION');
      if (!prior) members.set(key, { relativePath, source });
    }
    for (const file of tree.files) member(`${file.packageId}/${file.relativePath}`, { path: stagePath(tree.header.sourceRoot, `${file.packageId}/${file.relativePath}`), size: file.size, sha256: file.sha256 });
    for (const artifact of tree.profile.document.build.artifacts) member(`dist/${artifact.relativePath}`, {
      path: stagePath(tree.profile.document.paths.buildRoot, artifact.relativePath), size: artifact.size, sha256: artifact.sha256 });
    member('package.json', { path: stagePath(tree.header.sourceRoot, 'package.json'), ...tree.header.packageJson });
    member('package-lock.json', { path: stagePath(tree.header.sourceRoot, 'package-lock.json'), ...tree.header.packageLock });
    for (const file of tree.rootInventory.document.packageMetadata) {
      check(within(tree.header.sourceRoot, file.path), 'CONTROLLING_METADATA');
      member(path.win32.relative(tree.header.sourceRoot, file.path).replaceAll('\\', '/'), file);
    }
    for (const [index, name] of ['runtime-bootstrap.mjs', 'runtime-enforcement.mjs'].entries()) {
      const file = allocation.bootstrapFiles[index]; shape(file, ['source', 'relativePath']);
      check(file.relativePath === `.runtime/${name}` && path.win32.basename(file.source.path) === name && file.source.size <= 128 * 1024, phase);
      member(file.relativePath, file.source);
    }
    const files = Array.from(members.values()).sort((a, b) => a.relativePath < b.relativePath ? -1 : 1);
    check(files.length <= 33284 && files.reduce((sum, file) => sum + file.source.size, 0) <= 1013 * 1024 * 1024, 'BOUNDS');
    const directories = new Set();
    for (const file of files) { let directory = path.posix.dirname(file.relativePath); while (directory !== '.') { directories.add(directory); directory = path.posix.dirname(directory); } }
    for (const directory of tree.directories) directories.add(`${directory.packageId}/${directory.relativePath}`);
    const orderedDirectories = Array.from(directories).sort(); check(directories.size <= 24576, 'BOUNDS');
    for (const directory of orderedDirectories) check(!members.has(directory.toLowerCase()), 'COLLISION');
    const sourceNames = new Set(files.map(file => file.source.path));
    const checkedPaths = Array.from(new Set([...files.flatMap(file => ancestry(file.source.path)), ...ancestry(path.win32.dirname(allocation.stageRoot))]));
    const snapshots = new Map();
    function snapshot(name) {
      const node = fs.lstatSync(name, { bigint: true });
      check(!node.isSymbolicLink() && fs.realpathSync.native(name) === name && node.ino > 0n &&
        (sourceNames.has(name) ? node.isFile() && node.nlink === 1n : node.isDirectory()), 'SOURCE_IDENTITY'); return node;
    }
    phase = 'SOURCE_IDENTITY'; for (const name of checkedPaths) { tick(); snapshots.set(name, snapshot(name)); }
    // Existing Windows metadata helper has a 512-element canonical-array bound; batch explicitly.
    const metadata = new Map();
    for (let offset = 0; offset < checkedPaths.length; offset += 256) { tick(); for (const row of await readWindowsMetadata(checkedPaths.slice(offset, offset + 256), process.env.SystemRoot)) metadata.set(row.path, row); }
    for (const row of metadata.values()) check((row.attributes & 0x400) === 0 && row.directory === snapshots.get(row.path)?.isDirectory(), 'SOURCE_METADATA');
    for (const file of files) {
      tick();
      const fd = fs.openSync(file.source.path, fs.constants.O_RDONLY); opened.push(fd); file.descriptor = fd;
      check(identity(fs.fstatSync(fd, { bigint: true })) === identity(snapshots.get(file.source.path)), 'SOURCE_IDENTITY');
    }
    phase = 'CREATE_ROOT'; fs.mkdirSync(allocation.stageRoot); const rootIdentity = identity(fs.lstatSync(allocation.stageRoot, { bigint: true }));
    for (const name of orderedDirectories) { tick(); fs.mkdirSync(stagePath(allocation.stageRoot, name)); }
    phase = 'COPY';
    for (const file of files) {
      tick();
      const before = fs.fstatSync(file.descriptor, { bigint: true }); check(before.size === BigInt(file.source.size), 'SOURCE_BYTES');
      const bytes = Buffer.alloc(file.source.size); let offset = 0;
      while (offset < bytes.length) { tick(); const count = fs.readSync(file.descriptor, bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset); check(count > 0, 'SOURCE_BYTES'); offset += count; }
      check(sha(bytes) === file.source.sha256 && identity(before) === identity(fs.fstatSync(file.descriptor, { bigint: true })), 'SOURCE_BYTES');
      const destination = stagePath(allocation.stageRoot, file.relativePath); const fd = fs.openSync(destination, 'wx+');
      try {
        fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); const copy = Buffer.alloc(bytes.length); let position = 0;
        while (position < copy.length) { const count = fs.readSync(fd, copy, position, copy.length - position, position); check(count > 0, 'STAGE_BYTES'); position += count; }
        check(sha(copy) === file.source.sha256, 'STAGE_BYTES');
      } finally { fs.closeSync(fd); }
      const staged = fs.lstatSync(destination, { bigint: true }); check(staged.isFile() && !staged.isSymbolicLink() && staged.nlink === 1n && staged.size === BigInt(bytes.length) && fs.realpathSync.native(destination) === destination, 'STAGE_IDENTITY');
    }
    phase = 'POST';
    for (const name of checkedPaths) { tick(); check(identity(snapshot(name)) === identity(snapshots.get(name)), 'SOURCE_CHANGED'); }
    for (let offset = 0; offset < checkedPaths.length; offset += 256) {
      tick();
      const rows = await readWindowsMetadata(checkedPaths.slice(offset, offset + 256), process.env.SystemRoot);
      for (const row of rows) {
        const before = metadata.get(row.path);
        const stable = value => value.directory ? { path: value.path, directory: true, attributes: value.attributes, creationTicks: value.creationTicks } : value;
        check(before && JSON.stringify(stable(row)) === JSON.stringify(stable(before)), 'SOURCE_METADATA');
      }
    }
    check(identity(fs.lstatSync(allocation.stageRoot, { bigint: true })) === rootIdentity, 'STAGE_IDENTITY');
    const result = freeze({ kind: 'staged-runtime-package-tree', scenario, stageRoot: allocation.stageRoot, treeSha256: tree.treeSha256,
      evidenceClass: tree.header.evidenceClass, files: files.map(file => ({ relativePath: file.relativePath, size: file.source.size, sha256: file.source.sha256 })),
      directories: orderedDirectories, certifications: { custodyHeld: false, runtimeDependencyIdentity: false, executionAuthorized: false } });
    stages.add(result); return result;
  } catch (error) { if (/^RUNTIME_STAGE_REFUSED:/.test(error.message)) throw error; fail(phase); }
  finally { let failed = false; for (const fd of opened) { try { fs.closeSync(fd); } catch { failed = true; } } if (failed) fail('CLOSE'); }
}

/** Only genuine staging lineage can produce a request, and it can select only the fixed inert fixture. */
export function runtimeCustodyProtocol(stagedRecord) {
  const staged = requireRuntimeStage(stagedRecord); const declaration = runtimeFixtureDeclaration(staged.scenario);
  check(staged.evidenceClass === 'synthetic-fixture' && staged.stageRoot === declaration.stageRoot, 'FIXTURE');
  const files = staged.files.filter(file => !file.relativePath.startsWith('.runtime/'));
  const harness = staged.files.filter(file => file.relativePath.startsWith('.runtime/')).sort((a, b) => a.relativePath < b.relativePath ? -1 : 1);
  const text = JSON.stringify({ kind: 'pfa-inert-runtime-boundary', version: 1, fixtureId: declaration.fixtureId, scenario: staged.scenario, stageRoot: staged.stageRoot,
    treeSha256: staged.treeSha256, runtime: declaration.runtime, files,
    harness: [harness.find(file => file.relativePath === '.runtime/runtime-bootstrap.mjs'), harness.find(file => file.relativePath === '.runtime/runtime-enforcement.mjs')] });
  readRuntimeBoundaryProtocol(text, sha(text)); return freeze({ text, sha256: sha(text) });
}
