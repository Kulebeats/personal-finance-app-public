import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
// The Windows profile the custody fixtures live under, from the process token (os.userInfo),
// not USERPROFILE, which the fixed children override; a neutral placeholder off Windows.
const windowsProfile = process.platform === 'win32' ? os.userInfo().homedir : 'C:\\Users\\example';

const runtime = await import('./runtime-enforcement.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./runtime-enforcement.mjs', import.meta.url).href) return {};
  throw error;
});
const sha = value => createHash('sha256').update(value).digest('hex');
function fixture() {
  assert.equal(typeof runtime.runtimeFixtureDeclaration, 'function', 'closed inert fixture declaration is implemented');
  const declaration = runtime.runtimeFixtureDeclaration();
  const document = { kind: 'pfa-inert-runtime-boundary', version: 1, fixtureId: declaration.fixtureId,
    scenario: declaration.scenario, stageRoot: declaration.stageRoot, treeSha256: 'a'.repeat(64), runtime: declaration.runtime,
    files: declaration.files.map(({ relativePath, size, sha256 }) => ({ relativePath, size, sha256 })),
    harness: ['runtime-bootstrap.mjs', 'runtime-enforcement.mjs'].map(name => ({ relativePath: `.runtime/${name}`, size: 10, sha256: 'b'.repeat(64) })) };
  const read = (value = document) => {
    assert.equal(typeof runtime.readRuntimeBoundaryProtocol, 'function', 'closed pre-import reader is implemented');
    const text = JSON.stringify(value); return runtime.readRuntimeBoundaryProtocol(text, sha(text));
  };
  return { declaration, document, read };
}
const refused = /RUNTIME_BOUNDARY_REFUSED:[A-Z_]+/;
test('only the exact reviewed inert file bytes can become a boundary protocol', () => {
  const f = fixture(); const record = f.read();
  assert.equal(Object.isFrozen(record.document.files[0]), true);
  assert.equal(record.document.stageRoot, f.declaration.stageRoot);
  assert.equal(record.certifications.custodyHeld, false);
  assert.equal(record.certifications.runtimeDependencyIdentity, false);
  assert.equal(record.certifications.executionAuthorized, false);
});
for (const [name, change] of [
  ['entry source substitution', f => { f.document.files.find(v => v.relativePath === 'dist/index.js').sha256 = 'c'.repeat(64); }],
  ['alternate allocation', f => { f.document.stageRoot += '-other'; }],
  ['alternate fixture', f => { f.document.fixtureId = 'installed'; }],
  ['unindexed file', f => { f.document.files.push({ relativePath: 'evil.js', size: 10, sha256: 'c'.repeat(64) }); }],
  ['omitted package metadata', f => { f.document.files.shift(); }],
  ['runtime substitution', f => { f.document.runtime = { ...f.document.runtime, arch: 'x64' }; }],
  ['caller launch boolean', f => { f.document.executionAuthorized = true; }],
]) test(`caller-consistent hashes cannot authorize ${name}`, () => {
  const f = fixture(); change(f); assert.throws(() => f.read(), refused);
});
test('forged and serialized protocol records cannot open a boundary', () => {
  const f = fixture(); const accepted = f.read();
  assert.throws(() => runtime.openRuntimeBoundary(structuredClone(accepted)), refused);
  assert.throws(() => runtime.openRuntimeBoundary({ document: f.document }), refused);
});
function fake(t) {
  const f = fixture(); const map = new Map(f.declaration.files.map(file => [`${f.document.stageRoot}\\${file.relativePath.replaceAll('/', '\\')}`, Buffer.from(file.source)]));
  const fds = new Map(); let serial = 100;
  const stat = (name, bytes) => ({ dev: 1n, ino: BigInt(Array.from(map.keys()).indexOf(name) + 20), nlink: 1n, mode: 33206n,
    size: BigInt(bytes.length), birthtimeNs: 1n, ctimeNs: 1n, mtimeNs: 1n, isFile: () => true, isSymbolicLink: () => false });
  t.mock.method(fs, 'lstatSync', name => { assert.ok(map.has(name)); return stat(name, map.get(name)); });
  t.mock.method(fs.realpathSync, 'native', name => name);
  t.mock.method(fs, 'openSync', name => { assert.ok(map.has(name)); const fd = serial++; fds.set(fd, { name, bytes: map.get(name) }); return fd; });
  t.mock.method(fs, 'fstatSync', fd => { const file = fds.get(fd); return stat(file.name, file.bytes); });
  t.mock.method(fs, 'readSync', (fd, target, offset, length, position) => fds.get(fd).bytes.copy(target, offset, position, position + length));
  t.mock.method(fs, 'closeSync', fd => { assert.ok(fds.delete(fd)); });
  return { ...f, map, fds, open: () => runtime.openRuntimeBoundary(f.read()) };
}
test('unknown module loads and unindexed resolver targets refuse before next loader or evaluation', t => {
  const f = fake(t); const boundary = f.open(); let called = 0;
  const entry = pathToFileURL(`${f.document.stageRoot}\\dist\\index.js`).href;
  assert.throws(() => boundary.hooks.load(pathToFileURL('C:\\other\\evil.js').href, { format: 'module' }, () => { called++; }), refused);
  assert.throws(() => boundary.hooks.resolve('shadow', { parentURL: entry }, () => ({ url: pathToFileURL(`${f.document.stageRoot}\\node_modules\\shadow\\index.js`).href, format: 'module' })), refused);
  assert.throws(() => boundary.hooks.resolve('node:child_process', { parentURL: entry }, () => { called++; }), refused);
  assert.equal(called, 0); assert.equal(globalThis.R20_ENTRY_SENTINEL, undefined);
  boundary.close(); assert.equal(f.fds.size, 0);
});
test('supported ESM/CJS/JSON loads supply freshly verified descriptor bytes without delegating', t => {
  const f = fake(t); const boundary = f.open();
  for (const [relativePath, format] of [['dist/index.js', 'module'], ['node_modules/fixture-pkg/require.cjs', 'commonjs'], ['node_modules/fixture-pkg/data.json', 'json']]) {
    const file = `${f.document.stageRoot}\\${relativePath.replaceAll('/', '\\')}`;
    const result = boundary.hooks.load(pathToFileURL(file).href, { format }, () => { throw new Error('UNEXPECTED_LOADER'); });
    assert.equal(result.shortCircuit, true); assert.equal(result.format, format); assert.equal(sha(result.source), sha(f.map.get(file)));
  }
  boundary.close(); assert.throws(() => boundary.hooks.load(pathToFileURL(`${f.document.stageRoot}\\dist\\index.js`).href, { format: 'module' }), refused);
});
test('changed bytes and unknown format refuse before source is returned; failure closes descriptors', t => {
  const f = fake(t); const entry = `${f.document.stageRoot}\\dist\\index.js`;
  f.map.get(entry)[0] ^= 1;
  assert.throws(() => f.open(), refused); assert.equal(f.fds.size, 0);
});
test('cached entries still require exact parent and supported format', t => {
  const f = fake(t); const boundary = f.open(); const url = pathToFileURL(`${f.document.stageRoot}\\dist\\index.js`).href;
  assert.throws(() => boundary.hooks.load(url, { format: 'addon' }), refused);
  assert.throws(() => boundary.hooks.resolve('./index.js', { parentURL: 'file:///C:/outside.js' }, () => ({ url, format: 'module' })), refused);
  boundary.close();
});
test('closed lifetime refuses builtin loads as well as indexed files', t => {
  const f = fake(t); const boundary = f.open(); boundary.close();
  assert.throws(() => boundary.hooks.load('node:module', { format: 'builtin' }), /RUNTIME_BOUNDARY_REFUSED:CLOSED/);
});
function fakeProcess(t, declaration, mutate = () => {}) {
  const temp = `${windowsProfile}\\.codex\\worktrees\\capital-completion-v2\\personal-finance-app\\.local\\r20-staged-boundary-oct28\\native-temp`;
  const values = { platform: 'win32', arch: 'arm64', version: 'v24.22.0', execPath: declaration.runtime.executable.path,
    execArgv: ['--permission', `--allow-fs-read=${declaration.stageRoot}`],
    argv: [declaration.runtime.executable.path, `${declaration.stageRoot}\\.runtime\\runtime-bootstrap.mjs`, declaration.fixtureId],
    env: { PROCESSOR_ARCHITECTURE: 'ARM64', SystemRoot: 'C:\\WINDOWS', TZ: 'UTC', TEMP: temp, TMP: temp }, permission: { has: () => false } };
  mutate(values);
  for (const [name, value] of Object.entries(values)) {
    const descriptor = Object.getOwnPropertyDescriptor(process, name);
    Object.defineProperty(process, name, { configurable: true, enumerable: true, value });
    t.after(() => descriptor ? Object.defineProperty(process, name, descriptor) : delete process[name]);
  }
}
test('fake cold runtime gate preserves all false certifications and never evaluates the entry', t => {
  const f = fixture(); fakeProcess(t, f.declaration); const record = f.read();
  runtime.validateRuntimeBoundaryProcess(record);
  assert.equal(record.certifications.executionAuthorized, false); assert.equal(globalThis.R20_ENTRY_SENTINEL, undefined);
});
for (const [name, phase, change] of [
  ['alternate physical executable', 'RUNTIME', v => { v.execPath = 'C:\\Other\\node.exe'; }],
  ['worker override flag', 'ARGUMENTS', v => { v.execArgv.push('--allow-worker'); }],
  ['child override flag', 'ARGUMENTS', v => { v.execArgv.push('--allow-child-process'); }],
  ['native addon override flag', 'ARGUMENTS', v => { v.execArgv.push('--allow-addons'); }],
  ['preload/cached fixture path', 'ARGUMENTS', v => { v.execArgv.push('--import=fixture-pkg'); }],
  ['ambient injection variable', 'ENVIRONMENT', v => { v.env.NODE_OPTIONS = '--import=evil'; }],
  ['ambient executable search path', 'ENVIRONMENT', v => { v.env.PATH = 'C:\\Other'; }],
  ['in-root temporary directory', 'ENVIRONMENT', v => { v.env.TEMP = v.env.TMP = `${v.argv[1]}\\temp`; }],
  ['writable process permission', 'PERMISSIONS', v => { v.permission.has = scope => scope === 'fs.write'; }],
]) test(`fake pre-import process gate refuses ${name}`, t => {
  const f = fixture(); fakeProcess(t, f.declaration, change);
  assert.throws(() => runtime.validateRuntimeBoundaryProcess(f.read()), { message: `RUNTIME_BOUNDARY_REFUSED:${phase}` });
  assert.equal(globalThis.R20_ENTRY_SENTINEL, undefined);
});
