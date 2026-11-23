import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import moduleBuiltin, { registerHooks, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
// The Windows profile the custody fixtures live under, from the process token (os.userInfo),
// not USERPROFILE, which the fixed children override; a neutral placeholder off Windows.
const windowsProfile = process.platform === 'win32' ? os.userInfo().homedir : 'C:\\Users\\example';

const protocols = new WeakSet();
const fail = phase => { throw new Error(`RUNTIME_BOUNDARY_REFUSED:${phase}`); };
const check = (value, phase = 'PROTOCOL') => { if (!value) fail(phase); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const frozen = value => { if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); } return value; };
const exactKeys = (value, keys) => check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|'));
const fixtureRoot = `${windowsProfile}\\.codex\\worktrees\\capital-completion-v2\\personal-finance-app\\.local\\r20-stage-native-oct28a`;
const scenarios = ['normal', 'timeout', 'supervisor-loss', 'preexisting-writer', 'unknown-member'];
const entrySource = `import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import imported from 'fixture-pkg';
import data from 'fixture-pkg/data.json' with { type: 'json' };
const required = createRequire(import.meta.url)('fixture-pkg');
const computed = 'fixture-' + 'pkg/dynamic';
const dynamic = await import(computed);
assert.equal(imported, 'esm'); assert.equal(required, 'cjs');
assert.equal(dynamic.default, 'computed'); assert.equal(data.answer, 42);
globalThis.R20_ENTRY_SENTINEL = 'r20stage20261028a1';
console.log('R20_ENTRY_STARTED:r20stage20261028a1');
await new Promise(resolve => setTimeout(resolve, 5000));
console.log('R20_ENTRY_COMPLETE:r20stage20261028a1');
`;
const fixtureSources = {
  'package.json': '{"name":"r20-inert-fixture","version":"1.0.0","type":"module","dependencies":{"fixture-pkg":"1.0.0"}}\n',
  'package-lock.json': '{"lockfileVersion":3,"packages":{"":{"name":"r20-inert-fixture","version":"1.0.0","dependencies":{"fixture-pkg":"1.0.0"}},"node_modules/fixture-pkg":{"version":"1.0.0"}}}\n',
  'dist/index.js': entrySource,
  'dist/public/index.html': '<!doctype html><title>Inert R20 fixture</title>\n',
  'dist/public/assets/app.js': '/* Inert R20 fixture asset. */\n',
  'node_modules/fixture-pkg/package.json': '{"name":"fixture-pkg","version":"1.0.0","type":"module","exports":{".":{"import":"./import.js","require":"./require.cjs"},"./data.json":"./data.json","./dynamic":"./dynamic.js"}}\n',
  'node_modules/fixture-pkg/dynamic.js': "export default 'computed';\n",
  'node_modules/fixture-pkg/import.js': "export default 'esm';\n",
  'node_modules/fixture-pkg/require.cjs': "module.exports = 'cjs';\n",
  'node_modules/fixture-pkg/data.json': '{"answer":42}\n',
};
const declaration = frozen({ fixtureId: 'r20stage20261028a1', fixtureRoot,
  runtime: { executable: { path: `${windowsProfile}\\AppData\\Local\\Packages\\OpenAI.Codex_2p2nqsd0c76g0\\LocalCache\\Local\\capital-r00-runtime\\node-v24.22.0-win-arm64\\node.exe`,
    size: 82123080, sha256: 'df4b0e71e4e4d022bf8582fbe75f6061feb9c4a111a86f3fec6300d24b6fe5e0' }, version: '24.22.0', platform: 'win32', arch: 'arm64' },
  files: Object.entries(fixtureSources).sort(([a], [b]) => a < b ? -1 : 1).map(([relativePath, source]) => ({ relativePath, size: Buffer.byteLength(source), sha256: sha(source), source })) });

/** Public inert declarations are review material, not launch or custody authority. */
export function runtimeFixtureDeclaration(scenario = 'normal') {
  check(scenarios.includes(scenario), 'FIXTURE');
  return frozen({ ...declaration, scenario, stageRoot: `${fixtureRoot}\\cases\\${scenario}\\stage` });
}
export function readRuntimeBoundaryProtocol(text, expectedSha256) {
  try {
    check(typeof text === 'string' && Buffer.byteLength(text) <= 64 * 1024 && /^[a-f0-9]{64}$/.test(expectedSha256) && sha(text) === expectedSha256);
    const value = JSON.parse(text); check(JSON.stringify(value) === text);
    exactKeys(value, ['kind', 'version', 'fixtureId', 'scenario', 'stageRoot', 'treeSha256', 'runtime', 'files', 'harness']);
    check(scenarios.includes(value.scenario));
    check(value.kind === 'pfa-inert-runtime-boundary' && value.version === 1 && value.fixtureId === declaration.fixtureId && value.stageRoot === runtimeFixtureDeclaration(value.scenario).stageRoot);
    check(/^[a-f0-9]{64}$/.test(value.treeSha256));
    check(JSON.stringify(value.runtime) === JSON.stringify(declaration.runtime));
    const expectedFiles = declaration.files.map(({ relativePath, size, sha256 }) => ({ relativePath, size, sha256 }));
    check(JSON.stringify(value.files) === JSON.stringify(expectedFiles));
    check(Array.isArray(value.harness) && value.harness.length === 2);
    for (const [index, name] of ['runtime-bootstrap.mjs', 'runtime-enforcement.mjs'].entries()) {
      const file = value.harness[index]; exactKeys(file, ['relativePath', 'size', 'sha256']);
      check(file.relativePath === `.runtime/${name}` && Number.isSafeInteger(file.size) && file.size > 0 && file.size <= 128 * 1024 && /^[a-f0-9]{64}$/.test(file.sha256));
    }
    const record = frozen({ kind: 'validated-inert-runtime-boundary', document: value,
      certifications: { custodyHeld: false, runtimeDependencyIdentity: false, executionAuthorized: false } });
    protocols.add(record); return record;
  } catch { fail('PROTOCOL'); }
}
const filePath = (root, relative) => path.win32.join(root, ...relative.split('/'));
const identity = stat => [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.birthtimeNs, stat.ctimeNs, stat.mtimeNs].map(String).join('|');
function readPinned(root, file, descriptor) {
  const name = filePath(root, file.relativePath); const before = fs.fstatSync(descriptor, { bigint: true });
  check(before.isFile() && before.nlink === 1n && before.size === BigInt(file.size), 'FILE_IDENTITY');
  const named = fs.lstatSync(name, { bigint: true });
  check(!named.isSymbolicLink() && identity(before) === identity(named) && fs.realpathSync.native(name) === name, 'FILE_IDENTITY');
  const bytes = Buffer.alloc(file.size); let offset = 0;
  while (offset < bytes.length) { const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset); check(count > 0, 'FILE_BYTES'); offset += count; }
  check(sha(bytes) === file.sha256 && identity(before) === identity(fs.fstatSync(descriptor, { bigint: true })), 'FILE_BYTES');
  return bytes;
}
const supportedBuiltins = new Set(['node:assert/strict', 'node:module']);
/** Binds descriptors and supplies source; retained native Windows locks are a separate supervisor claim. */
export function openRuntimeBoundary(record) {
  check(protocols.has(record), 'LINEAGE'); const descriptors = new Map(); let closed = false;
  const root = record.document.stageRoot;
  const files = new Map(record.document.files.map(file => [pathToFileURL(filePath(root, file.relativePath)).href, file]));
  const bootstrapURL = pathToFileURL(filePath(root, '.runtime/runtime-bootstrap.mjs')).href;
  const entryURL = pathToFileURL(filePath(root, 'dist/index.js')).href;
  const close = () => {
    if (closed) return; closed = true; let failure = false;
    for (const fd of descriptors.values()) { try { fs.closeSync(fd); } catch { failure = true; } }
    descriptors.clear(); if (failure) fail('CLOSE');
  };
  const target = url => {
    check(!closed, 'CLOSED'); const file = files.get(url); check(file, 'MODULE_PATH');
    const parsed = new URL(url); check(parsed.protocol === 'file:' && !parsed.search && !parsed.hash && !parsed.hostname && pathToFileURL(fileURLToPath(parsed)).href === url, 'MODULE_PATH');
    return file;
  };
  const hooks = {
    resolve(specifier, context, nextResolve) {
      check(!closed, 'CLOSED');
      check(context.parentURL === bootstrapURL || files.has(context.parentURL), 'MODULE_PARENT');
      const builtin = specifier.startsWith('node:') ? specifier : `node:${specifier}`;
      if (supportedBuiltins.has(builtin)) return { url: builtin, shortCircuit: true };
      check(!specifier.startsWith('node:') && !['fs', 'child_process', 'worker_threads', 'module', 'vm', 'wasi', 'inspector'].includes(specifier), 'CAPABILITY');
      let result; try { result = nextResolve(specifier, context); } catch { fail('MODULE_RESOLVE'); }
      target(result.url); check(context.parentURL !== bootstrapURL || result.url === entryURL, 'ENTRY'); return result;
    },
    load(url, context) {
      check(!closed, 'CLOSED');
      if (supportedBuiltins.has(url)) return { format: 'builtin', source: null, shortCircuit: true };
      const file = target(url); const format = context.format;
      check(['module', 'commonjs', 'json'].includes(format), 'MODULE_FORMAT');
      const extension = path.win32.extname(file.relativePath);
      check(extension === '.json' ? format === 'json' : extension === '.cjs' ? format === 'commonjs' : extension === '.js' && format === 'module', 'MODULE_FORMAT');
      return { format, source: readPinned(root, file, descriptors.get(url)), shortCircuit: true };
    },
  };
  try {
    for (const [url, file] of files) { const fd = fs.openSync(filePath(root, file.relativePath), fs.constants.O_RDONLY); descriptors.set(url, fd); readPinned(root, file, fd); }
    return Object.freeze({ hooks: Object.freeze(hooks), entryURL, close });
  } catch (error) { close(); if (error.message.startsWith('RUNTIME_BOUNDARY_REFUSED:')) throw error; fail('OPEN'); }
}
/** Cold bootstrap checks; caller values do not expand the hardcoded fixture or effective environment. */
export function validateRuntimeBoundaryProcess(record) {
  check(protocols.has(record), 'LINEAGE'); const expected = declaration.runtime;
  const root = record.document.stageRoot;
  const temp = `${windowsProfile}\\.codex\\worktrees\\capital-completion-v2\\personal-finance-app\\.local\\r20-staged-boundary-oct28\\native-temp`;
  const env = process.env;
  check(process.platform === expected.platform && process.arch === expected.arch && process.version === `v${expected.version}` && process.execPath === expected.executable.path, 'RUNTIME');
  check(Object.keys(env).sort().join('|') === ['PROCESSOR_ARCHITECTURE', 'SystemRoot', 'TEMP', 'TMP', 'TZ'].sort().join('|') &&
    env.PROCESSOR_ARCHITECTURE === 'ARM64' && env.SystemRoot === 'C:\\WINDOWS' && env.TZ === 'UTC' && env.TEMP === temp && env.TMP === temp, 'ENVIRONMENT');
  const args = ['--permission', `--allow-fs-read=${root}`];
  check(JSON.stringify(process.execArgv) === JSON.stringify(args) && process.argv.length === 3 &&
    process.argv[1] === filePath(root, '.runtime/runtime-bootstrap.mjs') && process.argv[2] === declaration.fixtureId, 'ARGUMENTS');
  check(process.permission && !process.permission.has('fs.write') && !process.permission.has('child') && !process.permission.has('worker') && !process.permission.has('addons'), 'PERMISSIONS');
}
/** Install only after runtime checks. New ordinary hook registration is explicitly refused. */
export function installRuntimeBoundary(record) {
  validateRuntimeBoundaryProcess(record); const boundary = openRuntimeBoundary(record); const registration = registerHooks(boundary.hooks);
  const denied = () => fail('HOOK_REPLACEMENT');
  for (const name of ['registerHooks', 'register']) Object.defineProperty(moduleBuiltin, name, { value: denied, writable: false, configurable: false });
  syncBuiltinESMExports();
  return Object.freeze({ entryURL: boundary.entryURL, close: () => { registration.deregister(); boundary.close(); } });
}
