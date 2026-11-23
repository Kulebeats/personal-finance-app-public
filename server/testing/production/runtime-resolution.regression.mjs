import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
import moduleBuiltin, { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { parse, freeze, shape, check, hash, absolute, integer } from './primitives.mjs';
import { readWindowsMetadata } from '../../../scripts/recovery/windows-metadata.mjs';
import { readProductionManifest, canonicalJson, digest } from './manifest.mjs';
import { manifestFixture, approvedFixturePins } from './manifest.fixture.mjs';
import os from 'node:os';
// The Windows profile the custody fixtures live under, from the process token (os.userInfo),
// not USERPROFILE, which the fixed children override; a neutral placeholder off Windows.
const windowsProfile = process.platform === 'win32' ? os.userInfo().homedir : 'C:\\Users\\example';

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const nativeMode = isEntry && process.argv.length === 4 && process.argv[2] === '--run-owned-native-fixture' && process.argv[3] === 'r20res20261028b1';
if (isEntry && process.argv.length !== 2 && !nativeMode) throw new Error('RUNTIME_RESOLUTION_REFUSED');
const test = isEntry && !nativeMode ? nodeTest : () => {};
const runtime = await import('./runtime-resolution.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./runtime-resolution.mjs', import.meta.url).href) return {};
  throw error;
});
function fixture(source = manifestFixture()) {
  const text = canonicalJson(source);
  const profile = readProductionManifest(text, { ...approvedFixturePins, expectedManifestSha256: digest(text),
    expectedArtifactsSha256: digest(canonicalJson(source.build.artifacts)) });
  const file = (path, size = 20, sha256 = 'a'.repeat(64)) => ({ path, size, sha256 });
  const document = { kind: 'pfa-runtime-root-resolution', version: 1, evidenceClass: 'synthetic-fixture',
    manifestSha256: profile.manifestSha256, runId: profile.document.runId,
    buildCommitSha: profile.document.build.commitSha, harnessCommitSha: profile.document.harnessCommitSha,
    approvalRef: profile.document.approvalRef,
    runtime: { executable: file('C:\\Synthetic\\runtime\\node.exe', 100), version: '24.22.0', platform: 'win32', arch: 'arm64', flag: '--experimental-import-meta-resolve' },
    dependencyRoots: ['C:\\Synthetic\\dependencies'],
    metafile: { file: file('C:\\Synthetic\\metadata\\build.json'), outputKey: 'dist/index.js' },
    packageMetadata: [file('C:\\Synthetic\\package.json')],
    edges: [
      { specifier: 'file-type', kind: 'dynamic-import', occurrences: 2, target: { kind: 'file', file: file('C:\\Synthetic\\dependencies\\file-type\\index.js') } },
      { specifier: 'node:crypto', kind: 'import-statement', occurrences: 1, target: { kind: 'builtin', name: 'node:crypto' } },
      { specifier: 'posthog-node', kind: 'require-call', occurrences: 1, target: { kind: 'uncovered', reason: 'require-conditions' } },
    ], uncoveredNonliteral: [{ sourceRef: 'server/owned.ts:1', reason: 'computed-runtime-specifier' }],
  };
  const pins = () => ({ expectedInventorySha256: digest(canonicalJson(document)), manifestSha256: profile.manifestSha256,
    runId: document.runId, buildCommitSha: document.buildCommitSha, harnessCommitSha: document.harnessCommitSha,
    evidenceClass: document.evidenceClass, approvalRef: document.approvalRef });
  const read = (value = document, expected = pins(), owner = profile) => {
    assert.equal(typeof runtime.readRuntimeResolutionInventory, 'function', 'the approved pure inventory reader is implemented');
    return runtime.readRuntimeResolutionInventory(owner, canonicalJson(value), expected);
  };
  return { profile, document, pins, read, file };
}

test('copies the independently pinned root inventory without promoting the production manifest', () => {
  const f = fixture(); const record = f.read();
  assert.equal(record.kind, 'validated-runtime-root-inventory');
  assert.equal(record.inventorySha256, f.pins().expectedInventorySha256);
  assert.equal(record.document.evidenceClass, 'synthetic-fixture');
  assert.equal(Object.isFrozen(record.document.edges[0].target.file), true);
  f.document.edges[0].specifier = 'replacement';
  assert.equal(record.document.edges[0].specifier, 'file-type');
  assert.equal(f.profile.certifications.runtimeDependencyIdentity, false);
  assert.equal(f.profile.certifications.executionAuthorized, false);
});

const refused = { message: 'RUNTIME_RESOLUTION_REFUSED' };
for (const [name, change] of [
  ['extra public field', d => { d.executionAuthorized = true; }],
  ['unsupported version', d => { d.version = 2; }],
  ['unknown evidence class', d => { d.evidenceClass = 'production-ready'; }],
  ['wrong profile identity', d => { d.manifestSha256 = 'b'.repeat(64); }],
  ['wrong candidate', d => { d.buildCommitSha = 'b'.repeat(40); }],
  ['wrong harness', d => { d.harnessCommitSha = 'b'.repeat(40); }],
  ['wrong run', d => { d.runId = 'otherfixture'; }],
  ['wrong runtime', d => { d.runtime.arch = 'x64'; }],
  ['extra runtime flag', d => { d.runtime.flag = '--conditions=evil'; }],
  ['runtime pin size bound', d => { d.runtime.executable.size = 129 * 1024 * 1024; }],
  ['missing dependency root', d => { d.dependencyRoots = []; }],
  ['mutable dependency root', d => { d.dependencyRoots = ['C:\\Synthetic\\run\\private\\deps']; }],
  ['ancestor dependency root', d => { d.dependencyRoots = ['C:\\Synthetic']; }],
  ['overlapping dependency roots', d => { d.dependencyRoots.push('C:\\Synthetic\\dependencies\\nested'); }],
  ['escaped target', d => { d.edges[0].target.file.path = 'C:\\Other\\index.js'; }],
  ['case-aliased dependency root target', d => { d.edges[0].target.file.path = 'C:\\Synthetic\\DEPENDENCIES\\file-type\\index.js'; }],
  ['case-aliased metadata', d => { d.packageMetadata.push({ ...d.packageMetadata[0], path: 'C:\\Synthetic\\PACKAGE.JSON' }); }],
  ['metadata is not package JSON', d => { d.packageMetadata[0].path = 'C:\\Synthetic\\.env'; }],
  ['unsafe metadata path', d => { d.packageMetadata[0].path = 'C:\\Synthetic\\x\\..\\package.json'; }],
  ['metafile path traversal', d => { d.metafile.outputKey = '../dist/index.js'; }],
  ['metafile size bound', d => { d.metafile.file.size = 8 * 1024 * 1024 + 1; }],
  ['specifier URL', d => { d.edges[0].specifier = 'https://example.invalid/a'; }],
  ['specifier traversal', d => { d.edges[0].specifier = 'file-type/../x'; }],
  ['unknown builtin', d => { d.edges[1].specifier = d.edges[1].target.name = 'node:not-a-real-builtin'; }],
  ['builtin masquerades as a file', d => { d.edges[1].target = d.edges[0].target; }],
  ['wrong builtin identity', d => { d.edges[1].target.name = 'node:fs'; }],
  ['CJS masquerades as ESM file coverage', d => { d.edges[2].target = d.edges[0].target; }],
  ['ESM falsely uncovered', d => { d.edges[0].target = d.edges[2].target; }],
  ['unsupported edge kind', d => { d.edges[0].kind = 'require-resolve'; }],
  ['zero occurrence count', d => { d.edges[0].occurrences = 0; }],
  ['unbounded occurrences', d => { d.edges[0].occurrences = 4097; }],
  ['duplicate edge', d => { d.edges.splice(1, 0, structuredClone(d.edges[0])); }],
  ['unsorted edge', d => { d.edges.reverse(); }],
  ['omitted nonliteral set', d => { delete d.uncoveredNonliteral; }],
  ['unsupported nonliteral assertion', d => { d.uncoveredNonliteral[0].reason = 'proven-absent'; }],
]) test(`refuses ${name} even with regenerated fixture-consistency hashes`, () => {
  const f = fixture(); change(f.document); assert.throws(() => f.read(), refused);
});

test('independent unchanged pins reject modified inventory bytes and class substitution', () => {
  const f = fixture(); const pins = f.pins(); f.document.edges[0].occurrences++;
  assert.throws(() => f.read(f.document, pins), refused);
  const g = fixture(); const expected = g.pins(); g.document.evidenceClass = 'declared-installed-candidate';
  assert.throws(() => g.read(g.document, expected), refused);
});
test('forged profile records, unsafe caller descriptors and malformed canonical bytes refuse', () => {
  const f = fixture(); assert.throws(() => f.read(f.document, f.pins(), structuredClone(f.profile)), refused);
  let touched = 0; const getter = { ...f.pins(), get approvalRef() { touched++; return 'unsafe'; } };
  assert.throws(() => f.read(f.document, getter), refused);
  const proxy = new Proxy(f.pins(), { ownKeys() { touched++; return []; } });
  assert.throws(() => f.read(f.document, proxy), refused); assert.equal(touched, 0);
  for (const text of ['{}', canonicalJson(f.document) + '\n', '{"kind":1,"kind":2}', 'x'.repeat(262145)]) {
    assert.throws(() => runtime.readRuntimeResolutionInventory(f.profile, text, f.pins()), refused);
  }
});
test('pure inventory read does not inspect paths, open files or spawn metadata processes', t => {
  const f = fixture(); let calls = 0;
  const deny = () => { calls++; throw new Error('UNEXPECTED_IO'); };
  t.mock.method(fs, 'openSync', deny); t.mock.method(fs, 'lstatSync', deny); t.mock.method(childProcess, 'execFile', deny);
  f.read(); assert.equal(calls, 0);
});

const sha = value => createHash('sha256').update(value).digest('hex');
function fakeObservation(t, change = () => {}) {
  const entry = Buffer.from('throw new Error("DO_NOT_EVALUATE_ENTRY");\n');
  const source = manifestFixture(); Object.assign(source.build.artifacts[0], { size: entry.length, sha256: sha(entry) });
  const f = fixture(source); f.document.edges.shift();
  const meta = { inputs: {}, outputs: { 'dist/index.js': { entryPoint: 'server/index-prod.ts', bytes: entry.length,
    inputs: {}, exports: [], imports: f.document.edges.map(edge => ({ path: edge.specifier, kind: edge.kind, external: true })) } } };
  const virtual = new Map(); let serial = 10n;
  const put = (name, bytes) => { const file = { bytes: Buffer.from(bytes), ino: serial++, nlink: 1n, changed: 1_000_000_000n }; virtual.set(name, file); return file; };
  put('C:\\Synthetic\\build\\index.js', entry);
  put(f.document.runtime.executable.path, 'inert synthetic executable bytes');
  put(f.document.packageMetadata[0].path, '{"type":"module"}');
  put(f.document.metafile.file.path, JSON.stringify(meta, null, 2));
  put('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'inert bridge bytes');
  const state = { f, meta, virtual, put, reads: [], opened: [], closed: [], metadataCalls: 0, onRead() {}, beforeOpen() {}, reparse: false };
  change(state);
  for (const pin of [f.document.runtime.executable, f.document.metafile.file, ...f.document.packageMetadata]) {
    const bytes = virtual.get(pin.path).bytes; pin.size = bytes.length; pin.sha256 = sha(bytes);
  }
  const descriptors = new Map(); const directoryIds = new Map();
  const stat = (name, file = virtual.get(name)) => ({ dev: 1n, ino: file?.ino ?? (directoryIds.has(name) ? directoryIds.get(name) : (directoryIds.set(name, serial++), directoryIds.get(name))),
    mode: file ? 33206n : 16877n, nlink: file?.nlink ?? 1n, size: BigInt(file?.bytes.length ?? 0), birthtimeNs: 1_000_000_000n,
    ctimeNs: file?.changed ?? 1_000_000_000n, mtimeNs: file?.changed ?? 1_000_000_000n,
    isSymbolicLink: () => false, isDirectory: () => !file, isFile: () => Boolean(file) });
  for (const [key, value] of Object.entries({ execPath: f.document.runtime.executable.path, execArgv: ['--experimental-import-meta-resolve'],
    env: { PROCESSOR_ARCHITECTURE: 'ARM64', SystemRoot: 'C:\\Windows', TZ: 'UTC', TEMP: 'C:\\Synthetic\\run\\private\\temp', TMP: 'C:\\Synthetic\\run\\private\\temp' } })) {
    const descriptor = Object.getOwnPropertyDescriptor(process, key); Object.defineProperty(process, key, { ...descriptor, value });
    t.after(() => Object.defineProperty(process, key, descriptor));
  }
  t.mock.method(fs, 'lstatSync', name => stat(name));
  t.mock.method(fs.realpathSync, 'native', name => name);
  t.mock.method(fs, 'openSync', (name, flags) => { assert.equal(flags, fs.constants.O_RDONLY); state.beforeOpen(name);
    assert.ok(virtual.has(name)); const fd = state.opened.length + 100; state.opened.push(fd); descriptors.set(fd, { name, file: virtual.get(name) }); return fd; });
  t.mock.method(fs, 'fstatSync', fd => { assert.ok(descriptors.has(fd)); const item = descriptors.get(fd); return stat(item.name, item.file); });
  t.mock.method(fs, 'readSync', (fd, buffer, offset, length, position) => { const item = descriptors.get(fd); state.reads.push(item.name); state.onRead(item.name);
    return item.file.bytes.copy(buffer, offset, position, position + length); });
  t.mock.method(fs, 'closeSync', fd => { assert.ok(descriptors.delete(fd)); state.closed.push(fd); });
  t.mock.method(childProcess, 'execFile', (executable, args, options, callback) => {
    state.metadataCalls++; assert.equal(executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
    return { stdin: { on() {}, end(input) { const rows = JSON.parse(input).map(name => {
      const node = stat(name); return { path: name, directory: node.isDirectory(), attributes: state.reparse ? 0x400 : node.isDirectory() ? 16 : 32,
        size: String(node.size), creationTicks: '621355968010000000', writeTicks: String(621355968000000000n + node.mtimeNs / 100n) };
    }); queueMicrotask(() => callback(null, JSON.stringify(rows))); } } };
  });
  state.observe = async (record = f.read(), options = { systemRoot: 'C:\\Windows' }) => {
    assert.equal(typeof runtime.observeRuntimeResolution, 'function', 'the bounded observer is implemented');
    return runtime.observeRuntimeResolution(record, options);
  };
  return state;
}
test('fake-only readback classifies identifiers and CJS gaps and closes every descriptor', async t => {
  const s = fakeObservation(t); const result = await s.observe();
  assert.equal(result.evidenceClass, 'synthetic-fixture');
  assert.deepEqual(result.coverage.builtinIdentifiers, [{ kind: 'import-statement', specifier: 'node:crypto', name: 'node:crypto', occurrences: 1 }]);
  assert.deepEqual(result.coverage.uncoveredRequireCalls, [{ specifier: 'posthog-node', occurrences: 1 }]);
  assert.deepEqual(result.certifications, { esmRootResolutionsObserved: true, selectedEntryBytesObserved: true,
    transitiveClosureComplete: false, custodyHeld: false, runtimeDependencyIdentity: false, executionAuthorized: false });
  assert.equal(s.metadataCalls, 2); assert.equal(s.opened.length, 4); assert.deepEqual(s.closed, s.opened);
});
for (const [name, change] of [
  ['missing literal root', s => { s.meta.outputs['dist/index.js'].imports.pop(); }],
  ['extra literal root', s => { s.meta.outputs['dist/index.js'].imports.push({ path: 'zod', kind: 'import-statement', external: true }); }],
  ['changed occurrence count', s => { s.meta.outputs['dist/index.js'].imports.push(s.meta.outputs['dist/index.js'].imports[0]); }],
  ['wrong entry provenance', s => { s.meta.outputs['dist/index.js'].entryPoint = 'server/other.ts'; }],
  ['wrong output byte count', s => { s.meta.outputs['dist/index.js'].bytes++; }],
  ['unclassified external kind', s => { s.meta.outputs['dist/index.js'].imports[0].kind = 'require-resolve'; }],
  ['nonexternal output root', s => { s.meta.outputs['dist/index.js'].imports[0].external = false; }],
]) test(`fake-only observer refuses ${name}`, async t => {
  const s = fakeObservation(t, state => { change(state); state.put(state.f.document.metafile.file.path, JSON.stringify(state.meta)); });
  await assert.rejects(s.observe(), refused); assert.deepEqual(s.closed, s.opened);
});
test('fake-only observer rejects changed file bytes and closes failure descriptors', async t => {
  const s = fakeObservation(t); const record = s.f.read();
  s.virtual.get(s.f.document.runtime.executable.path).bytes.fill(1);
  await assert.rejects(s.observe(record), refused); assert.deepEqual(s.closed, s.opened);
});
test('forged observer record and ambient runtime flags refuse before file IO', async t => {
  const s = fakeObservation(t); const record = s.f.read();
  await assert.rejects(s.observe(structuredClone(record)), refused);
  process.execArgv.push('--conditions=unsafe'); await assert.rejects(s.observe(record), refused);
  assert.equal(s.opened.length, 0); assert.equal(s.metadataCalls, 0);
});
test('fake-only hardlink identity refuses before metadata or descriptor reads', async t => {
  const s = fakeObservation(t, state => { state.virtual.get(state.f.document.runtime.executable.path).nlink = 2n; });
  await assert.rejects(s.observe(), refused); assert.equal(s.metadataCalls, 0); assert.equal(s.opened.length, 0);
});
test('fake-only generic reparse metadata refuses before descriptor reads', async t => {
  const s = fakeObservation(t, state => { state.reparse = true; });
  await assert.rejects(s.observe(), refused); assert.equal(s.metadataCalls, 1); assert.equal(s.opened.length, 0);
});
test('fake-only same-byte path replacement after open is detected independently of hashing', async t => {
  const s = fakeObservation(t); let replaced = false;
  s.onRead = name => { if (!replaced) { replaced = true; s.put(name, s.virtual.get(name).bytes); } };
  await assert.rejects(s.observe(), refused); assert.equal(replaced, true); assert.deepEqual(s.closed, s.opened);
});
test('fake-only timestamp mutation while reading is detected even when the bytes remain identical', async t => {
  const s = fakeObservation(t); let mutated = false;
  s.onRead = name => { if (!mutated) { mutated = true; s.virtual.get(name).changed += 100n; } };
  await assert.rejects(s.observe(), refused); assert.equal(mutated, true); assert.deepEqual(s.closed, s.opened);
});
test('fake-only controlling metadata mutation after initial reads refuses with closed descriptors', async t => {
  const s = fakeObservation(t); let metaReads = 0; let mutated = false;
  s.onRead = name => { if (name === s.f.document.metafile.file.path && ++metaReads === 2) {
    s.virtual.get(s.f.document.packageMetadata[0].path).bytes.fill(32); mutated = true;
  } };
  await assert.rejects(s.observe(), refused); assert.equal(mutated, true); assert.deepEqual(s.closed, s.opened);
});
test('fake-only missing selected file refuses without a metadata process', async t => {
  const s = fakeObservation(t); s.virtual.delete(s.f.document.runtime.executable.path);
  await assert.rejects(s.observe(), refused); assert.equal(s.metadataCalls, 0); assert.equal(s.opened.length, 0);
});
test('fake-only raw formatted metafile above canonical-inventory size remains a separately hashed artifact', async t => {
  const s = fakeObservation(t, state => {
    state.meta.inputs = Object.fromEntries(Array.from({ length: 5000 }, (_, n) => [`server/fixture-source-${n}.ts`, { bytes: 1, imports: [], format: 'esm' }]));
    state.put(state.f.document.metafile.file.path, JSON.stringify(state.meta, null, 2));
  });
  assert.ok(s.f.document.metafile.file.size > 256 * 1024);
  const result = await s.observe(); assert.equal(result.certifications.runtimeDependencyIdentity, false);
  assert.deepEqual(s.closed, s.opened);
});
for (const [name, change] of [
  ['metafile input count', s => { s.meta.inputs = Object.fromEntries(Array.from({ length: 8193 }, (_, n) => [String(n), {}])); }],
  ['metafile output count', s => { for (let n = 0; n < 8; n++) s.meta.outputs[`extra-${n}.js`] = {}; }],
  ['metafile import count', s => { s.meta.outputs['dist/index.js'].imports = Array.from({ length: 4097 }, () => ({ path: 'node:fs', kind: 'import-statement', external: true })); }],
]) test(`fake-only ${name} bound refuses instead of truncating`, async t => {
  const s = fakeObservation(t, state => { change(state); state.put(state.f.document.metafile.file.path, JSON.stringify(state.meta)); });
  await assert.rejects(s.observe(), refused); assert.deepEqual(s.closed, s.opened);
});
test('fake-only observer options and ambient credentials refuse before inspecting any file', async t => {
  const s = fakeObservation(t); let getters = 0;
  await assert.rejects(s.observe(s.f.read(), { get systemRoot() { getters++; return 'C:\\Windows'; } }), refused);
  assert.equal(getters, 0); process.env.SMTP_PASS = 'UNSAFE_PAYLOAD_SENTINEL';
  await assert.rejects(s.observe(), error => error.message === 'RUNTIME_RESOLUTION_REFUSED' && !error.stack.includes('UNSAFE_PAYLOAD_SENTINEL'));
  assert.equal(s.opened.length, 0); assert.equal(s.metadataCalls, 0);
});
test('fake-only observer accepts the exact effective Windows ARM64 environment', async t => {
  const s = fakeObservation(t); process.env.PROCESSOR_ARCHITECTURE = 'ARM64';
  const result = await s.observe(); assert.equal(result.evidenceClass, 'synthetic-fixture'); assert.equal(s.metadataCalls, 2);
});
test('fake-only observer refuses a missing OS architecture key before file IO', async t => {
  const s = fakeObservation(t); delete process.env.PROCESSOR_ARCHITECTURE;
  await assert.rejects(s.observe(), refused); assert.equal(s.opened.length, 0); assert.equal(s.metadataCalls, 0);
});
for (const [name, change] of [
  ['wrong OS architecture', () => { process.env.PROCESSOR_ARCHITECTURE = 'AMD64'; }],
  ['extra effective variable', () => { process.env.PROCESSOR_ARCHITECTURE = 'ARM64'; process.env.EXTRA = 'forbidden'; }],
]) test(`fake-only observer refuses ${name}`, async t => {
  const s = fakeObservation(t); change(); await assert.rejects(s.observe(), refused); assert.equal(s.opened.length, 0);
});
test('fixed native fixture environment binds the mandatory OS architecture and no arbitrary extras', () => {
  assert.equal(typeof nativeFixtureEnvironment, 'function', 'the native fixture consumes a pure exact effective-environment policy');
  const env = { PROCESSOR_ARCHITECTURE: 'ARM64', SystemRoot: 'C:\\Windows', TZ: 'UTC', TEMP: 'C:\\Synthetic\\temp', TMP: 'C:\\Synthetic\\temp' };
  assert.equal(nativeFixtureEnvironment(env, 'arm64', env.TEMP), true);
  const missing = { ...env }; delete missing.PROCESSOR_ARCHITECTURE;
  assert.equal(nativeFixtureEnvironment(missing, 'arm64', env.TEMP), false);
  assert.equal(nativeFixtureEnvironment({ ...env, PROCESSOR_ARCHITECTURE: 'AMD64' }, 'arm64', env.TEMP), false);
  assert.equal(nativeFixtureEnvironment(env, 'x64', env.TEMP), false);
  assert.equal(nativeFixtureEnvironment({ ...env, EXTRA: 'forbidden' }, 'arm64', env.TEMP), false);
});
function fakeFileResolution(t, resolvedName) {
  const s = fakeObservation(t); const target = 'C:\\Synthetic\\dependencies\\index.js';
  const bytes = Buffer.from('throw new Error("DO_NOT_EVALUATE_DEPENDENCY");'); s.put(target, bytes);
  s.f.document.edges[0] = { kind: 'import-statement', specifier: 'crypto', occurrences: 1,
    target: { kind: 'file', file: { path: target, size: bytes.length, sha256: sha(bytes) } } };
  s.meta.outputs['dist/index.js'].imports[0].path = 'crypto';
  const metaBytes = Buffer.from(JSON.stringify(s.meta)); s.put(s.f.document.metafile.file.path, metaBytes);
  Object.assign(s.f.document.metafile.file, { size: metaBytes.length, sha256: sha(metaBytes) });
  // Test-only adapters exercise the file branch using a builtin-only native
  // resolver result. There is no installed package lookup or custom loader.
  const originalIsBuiltin = moduleBuiltin.isBuiltin;
  t.mock.method(moduleBuiltin, 'isBuiltin', value => value === 'crypto' ? false : originalIsBuiltin(value)); syncBuiltinESMExports();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'URL'); const OriginalURL = globalThis.URL;
  Object.defineProperty(globalThis, 'URL', { ...descriptor, value: class extends OriginalURL {
    constructor(value, base) { super(value === 'node:crypto' ? `file:///C:/Synthetic/dependencies/${resolvedName}` : value, base); }
  } });
  t.after(() => { Object.defineProperty(globalThis, 'URL', descriptor); t.mock.restoreAll(); syncBuiltinESMExports(); });
  return s;
}
test('fake-only file branch reads pinned bytes and records the exact resolved spelling', async t => {
  const s = fakeFileResolution(t, 'index.js'); const result = await s.observe();
  assert.equal(result.coverage.esmStatic[0].relativePath, 'index.js'); assert.equal(s.opened.length, 5);
  assert.deepEqual(s.closed, s.opened);
});
test('fake-only differently cased native result cannot attest the pinned file bytes', async t => {
  const s = fakeFileResolution(t, 'INDEX.js'); await assert.rejects(s.observe(), refused);
  assert.deepEqual(s.closed, s.opened);
});
test('fake-only differently cased executable cannot attest the pinned Node bytes', async t => {
  const s = fakeObservation(t); process.execPath = process.execPath.replace('node.exe', 'NODE.EXE');
  await assert.rejects(s.observe(), refused); assert.equal(s.opened.length, 0);
});
function allocationFixture() {
  assert.equal(typeof nativeFixtureProtocol, 'function', 'the fixed native protocol declarations exist');
  const fixed = nativeFixtureProtocol();
  return { kind: 'pfa-runtime-resolution-fixture-allocation', version: 1, runId: fixed.runId, evidenceClass: 'synthetic-fixture', root: fixed.root,
    runtime: { executable: { path: fixed.node, size: 100, sha256: 'a'.repeat(64) }, version: '24.22.0', platform: 'win32', arch: 'arm64', flag: '--experimental-import-meta-resolve' },
    harnessCommitSha: '2'.repeat(40), approvalRef: 'review/synthetic-native', harnessFiles: fixed.harnessFiles.map(file => ({ path: file, size: 100, sha256: 'a'.repeat(64) })),
    expectedFixtureBlueprintSha256: '3'.repeat(64), expectedFixtureManifestSha256: '4'.repeat(64), expectedFixtureInventorySha256: '5'.repeat(64) };
}
test('fixed native allocation is copied from supplied expectations without filesystem derivation', t => {
  const allocation = allocationFixture(); let reads = 0; t.mock.method(fs, 'readFileSync', () => { reads++; throw new Error('UNEXPECTED_IO'); });
  assert.equal(typeof readFixtureAllocation, 'function'); const record = readFixtureAllocation(canonicalJson(allocation));
  assert.equal(Object.isFrozen(record.harnessFiles[0]), true); assert.equal(record.expectedFixtureInventorySha256, '5'.repeat(64));
  allocation.runtime.executable.sha256 = 'b'.repeat(64); assert.equal(record.runtime.executable.sha256, 'a'.repeat(64)); assert.equal(reads, 0);
});
test('fixed native protocol names the physical runtime path rather than the redirected logical alias', () => {
  assert.equal(nativeFixtureProtocol().node,
    `${windowsProfile}\\AppData\\Local\\Packages\\OpenAI.Codex_2p2nqsd0c76g0\\LocalCache\\Local\\capital-r00-runtime\\node-v24.22.0-win-arm64\\node.exe`);
});
test('fixed native allocation rejects the historical logical runtime alias even with matching byte pins', () => {
  const allocation = allocationFixture();
  allocation.runtime.executable.path = `${windowsProfile}\\AppData\\Local\\capital-r00-runtime\\node-v24.22.0-win-arm64\\node.exe`;
  assert.throws(() => readFixtureAllocation(canonicalJson(allocation)), refused);
});
test('fresh native protocol separates existing parent temp from the absent fixture root', () => {
  const fixed = nativeFixtureProtocol();
  assert.equal(fixed.runId, 'r20res20261028b1');
  assert.equal(fixed.root, `${windowsProfile}\\.codex\\worktrees\\capital-completion-v2\\personal-finance-app\\.local\\r20-runtime-resolution-oct28b`);
  assert.equal(fixed.temporary, `${windowsProfile}\\.codex\\worktrees\\capital-completion-v2\\personal-finance-app\\.local\\r20-installed-resolution-oct28\\native-temp`);
  assert.equal(fixed.temporary.startsWith(fixed.root + '\\'), false);
});
for (const [name, change] of [
  ['historical run', value => { value.runId = 'r20res20261028a1'; }],
  ['historical nonreusable root', value => { value.root = `${windowsProfile}\\.codex\\worktrees\\capital-completion-v2\\personal-finance-app\\.local\\r20-runtime-resolution-oct28`; }],
]) test(`fixed native allocation rejects ${name}`, () => {
  const value = allocationFixture(); change(value); assert.throws(() => readFixtureAllocation(canonicalJson(value)), refused);
});
test('fake preallocation keeps root absent when metadata children materialize their external temp', async t => {
  assert.equal(typeof verifyFixturePreallocation, 'function', 'the actual native consumer has a bounded preallocation boundary');
  const s = fakeObservation(t); const fixed = nativeFixtureProtocol(); let rootExists = false; let absenceChecks = 0; let childCalls = 0;
  process.env.TEMP = process.env.TMP = fixed.temporary;
  t.mock.method(fs, 'existsSync', file => { assert.equal(file, fixed.root); absenceChecks++; return rootExists; });
  const dispatch = childProcess.execFile;
  t.mock.method(childProcess, 'execFile', (...args) => {
    childCalls++; assert.ok(absenceChecks > 0); assert.equal(rootExists, false);
    // Fake the Windows child's temp materialization without creating a file.
    if (process.env.TEMP.startsWith(fixed.root + '\\')) rootExists = true;
    assert.equal(process.env.TEMP, fixed.temporary);
    const child = dispatch(...args); const end = child.stdin.end;
    child.stdin.end = input => { const paths = JSON.parse(input); assert.ok(paths.includes(fixed.temporary));
      assert.ok(paths.includes(path.win32.dirname(fixed.root))); end(input); };
    return child;
  });
  await verifyFixturePreallocation({ runtime: { executable: s.f.document.runtime.executable }, harnessFiles: [s.f.document.metafile.file] });
  assert.equal(rootExists, false); assert.equal(absenceChecks, 2); assert.equal(childCalls, 2);
  assert.deepEqual(s.closed, s.opened);
});
for (const phase of ['already-exists', 'child-created']) test(`fake preallocation refuses ${phase} root without adopting or deleting it`, async t => {
  const s = fakeObservation(t); const fixed = nativeFixtureProtocol(); let rootExists = phase === 'already-exists'; let dispatches = 0;
  process.env.TEMP = process.env.TMP = fixed.temporary;
  t.mock.method(fs, 'existsSync', file => { assert.equal(file, fixed.root); return rootExists; });
  const dispatch = childProcess.execFile;
  t.mock.method(childProcess, 'execFile', (...args) => { dispatches++; rootExists = true; return dispatch(...args); });
  await assert.rejects(verifyFixturePreallocation({ runtime: { executable: s.f.document.runtime.executable }, harnessFiles: [s.f.document.metafile.file] }));
  assert.equal(rootExists, true); assert.equal(dispatches, phase === 'already-exists' ? 0 : 2); assert.deepEqual(s.closed, s.opened);
});
for (const [name, change] of [
  ['installed class', value => { value.evidenceClass = 'declared-installed-candidate'; }],
  ['alternate root', value => { value.root += '-other'; }],
  ['missing source expectation', value => { value.harnessFiles.pop(); }],
  ['extra source expectation', value => { value.harnessFiles.push({ path: 'C:\\Synthetic\\extra.mjs', size: 1, sha256: 'a'.repeat(64) }); }],
  ['missing expected digest', value => { delete value.expectedFixtureBlueprintSha256; }],
  ['runtime override', value => { value.runtime.executable.path = 'C:\\Other\\node.exe'; }],
]) test(`fixed native allocation refuses ${name}`, () => {
  const value = allocationFixture(); change(value); assert.throws(() => readFixtureAllocation(canonicalJson(value)), refused);
});
test('literal native blueprint derives synthetic expectations independently of observer or disk output', t => {
  const allocation = allocationFixture(); t.mock.method(fs, 'readFileSync', () => { throw new Error('UNEXPECTED_IO'); });
  assert.equal(typeof nativeFixtureDeclarations, 'function'); const first = nativeFixtureDeclarations(allocation); const second = nativeFixtureDeclarations(allocation);
  assert.equal(first.blueprintSha256, second.blueprintSha256); assert.equal(first.projects.length, 4);
  assert.notEqual(first.projects[0].inventory.edges[0].target.file.path, first.projects[1].inventory.edges[0].target.file.path);
  assert.ok(first.blueprint.some(file => file.optionalCaseProbe));
  assert.ok(first.blueprint.some(file => file.contents.includes('evaluated.marker')));
  const changed = structuredClone(allocation); changed.runtime.executable.sha256 = 'b'.repeat(64);
  const other = nativeFixtureDeclarations(changed); assert.equal(other.blueprintSha256, first.blueprintSha256);
  assert.notEqual(digest(canonicalJson(other.projects[0].inventory)), digest(canonicalJson(first.projects[0].inventory)));
});

export function nativeFixtureProtocol() {
  const sourceRoot = path.win32.resolve(path.win32.dirname(fileURLToPath(import.meta.url)), '../../..');
  const relativeFiles = ['server/testing/production/runtime-resolution.mjs', 'server/testing/production/runtime-resolution.regression.mjs',
    'server/testing/production/manifest.mjs', 'server/testing/production/manifest.fixture.mjs', 'server/testing/production/primitives.mjs',
    'server/testing/production/layout.mjs', 'server/testing/production/services.mjs', 'server/testing/production/security.mjs',
    'scripts/recovery/windows-metadata.mjs', 'scripts/recovery/common.mjs', 'scripts/recovery/paths.mjs'];
  return freeze({ runId: 'r20res20261028b1', root: `${windowsProfile}\\.codex\\worktrees\\capital-completion-v2\\personal-finance-app\\.local\\r20-runtime-resolution-oct28b`,
    temporary: `${windowsProfile}\\.codex\\worktrees\\capital-completion-v2\\personal-finance-app\\.local\\r20-installed-resolution-oct28\\native-temp`,
    node: `${windowsProfile}\\AppData\\Local\\Packages\\OpenAI.Codex_2p2nqsd0c76g0\\LocalCache\\Local\\capital-r00-runtime\\node-v24.22.0-win-arm64\\node.exe`,
    harnessFiles: relativeFiles.map(file => path.win32.join(sourceRoot, file)).sort() });
}
export function readFixtureAllocation(text) {
  try {
    check(typeof text === 'string' && Buffer.byteLength(text) <= 65536); const value = parse(text); const fixed = nativeFixtureProtocol();
    shape(value, ['kind', 'version', 'runId', 'evidenceClass', 'root', 'runtime', 'harnessCommitSha', 'approvalRef', 'harnessFiles',
      'expectedFixtureBlueprintSha256', 'expectedFixtureManifestSha256', 'expectedFixtureInventorySha256']);
    check(value.kind === 'pfa-runtime-resolution-fixture-allocation' && value.version === 1 && value.evidenceClass === 'synthetic-fixture' &&
      value.runId === fixed.runId && value.root === fixed.root); hash(value.harnessCommitSha, 40);
    check(typeof value.approvalRef === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value.approvalRef));
    shape(value.runtime, ['executable', 'version', 'platform', 'arch', 'flag']);
    check(value.runtime.version === '24.22.0' && value.runtime.platform === 'win32' && value.runtime.arch === 'arm64' && value.runtime.flag === '--experimental-import-meta-resolve');
    const pin = (file, max) => { shape(file, ['path', 'size', 'sha256']); absolute(file.path); integer(file.size, max); hash(file.sha256); };
    pin(value.runtime.executable, 128 * 1024 * 1024); check(value.runtime.executable.path === fixed.node);
    check(Array.isArray(value.harnessFiles) && value.harnessFiles.length === fixed.harnessFiles.length);
    value.harnessFiles.forEach((file, index) => { pin(file, 1024 * 1024); check(file.path === fixed.harnessFiles[index]); });
    for (const key of ['expectedFixtureBlueprintSha256', 'expectedFixtureManifestSha256', 'expectedFixtureInventorySha256']) hash(value[key]);
    return freeze(value);
  } catch { throw new Error('RUNTIME_RESOLUTION_REFUSED'); }
}
export function nativeFixtureDeclarations(allocation) {
  const fixed = nativeFixtureProtocol(); const blueprint = []; const projects = [];
  const add = (name, contents, optionalCaseProbe = false) => { blueprint.push({ relativePath: name, contents, optionalCaseProbe }); };
  const json = value => JSON.stringify(value, null, 2) + '\n';
  const moduleBody = label => `import {writeFileSync} from "node:fs";writeFileSync(new URL("evaluated.marker",import.meta.url),"UNEXPECTED");\nexport default "${label}";\n`;
  for (const [id, kind] of [['a', 'import-statement'], ['b', 'dynamic-import'], ['shadow', 'import-statement'], ['case', 'import-statement']]) {
    const base = `project-${id}`; const entry = `throw new Error("ENTRY_${id}_MUST_NOT_EVALUATE");\n`;
    add(`${base}/dist/index.js`, entry); add(`${base}/package.json`, '{"type":"module"}\n');
    const packageAt = `${base}/node_modules/@r20/probe`;
    const packageJson = target => json({ name: '@r20/probe', type: 'module', exports: { import: target, require: './require.cjs' } });
    add(`${packageAt}/package.json`, packageJson(id === 'case' ? './ESM.mjs' : './esm.mjs'));
    add(`${packageAt}/esm.mjs`, moduleBody(id)); add(`${packageAt}/require.cjs`, 'throw new Error("REQUIRE_BRANCH_MUST_NOT_RUN");\n');
    if (id === 'case') add(`${packageAt}/ESM.mjs`, moduleBody('distinct-uppercase'), true);
    const selected = id === 'shadow' ? `${base}/dist/node_modules/@r20/probe` : packageAt;
    if (id === 'shadow') { add(`${selected}/package.json`, packageJson('./esm.mjs')); add(`${selected}/esm.mjs`, moduleBody('nearer-shadow')); add(`${selected}/require.cjs`, 'throw new Error("SHADOW_REQUIRE_MUST_NOT_RUN");\n'); }
    const imports = [{ path: '@r20/probe', kind, external: true }, { path: 'node:crypto', kind: 'import-statement', external: true }, { path: 'unexecuted-cjs', kind: 'require-call', external: true }];
    add(`${base}/meta.json`, json({ inputs: {}, outputs: { 'dist/index.js': { entryPoint: 'server/index-prod.ts', bytes: Buffer.byteLength(entry), inputs: {}, exports: [], imports } } }));
    const file = name => { const item = blueprint.find(item => item.relativePath === name); return { path: path.win32.join(fixed.root, name), size: Buffer.byteLength(item.contents), sha256: sha(item.contents) }; };
    const manifest = manifestFixture(); manifest.runId = fixed.runId; manifest.approvalRef = allocation.approvalRef; manifest.harnessCommitSha = allocation.harnessCommitSha;
    manifest.paths = { runRoot: fixed.root, buildRoot: path.win32.join(fixed.root, base, 'dist'), browserRuntimeRoot: path.win32.join(fixed.root, 'browser-runtime'),
      browserProfileRoot: path.win32.join(fixed.root, 'state', 'profile'), pgdataRoot: path.win32.join(fixed.root, 'state', 'pgdata'),
      publicTlsRoot: path.win32.join(fixed.root, 'state', 'public'), privateRoot: path.win32.join(fixed.root, 'state', 'private') };
    manifest.postgres.target.runId = fixed.runId; manifest.postgres.target.database = `pfa_completion_r20_${fixed.runId}_test`;
    manifest.postgres.expectedMarker = `pfa-synthetic-test:v1:${fixed.runId}:${manifest.postgres.target.database}`;
    manifest.redis.aclUser = `pfa_${fixed.runId}`; manifest.redis.keyPrefix = `pfa:production:${fixed.runId}:`;
    for (const [role, prefix] of [['https', 'https'], ['postgres', 'pg']]) {
      manifest.tls[role].ca.file.path = path.win32.join(manifest.paths.publicTlsRoot, 'ca.pem');
      manifest.tls[role].leaf.file.path = path.win32.join(manifest.paths.publicTlsRoot, `${prefix}.pem`);
    }
    manifest.chromium.executable.path = path.win32.join(manifest.paths.browserRuntimeRoot, 'chrome.exe');
    Object.assign(manifest.build.artifacts[0], { size: file(`${base}/dist/index.js`).size, sha256: file(`${base}/dist/index.js`).sha256 });
    const inventory = { kind: 'pfa-runtime-root-resolution', version: 1, evidenceClass: 'synthetic-fixture', manifestSha256: digest(canonicalJson(manifest)),
      runId: fixed.runId, buildCommitSha: manifest.build.commitSha, harnessCommitSha: allocation.harnessCommitSha, approvalRef: allocation.approvalRef,
      runtime: allocation.runtime, dependencyRoots: [path.win32.join(fixed.root, base, 'node_modules')], metafile: { file: file(`${base}/meta.json`), outputKey: 'dist/index.js' },
      packageMetadata: [file(`${base}/package.json`), file(`${packageAt}/package.json`)],
      edges: [{ specifier: '@r20/probe', kind, occurrences: 1, target: { kind: 'file', file: file(`${selected}/esm.mjs`) } },
        { specifier: 'node:crypto', kind: 'import-statement', occurrences: 1, target: { kind: 'builtin', name: 'node:crypto' } },
        { specifier: 'unexecuted-cjs', kind: 'require-call', occurrences: 1, target: { kind: 'uncovered', reason: 'require-conditions' } }], uncoveredNonliteral: [] };
    if (id === 'shadow') { inventory.dependencyRoots.push(path.win32.join(fixed.root, base, 'dist', 'node_modules')); inventory.packageMetadata.push(file(`${selected}/package.json`)); }
    inventory.dependencyRoots.sort(); inventory.packageMetadata.sort((a, b) => a.path < b.path ? -1 : 1); inventory.edges.sort((a, b) => `${a.kind}:${a.specifier}` < `${b.kind}:${b.specifier}` ? -1 : 1);
    projects.push({ id, manifest, inventory });
  }
  return { blueprint, blueprintSha256: digest(canonicalJson(blueprint)), projects };
}

function nativeRecords(project) {
  const m = project.manifest; const text = canonicalJson(m);
  const profile = readProductionManifest(text, { expectedManifestSha256: digest(text), runId: m.runId, profile: m.profile,
    buildCommitSha: m.build.commitSha, harnessCommitSha: m.harnessCommitSha, approvalRef: m.approvalRef,
    expectedArtifactsSha256: digest(canonicalJson(m.build.artifacts)),
    expectedServicesSha256: digest(canonicalJson({ endpoints: m.endpoints, postgres: m.postgres, redis: m.redis })),
    expectedSecuritySha256: digest(canonicalJson({ tls: m.tls, chromium: m.chromium, policy: m.policy })) });
  const d = project.inventory;
  return runtime.readRuntimeResolutionInventory(profile, canonicalJson(d), { expectedInventorySha256: digest(canonicalJson(d)),
    manifestSha256: d.manifestSha256, runId: d.runId, buildCommitSha: d.buildCommitSha, harnessCommitSha: d.harnessCommitSha,
    evidenceClass: d.evidenceClass, approvalRef: d.approvalRef });
}
test('every deterministic native project is a valid synthetic branded contract without IO', () => {
  for (const project of nativeFixtureDeclarations(allocationFixture()).projects) {
    assert.equal(nativeRecords(project).document.evidenceClass, 'synthetic-fixture');
  }
});
function fakeStdin(t) {
  const input = new EventEmitter(); let destroyed = 0; let paused = 0; let cleared = 0; let timeout;
  input.destroy = () => { destroyed++; }; input.pause = () => { paused++; };
  const descriptor = Object.getOwnPropertyDescriptor(process, 'stdin'); Object.defineProperty(process, 'stdin', { configurable: true, value: input });
  t.after(() => Object.defineProperty(process, 'stdin', descriptor));
  t.mock.method(globalThis, 'setTimeout', (fn, ms) => { assert.equal(ms, 5000); timeout = fn; return 1; });
  t.mock.method(globalThis, 'clearTimeout', () => { cleared++; });
  return { input, state: () => ({ destroyed, paused, cleared }), expire: () => timeout() };
}
test('fake stdin successful EOF clears its deadline and detaches all read listeners', async t => {
  const s = fakeStdin(t); const pending = readNativeStdin(); s.input.emit('data', Buffer.from('{}')); s.input.emit('end');
  assert.equal(await pending, '{}'); assert.equal(s.input.listenerCount('data'), 0); assert.equal(s.input.listenerCount('error'), 0);
  assert.equal(s.state().cleared, 1);
});
test('fake stdin non-EOF deadline stops its handle and listeners before rejecting', async t => {
  const s = fakeStdin(t); const pending = readNativeStdin(); s.expire(); await assert.rejects(pending, refused);
  assert.equal(s.input.listenerCount('data'), 0); assert.equal(s.input.listenerCount('end'), 0);
  assert.equal(s.state().cleared, 1); assert.ok(s.state().destroyed > 0 || s.state().paused > 0);
});
test('fake stdin malformed UTF8 is a caught refusal rather than an event callback throw', async t => {
  const s = fakeStdin(t); const pending = readNativeStdin(); s.input.emit('data', Buffer.from([255]));
  assert.doesNotThrow(() => s.input.emit('end')); await assert.rejects(pending, refused); assert.equal(s.input.listenerCount('data'), 0);
});
test('fake stdin overflow rejects and detaches its stream without retaining the input', async t => {
  const s = fakeStdin(t); const pending = readNativeStdin(); s.input.emit('data', Buffer.alloc(65537)); await assert.rejects(pending, refused);
  assert.equal(s.input.listenerCount('data'), 0); assert.equal(s.input.listenerCount('error'), 0); assert.ok(s.state().destroyed > 0);
});
test('fake native pin preflight attempts every descriptor close after one close fails', async t => {
  const s = fakeObservation(t); const close = fs.closeSync; const attempts = [];
  t.mock.method(fs, 'closeSync', fd => { attempts.push(fd); close(fd); if (attempts.length === 1) throw new Error('UNFILTERED_CLOSE_SENTINEL'); });
  await assert.rejects(verifyNativePins([s.f.document.runtime.executable, s.f.document.metafile.file], 'C:\\Synthetic', 'C:\\Windows'));
  assert.deepEqual(attempts, s.opened); assert.deepEqual(s.closed, s.opened);
});
const stableId = node => [node.dev, node.ino, node.birthtimeNs].map(String).join(':');
function localAncestors(file) {
  const result = [file]; while (path.win32.dirname(result[0]) !== result[0]) result.unshift(path.win32.dirname(result[0])); return result;
}
async function verifyNativePins(pins, parent, systemRoot) {
  const opened = []; const files = new Set(pins.map(pin => pin.path));
  const paths = Array.from(new Set([...pins.flatMap(pin => localAncestors(pin.path)), ...localAncestors(parent)])); check(paths.length <= 512);
  const snapshot = () => paths.map(file => { const node = fs.lstatSync(file, { bigint: true });
    check(!node.isSymbolicLink() && (files.has(file) ? node.isFile() && node.nlink === 1n : node.isDirectory()) && fs.realpathSync.native(file) === file);
    return node.isDirectory() ? stableId(node) : `${stableId(node)}:${node.size}:${node.mtimeNs}:${node.ctimeNs}`;
  });
  try {
    const before = snapshot(); const metadata = await readWindowsMetadata(paths, systemRoot);
    for (const pin of pins) {
      const fd = fs.openSync(pin.path, fs.constants.O_RDONLY); opened.push(fd); const initial = fs.fstatSync(fd, { bigint: true });
      check(initial.size === BigInt(pin.size) && initial.nlink === 1n && stableId(initial) === stableId(fs.lstatSync(pin.path, { bigint: true })));
      const buffer = Buffer.alloc(65536); const hasher = createHash('sha256'); let position = 0;
      while (position < pin.size) { const n = fs.readSync(fd, buffer, 0, Math.min(buffer.length, pin.size - position), position); check(n > 0); hasher.update(buffer.subarray(0, n)); position += n; }
      check(hasher.digest('hex') === pin.sha256 && stableId(initial) === stableId(fs.fstatSync(fd, { bigint: true })));
    }
    const afterMetadata = await readWindowsMetadata(paths, systemRoot);
    const stableMetadata = rows => rows.map(row => row.directory ? { path: row.path, attributes: row.attributes, directory: true, creationTicks: row.creationTicks } : row);
    check(JSON.stringify(stableMetadata(metadata)) === JSON.stringify(stableMetadata(afterMetadata)) && JSON.stringify(before) === JSON.stringify(snapshot()));
  } finally { let failed = false; for (const fd of opened) { try { fs.closeSync(fd); } catch { failed = true; } }
    if (failed) throw new Error('RUNTIME_RESOLUTION_REFUSED'); }
}
function readNativeStdin() {
  return new Promise((resolve, reject) => {
    const input = process.stdin; const chunks = []; let bytes = 0; let settled = false; let timer;
    const settle = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer);
      input.removeListener('data', data); input.removeListener('end', end); input.removeListener('error', fail); input.removeListener('close', fail);
      chunks.length = 0; input.pause(); if (error) { input.destroy(); reject(new Error('RUNTIME_RESOLUTION_REFUSED')); } else resolve(value);
    };
    const fail = () => settle(true);
    const data = chunk => { if (!Buffer.isBuffer(chunk) || (bytes += chunk.length) > 65536) fail(); else chunks.push(Buffer.from(chunk)); };
    const end = () => { try { settle(false, new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { fail(); } };
    timer = setTimeout(fail, 5000); input.on('error', fail); input.on('close', fail); input.on('data', data); input.on('end', end);
  });
}
function nativeFixtureEnvironment(env, arch, temporary) {
  return Object.keys(env).length === 5 && ['PROCESSOR_ARCHITECTURE', 'SystemRoot', 'TZ', 'TEMP', 'TMP'].every(key => Object.hasOwn(env, key)) &&
    env.PROCESSOR_ARCHITECTURE === 'ARM64' && arch === 'arm64' && env.TZ === 'UTC' && env.TEMP === temporary && env.TMP === env.TEMP;
}
async function verifyFixturePreallocation(allocation) {
  const fixed = nativeFixtureProtocol();
  check(nativeFixtureEnvironment(process.env, process.arch, fixed.temporary));
  check(!fs.existsSync(fixed.root));
  await verifyNativePins([allocation.runtime.executable, ...allocation.harnessFiles], fixed.temporary, process.env.SystemRoot);
  check(!fs.existsSync(fixed.root));
}
async function runNativeFixture(text) {
  const allocation = readFixtureAllocation(text); const fixed = nativeFixtureProtocol(); const declarations = nativeFixtureDeclarations(allocation);
  check(process.execPath === allocation.runtime.executable.path && process.version === 'v24.22.0' && process.platform === 'win32' && process.arch === 'arm64' &&
    process.execArgv.length === 1 && process.execArgv[0] === '--experimental-import-meta-resolve');
  check(nativeFixtureEnvironment(process.env, process.arch, fixed.temporary)); absolute(process.env.SystemRoot);
  check(declarations.blueprintSha256 === allocation.expectedFixtureBlueprintSha256 &&
    digest(canonicalJson(declarations.projects[0].manifest)) === allocation.expectedFixtureManifestSha256 &&
    digest(canonicalJson(declarations.projects[0].inventory)) === allocation.expectedFixtureInventorySha256);
  await verifyFixturePreallocation(allocation); fs.mkdirSync(fixed.root); const rootId = stableId(fs.lstatSync(fixed.root, { bigint: true }));
  const directories = new Map([[fixed.root, rootId]]); const files = new Map(); const outcomes = []; let caseSupported = true; let cleanup = false;
  const assertRoot = () => check(fs.realpathSync.native(fixed.root) === fixed.root && stableId(fs.lstatSync(fixed.root, { bigint: true })) === rootId);
  const mkdir = directory => { if (directories.has(directory)) return; mkdir(path.win32.dirname(directory)); assertRoot(); fs.mkdirSync(directory); directories.set(directory, stableId(fs.lstatSync(directory, { bigint: true }))); };
  const inspectOwned = async () => {
    assertRoot(); const paths = [...directories.keys(), ...files.keys()]; check(paths.length <= 128); await readWindowsMetadata(paths, process.env.SystemRoot);
    for (const [file, id] of [...directories, ...files]) { const node = fs.lstatSync(file, { bigint: true }); check(!node.isSymbolicLink() && fs.realpathSync.native(file) === file && stableId(node) === id && (directories.has(file) ? node.isDirectory() : node.isFile() && node.nlink === 1n)); }
    const expected = new Set([...directories.keys(), ...files.keys()]);
    for (const directory of directories.keys()) for (const name of fs.readdirSync(directory)) check(expected.has(path.win32.join(directory, name)));
  };
  try {
    for (const item of declarations.blueprint) {
      const file = path.win32.join(fixed.root, item.relativePath); check(file.startsWith(fixed.root + '\\')); mkdir(path.win32.dirname(file)); assertRoot();
      try { fs.writeFileSync(file, item.contents, { flag: 'wx' }); files.set(file, stableId(fs.lstatSync(file, { bigint: true }))); }
      catch (error) { if (item.optionalCaseProbe && error.code === 'EEXIST') caseSupported = false; else throw error; }
    }
    await inspectOwned(); const options = { systemRoot: process.env.SystemRoot };
    for (const project of declarations.projects.slice(0, 3)) {
      assertRoot(); const result = await runtime.observeRuntimeResolution(nativeRecords(project), options);
      check(result.evidenceClass === 'synthetic-fixture' && result.certifications.runtimeDependencyIdentity === false);
      outcomes.push(`${project.id}:native-import-resolution-and-bytes`);
    }
    const requireMismatch = structuredClone(declarations.projects[0]);
    const pin = requireMismatch.inventory.edges.find(edge => edge.target.kind === 'file').target.file;
    const body = declarations.blueprint.find(file => file.relativePath === 'project-a/node_modules/@r20/probe/require.cjs').contents;
    Object.assign(pin, { path: path.win32.join(fixed.root, 'project-a/node_modules/@r20/probe/require.cjs'), size: Buffer.byteLength(body), sha256: sha(body) });
    await assert.rejects(runtime.observeRuntimeResolution(nativeRecords(requireMismatch), options), refused); outcomes.push('require-target:rejected');
    const shadowMismatch = structuredClone(declarations.projects[2]); const shadowPin = shadowMismatch.inventory.edges.find(edge => edge.target.kind === 'file').target.file;
    const outer = declarations.blueprint.find(file => file.relativePath === 'project-shadow/node_modules/@r20/probe/esm.mjs').contents;
    Object.assign(shadowPin, { path: path.win32.join(fixed.root, 'project-shadow/node_modules/@r20/probe/esm.mjs'), size: Buffer.byteLength(outer), sha256: sha(outer) });
    await assert.rejects(runtime.observeRuntimeResolution(nativeRecords(shadowMismatch), options), refused); outcomes.push('nearer-shadow:wrong-outer-target-rejected');
    if (caseSupported) { await assert.rejects(runtime.observeRuntimeResolution(nativeRecords(declarations.projects[3]), options), refused); outcomes.push('case-distinct-resolved-file:rejected'); }
    else outcomes.push('case-distinct-native-control:unsupported-no-toggle');
    await inspectOwned(); outcomes.push('evaluation-sentinels:untouched');
  } finally {
    await inspectOwned(); for (const file of Array.from(files.keys()).reverse()) fs.unlinkSync(file);
    for (const directory of Array.from(directories.keys()).reverse()) if (directory !== fixed.root) fs.rmdirSync(directory);
    assertRoot(); check(fs.readdirSync(fixed.root).length === 0); cleanup = true;
  }
  return { kind: 'native-runtime-resolution-fixture', evidenceClass: 'synthetic-fixture', runId: fixed.runId, status: 'passed', outcomes,
    allocationSha256: digest(text), blueprintSha256: declarations.blueprintSha256, cleanup,
    certifications: { runtimeDependencyIdentity: false, executionAuthorized: false, transitiveClosureComplete: false, custodyHeld: false } };
}
if (nativeMode) {
  try { process.stdout.write(JSON.stringify(await runNativeFixture(await readNativeStdin())) + '\n'); }
  catch { process.stderr.write('RUNTIME_RESOLUTION_NATIVE_REFUSED\n'); process.exitCode = 1; }
}
