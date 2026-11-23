import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readProductionManifest, canonicalJson, digest } from './manifest.mjs';
import { manifestFixture, approvedFixturePins } from './manifest.fixture.mjs';

const entry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (entry && process.argv.length !== 2) throw new Error('RUNTIME_PACKAGE_TREE_REFUSED');
const test = entry ? nodeTest : () => {};
const tree = await import('./runtime-package-tree.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./runtime-package-tree.mjs', import.meta.url).href) return {};
  throw error;
});
const sha = value => createHash('sha256').update(value).digest('hex');
export const packageTreeText = rows => rows.map(row => canonicalJson(row)).join('\n') + '\n';

// Consistency declarations for pure/fake tests, never independently approved native pins.
export function packageTreeFixture() {
  const source = manifestFixture(); const profileText = canonicalJson(source);
  const profile = readProductionManifest(profileText, approvedFixturePins);
  const sourceRoot = 'C:\\Synthetic\\app';
  const bytes = new Map([
    ['package.json', '{"type":"module","dependencies":{"alpha":"1.0.0"}}'],
    ['package-lock.json', '{"lockfileVersion":3,"packages":{"node_modules/alpha":{"name":"alpha","version":"1.0.0"},"node_modules/beta":{"name":"beta","version":"1.0.0"}}}'],
    ['node_modules/alpha/package.json', JSON.stringify({ name: 'alpha', version: '1.0.0', type: 'module', dependencies: { beta: '1.0.0' }, optionalDependencies: { absent: '*' } })],
    ['node_modules/alpha/index.mjs', 'globalThis.PFA_TREE_EVALUATED = true; export default 1;'],
    ['node_modules/alpha/assets/empty.txt', ''],
    ['node_modules/beta/package.json', JSON.stringify({ name: 'beta', version: '1.0.0' })],
    ['node_modules/beta/index.cjs', 'globalThis.PFA_TREE_EVALUATED = true; module.exports = 2;'],
  ]);
  const file = relativePath => ({ path: path.win32.join(sourceRoot, ...relativePath.split('/')), size: Buffer.byteLength(bytes.get(relativePath)), sha256: sha(bytes.get(relativePath)) });
  const root = { kind: 'pfa-runtime-root-resolution', version: 1, evidenceClass: 'synthetic-fixture', manifestSha256: profile.manifestSha256,
    runId: source.runId, buildCommitSha: source.build.commitSha, harnessCommitSha: source.harnessCommitSha, approvalRef: source.approvalRef,
    runtime: { executable: { path: 'C:\\Synthetic\\runtime\\node.exe', size: 100, sha256: 'a'.repeat(64) }, version: '24.22.0', platform: 'win32', arch: 'arm64', flag: '--experimental-import-meta-resolve' },
    dependencyRoots: [`${sourceRoot}\\node_modules`], metafile: { file: { path: 'C:\\Synthetic\\metadata\\build.json', size: 20, sha256: 'b'.repeat(64) }, outputKey: 'dist/index.js' },
    packageMetadata: [file('package.json')], edges: [{ kind: 'import-statement', specifier: 'alpha', occurrences: 1, target: { kind: 'file', file: file('node_modules/alpha/index.mjs') } }], uncoveredNonliteral: [] };
  const rootInput = () => ({ text: canonicalJson(root), pins: { expectedInventorySha256: digest(canonicalJson(root)), manifestSha256: profile.manifestSha256,
    runId: root.runId, buildCommitSha: root.buildCommitSha, harnessCommitSha: root.harnessCommitSha, evidenceClass: root.evidenceClass, approvalRef: root.approvalRef } });
  const packages = ['alpha', 'beta'].map(name => { const pin = file(`node_modules/${name}/package.json`); return { record: 'package', packageId: `node_modules/${name}`, name,
    version: '1.0.0', manifestSize: pin.size, manifestSha256: pin.sha256, type: name === 'alpha' ? 'module' : 'commonjs' }; });
  const edges = [
    { record: 'dependency-edge', from: '$root', name: 'alpha', range: '', edgeClass: 'root-import', target: 'node_modules/alpha', status: 'resolved' },
    { record: 'dependency-edge', from: 'node_modules/alpha', name: 'absent', range: '*', edgeClass: 'optional', target: '', status: 'absent-optional' },
    { record: 'dependency-edge', from: 'node_modules/alpha', name: 'beta', range: '1.0.0', edgeClass: 'required', target: 'node_modules/beta', status: 'resolved' },
  ];
  const files = Array.from(bytes).filter(([name]) => name.startsWith('node_modules/')).map(([name, value]) => {
    const parts = name.split('/'); const relativePath = parts.slice(2).join('/'); return { record: 'file', packageId: parts.slice(0, 2).join('/'), relativePath,
      size: Buffer.byteLength(value), sha256: sha(value), assetKind: name.endsWith('.mjs') ? 'module' : name.endsWith('.cjs') ? 'commonjs' : name.endsWith('.json') ? 'json' : 'opaque' };
  }).sort((a, b) => { const x = `${a.packageId}/${a.relativePath}`; const y = `${b.packageId}/${b.relativePath}`; return x < y ? -1 : x > y ? 1 : 0; });
  const smallPin = name => { const pin = file(name); return { size: pin.size, sha256: pin.sha256 }; };
  const header = { record: 'header', kind: 'pfa-runtime-package-tree', version: 1, evidenceClass: root.evidenceClass, runId: root.runId,
    profileManifestSha256: profile.manifestSha256, rootInventorySha256: rootInput().pins.expectedInventorySha256, buildCommitSha: root.buildCommitSha,
    harnessCommitSha: root.harnessCommitSha, approvalRef: root.approvalRef, metafileSha256: root.metafile.file.sha256,
    packageJson: smallPin('package.json'), packageLock: smallPin('package-lock.json'), sourceRoot,
    runtime: { executable: root.runtime.executable, version: '24.22.0', platform: 'win32', arch: 'arm64' },
    counts: { packages: 2, edges: 3, directories: 1, files: files.length, bytes: files.reduce((sum, f) => sum + f.size, 0), unresolved: 0 } };
  const rows = [header, ...packages, ...edges, { record: 'directory', packageId: 'node_modules/alpha', relativePath: 'assets' }, ...files];
  const pins = (text = packageTreeText(rows)) => ({ expectedTreeSha256: sha(text), profileManifestSha256: profile.manifestSha256,
    rootInventorySha256: rootInput().pins.expectedInventorySha256, runId: root.runId, buildCommitSha: root.buildCommitSha,
    harnessCommitSha: root.harnessCommitSha, evidenceClass: root.evidenceClass, approvalRef: root.approvalRef });
  const read = (text = packageTreeText(rows), expected = pins(text), owner = profile, input = rootInput()) => {
    assert.equal(typeof tree.readRuntimePackageTree, 'function', 'the package superset reader is implemented');
    return tree.readRuntimePackageTree(owner, input, text, expected);
  };
  return { sourceRoot, profile, root, rootInput, header, packages, edges, files, rows, bytes, file, pins, read,
    options: { sourceRoot, systemRoot: 'C:\\Windows', packageJson: file('package.json'), packageLock: file('package-lock.json') } };
}

const refused = { message: 'RUNTIME_PACKAGE_TREE_REFUSED' };
test('accepts independently pinned finite package superset with zero-byte data and genuine private lineage', () => {
  const f = packageTreeFixture(); const result = f.read();
  assert.equal(tree.requireRuntimePackageTree(result), result);
  assert.equal(result.kind, 'validated-runtime-package-tree');
  assert.equal(result.treeSha256, f.pins().expectedTreeSha256);
  assert.equal(result.files.length, 5); assert.equal(result.files[0].size, 0);
  assert.equal(Object.isFrozen(result.files[0]), true);
  assert.equal(result.profile, f.profile); assert.equal(result.rootInventory.kind, 'validated-runtime-root-inventory');
  assert.equal(result.profile.certifications.runtimeDependencyIdentity, false);
  assert.equal(result.profile.certifications.executionAuthorized, false);
  f.files[0].size = 10; assert.equal(result.files[0].size, 0);
  assert.throws(() => tree.requireRuntimePackageTree(structuredClone(result)), refused);
});

for (const [name, change] of [
  ['extra authority field', f => { f.header.executionAuthorized = true; }],
  ['wrong schema', f => { f.header.version = 2; }],
  ['profile substitution', f => { f.header.profileManifestSha256 = 'c'.repeat(64); }],
  ['root inventory substitution', f => { f.header.rootInventorySha256 = 'c'.repeat(64); }],
  ['build substitution', f => { f.header.buildCommitSha = 'c'.repeat(40); }],
  ['runtime substitution', f => { f.header.runtime.arch = 'x64'; }],
  ['mutable source root', f => { f.header.sourceRoot = f.profile.document.paths.privateRoot; }],
  ['case aliased install root', f => { f.header.sourceRoot = 'C:\\Synthetic\\APP'; }],
  ['count mismatch', f => { f.header.counts.files++; }],
  ['file byte limit', f => { f.files[0].size = 32 * 1024 * 1024 + 1; }],
  ['negative bytes', f => { f.files[0].size = -1; }],
  ['path escape', f => { f.files[0].relativePath = '../outside.js'; }],
  ['ADS file', f => { f.files[0].relativePath = 'assets/x:stream'; }],
  ['secret as module root', f => { f.packages[0].packageId = 'private'; }],
  ['missing package manifest', f => { f.rows.splice(f.rows.findIndex(v => v.record === 'file' && v.packageId === 'node_modules/alpha' && v.relativePath === 'package.json'), 1); }],
  ['manifest hash mismatch', f => { f.packages[0].manifestSha256 = 'c'.repeat(64); }],
  ['orphan file', f => { f.files[0].packageId = 'node_modules/missing'; }],
  ['orphan edge', f => { f.edges[2].target = 'node_modules/missing'; }],
  ['missing root edge', f => { f.rows.splice(f.rows.findIndex(v => v.record === 'dependency-edge' && v.from === '$root'), 1); }],
  ['required absence disguised optional', f => { f.edges[2].status = 'absent-optional'; f.edges[2].target = ''; }],
  ['unknown asset mode', f => { f.files[0].assetKind = 'execute-anything'; }],
  ['unknown record', f => { f.rows[1].record = 'observation'; }],
]) test(`refuses ${name} even under regenerated test consistency pins`, () => {
  const f = packageTreeFixture(); change(f);
  if (name !== 'count mismatch') {
    for (const [field, kind] of [['packages', 'package'], ['edges', 'dependency-edge'], ['directories', 'directory'], ['files', 'file'], ['unresolved', 'unresolved']]) f.header.counts[field] = f.rows.filter(r => r.record === kind).length;
    f.header.counts.bytes = f.rows.filter(r => r.record === 'file').reduce((sum, r) => sum + r.size, 0);
  }
  assert.throws(() => f.read(), refused);
});

test('rejects changed inventory against unchanged independent expectations', () => {
  const f = packageTreeFixture(); const pins = f.pins(); f.files[0].sha256 = 'd'.repeat(64);
  assert.throws(() => f.read(packageTreeText(f.rows), pins), refused);
});
test('rejects forged profile and serialized root result instead of rootInput text/pins', () => {
  const f = packageTreeFixture(); assert.throws(() => f.read(undefined, undefined, structuredClone(f.profile)), refused);
  assert.throws(() => f.read(undefined, undefined, undefined, { kind: 'validated-runtime-root-inventory' }), refused);
});
test('rejects byte and line ambiguity before creating a brand', () => {
  const f = packageTreeFixture(); const valid = packageTreeText(f.rows);
  for (const text of [valid.trimEnd(), valid.replaceAll('\n', '\r\n'), '\ufeff' + valid, valid + '\n', valid.replace('"version":1', '"version": 1'), '{}\n', 'x'.repeat(16 * 1024 + 1) + '\n']) {
    assert.throws(() => f.read(text), refused);
  }
});
test('rejects getters without invoking them and foreign input bytes', () => {
  const f = packageTreeFixture(); let touched = 0; const pins = { ...f.pins(), get approvalRef() { touched++; return 'unsafe'; } };
  assert.throws(() => f.read(undefined, pins), refused); assert.equal(touched, 0);
  assert.throws(() => f.read(Buffer.from([0xc3, 0x28])), refused);
});
test('raw UTF8 BOM cannot disappear before independent byte digest verification', () => {
  const f = packageTreeFixture(); const text = packageTreeText(f.rows);
  assert.throws(() => f.read(Buffer.from('\ufeff' + text), f.pins(text)), refused);
  assert.equal(f.read(Buffer.from(text), f.pins(text)).treeSha256, f.pins(text).expectedTreeSha256);
});
test('original rootInput text larger than a single helper string retains original reader bounds', () => {
  const f = packageTreeFixture();
  f.root.uncoveredNonliteral = Array.from({ length: 12 }, (_, n) => ({ sourceRef: `server/fixture${String(n).padStart(2, '0')}${'x'.repeat(100)}.ts:1`, reason: 'computed-runtime-specifier' }));
  assert.ok(f.rootInput().text.length > 2048); f.header.rootInventorySha256 = f.rootInput().pins.expectedInventorySha256;
  assert.equal(f.read().rootInventory.inventorySha256, f.header.rootInventorySha256);
  let touched = 0; const getter = { get text() { touched++; return f.rootInput().text; }, pins: f.rootInput().pins };
  assert.throws(() => f.read(undefined, undefined, undefined, getter), refused);
  const proxy = new Proxy(f.rootInput(), { ownKeys() { touched++; return []; } });
  assert.throws(() => f.read(undefined, undefined, undefined, proxy), refused); assert.equal(touched, 0);
});
test('record group overflow and aggregate size refuse without a raised v1 helper ceiling', () => {
  const f = packageTreeFixture(); const blockers = Array.from({ length: 129 }, (_, i) => ({ record: 'unresolved', reason: 'opaque-data', sourceRef: `fixture${String(i).padStart(3, '0')}`, required: true }));
  f.rows.push(...blockers); f.header.counts.unresolved = 128; assert.throws(() => f.read(), refused);
  assert.throws(() => f.read('x'.repeat(16 * 1024 * 1024 + 1), { ...f.pins(), expectedTreeSha256: 'd'.repeat(64) }), refused);
});
test('destination aliases and file/directory collisions refuse with consistent aggregate counts', () => {
  for (const alias of ['Assets', 'assets/empty.txt']) {
    const f = packageTreeFixture(); f.rows.splice(f.rows.findIndex(v => v.record === 'file'), 0, { record: 'directory', packageId: 'node_modules/alpha', relativePath: alias });
    f.header.counts.directories++; assert.throws(() => f.read(), refused);
  }
});

test('missing required root preflight never reads package bytes or launches metadata children', async t => {
  const f = packageTreeFixture(); f.root.edges.push({ kind: 'require-call', specifier: 'posthog-node', occurrences: 1, target: { kind: 'uncovered', reason: 'require-conditions' } });
  let reads = 0; let children = 0;
  t.mock.method(fs, 'lstatSync', () => { const error = new Error('absent'); error.code = 'ENOENT'; throw error; });
  t.mock.method(fs, 'openSync', () => { reads++; throw new Error('unexpected byte capture'); });
  t.mock.method(childProcess, 'execFile', () => { children++; throw new Error('unexpected child'); });
  assert.equal(typeof tree.collectRuntimePackageTreeCandidate, 'function', 'the early preflight collector is implemented');
  const result = await tree.collectRuntimePackageTreeCandidate(f.profile, f.rootInput(), f.options);
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.blockers.map(b => b.reason).sort(), ['esm-require-bridge', 'missing-root', 'missing-root']);
  assert.equal(reads, 0); assert.equal(children, 0); assert.equal(globalThis.PFA_TREE_EVALUATED, undefined);
});

function fakeCapture(t, change = () => {}) {
  const f = packageTreeFixture(); const nodes = new Map(); const descriptors = new Map(); let serial = 10n;
  const state = { f, nodes, opened: [], closed: [], reads: [], enumerated: [], metadataCalls: 0, reparse: '', alias: '', onRead() {}, onMetadata() {} };
  const put = (location, bytes) => {
    const full = path.win32.join(f.sourceRoot, ...location.split('/')); const item = { bytes: Buffer.from(bytes), ino: serial++, nlink: 1n, stamp: 1_000_000_000n };
    nodes.set(full, item); let dir = path.win32.dirname(full);
    while (!nodes.has(dir)) { nodes.set(dir, { ino: serial++, stamp: 1_000_000_000n }); const parent = path.win32.dirname(dir); if (parent === dir) break; dir = parent; }
    return item;
  };
  for (const [name, bytes] of f.bytes) put(name, bytes);
  nodes.set('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', { bytes: Buffer.from('inert platform bridge'), ino: serial++, nlink: 1n, stamp: 1_000_000_000n });
  state.put = put;
  const stat = (location, item = nodes.get(location)) => {
    if (!item) { const error = new Error('absent'); error.code = 'ENOENT'; throw error; }
    return { dev: 1n, ino: item.ino, mode: item.bytes ? 33206n : 16877n, nlink: item.nlink ?? 1n, size: BigInt(item.bytes?.length ?? 0),
      birthtimeNs: 1_000_000_000n, ctimeNs: item.stamp, mtimeNs: item.stamp, isFile: () => Boolean(item.bytes), isDirectory: () => !item.bytes, isSymbolicLink: () => false };
  };
  change(state);
  t.mock.method(fs, 'lstatSync', location => stat(location));
  t.mock.method(fs.realpathSync, 'native', location => location === state.alias ? location.toUpperCase() : location);
  t.mock.method(fs, 'opendirSync', location => {
    const names = Array.from(nodes.keys()).filter(p => path.win32.dirname(p) === location && p !== location).map(p => path.win32.basename(p)); let index = 0;
    return { readSync() { if (index >= names.length) return null; const name = names[index++]; state.enumerated.push(`${location}\\${name}`); return { name }; }, closeSync() {} };
  });
  t.mock.method(fs, 'openSync', (location, flags) => { assert.equal(flags, fs.constants.O_RDONLY); assert.ok(nodes.get(location)?.bytes);
    const fd = state.opened.length + 100; state.opened.push(fd); descriptors.set(fd, { location, item: nodes.get(location) }); return fd; });
  t.mock.method(fs, 'fstatSync', fd => { const row = descriptors.get(fd); assert.ok(row); return stat(row.location, row.item); });
  t.mock.method(fs, 'readSync', (fd, buffer, offset, length, position) => { const row = descriptors.get(fd); state.reads.push(row.location); state.onRead(row.location);
    return row.item.bytes.copy(buffer, offset, position, position + length); });
  t.mock.method(fs, 'closeSync', fd => { assert.equal(descriptors.delete(fd), true); state.closed.push(fd); });
  t.mock.method(childProcess, 'execFile', (executable, args, options, callback) => {
    state.metadataCalls++; assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
    return { stdin: { on() {}, end(input) { state.onMetadata(); const rows = JSON.parse(input).map(location => { const node = stat(location);
      return { path: location, directory: node.isDirectory(), attributes: state.reparse === location ? 0x400 : node.isDirectory() ? 16 : 32,
        size: String(node.size), creationTicks: '621355968010000000', writeTicks: String(621355968000000000n + node.mtimeNs / 100n) }; });
      queueMicrotask(() => callback(null, JSON.stringify(rows))); } } };
  });
  state.collect = () => tree.collectRuntimePackageTreeCandidate(f.profile, f.rootInput(), f.options); return state;
}

test('fake-only collector captures finite graph/data bytes without evaluating selected source', async t => {
  const s = fakeCapture(t); const result = await s.collect();
  assert.equal(result.status, 'candidate'); assert.equal(result.summary.packages, 2); assert.equal(result.summary.files, 5);
  const record = s.f.read(result.text); assert.equal(record.files.find(v => v.relativePath === 'assets/empty.txt').size, 0);
  assert.equal(record.edges.find(v => v.name === 'absent').status, 'absent-optional');
  assert.deepEqual(s.closed, s.opened); assert.equal(globalThis.PFA_TREE_EVALUATED, undefined);
});

for (const [name, change] of [
  ['path alias', s => { s.alias = `${s.f.sourceRoot}\\node_modules\\alpha`; }],
  ['hardlinked metadata', s => { s.nodes.get(`${s.f.sourceRoot}\\node_modules\\alpha\\package.json`).nlink = 2n; }],
  ['generic reparse', s => { s.reparse = `${s.f.sourceRoot}\\node_modules\\alpha`; }],
  ['mutating bytes', s => { s.onRead = location => { if (location.endsWith('index.mjs')) s.nodes.get(location).stamp += 100n; }; }],
  ['same-byte path replacement', s => { let changed = false; s.onRead = location => { if (!changed && location.endsWith('index.mjs')) { changed = true; s.put('node_modules/alpha/index.mjs', s.nodes.get(location).bytes); } }; }],
]) test(`fake-only collector refuses ${name} and closes every opened descriptor`, async t => {
  const s = fakeCapture(t, change); await assert.rejects(s.collect(), refused); assert.deepEqual(s.closed, s.opened);
});

test('fake-only native requirement is reported without payload hashing', async t => {
  const s = fakeCapture(t, state => { state.put('node_modules/alpha/native.node', 'not executable native bytes'); });
  const result = await s.collect(); assert.equal(result.status, 'blocked');
  assert.equal(result.blockers.some(v => v.reason === 'native-addon'), true);
  assert.equal(s.reads.some(v => v.endsWith('native.node') || v.endsWith('index.mjs')), false);
  assert.deepEqual(s.closed, s.opened); assert.equal(globalThis.PFA_TREE_EVALUATED, undefined);
});

test('fake-only declared dependency cycle terminates and retains both packages', async t => {
  const s = fakeCapture(t, state => { state.put('node_modules/beta/package.json', JSON.stringify({ name: 'beta', version: '1.0.0', dependencies: { alpha: '*' } })); });
  const result = await s.collect(); const accepted = s.f.read(result.text);
  assert.equal(accepted.packages.length, 2); assert.equal(accepted.edges.length, 4);
  assert.equal(accepted.edges.find(e => e.from === 'node_modules/beta').target, 'node_modules/alpha');
});
test('fake-only nested version is a distinct installed instance and preserves topology', async t => {
  const s = fakeCapture(t, state => {
    state.put('node_modules/beta/package.json', JSON.stringify({ name: 'beta', version: '1.0.0', dependencies: { alpha: '^2.0.0' } }));
    state.put('node_modules/beta/node_modules/alpha/package.json', JSON.stringify({ name: 'alpha', version: '2.0.0', type: 'module' }));
    state.put('node_modules/beta/node_modules/alpha/index.mjs', 'export default 3;');
    const lock = JSON.parse(state.f.bytes.get('package-lock.json')); lock.packages['node_modules/beta/node_modules/alpha'] = { version: '2.0.0' };
    const bytes = JSON.stringify(lock); state.put('package-lock.json', bytes); Object.assign(state.f.options.packageLock, { size: Buffer.byteLength(bytes), sha256: sha(bytes) });
  });
  const result = await s.collect(); const accepted = s.f.read(result.text);
  assert.equal(accepted.packages.length, 3);
  assert.equal(accepted.edges.find(e => e.from === 'node_modules/beta').target, 'node_modules/beta/node_modules/alpha');
});
test('fake-only missing required dependency reports before payload capture, unlike optional absence', async t => {
  const s = fakeCapture(t, state => { for (const name of Array.from(state.nodes.keys())) if (name.startsWith(`${state.f.sourceRoot}\\node_modules\\beta`)) state.nodes.delete(name); });
  const result = await s.collect(); assert.equal(result.status, 'blocked'); assert.equal(result.blockers[0].reason, 'missing-required');
  assert.equal(s.reads.some(v => v.endsWith('index.mjs')), false); assert.deepEqual(s.closed, s.opened);
});
test('fake-only posthog absence and emitted ESM require bridge stay separate pre-byte blockers', async t => {
  const s = fakeCapture(t); s.f.root.edges.push({ kind: 'require-call', specifier: 'posthog-node', occurrences: 1, target: { kind: 'uncovered', reason: 'require-conditions' } });
  const result = await s.collect(); assert.deepEqual(result.blockers.map(b => b.reason), ['esm-require-bridge', 'missing-root']);
  assert.equal(s.reads.length, 0); assert.equal(s.metadataCalls, 0); assert.equal(result.packageByteCaptureStarted, false);
});
test('fake-only untracked nested package refuses before payload capture', async t => {
  const s = fakeCapture(t, state => { state.put('node_modules/alpha/node_modules/untracked/package.json', '{"name":"untracked","version":"1.0.0"}'); });
  const result = await s.collect(); assert.equal(result.status, 'blocked'); assert.equal(result.blockers[0].reason, 'unsupported-topology');
  assert.equal(s.reads.some(v => v.endsWith('index.mjs')), false);
});
test('fake-only benign ancestor sibling timestamp movement preserves the package snapshot', async t => {
  const s = fakeCapture(t, state => {
    let changed = false; state.onRead = location => {
      if (!changed && location === `${state.f.sourceRoot}\\package.json`) {
        changed = true; state.nodes.get('C:\\Synthetic').stamp += 100n;
        state.nodes.set('C:\\Synthetic\\unrelated.txt', { bytes: Buffer.from('unrelated'), ino: 9000n, nlink: 1n, stamp: 1_000_000_000n });
      }
    };
  });
  assert.equal((await s.collect()).status, 'candidate'); assert.deepEqual(s.closed, s.opened);
});
test('fake-only changed package directory membership refuses even with unchanged directory timestamps', async t => {
  const s = fakeCapture(t, state => {
    let changed = false; state.onRead = location => { if (!changed && location.endsWith('index.mjs')) { changed = true; state.put('node_modules/alpha/unexpected.cjs', 'module.exports=3;'); } };
  });
  await assert.rejects(s.collect(), refused); assert.deepEqual(s.closed, s.opened);
});
test('fake-only scoped nested namespace expansion refuses before scanning later scopes', async t => {
  const s = fakeCapture(t, state => {
    for (const scope of ['@first', '@later']) for (let n = 0; n < 600; n++) state.put(`node_modules/alpha/node_modules/${scope}/pkg${String(n).padStart(4, '0')}/package.json`, '{}');
  });
  await assert.rejects(s.collect(), refused);
  const scopes = s.enumerated.filter(name => /\\@(first|later)\\pkg/.test(name));
  assert.ok(scopes.length <= 513, `bounded namespace scan expected, observed ${scopes.length}`);
  assert.equal(scopes.some(name => name.includes('\\@later\\')), false); assert.deepEqual(s.closed, s.opened);
});

test('named installed capture hashes inert native and data bytes while retaining obligations', async t => {
  const s = fakeCapture(t, state => {
    state.put('node_modules/alpha/native.node', 'inert native marker');
    state.put('node_modules/alpha/sibling.dll', 'inert dll marker');
  });
  s.f.root.evidenceClass = 'declared-installed-candidate';
  const collect = tree.collectInstalledRuntimePackageTreeCandidate ?? tree.collectRuntimePackageTreeCandidate;
  const result = await collect(s.f.profile, s.f.rootInput(), s.f.options);
  assert.equal(result.status, 'candidate'); assert.equal(result.summary.unresolved, 2);
  const accepted = s.f.read(result.text);
  assert.deepEqual(accepted.unresolved.map(row => row.reason), ['native-addon', 'native-dll']);
  assert.equal(accepted.files.find(row => row.relativePath === 'native.node').assetKind, 'native-addon');
  assert.equal(accepted.files.find(row => row.relativePath === 'sibling.dll').assetKind, 'native-dll');
  assert.ok(s.reads.some(name => name.endsWith('native.node'))); assert.deepEqual(s.closed, s.opened);
  assert.equal(globalThis.PFA_TREE_EVALUATED, undefined);
});

test('named installed capture requires the installed evidence class before filesystem access', async t => {
  assert.equal(typeof tree.collectInstalledRuntimePackageTreeCandidate, 'function');
  const f = packageTreeFixture(); let calls = 0;
  t.mock.method(fs, 'lstatSync', () => { calls++; throw new Error('UNEXPECTED_IO'); });
  await assert.rejects(tree.collectInstalledRuntimePackageTreeCandidate(f.profile, f.rootInput(), f.options), refused);
  assert.equal(calls, 0);
});

function declaredAliasFixture(t, declarations, lockedName) {
  const s = fakeCapture(t, state => {
    state.put('node_modules/alpha/package.json', JSON.stringify({ name: 'alpha', version: '1.0.0', dependencies: declarations }));
    const lock = JSON.parse(state.f.bytes.get('package-lock.json'));
    for (const dependency of Object.keys(declarations)) {
      const version = dependency === 'fetch-mock-cache' ? '2.1.3' : dependency === 'tough-cookie' ? '5.1.1' : dependency === 'tough-cookie-file-store' ? '2.0.3' : '1.2.3';
      state.put(`node_modules/${dependency}/package.json`, JSON.stringify({ name: dependency, version }));
      state.put(`node_modules/${dependency}/index.js`, 'globalThis.ALIAS_MODULE_EVALUATED=true;');
      lock.packages[`node_modules/${dependency}`] = { name: lockedName ?? dependency, version };
    }
    const bytes = JSON.stringify(lock); state.put('package-lock.json', bytes);
    Object.assign(state.f.options.packageLock, { size: Buffer.byteLength(bytes), sha256: sha(bytes) });
  });
  s.f.root.evidenceClass = 'declared-installed-candidate'; return s;
}

test('actual same-name npm aliases stay blocked in legacy capture and normalize only in installed capture', async t => {
  const aliases = { 'fetch-mock-cache': 'npm:fetch-mock-cache@^2.1.3', 'tough-cookie': 'npm:tough-cookie@^5.1.1', 'tough-cookie-file-store': 'npm:tough-cookie-file-store@^2.0.3' };
  const s = declaredAliasFixture(t, aliases); const legacy = await s.collect();
  assert.equal(legacy.status, 'blocked'); assert.equal(legacy.blockers.filter(row => row.reason === 'unsupported-topology').length, 3);
  const result = await tree.collectInstalledRuntimePackageTreeCandidate(s.f.profile, s.f.rootInput(), s.f.options);
  assert.equal(result.status, 'candidate'); const accepted = s.f.read(result.text);
  for (const [name, raw] of Object.entries(aliases)) {
    const edge = accepted.edges.find(row => row.from === 'node_modules/alpha' && row.name === name);
    assert.equal(edge.range, raw.slice(`npm:${name}@`.length));
  }
  assert.equal(globalThis.ALIAS_MODULE_EVALUATED, undefined); assert.deepEqual(s.closed, s.opened);
});

test('installed same-name alias supports exact scoped name while retaining pinned source spelling', async t => {
  const s = declaredAliasFixture(t, { '@scope/pkg': 'npm:@scope/pkg@~1.2.3' });
  const result = await tree.collectInstalledRuntimePackageTreeCandidate(s.f.profile, s.f.rootInput(), s.f.options);
  assert.equal(result.status, 'candidate'); assert.equal(s.f.read(result.text).edges.find(row => row.name === '@scope/pkg').range, '~1.2.3');
  assert.deepEqual(s.closed, s.opened);
});

for (const range of ['npm:other@^1.2.3', 'npm:beta@', 'npm:beta@npm:beta@^1.2.3', 'workspace:^1.2.3', 'file:../beta', 'https://example.invalid/beta.tgz']) {
  test(`installed capture refuses unsupported alias range ${range}`, async t => {
    const s = declaredAliasFixture(t, { beta: range });
    const result = await tree.collectInstalledRuntimePackageTreeCandidate(s.f.profile, s.f.rootInput(), s.f.options);
    assert.equal(result.status, 'blocked'); assert.equal(result.blockers[0].reason, 'unsupported-topology');
    assert.equal(s.reads.some(name => name.endsWith('index.js')), false); assert.deepEqual(s.closed, s.opened);
  });
}

test('installed alias cannot hide a conflicting lock package name', async t => {
  const s = declaredAliasFixture(t, { beta: 'npm:beta@^1.2.3' }, 'different');
  await assert.rejects(tree.collectInstalledRuntimePackageTreeCandidate(s.f.profile, s.f.rootInput(), s.f.options), refused);
  assert.deepEqual(s.closed, s.opened);
});

// Exact observed npm-generated command bytes. They are inert data and never evaluated.
const toolingBytes = [
  ['semver', 'IyEvYmluL3NoCmJhc2VkaXI9JChkaXJuYW1lICIkKGVjaG8gIiQwIiB8IHNlZCAtZSAncyxcXCwvLGcnKSIpCgpjYXNlIGB1bmFtZWAgaW4KICAgICpDWUdXSU4qfCpNSU5HVyp8Kk1TWVMqKQogICAgICAgIGlmIGNvbW1hbmQgLXYgY3lncGF0aCA+IC9kZXYvbnVsbCAyPiYxOyB0aGVuCiAgICAgICAgICAgIGJhc2VkaXI9YGN5Z3BhdGggLXcgIiRiYXNlZGlyImAKICAgICAgICBmaQogICAgOzsKZXNhYwoKaWYgWyAteCAiJGJhc2VkaXIvbm9kZSIgXTsgdGhlbgogIGV4ZWMgIiRiYXNlZGlyL25vZGUiICAiJGJhc2VkaXIvLi4vc2VtdmVyL2Jpbi9zZW12ZXIuanMiICIkQCIKZWxzZSAKICBleGVjIG5vZGUgICIkYmFzZWRpci8uLi9zZW12ZXIvYmluL3NlbXZlci5qcyIgIiRAIgpmaQo='],
  ['semver.cmd', 'QEVDSE8gb2ZmDQpHT1RPIHN0YXJ0DQo6ZmluZF9kcDANClNFVCBkcDA9JX5kcDANCkVYSVQgL2INCjpzdGFydA0KU0VUTE9DQUwNCkNBTEwgOmZpbmRfZHAwDQoNCklGIEVYSVNUICIlZHAwJVxub2RlLmV4ZSIgKA0KICBTRVQgIl9wcm9nPSVkcDAlXG5vZGUuZXhlIg0KKSBFTFNFICgNCiAgU0VUICJfcHJvZz1ub2RlIg0KICBTRVQgUEFUSEVYVD0lUEFUSEVYVDo7LkpTOz07JQ0KKQ0KDQplbmRMb2NhbCAmIGdvdG8gI191bmRlZmluZWRfIyAyPk5VTCB8fCB0aXRsZSAlQ09NU1BFQyUgJiAiJV9wcm9nJSIgICIlZHAwJVwuLlxzZW12ZXJcYmluXHNlbXZlci5qcyIgJSoNCg=='],
  ['semver.ps1', 'IyEvdXNyL2Jpbi9lbnYgcHdzaAokYmFzZWRpcj1TcGxpdC1QYXRoICRNeUludm9jYXRpb24uTXlDb21tYW5kLkRlZmluaXRpb24gLVBhcmVudAoKJGV4ZT0iIgppZiAoJFBTVmVyc2lvblRhYmxlLlBTVmVyc2lvbiAtbHQgIjYuMCIgLW9yICRJc1dpbmRvd3MpIHsKICAjIEZpeCBjYXNlIHdoZW4gYm90aCB0aGUgV2luZG93cyBhbmQgTGludXggYnVpbGRzIG9mIE5vZGUKICAjIGFyZSBpbnN0YWxsZWQgaW4gdGhlIHNhbWUgZGlyZWN0b3J5CiAgJGV4ZT0iLmV4ZSIKfQokcmV0PTAKaWYgKFRlc3QtUGF0aCAiJGJhc2VkaXIvbm9kZSRleGUiKSB7CiAgIyBTdXBwb3J0IHBpcGVsaW5lIGlucHV0CiAgaWYgKCRNeUludm9jYXRpb24uRXhwZWN0aW5nSW5wdXQpIHsKICAgICRpbnB1dCB8ICYgIiRiYXNlZGlyL25vZGUkZXhlIiAgIiRiYXNlZGlyLy4uL3NlbXZlci9iaW4vc2VtdmVyLmpzIiAkYXJncwogIH0gZWxzZSB7CiAgICAmICIkYmFzZWRpci9ub2RlJGV4ZSIgICIkYmFzZWRpci8uLi9zZW12ZXIvYmluL3NlbXZlci5qcyIgJGFyZ3MKICB9CiAgJHJldD0kTEFTVEVYSVRDT0RFCn0gZWxzZSB7CiAgIyBTdXBwb3J0IHBpcGVsaW5lIGlucHV0CiAgaWYgKCRNeUludm9jYXRpb24uRXhwZWN0aW5nSW5wdXQpIHsKICAgICRpbnB1dCB8ICYgIm5vZGUkZXhlIiAgIiRiYXNlZGlyLy4uL3NlbXZlci9iaW4vc2VtdmVyLmpzIiAkYXJncwogIH0gZWxzZSB7CiAgICAmICJub2RlJGV4ZSIgICIkYmFzZWRpci8uLi9zZW12ZXIvYmluL3NlbXZlci5qcyIgJGFyZ3MKICB9CiAgJHJldD0kTEFTVEVYSVRDT0RFCn0KZXhpdCAkcmV0Cg=='],
];
function generatedToolingFixture(t, variation = '') {
  const s = fakeCapture(t, state => {
    const sharp = 'node_modules/sharp', nested = `${sharp}/node_modules/semver`;
    const dependency = variation === 'edge' ? '^7.8.4' : '^7.8.5';
    const bin = { semver: variation === 'target' ? 'different.js' : 'bin/semver.js' };
    const version = variation === 'version' ? '7.8.6' : '7.8.5';
    state.put('node_modules/alpha/package.json', JSON.stringify({ name: 'alpha', version: '1.0.0', dependencies: { sharp: '0.35.5' } }));
    state.put(`${sharp}/package.json`, JSON.stringify({ name: 'sharp', version: '0.35.5', dependencies: { semver: dependency } }));
    state.put(`${sharp}/index.js`, 'globalThis.GENERATED_TOOLING_EVALUATED=true;');
    state.put(`${nested}/package.json`, JSON.stringify({ name: 'semver', version, bin }));
    state.put(`${nested}/bin/semver.js`, 'globalThis.GENERATED_TOOLING_EVALUATED=true;');
    for (const [name, encoded] of toolingBytes) state.put(`${sharp}/node_modules/.bin/${variation === 'name' && name === 'semver' ? 'renamed' : name}`, Buffer.from(encoded, 'base64'));
    if (variation === 'hash') state.nodes.get(`${state.f.sourceRoot}\\node_modules\\sharp\\node_modules\\.bin\\semver`).bytes[0] ^= 1;
    if (variation === 'extra') state.put(`${sharp}/node_modules/.bin/extra.cmd`, 'inert extra');
    if (variation === 'subdir') state.put(`${sharp}/node_modules/.bin/subdir/file.txt`, 'inert extra');
    const lock = JSON.parse(state.f.bytes.get('package-lock.json'));
    lock.packages[sharp] = { version: '0.35.5', dependencies: { semver: dependency } };
    lock.packages[nested] = { version, bin };
    const bytes = JSON.stringify(lock); state.put('package-lock.json', bytes); Object.assign(state.f.options.packageLock, { size: Buffer.byteLength(bytes), sha256: sha(bytes) });
  });
  s.f.root.evidenceClass = 'declared-installed-candidate'; return s;
}
test('exact Sharp generated shims are pinned explicit non-staged obligations only in installed capture', async t => {
  const s = generatedToolingFixture(t); const legacy = await s.collect();
  assert.equal(legacy.status, 'blocked'); assert.ok(legacy.blockers.some(row => row.sourceRef.endsWith('node_modules/.bin')));
  const result = await tree.collectInstalledRuntimePackageTreeCandidate(s.f.profile, s.f.rootInput(), s.f.options);
  assert.equal(result.status, 'candidate'); const accepted = s.f.read(result.text);
  assert.equal(accepted.unresolved.filter(row => row.reason === 'opaque-data' && row.sourceRef.startsWith('generated-tooling-not-staged:')).length, 3);
  assert.equal(accepted.files.some(row => row.relativePath.includes('.bin/')), false);
  assert.equal(globalThis.GENERATED_TOOLING_EVALUATED, undefined); assert.deepEqual(s.closed, s.opened);
});
for (const variation of ['hash', 'name', 'extra', 'subdir', 'edge', 'target', 'version']) test(`installed generated tooling refuses ${variation} drift`, async t => {
  const s = generatedToolingFixture(t, variation);
  const result = await tree.collectInstalledRuntimePackageTreeCandidate(s.f.profile, s.f.rootInput(), s.f.options);
  assert.equal(result.status, 'blocked'); assert.ok(result.blockers.some(row => row.reason === 'unsupported-topology'));
  assert.deepEqual(s.closed, s.opened); assert.equal(globalThis.GENERATED_TOOLING_EVALUATED, undefined);
});

const yahooToolingBytes = [
  ['tldts', 'IyEvYmluL3NoCmJhc2VkaXI9JChkaXJuYW1lICIkKGVjaG8gIiQwIiB8IHNlZCAtZSAncyxcXCwvLGcnKSIpCgpjYXNlIGB1bmFtZWAgaW4KICAgICpDWUdXSU4qfCpNSU5HVyp8Kk1TWVMqKQogICAgICAgIGlmIGNvbW1hbmQgLXYgY3lncGF0aCA+IC9kZXYvbnVsbCAyPiYxOyB0aGVuCiAgICAgICAgICAgIGJhc2VkaXI9YGN5Z3BhdGggLXcgIiRiYXNlZGlyImAKICAgICAgICBmaQogICAgOzsKZXNhYwoKaWYgWyAteCAiJGJhc2VkaXIvbm9kZSIgXTsgdGhlbgogIGV4ZWMgIiRiYXNlZGlyL25vZGUiICAiJGJhc2VkaXIvLi4vdGxkdHMvYmluL2NsaS5qcyIgIiRAIgplbHNlIAogIGV4ZWMgbm9kZSAgIiRiYXNlZGlyLy4uL3RsZHRzL2Jpbi9jbGkuanMiICIkQCIKZmkK'],
  ['tldts.cmd', 'QEVDSE8gb2ZmDQpHT1RPIHN0YXJ0DQo6ZmluZF9kcDANClNFVCBkcDA9JX5kcDANCkVYSVQgL2INCjpzdGFydA0KU0VUTE9DQUwNCkNBTEwgOmZpbmRfZHAwDQoNCklGIEVYSVNUICIlZHAwJVxub2RlLmV4ZSIgKA0KICBTRVQgIl9wcm9nPSVkcDAlXG5vZGUuZXhlIg0KKSBFTFNFICgNCiAgU0VUICJfcHJvZz1ub2RlIg0KICBTRVQgUEFUSEVYVD0lUEFUSEVYVDo7LkpTOz07JQ0KKQ0KDQplbmRMb2NhbCAmIGdvdG8gI191bmRlZmluZWRfIyAyPk5VTCB8fCB0aXRsZSAlQ09NU1BFQyUgJiAiJV9wcm9nJSIgICIlZHAwJVwuLlx0bGR0c1xiaW5cY2xpLmpzIiAlKg0K'],
  ['tldts.ps1', 'IyEvdXNyL2Jpbi9lbnYgcHdzaAokYmFzZWRpcj1TcGxpdC1QYXRoICRNeUludm9jYXRpb24uTXlDb21tYW5kLkRlZmluaXRpb24gLVBhcmVudAoKJGV4ZT0iIgppZiAoJFBTVmVyc2lvblRhYmxlLlBTVmVyc2lvbiAtbHQgIjYuMCIgLW9yICRJc1dpbmRvd3MpIHsKICAjIEZpeCBjYXNlIHdoZW4gYm90aCB0aGUgV2luZG93cyBhbmQgTGludXggYnVpbGRzIG9mIE5vZGUKICAjIGFyZSBpbnN0YWxsZWQgaW4gdGhlIHNhbWUgZGlyZWN0b3J5CiAgJGV4ZT0iLmV4ZSIKfQokcmV0PTAKaWYgKFRlc3QtUGF0aCAiJGJhc2VkaXIvbm9kZSRleGUiKSB7CiAgIyBTdXBwb3J0IHBpcGVsaW5lIGlucHV0CiAgaWYgKCRNeUludm9jYXRpb24uRXhwZWN0aW5nSW5wdXQpIHsKICAgICRpbnB1dCB8ICYgIiRiYXNlZGlyL25vZGUkZXhlIiAgIiRiYXNlZGlyLy4uL3RsZHRzL2Jpbi9jbGkuanMiICRhcmdzCiAgfSBlbHNlIHsKICAgICYgIiRiYXNlZGlyL25vZGUkZXhlIiAgIiRiYXNlZGlyLy4uL3RsZHRzL2Jpbi9jbGkuanMiICRhcmdzCiAgfQogICRyZXQ9JExBU1RFWElUQ09ERQp9IGVsc2UgewogICMgU3VwcG9ydCBwaXBlbGluZSBpbnB1dAogIGlmICgkTXlJbnZvY2F0aW9uLkV4cGVjdGluZ0lucHV0KSB7CiAgICAkaW5wdXQgfCAmICJub2RlJGV4ZSIgICIkYmFzZWRpci8uLi90bGR0cy9iaW4vY2xpLmpzIiAkYXJncwogIH0gZWxzZSB7CiAgICAmICJub2RlJGV4ZSIgICIkYmFzZWRpci8uLi90bGR0cy9iaW4vY2xpLmpzIiAkYXJncwogIH0KICAkcmV0PSRMQVNURVhJVENPREUKfQpleGl0ICRyZXQK'],
];
function yahooGeneratedToolingFixture(t, variation = '') {
  const s = fakeCapture(t, state => {
    const owner = 'node_modules/yahoo-finance2', cookie = `${owner}/node_modules/tough-cookie`, target = `${owner}/node_modules/tldts`;
    const cookieRange = variation === 'chain' ? '^6.1.31' : '^6.1.32';
    const version = variation === 'version' ? '6.1.85' : '6.1.86', bin = { tldts: variation === 'target' ? 'other.js' : 'bin/cli.js' };
    state.put('node_modules/alpha/package.json', JSON.stringify({ name: 'alpha', version: '1.0.0', dependencies: { 'yahoo-finance2': '3.13.0' } }));
    state.put(`${owner}/package.json`, JSON.stringify({ name: 'yahoo-finance2', version: '3.13.0', dependencies: { 'tough-cookie': 'npm:tough-cookie@^5.1.1' } }));
    state.put(`${cookie}/package.json`, JSON.stringify({ name: 'tough-cookie', version: '5.1.2', dependencies: { tldts: cookieRange } }));
    state.put(`${target}/package.json`, JSON.stringify({ name: 'tldts', version, bin })); state.put(`${target}/bin/cli.js`, 'globalThis.YAHOO_TOOLING_EVALUATED=true;');
    for (const [name, encoded] of yahooToolingBytes) if (!(variation === 'missing' && name === 'tldts.cmd')) state.put(`${owner}/node_modules/.bin/${name}`, Buffer.from(encoded, 'base64'));
    if (variation === 'hash') state.nodes.get(`${state.f.sourceRoot}\\node_modules\\yahoo-finance2\\node_modules\\.bin\\tldts`).bytes[0] ^= 1;
    if (variation === 'extra') state.put(`${owner}/node_modules/.bin/unknown.cmd`, 'inert');
    if (variation === 'unknown-group') state.put(`${cookie}/node_modules/.bin/tldts`, 'inert unapproved group');
    const lock = JSON.parse(state.f.bytes.get('package-lock.json'));
    lock.packages[owner] = { version: '3.13.0', dependencies: { 'tough-cookie': 'npm:tough-cookie@^5.1.1' } };
    lock.packages[cookie] = { version: '5.1.2', dependencies: { tldts: cookieRange } }; lock.packages[target] = { version, bin };
    const bytes = JSON.stringify(lock); state.put('package-lock.json', bytes); Object.assign(state.f.options.packageLock, { size: Buffer.byteLength(bytes), sha256: sha(bytes) });
  });
  s.f.root.evidenceClass = 'declared-installed-candidate'; return s;
}
test('finite Yahoo generated tooling follows the exact measured two-edge chain', async t => {
  const s = yahooGeneratedToolingFixture(t); assert.equal((await s.collect()).status, 'blocked');
  const result = await tree.collectInstalledRuntimePackageTreeCandidate(s.f.profile, s.f.rootInput(), s.f.options);
  assert.equal(result.status, 'candidate'); const accepted = s.f.read(result.text);
  assert.equal(accepted.unresolved.filter(row => row.sourceRef.startsWith('generated-tooling-not-staged:node_modules/yahoo-finance2/')).length, 3);
  assert.equal(accepted.files.some(row => row.relativePath.includes('.bin')), false); assert.deepEqual(s.closed, s.opened);
  assert.equal(globalThis.YAHOO_TOOLING_EVALUATED, undefined);
});
for (const variation of ['hash', 'missing', 'extra', 'unknown-group', 'chain', 'target', 'version']) test(`finite Yahoo tooling refuses ${variation}`, async t => {
  const s = yahooGeneratedToolingFixture(t, variation);
  const result = await tree.collectInstalledRuntimePackageTreeCandidate(s.f.profile, s.f.rootInput(), s.f.options);
  assert.equal(result.status, 'blocked'); assert.ok(result.blockers.some(row => row.reason === 'unsupported-topology')); assert.deepEqual(s.closed, s.opened);
});
