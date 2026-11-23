import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { absolute, canonicalJson, freeze, parse, shape, disjoint } from './primitives.mjs';
import { requireRuntimePackageTree, installedGeneratedTooling } from './runtime-package-tree.mjs';
import { readWindowsMetadata } from '../../../scripts/recovery/windows-metadata.mjs';
import os from 'node:os';
// The Windows profile the custody fixtures live under, from the process token (os.userInfo),
// not USERPROFILE, which the fixed children override; a neutral placeholder off Windows.
const windowsProfile = process.platform === 'win32' ? os.userInfo().homedir : 'C:\\Users\\example';

const MiB = 1024 * 1024;
const sourceRoot = `${windowsProfile}\\.codex\\worktrees\\capital-completion-v2\\personal-finance-app`;
const namespace = `${sourceRoot}\\.local\\r20-installed-component-oct28a\\cases`;
const closure = ['bootstrap', 'component', 'data', 'loading'].map(name => `.runtime/runtime-installed-${name}.mjs`);
const brands = new WeakSet();
const fail = phase => { throw new Error(`INSTALLED_RUNTIME_STAGE_REFUSED:${phase}`); };
const check = (value, phase) => { if (!value) fail(phase); };
const sha = value => createHash('sha256').update(value).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const identity = stat => (stat.isDirectory() ? [stat.dev, stat.ino, stat.mode, stat.birthtimeNs]
  : [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.birthtimeNs, stat.ctimeNs, stat.mtimeNs]).map(String).join(':');
const fileObject = stat => [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.birthtimeNs].map(String).join(':');
const ancestry = name => { const result = [name]; while (path.win32.dirname(result[0]) !== result[0]) result.unshift(path.win32.dirname(result[0])); return result; };
function memberPath(root, value) {
  check(typeof value === 'string' && value.length > 0 && value.length <= 1024 && !value.includes('\\') && !value.startsWith('/') &&
    value.split('/').every(part => part && part !== '.' && part !== '..'), 'MEMBER_PATH');
  const result = path.win32.join(root, ...value.split('/')); absolute(result);
  check(result.startsWith(`${root}\\`), 'MEMBER_PATH'); return result;
}
function nativeData(input, tree) {
  const phase = 'NATIVE_DATA';
  try {
    check(input && typeof input === 'object' && !types.isProxy(input) && Object.getPrototypeOf(input) === Object.prototype, phase);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    check(Reflect.ownKeys(descriptors).length === 2 && ['text', 'expectedSha256'].every(key => descriptors[key] && 'value' in descriptors[key]), phase);
    const text = descriptors.text.value, expected = descriptors.expectedSha256.value;
    check(typeof text === 'string' && Buffer.byteLength(text) <= 2 * MiB && text.endsWith('\n') && !text.includes('\r') && !text.startsWith('\ufeff') &&
      Buffer.from(text).toString('utf8') === text && /^[a-f0-9]{64}$/.test(expected) && sha(text) === expected, phase);
    const lines = text.slice(0, -1).split('\n'); check(lines.length > 1 && lines.length <= 5000, phase);
    const rows = lines.map(line => { check(Buffer.byteLength(line) <= 16 * 1024, phase); return parse(line); });
    const header = rows.shift();
    shape(header, ['record', 'kind', 'version', 'evidenceClass', 'sourceLayout', 'selection', 'counts', 'absentProbes', 'dataReadPattern', 'remaining']);
    check(header.record === 'header' && header.kind === 'pfa-installed-native-data' && header.version === 1 && header.evidenceClass === 'static-file-snapshot' &&
      header.sourceLayout === 'node_modules' && header.selection === 'sharp-0.35.5-win32-arm64+fast-geoip-1.1.88' && header.dataReadPattern === 'whole-json-or-locations-range-112n+1:111', phase);
    const sharp = 'node_modules/sharp', native = 'node_modules/@img/sharp-win32-arm64', geo = 'node_modules/fast-geoip';
    const controls = [`${sharp}/package.json`, ...['index', 'constructor', 'sharp', 'libvips'].flatMap(name => ['mjs', 'cjs'].map(ext => `${sharp}/dist/${name}.${ext}`)),
      `${native}/package.json`, `${native}/index.cjs`, `${native}/versions.json`, `${geo}/package.json`, ...['index', 'utils', 'params'].map(name => `${geo}/build/${name}.js`)].sort(compare);
    const nativeNames = ['libvips-42.dll', 'libvips-cpp-8.18.7.dll', 'sharp-win32-arm64-0.35.5.node'].map(name => `${native}/lib/${name}`);
    const absencePaths = [`${sharp}/src/build`, 'node_modules/@img/sharp-wasm32'];
    check(JSON.stringify(header.absentProbes) === JSON.stringify(absencePaths), phase);
    check(JSON.stringify(header.remaining) === JSON.stringify(['windows-loader-path-observation', 'native-file-custody', 'data-read-consumer', 'installed-stage-integration', 'runtime-selection-input-enforcement']), phase);
    const files = new Map(tree.files.map(file => [`${file.packageId}/${file.relativePath}`, file]));
    const groups = { 'control-file': [], 'native-file': [], 'data-file': [] }; let previous = '', totalBytes = 0, dataBytes = 0;
    for (const row of rows) {
      const order = `${row.record}:${row.relativePath ?? row.from}:${row.importKind ?? ''}:${row.name ?? ''}`;
      check(order > previous, phase); previous = order;
      if (row.record === 'native-import') {
        shape(row, ['record', 'from', 'importKind', 'name', 'target']);
        check(nativeNames.includes(row.from) && ['ordinary', 'delay'].includes(row.importKind) && typeof row.name === 'string' &&
          /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:dll|exe)$/i.test(row.name) &&
          [...nativeNames, 'trusted-windows-base', 'trusted-node-runtime'].includes(row.target), phase); continue;
      }
      check(Object.hasOwn(groups, row.record), phase);
      shape(row, row.record === 'native-file' ? ['record', 'relativePath', 'size', 'sha256', 'machine', 'format'] : ['record', 'relativePath', 'size', 'sha256']);
      const file = files.get(row.relativePath);
      check(file && file.size === row.size && file.sha256 === row.sha256 && row.size > 0, phase);
      if (row.record === 'native-file') check(nativeNames.includes(row.relativePath) && row.machine === 'arm64' && row.format === 'PE32+', phase);
      if (row.record === 'data-file') check(row.relativePath.startsWith(`${geo}/data/`) && /^(?:index|locations|i?(?:0|[1-9][0-9]{0,5}))\.json$/.test(row.relativePath.slice(`${geo}/data/`.length)) && row.size <= 16 * MiB, phase);
      groups[row.record].push(row.relativePath); totalBytes += row.size;
      if (row.record === 'data-file') dataBytes += row.size;
    }
    check(JSON.stringify(groups['control-file']) === JSON.stringify(controls) && JSON.stringify(groups['native-file']) === JSON.stringify(nativeNames), phase);
    const expectedData = Array.from(files.keys()).filter(name => name.startsWith(`${geo}/data/`)).sort(compare);
    check(groups['data-file'].length >= 2 && groups['data-file'].length <= 4096 && groups['data-file'].includes(`${geo}/data/index.json`) &&
      groups['data-file'].includes(`${geo}/data/locations.json`) && JSON.stringify(groups['data-file']) === JSON.stringify(expectedData), phase);
    shape(header.counts, ['controls', 'nativeFiles', 'dataFiles', 'dataBytes', 'totalBytes']);
    check(JSON.stringify(header.counts) === JSON.stringify(JSON.parse(canonicalJson({ controls: controls.length, nativeFiles: 3, dataFiles: expectedData.length, dataBytes, totalBytes }))) &&
      dataBytes <= 192 * MiB && totalBytes <= 224 * MiB, phase);
    const members = [...tree.files.map(file => `${file.packageId}/${file.relativePath}`), ...tree.directories.map(dir => `${dir.packageId}/${dir.relativePath}`)];
    for (const absent of absencePaths) check(!members.some(name => name.toLowerCase() === absent.toLowerCase() || name.toLowerCase().startsWith(`${absent.toLowerCase()}/`)), phase);
    return { sha256: expected, absencePaths };
  } catch { fail(phase); }
}
export function requireInstalledRuntimeStage(record) { check(brands.has(record), 'LINEAGE'); return record; }

/** Inert byte staging only. No module/native/application execution or custody grant. */
export async function stageInstalledRuntimePackageTree(acceptedTreeRecord, nativeInput, suppliedAllocation) {
  let tree; try { tree = requireRuntimePackageTree(acceptedTreeRecord); } catch { fail('LINEAGE'); }
  check(tree.header.evidenceClass === 'declared-installed-candidate' && tree.header.sourceRoot === sourceRoot &&
    tree.profile.document.paths.buildRoot === `${sourceRoot}\\dist` && tree.edges.every(edge => edge.status !== 'missing-required') &&
    tree.unresolved.every(row => ['native-addon', 'native-dll', 'opaque-data'].includes(row.reason)), 'CAPABILITY');
  const joined = nativeData(nativeInput, tree);
  const omitted = tree.unresolved.filter(row => row.sourceRef.startsWith('generated-tooling-not-staged:'));
  const omittedDirectories = []; let matchedOmissions = 0;
  for (const group of installedGeneratedTooling) {
    const prefix = `generated-tooling-not-staged:${group.directory}/`;
    const actual = omitted.filter(row => row.sourceRef.startsWith(prefix));
    if (!actual.length) continue;
    const expected = group.files.map(file => `${prefix}${file.name}:${file.size}:${file.sha256}`).sort(compare);
    check(actual.length === expected.length && actual.every((row, index) => row.reason === 'opaque-data' && row.sourceRef === expected[index]), 'TOOLING_DISPOSITION');
    matchedOmissions += actual.length; omittedDirectories.push(group.directory);
  }
  check(matchedOmissions === omitted.length, 'TOOLING_DISPOSITION');
  const stageAbsences = [...joined.absencePaths, ...omittedDirectories].sort(compare);
  let phase = 'ALLOCATION'; const opened = new Set();
  try {
    const allocation = parse(canonicalJson(suppliedAllocation)); shape(allocation, ['stageRoot', 'expectedTreeSha256', 'bootstrapFiles']);
    absolute(allocation.stageRoot); check(allocation.expectedTreeSha256 === tree.treeSha256 && allocation.stageRoot.startsWith(`${namespace}\\`) &&
      /^[a-z][a-z0-9-]{0,31}\\stage$/.test(allocation.stageRoot.slice(namespace.length + 1)), phase);
    check(Array.isArray(allocation.bootstrapFiles) && allocation.bootstrapFiles.length === closure.length, phase);
    for (const root of [tree.profile.document.paths.buildRoot, `${sourceRoot}\\node_modules`, ...Object.values(tree.profile.document.paths)]) disjoint(allocation.stageRoot, root);
    const members = new Map();
    const add = (relativePath, source, assetKind) => {
      memberPath(allocation.stageRoot, relativePath); shape(source, ['path', 'size', 'sha256']); absolute(source.path);
      check(Number.isSafeInteger(source.size) && source.size >= 0 && source.size <= 100 * MiB && /^[a-f0-9]{64}$/.test(source.sha256), phase);
      const prior = members.get(relativePath.toLowerCase());
      check(!prior || prior.relativePath === relativePath && prior.assetKind === assetKind && prior.source.path === source.path &&
        prior.source.size === source.size && prior.source.sha256 === source.sha256, 'COLLISION');
      if (!prior) members.set(relativePath.toLowerCase(), { relativePath, source, assetKind });
    };
    for (const file of tree.files) { const relativePath = `${file.packageId}/${file.relativePath}`;
      add(relativePath, { path: memberPath(sourceRoot, relativePath), size: file.size, sha256: file.sha256 }, file.assetKind); }
    for (const artifact of tree.profile.document.build.artifacts) add(`dist/${artifact.relativePath}`, {
      path: memberPath(tree.profile.document.paths.buildRoot, artifact.relativePath), size: artifact.size, sha256: artifact.sha256 }, artifact.role === 'server-entry' ? 'module' : 'opaque');
    check(tree.profile.document.build.artifacts.some(file => file.role === 'server-entry' && file.relativePath === 'index.js'), phase);
    add('package.json', { path: `${sourceRoot}\\package.json`, ...tree.header.packageJson }, 'json');
    add('package-lock.json', { path: `${sourceRoot}\\package-lock.json`, ...tree.header.packageLock }, 'json');
    for (const file of tree.rootInventory.document.packageMetadata) {
      check(file.path.startsWith(`${sourceRoot}\\`), 'CONTROLLING_METADATA');
      add(path.win32.relative(sourceRoot, file.path).replaceAll('\\', '/'), file, 'json');
    }
    for (const [index, file] of allocation.bootstrapFiles.entries()) {
      shape(file, ['relativePath', 'source']); check(file.relativePath === closure[index] && path.win32.basename(file.source.path) === path.posix.basename(closure[index]) && file.source.size <= 128 * 1024, phase);
      add(file.relativePath, file.source, 'module');
    }
    const files = Array.from(members.values()).sort((a, b) => compare(a.relativePath, b.relativePath));
    check(files.length <= 33284 && files.reduce((sum, file) => sum + file.source.size, 0) <= 1013 * MiB, 'BOUNDS');
    const dirs = new Map();
    const directory = name => { memberPath(allocation.stageRoot, name); const prior = dirs.get(name.toLowerCase()); check(!prior || prior === name, 'COLLISION'); dirs.set(name.toLowerCase(), name); };
    for (const file of files) for (let dir = path.posix.dirname(file.relativePath); dir !== '.'; dir = path.posix.dirname(dir)) directory(dir);
    for (const dir of tree.directories) directory(`${dir.packageId}/${dir.relativePath}`);
    const directories = Array.from(dirs.values()).sort(compare); check(directories.length <= 24576, 'BOUNDS');
    for (const dir of directories) check(!members.has(dir.toLowerCase()), 'COLLISION');
    for (const absent of stageAbsences) check(![...directories, ...files.map(file => file.relativePath)].some(name => name.toLowerCase() === absent.toLowerCase() || name.toLowerCase().startsWith(`${absent.toLowerCase()}/`)), 'ABSENCE');
    const deadline = performance.now() + 300000, tick = () => check(performance.now() <= deadline, 'DEADLINE');
    const sourceFiles = new Set(files.map(file => file.source.path));
    const checked = Array.from(new Set([...files.flatMap(file => ancestry(file.source.path)), ...ancestry(path.win32.dirname(allocation.stageRoot))]));
    const snapshots = new Map(), metadata = new Map();
    const inspect = name => { tick(); const node = fs.lstatSync(name, { bigint: true });
      check(!node.isSymbolicLink() && node.ino > 0n && fs.realpathSync.native(name) === name &&
        (sourceFiles.has(name) ? node.isFile() && node.nlink === 1n : node.isDirectory()), 'SOURCE_IDENTITY'); return node; };
    const absent = () => { for (const name of joined.absencePaths) {
      try { fs.lstatSync(memberPath(sourceRoot, name), { bigint: true }); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      fail('ABSENCE');
    } };
    const verify = async first => {
      let offset = 0;
      while (offset < checked.length) {
        const batch = []; let bytes = 2;
        while (offset < checked.length && batch.length < 1024) { const size = Buffer.byteLength(JSON.stringify(checked[offset])) + (batch.length ? 1 : 0); if (bytes + size > 128 * 1024) break; bytes += size; batch.push(checked[offset++]); }
        check(batch.length > 0, 'BOUNDS'); tick();
        for (const row of await readWindowsMetadata(batch, process.env.SystemRoot)) {
          const node = inspect(row.path); check(row.directory === node.isDirectory() && row.size === String(node.isFile() ? node.size : 0n) &&
            row.creationTicks === String(621355968000000000n + node.birthtimeNs / 100n) && (!node.isFile() || row.writeTicks === String(621355968000000000n + node.mtimeNs / 100n)), 'SOURCE_METADATA');
          const stable = canonicalJson(row.directory ? { path: row.path, directory: true, attributes: row.attributes, creationTicks: row.creationTicks } : row);
          if (first) metadata.set(row.path, stable); else check(metadata.get(row.path) === stable, 'SOURCE_METADATA');
        }
      }
    };
    phase = 'SOURCE_IDENTITY'; for (const name of checked) snapshots.set(name, identity(inspect(name))); absent(); await verify(true);
    phase = 'CREATE_ROOT'; fs.mkdirSync(allocation.stageRoot); const stageIdentity = identity(fs.lstatSync(allocation.stageRoot, { bigint: true }));
    for (const dir of directories) { tick(); fs.mkdirSync(memberPath(allocation.stageRoot, dir)); }
    const staged = new Map(); phase = 'SOURCE_BYTES';
    for (const file of files) {
      tick(); const before = inspect(file.source.path); check(identity(before) === snapshots.get(file.source.path) && before.size === BigInt(file.source.size), phase);
      const input = fs.openSync(file.source.path, fs.constants.O_RDONLY); opened.add(input);
      try {
        check(identity(fs.fstatSync(input, { bigint: true })) === identity(before), phase);
        const destination = memberPath(allocation.stageRoot, file.relativePath), output = fs.openSync(destination, 'wx+'); opened.add(output);
        let copiedObject;
        try {
          const readHash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024); let position = 0;
          while (position < file.source.size) { tick(); const got = fs.readSync(input, buffer, 0, Math.min(buffer.length, file.source.size - position), position); check(got > 0, phase); readHash.update(buffer.subarray(0, got));
            let written = 0; while (written < got) { tick(); const count = fs.writeSync(output, buffer, written, got - written, position + written); check(count > 0, 'STAGE_BYTES'); written += count; } position += got;
          }
          check(readHash.digest('hex') === file.source.sha256 && identity(fs.fstatSync(input, { bigint: true })) === identity(before) && identity(inspect(file.source.path)) === identity(before), phase);
          fs.fsyncSync(output); const copyHash = createHash('sha256'); position = 0;
          while (position < file.source.size) { tick(); const got = fs.readSync(output, buffer, 0, Math.min(buffer.length, file.source.size - position), position); check(got > 0, 'STAGE_BYTES'); copyHash.update(buffer.subarray(0, got)); position += got; }
          const node = fs.lstatSync(destination, { bigint: true }); check(copyHash.digest('hex') === file.source.sha256 && node.isFile() && !node.isSymbolicLink() && node.nlink === 1n && node.size === BigInt(file.source.size) && fs.realpathSync.native(destination) === destination, 'STAGE_BYTES');
          copiedObject = fileObject(node);
        } finally { fs.closeSync(output); opened.delete(output); }
        // Windows only guarantees final write timestamps after the write handle closes.
        const closed = fs.lstatSync(destination, { bigint: true });
        check(fileObject(closed) === copiedObject && closed.isFile() && !closed.isSymbolicLink() && fs.realpathSync.native(destination) === destination, 'STAGE_IDENTITY');
        staged.set(destination, identity(closed));
      } finally { fs.closeSync(input); opened.delete(input); }
    }
    phase = 'POST'; for (const name of checked) check(identity(inspect(name)) === snapshots.get(name), 'SOURCE_CHANGED');
    absent(); await verify(false);
    check(identity(fs.lstatSync(allocation.stageRoot, { bigint: true })) === stageIdentity, 'STAGE_IDENTITY');
    for (const [name, prior] of staged) check(identity(fs.lstatSync(name, { bigint: true })) === prior, 'STAGE_CHANGED');
    const expected = new Set([...directories, ...files.map(file => file.relativePath)]), found = new Set(), pending = [''];
    while (pending.length) {
      const parent = pending.pop(), full = parent ? memberPath(allocation.stageRoot, parent) : allocation.stageRoot, directory = fs.opendirSync(full);
      try { for (let entry; (entry = directory.readSync()) !== null;) {
        tick(); const rel = parent ? `${parent}/${entry.name}` : entry.name; check(expected.has(rel) && !found.has(rel), 'STAGE_MEMBERS'); found.add(rel);
        const node = fs.lstatSync(memberPath(allocation.stageRoot, rel), { bigint: true });
        check(!node.isSymbolicLink() && fs.realpathSync.native(memberPath(allocation.stageRoot, rel)) === memberPath(allocation.stageRoot, rel), 'STAGE_IDENTITY');
        if (dirs.has(rel.toLowerCase())) { check(node.isDirectory(), 'STAGE_IDENTITY'); pending.push(rel); } else check(node.isFile() && node.nlink === 1n, 'STAGE_IDENTITY');
      } } finally { directory.closeSync(); }
    }
    check(found.size === expected.size, 'STAGE_MEMBERS');
    const result = freeze({ kind: 'staged-installed-runtime', evidenceClass: tree.header.evidenceClass, componentId: 'sharp-geoip-v1', stageRoot: allocation.stageRoot,
      entryRelativePath: 'dist/index.js', componentEntryRelativePath: '.runtime/runtime-installed-component.mjs', treeSha256: tree.treeSha256,
      rootInventorySha256: tree.header.rootInventorySha256, profileManifestSha256: tree.header.profileManifestSha256, buildCommitSha: tree.header.buildCommitSha,
      harnessCommitSha: tree.header.harnessCommitSha, nativeDataSha256: joined.sha256, runtime: tree.header.runtime,
      files: files.map(file => ({ relativePath: file.relativePath, size: file.source.size, sha256: file.source.sha256, assetKind: file.assetKind })), directories,
      absencePaths: stageAbsences, unresolved: tree.unresolved,
      certifications: { transitiveClosureComplete: false, custodyHeld: false, runtimeDependencyIdentity: false, executionAuthorized: false } });
    brands.add(result); return result;
  } catch (error) { if (error.message?.startsWith('INSTALLED_RUNTIME_STAGE_REFUSED:')) throw error; fail(phase); }
  finally { let failed = false; for (const fd of opened) { try { fs.closeSync(fd); } catch { failed = true; } } if (failed) fail('CLOSE'); }
}
