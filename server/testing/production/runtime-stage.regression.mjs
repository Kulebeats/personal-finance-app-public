import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { packageTreeFixture, packageTreeText } from './runtime-package-tree.regression.mjs';
import { collectRuntimePackageTreeCandidate, readRuntimePackageTree } from './runtime-package-tree.mjs';
import { readProductionManifest, canonicalJson, digest } from './manifest.mjs';
import { approvedFixturePins } from './manifest.fixture.mjs';
import { runtimeFixtureDeclaration } from './runtime-enforcement.mjs';

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const test = isEntry ? nodeTest : () => {};
if (isEntry && process.argv.length !== 2) throw new Error('RUNTIME_STAGE_REFUSED:ARGUMENTS');

const stage = await import('./runtime-stage.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
test('forged inventory refuses before allocation access, filesystem calls, helpers or children', async t => {
  assert.equal(typeof stage.stageRuntimePackageTree, 'function', 'private-lineage stage producer is implemented');
  let touched = 0;
  const deny = () => { touched++; throw new Error('UNEXPECTED_IO'); };
  for (const name of ['mkdirSync', 'openSync', 'lstatSync']) t.mock.method(fs, name, deny);
  t.mock.method(childProcess, 'execFile', deny);
  await assert.rejects(stage.stageRuntimePackageTree({ kind: 'validated-runtime-package-tree', unresolved: [] }, { get stageRoot() { touched++; return 'C:\\Forged'; } }), /RUNTIME_STAGE_REFUSED:LINEAGE/);
  assert.equal(touched, 0);
});
test('serialized stage results never recreate the private consumer brand', () => {
  assert.equal(typeof stage.requireRuntimeStage, 'function', 'private stage consumer is implemented');
  for (const value of [{ kind: 'staged-runtime-package-tree', executionAuthorized: true }, {}, null]) {
    assert.throws(() => stage.requireRuntimeStage(value), /RUNTIME_STAGE_REFUSED:LINEAGE/);
  }
});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function declaration(scoped = false, metadataOverlap = false, blocker = false) {
  const f = packageTreeFixture(); const fixed = runtimeFixtureDeclaration();
  const sourceRoot = `${fixed.fixtureRoot}\\source`; const buildRoot = `${fixed.fixtureRoot}\\build`;
  const from = 'node_modules/alpha'; const to = scoped ? 'node_modules/@scope/alpha' : from;
  const bytes = new Map(Array.from(f.bytes).filter(([name]) => !name.endsWith('empty.txt')).map(([name, text]) => [name.replace(from, to), text]));
  const manifestName = `${to}/package.json`; const packageJson = JSON.parse(bytes.get(manifestName));
  if (scoped) packageJson.name = '@scope/alpha'; bytes.set(manifestName, JSON.stringify(packageJson));
  const profileSource = structuredClone(f.profile.document); profileSource.paths.buildRoot = buildRoot;
  const virtual = new Map();
  const put = (name, text) => { virtual.set(name, { bytes: Buffer.from(text) }); return { path: name, size: Buffer.byteLength(text), sha256: sha(text) }; };
  const sourcePin = name => put(path.win32.join(sourceRoot, ...name.split('/')), bytes.get(name));
  for (const artifact of profileSource.build.artifacts) {
    const text = artifact.role === 'server-entry' ? 'globalThis.STAGE_ENTRY_EVALUATED = true;\n' : `/* inert ${artifact.relativePath} */\n`;
    const pin = put(path.win32.join(buildRoot, ...artifact.relativePath.split('/')), text); artifact.size = pin.size; artifact.sha256 = pin.sha256;
  }
  const profileText = canonicalJson(profileSource);
  const profile = readProductionManifest(profileText, { ...approvedFixturePins, expectedManifestSha256: digest(profileText),
    expectedArtifactsSha256: digest(canonicalJson(profileSource.build.artifacts)) });
  const root = structuredClone(f.root); root.manifestSha256 = profile.manifestSha256;
  root.dependencyRoots = [`${sourceRoot}\\node_modules`]; root.packageMetadata = [sourcePin('package.json')];
  root.edges[0].specifier = scoped ? '@scope/alpha' : 'alpha'; root.edges[0].target.file = sourcePin(`${to}/index.mjs`);
  if (metadataOverlap) root.packageMetadata.push(sourcePin(manifestName));
  root.packageMetadata.sort((a, b) => a.path < b.path ? -1 : 1);
  const rootText = canonicalJson(root); const rootInput = { text: rootText, pins: { expectedInventorySha256: digest(rootText), manifestSha256: profile.manifestSha256,
    runId: root.runId, buildCommitSha: root.buildCommitSha, harnessCommitSha: root.harnessCommitSha, evidenceClass: root.evidenceClass, approvalRef: root.approvalRef } };
  const rows = structuredClone(f.rows).filter(row => row.record !== 'directory' && !(row.record === 'file' && row.assetKind === 'opaque'));
  const header = rows[0]; header.sourceRoot = sourceRoot; header.profileManifestSha256 = profile.manifestSha256; header.rootInventorySha256 = digest(rootText);
  header.counts.directories = 0;
  for (const row of rows) {
    if (row.packageId === from) row.packageId = to;
    if (row.from === from) row.from = to; if (row.target === from) row.target = to;
    if (scoped && row.name === 'alpha') row.name = '@scope/alpha';
    if (row.record === 'file') { const pin = sourcePin(`${row.packageId}/${row.relativePath}`); row.size = pin.size; row.sha256 = pin.sha256; }
    if (row.record === 'package') { const pin = sourcePin(`${row.packageId}/package.json`); row.manifestSize = pin.size; row.manifestSha256 = pin.sha256; }
  }
  const lock = sourcePin('package-lock.json'); sourcePin('package.json');
  header.packageJson = { size: root.packageMetadata.find(pin => pin.path === `${sourceRoot}\\package.json`).size, sha256: sha(bytes.get('package.json')) };
  header.packageLock = { size: lock.size, sha256: lock.sha256 };
  header.counts.files = rows.filter(row => row.record === 'file').length;
  header.counts.bytes = rows.filter(row => row.record === 'file').reduce((sum, row) => sum + row.size, 0);
  if (blocker) { header.counts.unresolved = 1; rows.push({ record: 'unresolved', reason: 'unsupported-topology', sourceRef: 'fixture-owned', required: true }); }
  const text = packageTreeText(rows); const pins = { expectedTreeSha256: sha(text), profileManifestSha256: profile.manifestSha256,
    rootInventorySha256: digest(rootText), runId: root.runId, buildCommitSha: root.buildCommitSha, harnessCommitSha: root.harnessCommitSha,
    evidenceClass: root.evidenceClass, approvalRef: root.approvalRef };
  const accepted = readRuntimePackageTree(profile, rootInput, text, pins);
  const bootstrapFiles = ['runtime-bootstrap.mjs', 'runtime-enforcement.mjs'].map(name => ({ source: put(`C:\\OwnedHarness\\${name}`, `/* inert trusted ${name} */\n`), relativePath: `.runtime/${name}` }));
  return { accepted, virtual, allocation: { stageRoot: fixed.stageRoot, expectedTreeSha256: sha(text), bootstrapFiles } };
}
/** Inert declaration/helper only; importing this file registers no tests and creates no files. */
export function runtimeNativeFixtureInputs(scenario = 'normal') {
  const fixed = runtimeFixtureDeclaration(scenario); const sourceRoot = `${fixed.fixtureRoot}\\source`; const buildRoot = `${fixed.fixtureRoot}\\build`;
  const virtual = new Map();
  for (const file of fixed.files) {
    const name = file.relativePath.startsWith('dist/') ? path.win32.join(buildRoot, ...file.relativePath.slice(5).split('/'))
      : path.win32.join(sourceRoot, ...file.relativePath.split('/'));
    virtual.set(name, { bytes: Buffer.from(file.source) });
  }
  const filePin = name => ({ path: name, size: virtual.get(name).bytes.length, sha256: sha(virtual.get(name).bytes) });
  const inherited = packageTreeFixture(); const profileSource = structuredClone(inherited.profile.document); profileSource.paths.buildRoot = buildRoot;
  for (const artifact of profileSource.build.artifacts) Object.assign(artifact, { size: filePin(path.win32.join(buildRoot, ...artifact.relativePath.split('/'))).size,
    sha256: filePin(path.win32.join(buildRoot, ...artifact.relativePath.split('/'))).sha256 });
  const profileText = canonicalJson(profileSource); const profilePins = { ...approvedFixturePins,
    expectedManifestSha256: digest(profileText), expectedArtifactsSha256: digest(canonicalJson(profileSource.build.artifacts)) };
  const profile = readProductionManifest(profileText, profilePins);
  const root = structuredClone(inherited.root); root.manifestSha256 = profile.manifestSha256;
  root.dependencyRoots = [`${sourceRoot}\\node_modules`]; root.runtime = { ...fixed.runtime, flag: '--experimental-import-meta-resolve' };
  root.packageMetadata = [filePin(`${sourceRoot}\\package.json`)]; root.uncoveredNonliteral = [{ sourceRef: 'fixture-computed-import', reason: 'computed-runtime-specifier' }];
  root.edges = [
    { kind: 'import-statement', specifier: 'fixture-pkg', occurrences: 1, target: { kind: 'file', file: filePin(`${sourceRoot}\\node_modules\\fixture-pkg\\import.js`) } },
    { kind: 'import-statement', specifier: 'fixture-pkg/data.json', occurrences: 1, target: { kind: 'file', file: filePin(`${sourceRoot}\\node_modules\\fixture-pkg\\data.json`) } },
    ...['node:assert/strict', 'node:module'].map(name => ({ kind: 'import-statement', specifier: name, occurrences: 1, target: { kind: 'builtin', name } })),
  ];
  const rootText = canonicalJson(root); const rootInput = { text: rootText, pins: { expectedInventorySha256: digest(rootText), manifestSha256: profile.manifestSha256,
    runId: root.runId, buildCommitSha: root.buildCommitSha, harnessCommitSha: root.harnessCommitSha, evidenceClass: root.evidenceClass, approvalRef: root.approvalRef } };
  const bootstrapFiles = ['runtime-bootstrap.mjs', 'runtime-enforcement.mjs'].map(name => {
    const filename = new URL(name, import.meta.url); const actual = fs.readFileSync(filename); const sourceName = fileURLToPath(filename);
    virtual.set(sourceName, { bytes: actual }); return { source: filePin(sourceName), relativePath: `.runtime/${name}` };
  });
  const packageFiles = fixed.files.filter(file => file.relativePath.startsWith('node_modules/fixture-pkg/'));
  const manifest = packageFiles.find(file => file.relativePath.endsWith('/package.json'));
  const small = pin => ({ size: pin.size, sha256: pin.sha256 });
  const expectedRows = [
    { record: 'header', kind: 'pfa-runtime-package-tree', version: 1, evidenceClass: root.evidenceClass, runId: root.runId,
      profileManifestSha256: profile.manifestSha256, rootInventorySha256: digest(rootText), buildCommitSha: root.buildCommitSha,
      harnessCommitSha: root.harnessCommitSha, approvalRef: root.approvalRef, metafileSha256: root.metafile.file.sha256,
      packageJson: small(filePin(`${sourceRoot}\\package.json`)), packageLock: small(filePin(`${sourceRoot}\\package-lock.json`)), sourceRoot,
      runtime: fixed.runtime, counts: { packages: 1, edges: 2, directories: 0, files: packageFiles.length, bytes: packageFiles.reduce((sum, file) => sum + file.size, 0), unresolved: 0 } },
    { record: 'package', packageId: 'node_modules/fixture-pkg', name: 'fixture-pkg', version: '1.0.0', manifestSize: manifest.size, manifestSha256: manifest.sha256, type: 'module' },
    ...['fixture-pkg', 'fixture-pkg/data.json'].map(name => ({ record: 'dependency-edge', from: '$root', name, range: '', edgeClass: 'root-import', target: 'node_modules/fixture-pkg', status: 'resolved' })),
    ...packageFiles.map(file => ({ record: 'file', packageId: 'node_modules/fixture-pkg', relativePath: file.relativePath.slice('node_modules/fixture-pkg/'.length),
      size: file.size, sha256: file.sha256, assetKind: file.relativePath.endsWith('.json') ? 'json' : file.relativePath.endsWith('.cjs') ? 'commonjs' : 'module' })),
  ];
  const expectedText = packageTreeText(expectedRows);
  const accept = text => readRuntimePackageTree(profile, rootInput, text, { expectedTreeSha256: sha(expectedText), profileManifestSha256: profile.manifestSha256,
    rootInventorySha256: digest(rootText), runId: root.runId, buildCommitSha: root.buildCommitSha, harnessCommitSha: root.harnessCommitSha,
    evidenceClass: root.evidenceClass, approvalRef: root.approvalRef });
  return { virtual, profile, profileText, profilePins, root, rootInput, expectedText, expectedTreeSha256: sha(expectedText), accept, options: { sourceRoot, systemRoot: process.env.SystemRoot, packageJson: filePin(`${sourceRoot}\\package.json`),
    packageLock: filePin(`${sourceRoot}\\package-lock.json`) }, allocation: { stageRoot: fixed.stageRoot, expectedTreeSha256: 'a'.repeat(64), bootstrapFiles } };
}
function fakeStage(t, options = {}) {
  const f = options.nativeFixture ? runtimeNativeFixtureInputs() : declaration(options.scoped, options.metadataOverlap); const directories = new Map(); let serial = 10n;
  const parents = name => { let next = path.win32.dirname(name); while (!directories.has(next)) { directories.set(next, serial++); const parent = path.win32.dirname(next); if (parent === next) break; next = parent; } };
  for (const [name, value] of f.virtual) { value.ino = serial++; parents(name); }
  parents(f.allocation.stageRoot);
  const helper = path.win32.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  f.virtual.set(helper, { bytes: Buffer.from('metadata helper'), ino: serial++ }); parents(helper);
  const descriptors = new Map(); const state = { ...f, directories, descriptors, writes: [], opens: [], mkdirs: [], metadataCalls: 0, onRead() {}, onMkdir() {} };
  const stat = name => {
    const file = f.virtual.get(name); const directory = directories.has(name);
    if (!file && !directory) { const error = new Error('absent'); error.code = 'ENOENT'; throw error; }
    return { dev: 1n, ino: file?.ino ?? directories.get(name), nlink: 1n, mode: file ? 33206n : 16877n, size: BigInt(file?.bytes.length ?? 0),
      birthtimeNs: 1000000000n, ctimeNs: 1000000000n, mtimeNs: 1000000000n, isFile: () => Boolean(file), isDirectory: () => !file, isSymbolicLink: () => false };
  };
  t.mock.method(fs, 'lstatSync', stat); t.mock.method(fs.realpathSync, 'native', name => name);
  t.mock.method(fs, 'opendirSync', name => {
    const names = Array.from(new Set([...f.virtual.keys(), ...directories.keys()])).filter(file => file !== name && path.win32.dirname(file) === name).map(file => path.win32.basename(file)); let cursor = 0;
    return { readSync: () => cursor < names.length ? { name: names[cursor++] } : null, closeSync() {} };
  });
  t.mock.method(fs, 'mkdirSync', name => {
    state.onMkdir(name); assert.ok(directories.has(path.win32.dirname(name))); assert.equal(directories.has(name) || f.virtual.has(name), false);
    directories.set(name, serial++); state.mkdirs.push(name);
  });
  t.mock.method(fs, 'openSync', (name, flags) => {
    state.opens.push({ name, flags });
    if (flags === 'wx+') {
      assert.equal(f.virtual.has(name), false); assert.ok(directories.has(path.win32.dirname(name))); f.virtual.set(name, { bytes: Buffer.alloc(0), ino: serial++ });
    } else assert.equal(flags, fs.constants.O_RDONLY);
    assert.ok(f.virtual.has(name)); const fd = Number(serial++); descriptors.set(fd, name); return fd;
  });
  t.mock.method(fs, 'fstatSync', fd => stat(descriptors.get(fd)));
  t.mock.method(fs, 'readSync', (fd, bytes, offset, length, position) => { const name = descriptors.get(fd); state.onRead(name); return f.virtual.get(name).bytes.copy(bytes, offset, position, position + length); });
  t.mock.method(fs, 'writeFileSync', (fd, bytes) => { const name = descriptors.get(fd); state.writes.push(name); f.virtual.get(name).bytes = Buffer.from(bytes); });
  t.mock.method(fs, 'fsyncSync', () => {}); t.mock.method(fs, 'closeSync', fd => { assert.ok(descriptors.delete(fd)); });
  t.mock.method(childProcess, 'execFile', (_executable, _args, _options, callback) => {
    state.metadataCalls++;
    return { stdin: { on() {}, end(input) { const rows = JSON.parse(input).map(name => { const node = stat(name); return {
      path: name, directory: node.isDirectory(), attributes: node.isDirectory() ? 16 : 32,
      size: String(node.size), creationTicks: '621355968010000000', writeTicks: '621355968010000000' }; }); queueMicrotask(() => callback(null, JSON.stringify(rows))); } } };
  });
  state.stage = (record = f.accepted, allocation = f.allocation) => stage.stageRuntimePackageTree(record, allocation); return state;
}
test('genuine private tree stages an exact create-only union and closes all descriptors', async t => {
  const f = fakeStage(t); const result = await f.stage();
  assert.equal(stage.requireRuntimeStage(result), result); assert.equal(result.certifications.executionAuthorized, false);
  assert.equal(result.files.length, f.accepted.files.length + f.accepted.profile.document.build.artifacts.length + 4);
  assert.equal(f.descriptors.size, 0); assert.equal(f.mkdirs[0], f.allocation.stageRoot);
  for (const write of f.writes) assert.ok(write.startsWith(`${f.allocation.stageRoot}\\`));
  assert.throws(() => stage.requireRuntimeStage(structuredClone(result)), /RUNTIME_STAGE_REFUSED:LINEAGE/);
  assert.throws(() => stage.runtimeCustodyProtocol(result), /RUNTIME_BOUNDARY_REFUSED:PROTOCOL/);
});
test('scoped package paths stage with the private reader without widening v1 paths', async t => {
  const f = fakeStage(t, { scoped: true }); const result = await f.stage();
  assert.ok(result.files.some(file => file.relativePath === 'node_modules/@scope/alpha/index.mjs')); assert.equal(f.descriptors.size, 0);
});
test('overlapping package metadata pins compare fields despite canonical key reordering', async t => {
  const f = fakeStage(t, { metadataOverlap: true }); const result = await f.stage();
  assert.equal(result.files.filter(file => file.relativePath === 'node_modules/alpha/package.json').length, 1);
});
test('source byte drift aborts the copy and preserves only the owned partial allocation', async t => {
  const f = fakeStage(t); const name = f.accepted.rootInventory.document.packageMetadata[0].path;
  f.onRead = source => { if (source === name) f.virtual.get(source).bytes[0] ^= 1; };
  await assert.rejects(f.stage(), /RUNTIME_STAGE_REFUSED:SOURCE_BYTES/);
  assert.equal(f.descriptors.size, 0); assert.equal(f.directories.has(f.allocation.stageRoot), true);
  assert.ok(f.writes.every(name => name.startsWith(`${f.allocation.stageRoot}\\`)));
});
test('interrupted create-only allocation closes descriptors and never adopts the partial root', async t => {
  const f = fakeStage(t); let calls = 0; f.onMkdir = () => { if (++calls === 2) throw new Error('interrupted'); };
  await assert.rejects(f.stage(), /RUNTIME_STAGE_REFUSED:CREATE_ROOT/);
  assert.equal(f.descriptors.size, 0); assert.equal(f.writes.length, 0); assert.equal(f.directories.has(f.allocation.stageRoot), true);
  await assert.rejects(f.stage(), /RUNTIME_STAGE_REFUSED:CREATE_ROOT/);
});
test('genuine required blocker refuses before even reading allocation getters or filesystem/helper work', async t => {
  const f = declaration(false, false, true); let calls = 0;
  const deny = () => { calls++; throw new Error('UNEXPECTED_IO'); };
  for (const name of ['lstatSync', 'openSync', 'mkdirSync']) t.mock.method(fs, name, deny);
  t.mock.method(childProcess, 'execFile', deny);
  await assert.rejects(stage.stageRuntimePackageTree(f.accepted, { get stageRoot() { calls++; return 'forged'; } }), /RUNTIME_STAGE_REFUSED:CAPABILITY/);
  assert.equal(calls, 0); assert.equal(globalThis.STAGE_ENTRY_EVALUATED, undefined);
});
test('exact inert native fixture composes collector -> real reader -> stage -> closed custody protocol', async t => {
  const f = fakeStage(t, { nativeFixture: true });
  const candidate = await collectRuntimePackageTreeCandidate(f.profile, f.rootInput, f.options); assert.equal(candidate.status, 'candidate');
  assert.equal(candidate.text, f.expectedText, 'capture must equal the separately constructed finite fixture inventory before reader acceptance');
  const accepted = f.accept(candidate.text); f.allocation.expectedTreeSha256 = candidate.sha256;
  const staged = await f.stage(accepted); const protocol = stage.runtimeCustodyProtocol(staged);
  const value = JSON.parse(protocol.text); assert.equal(value.files.length, runtimeFixtureDeclaration().files.length);
  assert.equal(value.scenario, 'normal'); assert.equal(value.treeSha256, candidate.sha256);
  assert.equal(f.descriptors.size, 0); assert.equal(staged.certifications.executionAuthorized, false);
  assert.equal(globalThis.R20_ENTRY_SENTINEL, undefined);
});
