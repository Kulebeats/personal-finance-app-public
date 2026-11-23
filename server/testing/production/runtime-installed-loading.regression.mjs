import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as api from './runtime-installed-loading.mjs';
import { installedRuntimeStageFixture } from './installed-runtime-stage.regression.mjs';
import { requireInstalledRuntimeStage } from './installed-runtime-stage.mjs';
import { readRuntimePackageTree } from './runtime-package-tree.mjs';
import { canonicalJson } from './manifest.mjs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
// The Windows profile the custody fixtures live under, from the process token (os.userInfo),
// not USERPROFILE, which the fixed children override; a neutral placeholder off Windows.
const windowsProfile = process.platform === 'win32' ? os.userInfo().homedir : 'C:\\Users\\example';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const base = `${windowsProfile}\\.codex\\worktrees\\capital-completion-v2\\personal-finance-app\\.local\\r20-installed-component-oct28a`;
const native = 'node_modules/@img/sharp-win32-arm64/lib/';
const addon = `${native}sharp-win32-arm64-0.35.5.node`;
const component = '.runtime/runtime-installed-component.mjs';
const runtime = { executable: { path: `${windowsProfile}\\AppData\\Local\\Packages\\OpenAI.Codex_2p2nqsd0c76g0\\LocalCache\\Local\\capital-r00-runtime\\node-v24.22.0-win-arm64\\node.exe`,
  size: 82123080, sha256: 'df4b0e71e4e4d022bf8582fbe75f6061feb9c4a111a86f3fec6300d24b6fe5e0' }, version: '24.22.0', platform: 'win32', arch: 'arm64' };
function fixture() {
  const bytes = new Map(['package.json', 'package-lock.json', 'dist/index.js', ...['bootstrap', 'component', 'loading', 'data'].map(name => `.runtime/runtime-installed-${name}.mjs`),
    'node_modules/sharp/package.json', 'node_modules/sharp/dist/sharp.mjs', 'node_modules/fast-geoip/package.json', 'node_modules/fast-geoip/build/index.js',
    'node_modules/fast-geoip/data/index.json', 'node_modules/fast-geoip/data/locations.json', addon, `${native}libvips-42.dll`, `${native}libvips-cpp-8.18.7.dll`]
    .map(name => [name, Buffer.from(name.endsWith('.json') ? '{}' : 'globalThis.INSTALLED_SENTINEL = true;')]));
  const directories = new Set();
  for (const name of bytes.keys()) { let parent = path.posix.dirname(name); while (parent !== '.') { directories.add(parent); parent = path.posix.dirname(parent); } }
  const document = { kind: 'pfa-installed-component-loading', version: 1, componentId: 'sharp-geoip-v1', scenario: 'normal', stageRoot: `${base}\\cases\\normal\\stage`,
    entryRelativePath: 'dist/index.js', componentEntryRelativePath: component,
    treeSha256: 'a'.repeat(64), rootInventorySha256: 'b'.repeat(64), profileManifestSha256: 'c'.repeat(64), buildCommitSha: 'd'.repeat(40), harnessCommitSha: 'e'.repeat(40), nativeDataSha256: 'f'.repeat(64), runtime,
    files: Array.from(bytes, ([relativePath, value]) => ({ relativePath, size: value.length, sha256: sha(value),
      assetKind: relativePath.endsWith('.node') ? 'native-addon' : relativePath.endsWith('.dll') ? 'native-dll' : relativePath.endsWith('.json') ? 'json' : relativePath.endsWith('index.js') && relativePath.startsWith('node_modules/') ? 'commonjs' : 'module' })).sort((a, b) => a.relativePath < b.relativePath ? -1 : 1),
    directories: Array.from(directories).sort(), absencePaths: ['node_modules/@img/sharp-wasm32', 'node_modules/sharp/node_modules/.bin', 'node_modules/sharp/src/build'] };
  const read = (value = document) => { const text = JSON.stringify(value); return api.readInstalledRuntimeLoadingProtocol(text, sha(text)); };
  return { bytes, document, read };
}
const refused = /INSTALLED_LOADING_REFUSED:/;
test('transport consistency keeps every authority certification false and frozen', () => {
  const f = fixture(); const record = f.read(); assert.equal(Object.isFrozen(record.document.files[0]), true);
  assert.deepEqual(record.certifications, { custodyHeld: false, runtimeDependencyIdentity: false, executionAuthorized: false });
  assert.throws(() => api.openInstalledRuntimeLoading(structuredClone(record)), /LINEAGE/);
});
for (const [name, mutate] of [
  ['application entry override', value => { value.componentEntryRelativePath = 'dist/index.js'; }],
  ['component scope override', value => { value.componentId = 'whole-app'; }],
  ['caller launch flag', value => { value.executionAuthorized = true; }],
  ['alternate allocation', value => { value.stageRoot += '-other'; }],
  ['runtime architecture', value => { value.runtime = { ...value.runtime, arch: 'x64' }; }],
  ['alias file', value => { value.files[0].relativePath = value.files[1].relativePath.toUpperCase(); }],
  ['missing trusted bootstrap', value => { value.files = value.files.filter(row => !row.relativePath.endsWith('bootstrap.mjs')); }],
  ['missing native sibling', value => { value.files = value.files.filter(row => !row.relativePath.endsWith('libvips-42.dll')); }],
  ['missing absence selection', value => { value.absencePaths.pop(); }],
  ['missing explicitly omitted command namespace', value => { value.absencePaths = value.absencePaths.filter(name => !name.endsWith('/.bin')); }],
]) test(`consistent caller hashes do not widen ${name}`, () => { const f = fixture(); mutate(f.document); assert.throws(() => f.read(), /PROTOCOL/); });
test('digest, duplicate-key and noncanonical bytes refuse', () => {
  const f = fixture(); const text = JSON.stringify(f.document);
  assert.throws(() => api.readInstalledRuntimeLoadingProtocol(text, '0'.repeat(64)), /PROTOCOL/);
  const duplicate = text.replace('"version":1', '"version":1,"version":1');
  assert.throws(() => api.readInstalledRuntimeLoadingProtocol(duplicate, sha(duplicate)), /PROTOCOL/);
});
test('producer canonical runtime metadata key order preserves exact field comparison', () => {
  const f = fixture(); f.document.runtime = { arch: runtime.arch, executable: { path: runtime.executable.path, sha256: runtime.executable.sha256, size: runtime.executable.size }, platform: runtime.platform, version: runtime.version };
  assert.equal(f.read().document.runtime.executable.sha256, runtime.executable.sha256);
});
test('forged stage cannot export a protocol and never invokes supplied getters', async () => {
  let touched = false; await assert.rejects(api.installedRuntimeLoadingProtocol({ get stageRoot() { touched = true; return 'ignored'; } }), /LINEAGE/); assert.equal(touched, false);
});
function fake(t) {
  const f = fixture(); const root = f.document.stageRoot; const paths = new Map(); const fds = new Map(); let serial = 100; let inode = 1n; let peak = 0;
  paths.set(root, { directory: true, ino: inode++ });
  for (const name of f.document.directories) paths.set(path.win32.join(root, ...name.split('/')), { directory: true, ino: inode++ });
  for (const [name, bytes] of f.bytes) paths.set(path.win32.join(root, ...name.split('/')), { bytes, ino: inode++ });
  const get = name => { const node = paths.get(name); if (!node) throw Object.assign(new Error('absent'), { code: 'ENOENT' }); return node; };
  const stat = node => ({ dev: 1n, ino: node.ino, mode: node.directory ? 16877n : 33206n, nlink: node.links ?? 1n, size: BigInt(node.bytes?.length ?? 0),
    birthtimeNs: 1n, ctimeNs: 1n, mtimeNs: 1n, isFile: () => !node.directory, isDirectory: () => !!node.directory, isSymbolicLink: () => !!node.symlink });
  t.mock.method(fs, 'lstatSync', name => stat(get(name)));
  t.mock.method(fs.realpathSync, 'native', name => { get(name); return name; });
  t.mock.method(fs, 'openSync', name => { const fd = serial++; fds.set(fd, { name, node: get(name) }); peak = Math.max(peak, fds.size); return fd; });
  t.mock.method(fs, 'fstatSync', fd => stat(fds.get(fd).node));
  t.mock.method(fs, 'readSync', (fd, buffer, offset, length, position) => fds.get(fd).node.bytes.copy(buffer, offset, position, position + length));
  t.mock.method(fs, 'closeSync', fd => assert.equal(fds.delete(fd), true));
  return { ...f, root, paths, fds, peak: () => peak, url: name => pathToFileURL(path.win32.join(root, ...name.split('/'))).href, open: () => api.openInstalledRuntimeLoading(f.read()) };
}
test('real descriptor hooks supply pinned ESM/CommonJS/JSON bytes and close all retained fds', t => {
  const f = fake(t); const boundary = f.open();
  assert.equal(f.peak(), 1, 'whole-stage preflight does not exhaust Node descriptors');
  for (const name of [component, 'node_modules/sharp/dist/sharp.mjs', 'node_modules/fast-geoip/build/index.js', 'node_modules/sharp/package.json']) {
    const file = f.document.files.find(row => row.relativePath === name); const result = boundary.hooks.load(f.url(name), { format: file.assetKind });
    assert.equal(result.format, file.assetKind); assert.equal(sha(result.source), file.sha256);
  }
  assert.equal(globalThis.INSTALLED_SENTINEL, undefined); boundary.close(); assert.equal(f.fds.size, 0);
});
test('staged application and noncomponent harness never enter the executable module set', t => {
  const f = fake(t); const boundary = f.open();
  for (const name of ['dist/index.js', '.runtime/runtime-installed-data.mjs']) assert.throws(() => boundary.hooks.load(f.url(name), { format: 'module' }), /MODULE_PATH/);
  assert.equal(boundary.violation(), 'MODULE_PATH');
  assert.equal(globalThis.INSTALLED_SENTINEL, undefined); assert.throws(boundary.evidence, /TAINTED/); boundary.close();
});
test('closer package metadata cannot redirect a known package to already pinned bytes', t => {
  const f = fake(t); const boundary = f.open(); let next = 0;
  f.paths.set(`${f.root}\\.runtime\\node_modules\\sharp`, { directory: true, ino: 900n });
  f.paths.set(`${f.root}\\.runtime\\node_modules\\sharp\\package.json`, { bytes: Buffer.from('{"main":"../../../node_modules/fast-geoip/build/index.js"}'), ino: 901n });
  assert.throws(() => boundary.hooks.resolve('sharp', { parentURL: f.url(component) }, () => { next++; return { url: f.url('node_modules/fast-geoip/build/index.js') }; }), /METADATA/);
  assert.equal(next, 0); assert.throws(boundary.evidence, /TAINTED/); assert.equal(globalThis.INSTALLED_SENTINEL, undefined); boundary.close();
});
test('declared Sharp absence probes stay ordinary missing while unknown modules poison', t => {
  const f = fake(t); const boundary = f.open(); const parentURL = f.url('node_modules/sharp/dist/sharp.mjs');
  assert.throws(() => boundary.hooks.resolve('../src/build/Release/sharp-win32-arm64-0.35.5.node', { parentURL }, () => assert.fail()), { code: 'MODULE_NOT_FOUND' });
  assert.equal(boundary.evidence().nativeLoads, 0);
  assert.throws(() => boundary.hooks.resolve('node:net', { parentURL }, () => assert.fail()), /CAPABILITY/); assert.throws(boundary.evidence, /TAINTED/); boundary.close();
});
test('native guard delegates only exact selected addon with revalidated sibling pins', t => {
  const f = fake(t); const boundary = f.open(); let calls = 0;
  const expected = path.win32.join(f.root, ...addon.split('/'));
  assert.equal(boundary.nativeLoad(() => { calls++; return 'native-result'; }, null, [{}, expected]), 'native-result');
  assert.equal(calls, 1); assert.equal(boundary.evidence().nativeLoads, 1); boundary.close();
});
test('native substitution and changed bytes poison even if callers swallow the refusal', t => {
  const f = fake(t); const boundary = f.open(); let calls = 0;
  assert.throws(() => boundary.nativeLoad(() => { calls++; }, null, [{}, `${f.root}\\other.node`]), /NATIVE_PATH/);
  assert.equal(boundary.violation(), 'NATIVE_PATH');
  assert.equal(calls, 0); assert.throws(boundary.evidence, /TAINTED/); boundary.close();
});
test('same-name file replacement and digest drift refuse before source supply and close fds', t => {
  const f = fake(t); const name = path.win32.join(f.root, ...component.split('/')); f.paths.get(name).bytes[0] ^= 1;
  assert.throws(f.open, /FILE_BYTES/); assert.equal(f.fds.size, 0);
});
test('closed boundaries refuse builtins, data and native operations', t => {
  const f = fake(t); const boundary = f.open(); boundary.close();
  assert.throws(() => boundary.hooks.load('node:module', {}), /CLOSED/); assert.throws(() => boundary.nativeLoad(() => {}, null, [{}, 'ignored']), /CLOSED/);
});
test('literal namespaced spelling still identifies only the exact selected native addon', t => {
  const f = fake(t); const boundary = f.open(); let calls = 0;
  const name = `\\\\?\\${path.win32.join(f.root, ...addon.split('/'))}`;
  boundary.nativeLoad(() => { calls++; }, null, [{}, name]); assert.equal(calls, 1); boundary.close();
});
test('same-byte named replacement after preflight refuses against retained descriptor identity', t => {
  const f = fake(t); const boundary = f.open(); const name = path.win32.join(f.root, ...component.split('/'));
  boundary.hooks.load(f.url(component), { format: 'module' }); f.paths.set(name, { ...f.paths.get(name), ino: 99999n });
  assert.throws(() => boundary.hooks.load(f.url(component), { format: 'module' }), /FILE_IDENTITY/); assert.throws(boundary.evidence, /TAINTED/); boundary.close();
});
test('caught missing-file IO after preflight poisons the final component result', t => {
  const f = fake(t); const boundary = f.open(); f.paths.delete(path.win32.join(f.root, ...component.split('/')));
  assert.throws(() => boundary.hooks.load(f.url(component), { format: 'module' }), /FILE_IO/);
  assert.throws(boundary.evidence, /TAINTED/); boundary.close(); assert.equal(f.fds.size, 0);
});
test('shared data violation keeps its original phase through a later generic health error', async t => {
  const f = fake(t); const boundary = f.open();
  await new Promise(resolve => boundary.data.fs.readFile(`${f.root}\\node_modules\\fast-geoip\\data\\unknown.json`, () => resolve()));
  assert.equal(boundary.violation(), 'DATA_PATH'); assert.throws(boundary.evidence, /TAINTED/);
  assert.equal(boundary.violation(), 'DATA_PATH'); boundary.close();
});
test('intentionally omitted Sharp tooling namespace must stay absent during admission', t => {
  const f = fake(t);
  const boundary = f.open(); f.paths.set(`${f.root}\\node_modules\\sharp\\node_modules\\.bin`, { directory: true, ino: 8899n });
  assert.throws(() => boundary.hooks.load(f.url(component), { format: 'module' }), /ABSENCE/);
  assert.equal(boundary.violation(), 'ABSENCE'); assert.throws(boundary.evidence, /ABSENCE/); boundary.close();
});

async function genuine(t) {
  const f = installedRuntimeStageFixture(t, () => {}, { generatedTooling: true });
  // The reusable producer fixture deliberately names an inert synthetic runtime.
  // Re-read consistent root/tree bytes with the actual component's fixed Node pins;
  // all brands below still come from production readers and the real stage function.
  const prior = f.accepted; const root = structuredClone(prior.rootInventory.document);
  root.runtime = { ...structuredClone(runtime), flag: root.runtime.flag };
  const rootText = canonicalJson(root); const header = structuredClone(prior.header);
  header.runtime = structuredClone(runtime); header.rootInventorySha256 = sha(rootText);
  const treeText = [header, ...prior.packages, ...prior.edges, ...prior.directories, ...prior.files, ...prior.unresolved].map(canonicalJson).join('\n') + '\n';
  f.accepted = readRuntimePackageTree(prior.profile, { text: rootText, pins: { expectedInventorySha256: sha(rootText), manifestSha256: prior.profile.manifestSha256,
    runId: root.runId, buildCommitSha: root.buildCommitSha, harnessCommitSha: root.harnessCommitSha, evidenceClass: root.evidenceClass, approvalRef: root.approvalRef } }, treeText,
  { expectedTreeSha256: sha(treeText), profileManifestSha256: prior.profile.manifestSha256, rootInventorySha256: sha(rootText),
    runId: header.runId, buildCommitSha: header.buildCommitSha, harnessCommitSha: header.harnessCommitSha, evidenceClass: header.evidenceClass, approvalRef: header.approvalRef });
  f.allocation.expectedTreeSha256 = f.accepted.treeSha256;
  const staged = await f.stage();
  assert.equal(requireInstalledRuntimeStage(staged), staged, 'fixture and exporter share the actual producer module identity');
  const transport = await api.installedRuntimeLoadingProtocol(staged);
  const record = api.readInstalledRuntimeLoadingProtocol(transport.text, transport.sha256);
  const url = name => pathToFileURL(path.win32.join(staged.stageRoot, ...name.split('/'))).href;
  return { ...f, staged, transport, record, url };
}
test('genuine producer stage exports exact ordered absences and canonical runtime metadata', async t => {
  const f = await genuine(t);
  assert.deepEqual(f.staged.absencePaths, ['node_modules/@img/sharp-wasm32', 'node_modules/sharp/node_modules/.bin', 'node_modules/sharp/src/build']);
  assert.deepEqual(Object.keys(f.staged.runtime), ['arch', 'executable', 'platform', 'version']);
  assert.deepEqual(f.record.document.runtime, f.staged.runtime);
  assert.deepEqual(f.record.document.absencePaths, f.staged.absencePaths);
  for (const name of ['treeSha256', 'rootInventorySha256', 'profileManifestSha256', 'buildCommitSha', 'harnessCommitSha', 'nativeDataSha256'])
    assert.equal(f.record.document[name], f.staged[name]);
  assert.equal(f.record.document.componentEntryRelativePath, component); assert.equal(f.record.document.entryRelativePath, 'dist/index.js');
  assert.equal(f.staged.unresolved.filter(row => row.sourceRef.startsWith('generated-tooling-not-staged:')).length, 3);
  assert.ok(Object.values(f.staged.certifications).every(value => value === false));
  assert.ok(Object.values(f.record.certifications).every(value => value === false));
  assert.equal(f.descriptors.size, 0); assert.equal(globalThis.INSTALLED_APP_EVALUATED, undefined);
});
test('genuine producer bytes compose into the consumer without evaluating staged sources', async t => {
  const f = await genuine(t); const boundary = api.openInstalledRuntimeLoading(f.record);
  try {
    const loaded = boundary.hooks.load(f.url(component), { format: 'module' });
    const expected = f.staged.files.find(file => file.relativePath === component);
    assert.equal(sha(loaded.source), expected.sha256); assert.equal(loaded.format, 'module');
    assert.equal(boundary.evidence().nativeLoads, 0); assert.equal(globalThis.INSTALLED_APP_EVALUATED, undefined);
    assert.throws(() => boundary.hooks.load(f.url('dist/index.js'), { format: 'module' }), /MODULE_PATH/);
    assert.equal(boundary.violation(), 'MODULE_PATH');
  } finally { boundary.close(); }
  assert.equal(f.descriptors.size, 0);
});
test('serialized genuine stages cannot export authority or reopen producer lineage', async t => {
  const f = await genuine(t); const opens = f.opens.length;
  await assert.rejects(api.installedRuntimeLoadingProtocol(structuredClone(f.staged)), /LINEAGE/);
  assert.equal(f.opens.length, opens); assert.equal(f.descriptors.size, 0);
});
test('rehashed genuine transport still refuses reversed absences and missing .bin', async t => {
  const f = await genuine(t);
  for (const change of [value => value.absencePaths.reverse(), value => { value.absencePaths = value.absencePaths.filter(name => !name.endsWith('/.bin')); }]) {
    const value = JSON.parse(f.transport.text); change(value); const text = JSON.stringify(value);
    assert.throws(() => api.readInstalledRuntimeLoadingProtocol(text, sha(text)), /PROTOCOL/);
  }
});
test('rehashed genuine runtime substitution refuses despite preserved producer pins', async t => {
  const f = await genuine(t); const value = JSON.parse(f.transport.text); value.runtime.executable.sha256 = '0'.repeat(64);
  const text = JSON.stringify(value); assert.throws(() => api.readInstalledRuntimeLoadingProtocol(text, sha(text)), /PROTOCOL/);
});
test('genuine staged metadata cannot redirect sharp to another already pinned package file', async t => {
  const f = await genuine(t); const boundary = api.openInstalledRuntimeLoading(f.record); let resolved = 0;
  const other = 'node_modules/fast-geoip/build/index.js';
  const pin = f.staged.files.find(file => file.relativePath === other);
  assert.equal(sha(boundary.hooks.load(f.url(other), { format: 'commonjs' }).source), pin.sha256, 'redirect target is admitted, real pinned stage bytes');
  const closer = `${f.staged.stageRoot}\\.runtime\\node_modules\\sharp`;
  f.directories.set(closer, 999001n);
  f.virtual.set(`${closer}\\package.json`, { bytes: Buffer.from('{"main":"../../../node_modules/fast-geoip/build/index.js"}'), ino: 999002n });
  try {
    assert.throws(() => boundary.hooks.resolve('sharp', { parentURL: f.url(component) }, () => { resolved++; return { url: f.url(other), format: 'commonjs' }; }), /METADATA/);
    assert.equal(resolved, 0); assert.equal(boundary.violation(), 'METADATA'); assert.throws(boundary.evidence, /TAINTED/);
    assert.equal(globalThis.INSTALLED_APP_EVALUATED, undefined);
  } finally { boundary.close(); }
  assert.equal(f.descriptors.size, 0);
});
test('real builtin-only Node API uses singular addon and denies it without the flag', () => {
  const source = 'console.log(JSON.stringify({addon:process.permission.has("addon"),addons:process.permission.has("addons"),write:process.permission.has("fs.write"),child:process.permission.has("child"),worker:process.permission.has("worker")}));';
  for (const enabled of [false, true]) {
    const probe = spawnSync(process.execPath, ['--permission', ...(enabled ? ['--allow-addons'] : []), '-e', source], {
      encoding: 'utf8', timeout: 5000, windowsHide: true,
      env: { SystemRoot: 'C:\\WINDOWS', TZ: 'UTC', TEMP: `${base}\\native-temp`, TMP: `${base}\\native-temp` },
    });
    assert.equal(probe.error, undefined); assert.equal(probe.status, 0); assert.equal(probe.signal, null);
    assert.deepEqual(JSON.parse(probe.stdout), { addon: enabled, addons: false, write: false, child: false, worker: false });
  }
});
function fakeProcess(t, record, mutate = () => {}) {
  const doc = record.document;
  const values = { execPath: runtime.executable.path, version: 'v24.22.0', platform: 'win32', arch: 'arm64',
    execArgv: ['--permission', `--allow-fs-read=${doc.stageRoot}`, '--allow-addons'],
    argv: [runtime.executable.path, path.win32.join(doc.stageRoot, '.runtime', 'runtime-installed-bootstrap.mjs'), record.protocolSha256],
    env: { PROCESSOR_ARCHITECTURE: 'ARM64', SystemRoot: 'C:\\WINDOWS', TEMP: `${base}\\native-temp`, TMP: `${base}\\native-temp`, TZ: 'UTC' },
    permission: { has: scope => scope === 'addon' } };
  mutate(values);
  for (const [name, value] of Object.entries(values)) {
    const original = Object.getOwnPropertyDescriptor(process, name); Object.defineProperty(process, name, { value, configurable: true, enumerable: true });
    t.after(() => original ? Object.defineProperty(process, name, original) : delete process[name]);
  }
}
test('cold process binding accepts only pinned physical runtime and false authority certifications', t => {
  const record = fixture().read(); fakeProcess(t, record); api.validateInstalledRuntimeProcess(record); assert.equal(record.certifications.executionAuthorized, false);
});
for (const [name, phase, mutate] of [
  ['runtime alias', 'RUNTIME', value => { value.execPath = 'C:\\Other\\node.exe'; }],
  ['wrong architecture', 'RUNTIME', value => { value.arch = 'x64'; }],
  ['preloaded module', 'ARGUMENTS', value => { value.execArgv.push('--import=unreviewed'); }],
  ['application entry', 'ARGUMENTS', value => { value.argv[1] = path.win32.join(value.env.TEMP, 'dist/index.js'); }],
  ['caller-consistent protocol override', 'ARGUMENTS', value => { value.argv[2] = '0'.repeat(64); }],
  ['ambient NODE_OPTIONS', 'ENVIRONMENT', value => { value.env.NODE_OPTIONS = '--import=unreviewed'; }],
  ['ambient executable search', 'ENVIRONMENT', value => { value.env.PATH = 'C:\\Other'; }],
  ['missing addon permission despite exact argv', 'PERMISSIONS', value => { value.permission.has = () => false; }],
  ['plural addons scope alone', 'PERMISSIONS', value => { value.permission.has = scope => scope === 'addons'; }],
  ['filesystem writes', 'PERMISSIONS', value => { value.permission.has = scope => scope === 'fs.write' || scope === 'addon'; }],
  ['child override', 'PERMISSIONS', value => { value.permission.has = scope => scope === 'child' || scope === 'addon'; }],
]) test(`cold binding refuses ${name}`, t => { const record = fixture().read(); fakeProcess(t, record, mutate); assert.throws(() => api.validateInstalledRuntimeProcess(record), new RegExp(`INSTALLED_LOADING_REFUSED:${phase}`)); });
