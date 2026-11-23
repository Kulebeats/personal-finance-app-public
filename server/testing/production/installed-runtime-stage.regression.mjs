import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { packageTreeFixture, packageTreeText } from './runtime-package-tree.regression.mjs';
import { readProductionManifest, canonicalJson, digest } from './manifest.mjs';
import { approvedFixturePins } from './manifest.fixture.mjs';
import { readRuntimePackageTree, installedSharpTooling, installedGeneratedTooling } from './runtime-package-tree.mjs';
import os from 'node:os';
// The Windows profile the custody fixtures live under, from the process token (os.userInfo),
// not USERPROFILE, which the fixed children override; a neutral placeholder off Windows.
const windowsProfile = process.platform === 'win32' ? os.userInfo().homedir : 'C:\\Users\\example';

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const test = isEntry ? nodeTest : () => {};
const stage = await import('./installed-runtime-stage.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./installed-runtime-stage.mjs', import.meta.url).href) return {};
  throw error;
});
const sha = value => createHash('sha256').update(value).digest('hex');
const canonicalRoot = `${windowsProfile}\\.codex\\worktrees\\capital-completion-v2\\personal-finance-app`;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const native = 'node_modules/@img/sharp-win32-arm64';
const sharp = 'node_modules/sharp'; const geo = 'node_modules/fast-geoip';
const nativeNames = ['libvips-42.dll', 'libvips-cpp-8.18.7.dll', 'sharp-win32-arm64-0.35.5.node'];
const controls = [`${sharp}/package.json`, ...['index', 'constructor', 'sharp', 'libvips'].flatMap(n => ['mjs', 'cjs'].map(ext => `${sharp}/dist/${n}.${ext}`)),
  `${native}/package.json`, `${native}/index.cjs`, `${native}/versions.json`, `${geo}/package.json`, ...['index', 'utils', 'params'].map(n => `${geo}/build/${n}.js`)].sort(compare);

/** Inert consistency fixture only. Imports register no tests or filesystem work. */
export function installedRuntimeStageDeclaration({ generatedTooling = false, toolingVariation = '' } = {}) {
  const inherited = packageTreeFixture(), virtual = new Map();
  const put = (relativePath, bytes) => virtual.set(path.win32.join(canonicalRoot, ...relativePath.split('/')), { bytes: Buffer.from(bytes) });
  for (const name of controls) put(name, name.endsWith('.json') ? '{}' : '/* inert control, never evaluated */');
  for (const name of nativeNames) put(`${native}/lib/${name}`, 'inert native bytes, never loaded');
  for (const name of ['index.json', 'locations.json']) put(`${geo}/data/${name}`, '{}');
  put(`${sharp}/LICENSE`, 'inert opaque file');
  for (const name of ['package.json', 'package-lock.json']) put(name, name === 'package.json' ? '{"type":"module"}' : '{"lockfileVersion":3}');
  const pin = relativePath => { const bytes = virtual.get(path.win32.join(canonicalRoot, ...relativePath.split('/'))).bytes;
    return { relativePath, size: bytes.length, sha256: sha(bytes) }; };
  const profileSource = structuredClone(inherited.profile.document); profileSource.paths.buildRoot = `${canonicalRoot}\\dist`;
  for (const artifact of profileSource.build.artifacts) {
    put(`dist/${artifact.relativePath}`, 'globalThis.INSTALLED_APP_EVALUATED=true;');
    Object.assign(artifact, { size: pin(`dist/${artifact.relativePath}`).size, sha256: pin(`dist/${artifact.relativePath}`).sha256 });
  }
  const profileText = canonicalJson(profileSource);
  const profile = readProductionManifest(profileText, { ...approvedFixturePins, expectedManifestSha256: digest(profileText), expectedArtifactsSha256: digest(canonicalJson(profileSource.build.artifacts)) });
  const root = structuredClone(inherited.root); root.evidenceClass = 'declared-installed-candidate'; root.manifestSha256 = profile.manifestSha256;
  root.dependencyRoots = [`${canonicalRoot}\\node_modules`]; root.packageMetadata = [{ path: `${canonicalRoot}\\package.json`, ...pin('package.json') }];
  delete root.packageMetadata[0].relativePath;
  root.edges = [geo, sharp].map(id => { const relativePath = id === sharp ? `${sharp}/dist/index.mjs` : `${geo}/build/index.js`;
    const { size, sha256 } = pin(relativePath); return { kind: 'import-statement', specifier: id.slice(13), occurrences: 1,
      target: { kind: 'file', file: { path: path.win32.join(canonicalRoot, ...relativePath.split('/')), size, sha256 } } }; });
  const rootText = canonicalJson(root), rootInput = { text: rootText, pins: { expectedInventorySha256: digest(rootText), manifestSha256: profile.manifestSha256,
    runId: root.runId, buildCommitSha: root.buildCommitSha, harnessCommitSha: root.harnessCommitSha, evidenceClass: root.evidenceClass, approvalRef: root.approvalRef } };
  const packageIds = [native, geo, sharp].sort(compare);
  const packages = packageIds.map(packageId => { const f = pin(`${packageId}/package.json`); return { record: 'package', packageId,
    name: packageId.slice(13), version: '1.0.0', manifestSize: f.size, manifestSha256: f.sha256, type: 'commonjs' }; });
  const edges = [
    ...[geo, sharp].map(id => ({ record: 'dependency-edge', from: '$root', name: id.slice(13), range: '', edgeClass: 'root-import', target: id, status: 'resolved' })),
    { record: 'dependency-edge', from: sharp, name: '@img/sharp-win32-arm64', range: '*', edgeClass: 'optional', target: native, status: 'resolved' },
  ];
  const files = [], directories = new Map();
  for (const [location] of virtual) {
    const relativePath = path.win32.relative(canonicalRoot, location).replaceAll('\\', '/');
    const packageId = packageIds.find(id => relativePath.startsWith(`${id}/`)); if (!packageId) continue;
    const within = relativePath.slice(packageId.length + 1), f = pin(relativePath);
    const assetKind = ({ '.node': 'native-addon', '.dll': 'native-dll', '.mjs': 'module', '.cjs': 'commonjs', '.js': 'commonjs', '.json': 'json' })[path.posix.extname(within)] ?? 'opaque';
    files.push({ record: 'file', packageId, relativePath: within, size: f.size, sha256: f.sha256, assetKind });
    for (let dir = path.posix.dirname(within); dir !== '.'; dir = path.posix.dirname(dir)) directories.set(`${packageId}/${dir}`, { record: 'directory', packageId, relativePath: dir });
  }
  files.sort((a, b) => compare(`${a.packageId}/${a.relativePath}`, `${b.packageId}/${b.relativePath}`));
  const unresolved = nativeNames.map(name => ({ record: 'unresolved', reason: name.endsWith('.node') ? 'native-addon' : 'native-dll', sourceRef: `${native}/lib/${name}`, required: true }));
  unresolved.push({ record: 'unresolved', reason: 'opaque-data', sourceRef: `${geo}/data`, required: true });
  const toolingGroups = generatedTooling === 'all' ? installedGeneratedTooling : generatedTooling ? [installedSharpTooling] : [];
  const toolingRows = toolingGroups.flatMap(group => group.files.map(file => ({ record: 'unresolved', reason: 'opaque-data',
    sourceRef: `generated-tooling-not-staged:${group.directory}/${file.name}:${file.size}:${file.sha256}`, required: true })));
  if (toolingVariation === 'partial') toolingRows.pop();
  if (toolingVariation === 'changed') toolingRows.at(-1).sourceRef = toolingRows.at(-1).sourceRef.replace(/.$/, '0');
  if (toolingVariation === 'unknown') toolingRows.push({ record: 'unresolved', reason: 'opaque-data',
    sourceRef: 'generated-tooling-not-staged:node_modules/unknown/node_modules/.bin/tool:1:' + 'a'.repeat(64), required: true });
  unresolved.push(...toolingRows);
  unresolved.sort((a, b) => compare(`${a.reason}\0${a.sourceRef}`, `${b.reason}\0${b.sourceRef}`));
  const header = { ...structuredClone(inherited.header), evidenceClass: root.evidenceClass, sourceRoot: canonicalRoot,
    profileManifestSha256: profile.manifestSha256, rootInventorySha256: digest(rootText),
    packageJson: { size: pin('package.json').size, sha256: pin('package.json').sha256 }, packageLock: { size: pin('package-lock.json').size, sha256: pin('package-lock.json').sha256 },
    counts: { packages: packages.length, edges: edges.length, directories: directories.size, files: files.length,
      bytes: files.reduce((sum, f) => sum + f.size, 0), unresolved: unresolved.length } };
  const treeText = packageTreeText([header, ...packages, ...edges, ...Array.from(directories.values()).sort((a, b) => compare(`${a.packageId}/${a.relativePath}`, `${b.packageId}/${b.relativePath}`)), ...files, ...unresolved]);
  const accepted = readRuntimePackageTree(profile, rootInput, treeText, { ...inherited.pins(), evidenceClass: root.evidenceClass,
    expectedTreeSha256: sha(treeText), profileManifestSha256: profile.manifestSha256, rootInventorySha256: digest(rootText) });
  const nativeRows = [...controls.map(name => ({ record: 'control-file', ...pin(name) })),
    ...nativeNames.map(name => ({ record: 'native-file', ...pin(`${native}/lib/${name}`), machine: 'arm64', format: 'PE32+' })),
    ...['index.json', 'locations.json'].map(name => ({ record: 'data-file', ...pin(`${geo}/data/${name}`) }))];
  nativeRows.sort((a, b) => compare(`${a.record}:${a.relativePath}::`, `${b.record}:${b.relativePath}::`));
  const nativeHeader = { record: 'header', kind: 'pfa-installed-native-data', version: 1, evidenceClass: 'static-file-snapshot', sourceLayout: 'node_modules',
    selection: 'sharp-0.35.5-win32-arm64+fast-geoip-1.1.88', counts: { controls: controls.length, nativeFiles: 3, dataFiles: 2, dataBytes: 4,
      totalBytes: nativeRows.reduce((sum, row) => sum + row.size, 0) }, absentProbes: [`${sharp}/src/build`, 'node_modules/@img/sharp-wasm32'],
    dataReadPattern: 'whole-json-or-locations-range-112n+1:111', remaining: ['windows-loader-path-observation', 'native-file-custody', 'data-read-consumer', 'installed-stage-integration', 'runtime-selection-input-enforcement'] };
  const nativeText = [nativeHeader, ...nativeRows].map(row => canonicalJson(row)).join('\n') + '\n';
  const bootstrapFiles = ['bootstrap', 'component', 'data', 'loading'].map(name => {
    const relativePath = `.runtime/runtime-installed-${name}.mjs`, source = `C:\\OwnedHarness\\runtime-installed-${name}.mjs`, bytes = Buffer.from('/* inert trusted component closure */');
    virtual.set(source, { bytes }); return { relativePath, source: { path: source, size: bytes.length, sha256: sha(bytes) } };
  });
  return { accepted, virtual, nativeInput: { text: nativeText, expectedSha256: sha(nativeText) },
    allocation: { stageRoot: `${canonicalRoot}\\.local\\r20-installed-component-oct28a\\cases\\normal\\stage`, expectedTreeSha256: accepted.treeSha256, bootstrapFiles } };
}

/** Shared pure-test composer: executes the genuine stage with fake I/O, never a forged brand. */
export function installedRuntimeStageFixture(t, change = () => {}, options = {}) {
  const f = installedRuntimeStageDeclaration(options), directories = new Map(), descriptors = new Map(); let serial = 10n;
  const parents = name => { for (let current = path.win32.dirname(name); ; current = path.win32.dirname(current)) { if (!directories.has(current)) directories.set(current, serial++); if (path.win32.dirname(current) === current) break; } };
  for (const [name, value] of f.virtual) { value.ino = serial++; parents(name); }
  parents(f.allocation.stageRoot);
  const helper = path.win32.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  f.virtual.set(helper, { bytes: Buffer.from('inert metadata helper'), ino: serial++ }); parents(helper);
  const state = { ...f, directories, descriptors, opens: [], writes: [], mkdirs: [], maxOpen: 0, onRead() {}, onMkdir() {}, onMetadata() {} };
  const stat = name => {
    const file = f.virtual.get(name), directory = directories.has(name);
    if (!file && !directory) { const error = new Error('absent'); error.code = 'ENOENT'; throw error; }
    return { dev: 1n, ino: file?.ino ?? directories.get(name), nlink: file?.nlink ?? 1n, mode: file ? 33206n : 16877n, size: BigInt(file?.bytes.length ?? 0),
      birthtimeNs: 1000000000n, ctimeNs: file?.stamp ?? 1000000000n, mtimeNs: file?.stamp ?? 1000000000n,
      isFile: () => Boolean(file), isDirectory: () => !file, isSymbolicLink: () => false };
  };
  change(state);
  t.mock.method(fs, 'lstatSync', stat); t.mock.method(fs.realpathSync, 'native', name => name);
  t.mock.method(fs, 'mkdirSync', name => { state.onMkdir(name); assert.ok(directories.has(path.win32.dirname(name))); assert.equal(directories.has(name) || f.virtual.has(name), false); directories.set(name, serial++); state.mkdirs.push(name); });
  t.mock.method(fs, 'openSync', (name, flags) => {
    state.opens.push({ name, flags });
    if (flags === 'wx+') { assert.equal(f.virtual.has(name), false); assert.ok(directories.has(path.win32.dirname(name))); f.virtual.set(name, { bytes: Buffer.alloc(0), ino: serial++ }); }
    else assert.equal(flags, fs.constants.O_RDONLY);
    assert.ok(f.virtual.has(name)); const fd = Number(serial++); descriptors.set(fd, name); state.maxOpen = Math.max(state.maxOpen, descriptors.size); return fd;
  });
  t.mock.method(fs, 'fstatSync', fd => stat(descriptors.get(fd)));
  t.mock.method(fs, 'readSync', (fd, buffer, offset, length, position) => { const name = descriptors.get(fd); state.onRead(name); return f.virtual.get(name).bytes.copy(buffer, offset, position, position + length); });
  t.mock.method(fs, 'writeSync', (fd, buffer, offset, length, position) => {
    const name = descriptors.get(fd), file = f.virtual.get(name); const bytes = Buffer.alloc(Math.max(file.bytes.length, position + length)); file.bytes.copy(bytes); buffer.copy(bytes, position, offset, offset + length); file.bytes = bytes; state.writes.push(name); return length;
  });
  t.mock.method(fs, 'fsyncSync', () => {}); t.mock.method(fs, 'closeSync', fd => assert.ok(descriptors.delete(fd)));
  t.mock.method(fs, 'opendirSync', name => { const names = Array.from(new Set([...f.virtual.keys(), ...directories.keys()])).filter(file => file !== name && path.win32.dirname(file) === name).map(file => path.win32.basename(file)); let index = 0;
    return { readSync: () => index < names.length ? { name: names[index++] } : null, closeSync() {} }; });
  t.mock.method(childProcess, 'execFile', (_executable, _args, _options, callback) => ({ stdin: { on() {}, end(input) {
    state.onMetadata(); const rows = JSON.parse(input).map(name => { const node = stat(name); return { path: name, directory: node.isDirectory(), attributes: node.isDirectory() ? 16 : 32,
      size: String(node.size), creationTicks: '621355968010000000', writeTicks: String(621355968000000000n + node.mtimeNs / 100n) }; }); queueMicrotask(() => callback(null, JSON.stringify(rows)));
  } } }));
  state.stage = () => stage.stageInstalledRuntimePackageTree(state.accepted, state.nativeInput, state.allocation); return state;
}

test('forged installed tree refuses before allocation/native-input getters or filesystem work', async t => {
  assert.equal(typeof stage.stageInstalledRuntimePackageTree, 'function'); let calls = 0;
  t.mock.method(fs, 'lstatSync', () => { calls++; throw new Error('UNEXPECTED_IO'); });
  await assert.rejects(stage.stageInstalledRuntimePackageTree({}, { get text() { calls++; } }, { get stageRoot() { calls++; } }), /INSTALLED_RUNTIME_STAGE_REFUSED:LINEAGE/);
  assert.equal(calls, 0);
});

test('genuine joined whole tree stages inert native/data/build bytes with a distinct brand', async t => {
  const f = installedRuntimeStageFixture(t), result = await f.stage();
  assert.equal(stage.requireInstalledRuntimeStage(result), result); assert.equal(result.componentId, 'sharp-geoip-v1');
  assert.equal(result.entryRelativePath, 'dist/index.js'); assert.equal(result.componentEntryRelativePath, '.runtime/runtime-installed-component.mjs');
  assert.ok(result.files.some(row => row.assetKind === 'native-addon')); assert.ok(result.files.some(row => row.relativePath.endsWith('data/locations.json')));
  assert.equal(result.unresolved.length, 4); assert.deepEqual(Object.values(result.certifications), [false, false, false, false]);
  assert.deepEqual(result.absencePaths, result.absencePaths.slice().sort(compare));
  assert.equal(f.descriptors.size, 0); assert.ok(f.writes.every(name => name.startsWith(`${f.allocation.stageRoot}\\`)));
  assert.ok(f.maxOpen <= 2, 'whole tree staging never opens every package file at once');
  assert.throws(() => stage.requireInstalledRuntimeStage(structuredClone(result)), /INSTALLED_RUNTIME_STAGE_REFUSED:LINEAGE/);
  assert.equal(globalThis.INSTALLED_APP_EVALUATED, undefined);
});

test('changed independent native digest refuses before any allocation', async t => {
  const f = installedRuntimeStageFixture(t); f.nativeInput.expectedSha256 = 'f'.repeat(64);
  await assert.rejects(f.stage(), /INSTALLED_RUNTIME_STAGE_REFUSED:NATIVE_DATA/); assert.equal(f.mkdirs.length, 0);
});

test('native manifest byte mismatch cannot be repaired with its own regenerated digest', async t => {
  const f = installedRuntimeStageFixture(t); const rows = f.nativeInput.text.trimEnd().split('\n').map(JSON.parse);
  rows.find(row => row.record === 'native-file').sha256 = 'f'.repeat(64);
  f.nativeInput.text = rows.map(row => canonicalJson(row)).join('\n') + '\n'; f.nativeInput.expectedSha256 = sha(f.nativeInput.text);
  await assert.rejects(f.stage(), /INSTALLED_RUNTIME_STAGE_REFUSED:NATIVE_DATA/); assert.equal(f.mkdirs.length, 0);
});

test('same-byte source replacement preserves partial allocation and closes all handles', async t => {
  const f = installedRuntimeStageFixture(t); let changed = false;
  f.onRead = name => { if (!changed && name.endsWith('locations.json')) { changed = true; f.virtual.get(name).ino += 1n; } };
  await assert.rejects(f.stage(), /INSTALLED_RUNTIME_STAGE_REFUSED:SOURCE_BYTES/);
  assert.equal(f.descriptors.size, 0); assert.ok(f.directories.has(f.allocation.stageRoot));
});

test('preexisting stage root is never adopted or overwritten', async t => {
  const f = installedRuntimeStageFixture(t); f.directories.set(f.allocation.stageRoot, 9999n);
  await assert.rejects(f.stage(), /INSTALLED_RUNTIME_STAGE_REFUSED:CREATE_ROOT/);
  assert.equal(f.writes.length, 0); assert.equal(f.descriptors.size, 0);
});

test('raw source mutation fails its byte pin and retains only the owned partial allocation', async t => {
  const f = installedRuntimeStageFixture(t); let changed = false;
  f.onRead = name => { if (!changed && name === `${canonicalRoot}\\node_modules\\fast-geoip\\data\\locations.json`) { changed = true; f.virtual.get(name).bytes[0] ^= 1; } };
  await assert.rejects(f.stage(), /INSTALLED_RUNTIME_STAGE_REFUSED:SOURCE_BYTES/);
  assert.equal(f.descriptors.size, 0); assert.ok(f.directories.has(f.allocation.stageRoot));
});

test('late unknown staged member refuses even though every copied byte remains unchanged', async t => {
  const f = installedRuntimeStageFixture(t); let inserted = false;
  f.onRead = () => { if (!inserted) { inserted = true; f.virtual.set(`${f.allocation.stageRoot}\\unknown.js`, { bytes: Buffer.from('inert surprise'), ino: 99999n }); } };
  await assert.rejects(f.stage(), /INSTALLED_RUNTIME_STAGE_REFUSED:STAGE_MEMBERS/);
  assert.equal(f.descriptors.size, 0);
});

test('partial writes are completed and descriptor readback still matches every expected pin', async t => {
  const f = installedRuntimeStageFixture(t), write = fs.writeSync;
  t.mock.method(fs, 'writeSync', (fd, buffer, offset, length, position) => write(fd, buffer, offset, Math.min(length, 2), position));
  const result = await f.stage();
  assert.equal(stage.requireInstalledRuntimeStage(result), result); assert.equal(f.descriptors.size, 0);
  assert.ok(f.writes.length > result.files.length); assert.ok(f.maxOpen <= 2);
});

test('write-close timestamp materialization is captured after closing the destination handle', async t => {
  const f = installedRuntimeStageFixture(t), close = fs.closeSync;
  t.mock.method(fs, 'closeSync', fd => {
    const name = f.descriptors.get(fd); close(fd);
    if (name.startsWith(`${f.allocation.stageRoot}\\`)) f.virtual.get(name).stamp = 1000000100n;
  });
  const result = await f.stage(); assert.equal(stage.requireInstalledRuntimeStage(result), result);
  assert.equal(f.descriptors.size, 0);
});

test('same-byte destination replacement on close still refuses after the timestamp correction', async t => {
  const f = installedRuntimeStageFixture(t), close = fs.closeSync; let replaced = false;
  t.mock.method(fs, 'closeSync', fd => {
    const name = f.descriptors.get(fd); close(fd);
    if (!replaced && name.startsWith(`${f.allocation.stageRoot}\\`)) { replaced = true; f.virtual.get(name).ino += 1n; }
  });
  await assert.rejects(f.stage(), /INSTALLED_RUNTIME_STAGE_REFUSED:STAGE_IDENTITY/); assert.equal(f.descriptors.size, 0);
});

test('failed write/readback preparation closes both held descriptors without a stage brand', async t => {
  const f = installedRuntimeStageFixture(t);
  t.mock.method(fs, 'fsyncSync', () => { throw new Error('inert disk failure'); });
  await assert.rejects(f.stage(), /INSTALLED_RUNTIME_STAGE_REFUSED:SOURCE_BYTES/);
  assert.equal(f.descriptors.size, 0); assert.ok(f.directories.has(f.allocation.stageRoot));
});

test('native input cannot omit a whole-tree data member under regenerated consistency pins', async t => {
  const f = installedRuntimeStageFixture(t), rows = f.nativeInput.text.trimEnd().split('\n').map(JSON.parse);
  const removed = rows.findIndex(row => row.record === 'data-file'); const [file] = rows.splice(removed, 1);
  rows[0].counts.dataFiles--; rows[0].counts.dataBytes -= file.size; rows[0].counts.totalBytes -= file.size;
  f.nativeInput.text = rows.map(row => canonicalJson(row)).join('\n') + '\n'; f.nativeInput.expectedSha256 = sha(f.nativeInput.text);
  await assert.rejects(f.stage(), /INSTALLED_RUNTIME_STAGE_REFUSED:NATIVE_DATA/); assert.equal(f.mkdirs.length, 0);
});

test('caller authority flags or a different stage namespace refuse before file operations', async t => {
  const f = installedRuntimeStageFixture(t); f.allocation.executionAuthorized = true;
  await assert.rejects(f.stage(), /INSTALLED_RUNTIME_STAGE_REFUSED:ALLOCATION/); assert.equal(f.opens.length, 0);
  delete f.allocation.executionAuthorized; f.allocation.stageRoot = `${canonicalRoot}\\.local\\unapproved-stage`;
  await assert.rejects(f.stage(), /INSTALLED_RUNTIME_STAGE_REFUSED:ALLOCATION/); assert.equal(f.opens.length, 0);
});

test('a late native fallback location invalidates the absence contract', async t => {
  const f = installedRuntimeStageFixture(t); let calls = 0;
  f.onRead = () => { if (++calls === 1) f.directories.set(`${canonicalRoot}\\node_modules\\sharp\\src\\build`, 99999n); };
  await assert.rejects(f.stage(), /INSTALLED_RUNTIME_STAGE_REFUSED:ABSENCE/); assert.equal(f.descriptors.size, 0);
});

test('explicit non-staged command shims produce a sorted staged .bin absence', async t => {
  const f = installedRuntimeStageFixture(t, () => {}, { generatedTooling: true }), result = await f.stage();
  assert.ok(result.absencePaths.includes(installedSharpTooling.directory));
  assert.deepEqual(result.absencePaths, result.absencePaths.slice().sort(compare));
  assert.equal(result.unresolved.filter(row => row.sourceRef.startsWith('generated-tooling-not-staged:')).length, 3);
  assert.equal(result.files.some(file => file.relativePath.startsWith(`${installedSharpTooling.directory}/`)), false);
  assert.equal(result.directories.includes(installedSharpTooling.directory), false);
});

test('both complete finite tooling groups retain six obligations and four sorted stage absences', async t => {
  const f = installedRuntimeStageFixture(t, () => {}, { generatedTooling: 'all' }), result = await f.stage();
  assert.deepEqual(result.absencePaths, [...installedGeneratedTooling.map(group => group.directory),
    `${sharp}/src/build`, 'node_modules/@img/sharp-wasm32'].sort(compare));
  assert.equal(result.unresolved.filter(row => row.sourceRef.startsWith('generated-tooling-not-staged:')).length, 6);
  for (const group of installedGeneratedTooling) {
    assert.equal(result.files.some(file => file.relativePath.startsWith(`${group.directory}/`)), false);
    assert.equal(result.directories.includes(group.directory), false);
  }
});

for (const variation of ['partial', 'changed', 'unknown']) test(`stage refuses ${variation} generated tooling obligations before allocation`, async t => {
  const f = installedRuntimeStageFixture(t, () => {}, { generatedTooling: 'all', toolingVariation: variation });
  await assert.rejects(f.stage(), /INSTALLED_RUNTIME_STAGE_REFUSED:TOOLING_DISPOSITION/);
  assert.equal(f.mkdirs.length, 0); assert.equal(f.opens.length, 0);
});
