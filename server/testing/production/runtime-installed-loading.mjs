import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import moduleBuiltin, { registerHooks, syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createInstalledDataAccess } from './runtime-installed-data.mjs';
import os from 'node:os';
// The Windows profile the custody fixtures live under, from the process token (os.userInfo),
// not USERPROFILE, which the fixed children override; a neutral placeholder off Windows.
const windowsProfile = process.platform === 'win32' ? os.userInfo().homedir : 'C:\\Users\\example';

const protocols = new WeakSet();
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = phase => { throw new Error(`INSTALLED_LOADING_REFUSED:${phase}`); };
const need = (value, phase = 'PROTOCOL') => { if (!value) fail(phase); };
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const keys = (value, names) => need(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...names].sort().join('|'));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const rootBase = `${windowsProfile}\\.codex\\worktrees\\capital-completion-v2\\personal-finance-app\\.local\\r20-installed-component-oct28a`;
const runtime = freeze({ executable: { path: `${windowsProfile}\\AppData\\Local\\Packages\\OpenAI.Codex_2p2nqsd0c76g0\\LocalCache\\Local\\capital-r00-runtime\\node-v24.22.0-win-arm64\\node.exe`,
  size: 82123080, sha256: 'df4b0e71e4e4d022bf8582fbe75f6061feb9c4a111a86f3fec6300d24b6fe5e0' }, version: '24.22.0', platform: 'win32', arch: 'arm64' });
const nativePrefix = 'node_modules/@img/sharp-win32-arm64/lib/';
const addon = `${nativePrefix}sharp-win32-arm64-0.35.5.node`;
const nativeFiles = [addon, `${nativePrefix}libvips-42.dll`, `${nativePrefix}libvips-cpp-8.18.7.dll`];
const harnessNames = ['runtime-installed-bootstrap.mjs', 'runtime-installed-component.mjs', 'runtime-installed-loading.mjs', 'runtime-installed-data.mjs'];
const component = '.runtime/runtime-installed-component.mjs';
const cases = ['normal', 'timeout', 'supervisor-loss', 'preexisting-writer', 'unknown-member', 'unknown-module', 'unknown-data', 'native-substitution', 'digest-drift'];
const at = (root, relative) => path.win32.join(root, ...relative.split('/'));
const memberName = name => typeof name === 'string' && /^[A-Za-z0-9@._/-]{1,1024}$/.test(name) && name.split('/').every(part => part && part !== '.' && part !== '..');

/** Genuine in-process staging is required to export a transport, never a custody/launch grant. */
export async function installedRuntimeLoadingProtocol(stageRecord) {
  let stage;
  try { stage = (await import('./installed-runtime-stage.mjs')).requireInstalledRuntimeStage(stageRecord); } catch { fail('LINEAGE'); }
  need(stage.kind === 'staged-installed-runtime' && stage.evidenceClass === 'declared-installed-candidate', 'LINEAGE');
  const scenario = cases.find(name => stage.stageRoot === `${rootBase}\\cases\\${name}\\stage`); need(scenario, 'ALLOCATION');
  need(stage.entryRelativePath === 'dist/index.js' && stage.componentEntryRelativePath === component && stage.componentId === 'sharp-geoip-v1', 'ENTRY');
  const text = JSON.stringify({ kind: 'pfa-installed-component-loading', version: 1, componentId: 'sharp-geoip-v1', scenario, stageRoot: stage.stageRoot,
    entryRelativePath: stage.entryRelativePath, componentEntryRelativePath: component,
    treeSha256: stage.treeSha256, rootInventorySha256: stage.rootInventorySha256, profileManifestSha256: stage.profileManifestSha256,
    buildCommitSha: stage.buildCommitSha, harnessCommitSha: stage.harnessCommitSha, nativeDataSha256: stage.nativeDataSha256,
    runtime: stage.runtime, files: stage.files, directories: stage.directories, absencePaths: stage.absencePaths });
  readInstalledRuntimeLoadingProtocol(text, sha(text)); return freeze({ text, sha256: sha(text) });
}

/** Independent digest checks transport consistency; it does not authenticate the caller or authorize execution. */
export function readInstalledRuntimeLoadingProtocol(text, expectedSha256) {
  try {
    need(typeof text === 'string' && Buffer.byteLength(text) <= 16 * 1024 * 1024 && hash(expectedSha256) && sha(text) === expectedSha256);
    const value = JSON.parse(text); need(JSON.stringify(value) === text);
    keys(value, ['kind', 'version', 'componentId', 'scenario', 'stageRoot', 'entryRelativePath', 'componentEntryRelativePath', 'treeSha256', 'rootInventorySha256',
      'profileManifestSha256', 'buildCommitSha', 'harnessCommitSha', 'nativeDataSha256', 'runtime', 'files', 'directories', 'absencePaths']);
    need(value.kind === 'pfa-installed-component-loading' && value.version === 1 && value.componentId === 'sharp-geoip-v1' && cases.includes(value.scenario) && value.stageRoot === `${rootBase}\\cases\\${value.scenario}\\stage`);
    need(value.entryRelativePath === 'dist/index.js' && value.componentEntryRelativePath === component);
    for (const field of ['treeSha256', 'rootInventorySha256', 'profileManifestSha256', 'nativeDataSha256']) need(hash(value[field]));
    for (const field of ['buildCommitSha', 'harnessCommitSha']) need(typeof value[field] === 'string' && /^[a-f0-9]{40}$/.test(value[field]));
    keys(value.runtime, ['executable', 'version', 'platform', 'arch']); keys(value.runtime.executable, ['path', 'size', 'sha256']);
    for (const name of ['version', 'platform', 'arch']) need(value.runtime[name] === runtime[name]);
    for (const name of ['path', 'size', 'sha256']) need(value.runtime.executable[name] === runtime.executable[name]);
    need(Array.isArray(value.files) && value.files.length >= 10 && value.files.length <= 40000);
    const names = new Set(); let previous = ''; let bytes = 0;
    for (const file of value.files) {
      keys(file, ['relativePath', 'size', 'sha256', 'assetKind']); need(memberName(file.relativePath) && file.relativePath > previous && !names.has(file.relativePath.toLowerCase()));
      previous = file.relativePath; names.add(file.relativePath.toLowerCase());
      need(Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= 100 * 1024 * 1024 && hash(file.sha256)); bytes += file.size;
      need(['module', 'commonjs', 'json', 'native-addon', 'native-dll', 'wasm', 'opaque', 'data'].includes(file.assetKind));
    }
    need(bytes <= 1013 * 1024 * 1024);
    for (const name of ['dist/index.js', 'package.json', 'package-lock.json', ...nativeFiles, ...harnessNames.map(name => `.runtime/${name}`)]) need(names.has(name.toLowerCase()));
    need(value.files.find(file => file.relativePath === component)?.assetKind === 'module');
    need(Array.isArray(value.directories) && value.directories.length <= 30000); previous = '';
    const directories = new Set();
    for (const directory of value.directories) { need(memberName(directory) && directory > previous && !directories.has(directory.toLowerCase()) && !names.has(directory.toLowerCase())); previous = directory; directories.add(directory.toLowerCase()); }
    for (const file of value.files) { let directory = path.posix.dirname(file.relativePath); while (directory !== '.') { need(directories.has(directory.toLowerCase())); directory = path.posix.dirname(directory); } }
    need(Array.isArray(value.absencePaths) && value.absencePaths.length >= 2 && value.absencePaths.length <= 512); previous = '';
    for (const absent of value.absencePaths) { need(memberName(absent) && absent > previous && !names.has(absent.toLowerCase()) && !directories.has(absent.toLowerCase())); previous = absent; }
    for (const name of ['node_modules/sharp/src/build', 'node_modules/@img/sharp-wasm32', 'node_modules/sharp/node_modules/.bin']) need(value.absencePaths.includes(name));
    const record = freeze({ kind: 'validated-installed-component-loading', protocolSha256: expectedSha256, document: value,
      certifications: { custodyHeld: false, runtimeDependencyIdentity: false, executionAuthorized: false } });
    protocols.add(record); return record;
  } catch { fail('PROTOCOL'); }
}

const identity = stat => [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.birthtimeNs, stat.ctimeNs, stat.mtimeNs].map(String).join('|');
const supportedBuiltins = new Set(['node:assert/strict', 'node:buffer', 'node:crypto', 'node:events', 'node:fs', 'node:module', 'node:os', 'node:path', 'node:stream', 'node:string_decoder', 'node:url', 'node:util']);
/** Executable source/data/native-path controls. Windows sharing custody is supplied by the separate reviewed supervisor. */
export function openInstalledRuntimeLoading(record) {
  need(protocols.has(record), 'LINEAGE'); const doc = record.document; const root = doc.stageRoot;
  const raw = Object.fromEntries(['openSync', 'closeSync', 'lstatSync', 'fstatSync', 'readSync'].map(name => [name, fs[name].bind(fs)]));
  raw.realpath = fs.realpathSync.native.bind(fs.realpathSync);
  const files = new Map(doc.files.map(file => [file.relativePath, file])); const urls = new Map(doc.files.map(file => [pathToFileURL(at(root, file.relativePath)).href, file.relativePath]));
  const descriptors = new Map(); let closed = false; let tainted = false; let nativeLoads = 0; let firstViolation;
  const mark = phase => { tainted = true; firstViolation ??= phase; };
  const refuse = phase => { mark(phase); fail(phase); }; const check = (value, phase) => { if (!value) refuse(phase); };
  const io = (operation, phase) => { try { return operation(); } catch (error) { mark(/^INSTALLED_LOADING_REFUSED:([A-Z_]+)$/.exec(error.message ?? '')?.[1] ?? phase); if (error.message?.startsWith('INSTALLED_LOADING_REFUSED:')) throw error; fail(phase); } };
  const alive = () => check(!closed, 'CLOSED');
  function pinned(name) {
    return io(() => {
    alive(); const file = files.get(name); check(file, 'FILE_PATH');
    if (!descriptors.has(name)) { check(descriptors.size < 512, 'DESCRIPTOR_LIMIT'); descriptors.set(name, raw.openSync(at(root, name), fs.constants.O_RDONLY)); }
    const fd = descriptors.get(name);
    const before = raw.fstatSync(fd, { bigint: true }); const named = raw.lstatSync(at(root, name), { bigint: true });
    check(before.isFile() && before.nlink === 1n && before.size === BigInt(file.size) && !named.isSymbolicLink() &&
      identity(before) === identity(named) && raw.realpath(at(root, name)) === at(root, name), 'FILE_IDENTITY');
    const bytes = Buffer.alloc(file.size); let position = 0;
    while (position < bytes.length) { const count = raw.readSync(fd, bytes, position, Math.min(65536, bytes.length - position), position); check(count > 0, 'FILE_BYTES'); position += count; }
    check(sha(bytes) === file.sha256 && identity(before) === identity(raw.fstatSync(fd, { bigint: true })), 'FILE_BYTES'); return bytes;
    }, 'FILE_IO');
  }
  function absences() {
    for (const relative of doc.absencePaths) {
      let absent = false; try { raw.lstatSync(at(root, relative)); } catch (error) { absent = error.code === 'ENOENT'; }
      check(absent, 'ABSENCE');
    }
  }
  const data = createInstalledDataAccess(root, Array.from(files.keys()), pinned, mark);
  const safeFs = { ...data.fs };
  // Node's own default resolver uses these public synchronous metadata methods.
  // Keep that operation possible only for this exact staged namespace.
  const named = name => {
    alive(); check(typeof name === 'string' && path.win32.normalize(name) === name, 'FILE_PATH');
    const relative = path.win32.relative(root, name).replaceAll('\\', '/');
    check(name === root || files.has(relative) || doc.directories.includes(relative), 'FILE_PATH'); return relative;
  };
  safeFs.realpathSync = name => io(() => { named(name); check(raw.realpath(name) === name, 'FILE_IDENTITY'); return name; }, 'FILE_IO');
  Object.defineProperty(safeFs.realpathSync, 'native', { value: safeFs.realpathSync });
  safeFs.lstatSync = name => io(() => { named(name); return raw.lstatSync(name, { bigint: false }); }, 'FILE_IO');
  safeFs.statSync = safeFs.lstatSync;
  safeFs.readFileSync = (name, options) => {
    const relative = named(name); check(files.has(relative) && !relative.startsWith('node_modules/fast-geoip/data/') && (options === undefined || options === 'utf8'), 'FILE_PATH');
    const bytes = pinned(relative); return options === 'utf8' ? bytes.toString('utf8') : bytes;
  };
  const entryURL = pathToFileURL(at(root, component)).href; const bootstrapURL = pathToFileURL(at(root, '.runtime/runtime-installed-bootstrap.mjs')).href;
  const target = url => { alive(); const name = urls.get(url); check(name && (name.startsWith('node_modules/') || name === component), 'MODULE_PATH'); return name; };
  const declaredMissing = (specifier, parentURL) => {
    const parent = urls.get(parentURL);
    if (!['node_modules/sharp/dist/sharp.mjs', 'node_modules/sharp/dist/sharp.cjs'].includes(parent)) return false;
    return specifier === '../src/build/Release/sharp-win32-arm64-0.35.5.node' || specifier === '../src/build/Release/sharp-wasm32-0.35.5.node' || specifier === '@img/sharp-wasm32/sharp.node';
  };
  function metadata(specifier, parentURL) {
    return io(() => {
    const parent = urls.get(parentURL); check(parent, 'MODULE_PARENT');
    const bare = /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*(?:\/.*)?$/.test(specifier);
    const packageName = bare ? (specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]) : undefined;
    const inspect = (relative, directory) => {
      let stat; try { stat = raw.lstatSync(at(root, relative), { bigint: true }); } catch (error) { check(error.code === 'ENOENT' && !files.has(relative) && !doc.directories.includes(relative), 'METADATA'); return; }
      check(!stat.isSymbolicLink() && raw.realpath(at(root, relative)) === at(root, relative), 'METADATA');
      if (directory) check(stat.isDirectory() && doc.directories.includes(relative), 'METADATA');
      else { check(files.has(relative), 'METADATA'); pinned(relative); }
    };
    let directory = path.posix.dirname(parent);
    while (true) {
      inspect(directory === '.' ? 'package.json' : `${directory}/package.json`, false);
      if (packageName) {
        const candidate = `${directory === '.' ? '' : directory + '/'}node_modules/${packageName}`;
        inspect(candidate, true); inspect(`${candidate}/package.json`, false);
      }
      if (directory === '.') break; directory = path.posix.dirname(directory);
    }
    }, 'METADATA');
  }
  const hooks = {
    resolve(specifier, context, nextResolve) {
      alive(); absences(); check(context.parentURL === bootstrapURL || context.parentURL === entryURL || (urls.get(context.parentURL) ?? '').startsWith('node_modules/'), 'MODULE_PARENT');
      const builtin = specifier.startsWith('node:') ? specifier : `node:${specifier}`;
      if (supportedBuiltins.has(builtin)) return { url: builtin, shortCircuit: true };
      if (builtin === 'node:child_process' && ['node_modules/sharp/dist/libvips.mjs', 'node_modules/sharp/dist/libvips.cjs', 'node_modules/detect-libc/lib/detect-libc.js'].includes(urls.get(context.parentURL)))
        return { url: builtin, shortCircuit: true }; // Imported by these packages; every callable is disabled before imports.
      check(!specifier.startsWith('node:') && !['child_process', 'cluster', 'dns', 'http', 'https', 'net', 'tls', 'dgram', 'worker_threads', 'vm', 'wasi', 'inspector'].includes(specifier), 'CAPABILITY');
      if (declaredMissing(specifier, context.parentURL)) { absences(); throw Object.assign(new Error('Declared Sharp selection probe is absent'), { code: 'MODULE_NOT_FOUND' }); }
      metadata(specifier, context.parentURL);
      let result; try { result = nextResolve(specifier, context); } catch { refuse('MODULE_RESOLVE'); }
      metadata(specifier, context.parentURL);
      target(result.url); metadata('./', result.url); check(context.parentURL !== bootstrapURL || result.url === entryURL, 'ENTRY'); return result;
    },
    load(url, context) {
      alive(); absences(); if (supportedBuiltins.has(url) || url === 'node:child_process') return { format: 'builtin', source: null, shortCircuit: true };
      const name = target(url); const file = files.get(name);
      if (name === addon) { check(context.format === 'addon' || context.format === undefined || context.format === null, 'MODULE_FORMAT'); pinned(name); return { format: 'addon', source: null, shortCircuit: true }; }
      check(['module', 'commonjs', 'json'].includes(file.assetKind), 'CAPABILITY');
      const format = file.assetKind; check(context.format === undefined || context.format === null || context.format === format, 'MODULE_FORMAT');
      return { format, source: pinned(name), shortCircuit: true };
    },
  };
  const close = () => {
    if (closed) return; closed = true; data.close(); let failed = false;
    for (const fd of descriptors.values()) { try { raw.closeSync(fd); } catch { failed = true; } } descriptors.clear(); if (failed) fail('CLOSE');
  };
  try {
    absences();
    // Preflight the entire stage with one Node fd at a time. Only reached module/metadata/data
    // descriptors remain open later; native inherited sharing handles hold whole-stage custody.
    for (const file of doc.files) {
      try { pinned(file.relativePath); } finally { const fd = descriptors.get(file.relativePath); if (fd !== undefined) { raw.closeSync(fd); descriptors.delete(file.relativePath); } }
    }
    return Object.freeze({ hooks: Object.freeze(hooks), entryURL, data, fs: Object.freeze(safeFs),
      nativeLoad(original, receiver, args) {
        alive(); check(args.length >= 2 && args.length <= 3 && [at(root, addon), `\\\\?\\${at(root, addon)}`].includes(args[1]) && (args.length === 2 || args[2] === undefined), 'NATIVE_PATH');
        check(nativeLoads === 0, 'NATIVE_PATH'); absences(); nativeFiles.forEach(pinned); nativeLoads++;
        try { return Reflect.apply(original, receiver, args); } catch { refuse('NATIVE_LOAD'); }
      },
      deny() { refuse('CAPABILITY'); }, violation: () => firstViolation,
      evidence() { alive(); absences(); check(!tainted, 'TAINTED'); data.assertHealthy(); return freeze({ ...data.events(), nativeLoads }); }, close });
  } catch (error) { close(); if (error.message?.startsWith('INSTALLED_LOADING_REFUSED:')) throw error; fail('OPEN'); }
}

export function validateInstalledRuntimeProcess(record) {
  need(protocols.has(record), 'LINEAGE'); const doc = record.document; const temp = `${rootBase}\\native-temp`; const env = process.env;
  need(process.execPath === runtime.executable.path && process.version === `v${runtime.version}` && process.platform === 'win32' && process.arch === 'arm64', 'RUNTIME');
  need(JSON.stringify(process.execArgv) === JSON.stringify(['--permission', `--allow-fs-read=${doc.stageRoot}`, '--allow-addons']) && process.argv.length === 3 &&
    process.argv[1] === at(doc.stageRoot, '.runtime/runtime-installed-bootstrap.mjs') && process.argv[2] === record.protocolSha256, 'ARGUMENTS');
  need(Object.keys(env).sort().join('|') === ['PROCESSOR_ARCHITECTURE', 'SystemRoot', 'TEMP', 'TMP', 'TZ'].sort().join('|') &&
    env.PROCESSOR_ARCHITECTURE === 'ARM64' && env.SystemRoot === 'C:\\WINDOWS' && env.TEMP === temp && env.TMP === temp && env.TZ === 'UTC', 'ENVIRONMENT');
  need(process.permission && !process.permission.has('fs.write') && !process.permission.has('child') && !process.permission.has('worker') && process.permission.has('addon'), 'PERMISSIONS');
}

/** Dedicated cold component process only; irreversible builtin guards live until that process exits. */
export function installInstalledRuntimeLoading(record) {
  validateInstalledRuntimeProcess(record); const boundary = openInstalledRuntimeLoading(record);
  try {
    const denied = boundary.deny;
    const originalDlopen = process.dlopen;
    Object.defineProperty(process, 'dlopen', { value: function (...args) { return boundary.nativeLoad(originalDlopen, this, args); }, writable: false, configurable: false });
    for (const [name, value] of Object.entries(fs)) if (typeof value === 'function' && name !== 'Stats' && name !== 'Dirent')
      Object.defineProperty(fs, name, { value: boundary.fs[name] ?? denied, writable: false, configurable: false });
    for (const name of Object.keys(fs.promises)) if (typeof fs.promises[name] === 'function') Object.defineProperty(fs.promises, name, { value: denied, writable: false, configurable: false });
    for (const [name, value] of Object.entries(childProcess)) if (typeof value === 'function') Object.defineProperty(childProcess, name, { value: denied, writable: false, configurable: false });
    Object.defineProperty(globalThis, 'fetch', { value: denied, writable: false, configurable: false });
    const registration = registerHooks(boundary.hooks);
    for (const name of ['registerHooks', 'register']) Object.defineProperty(moduleBuiltin, name, { value: denied, writable: false, configurable: false });
    syncBuiltinESMExports();
    return Object.freeze({ entryURL: boundary.entryURL, evidence: boundary.evidence, violation: boundary.violation, close: () => { registration.deregister(); boundary.close(); } });
  } catch (error) { boundary.close(); throw error; }
}
