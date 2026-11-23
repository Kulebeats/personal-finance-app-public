import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { canonicalJson, parse, shape, check, hash, absolute, freeze } from './primitives.mjs';
import { readRuntimeResolutionInventory } from './runtime-resolution.mjs';
import { readWindowsMetadata } from '../../../scripts/recovery/windows-metadata.mjs';

const MiB = 1024 * 1024;
const limits = Object.freeze({ text: 16 * MiB, line: 16 * 1024, records: 45697, packages: 512, edges: 4096,
  directories: 8192, files: 32768, bytes: 512 * MiB, file: 32 * MiB, depth: 16, unresolved: 128 });
// Observed installer-generated commands, not runtime package payload or execution authority.
export const installedSharpTooling = freeze({ directory: 'node_modules/sharp/node_modules/.bin', files: [
  { name: 'semver', size: 389, sha256: '77ef070b2790156c37dd77efd5d0cf54fbff85d9c1adabc890948192cd2b2639' },
  { name: 'semver.cmd', size: 325, sha256: '3fa2710c6522669c2253edbd465ccf4c58d0d29e0eff3337d7900cd4e5cec7ac' },
  { name: 'semver.ps1', size: 805, sha256: '1e1355d1aaf2a75275f9d884dbcd2f1c713d4ada1782fe8370bc21db6aedbc31' },
] });
export const installedYahooTooling = freeze({ directory: 'node_modules/yahoo-finance2/node_modules/.bin', files: [
  { name: 'tldts', size: 381, sha256: 'acb576d0cdbcd419cb2078cb63eab1ad40800094a5cca504c7e79a0530c45580' },
  { name: 'tldts.cmd', size: 321, sha256: 'd82bf9733d3016c8f72fb964140406fedc725bb1273e8ee7aa808f15f4db146b' },
  { name: 'tldts.ps1', size: 789, sha256: '6043827739a3a12198407c11a9ca42333c060be89d22373d0c1781802f9e09b8' },
] });
export const installedGeneratedTooling = freeze([installedSharpTooling, installedYahooTooling]);
// Complete finite census: two measured groups, not a general .bin/shim parser.
const toolingSelections = freeze([
  { tooling: installedSharpTooling, packages: [
    { id: 'node_modules/sharp', name: 'sharp', version: '0.35.5' },
    { id: 'node_modules/sharp/node_modules/semver', name: 'semver', version: '7.8.5' },
  ], edges: [{ from: 'node_modules/sharp', name: 'semver', declared: '^7.8.5', range: '^7.8.5', target: 'node_modules/sharp/node_modules/semver' }],
  bin: { packageId: 'node_modules/sharp/node_modules/semver', name: 'semver', target: 'bin/semver.js' } },
  { tooling: installedYahooTooling, packages: [
    { id: 'node_modules/yahoo-finance2', name: 'yahoo-finance2', version: '3.13.0' },
    { id: 'node_modules/yahoo-finance2/node_modules/tough-cookie', name: 'tough-cookie', version: '5.1.2' },
    { id: 'node_modules/yahoo-finance2/node_modules/tldts', name: 'tldts', version: '6.1.86' },
  ], edges: [
    { from: 'node_modules/yahoo-finance2', name: 'tough-cookie', declared: 'npm:tough-cookie@^5.1.1', range: '^5.1.1', target: 'node_modules/yahoo-finance2/node_modules/tough-cookie' },
    { from: 'node_modules/yahoo-finance2/node_modules/tough-cookie', name: 'tldts', declared: '^6.1.32', range: '^6.1.32', target: 'node_modules/yahoo-finance2/node_modules/tldts' },
  ], bin: { packageId: 'node_modules/yahoo-finance2/node_modules/tldts', name: 'tldts', target: 'bin/cli.js' } },
]);
const brands = new WeakSet();
const refuse = () => { throw new Error('RUNTIME_PACKAGE_TREE_REFUSED'); };
const sha = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const count = (value, maximum) => check(Number.isSafeInteger(value) && value >= 0 && value <= maximum);
const name = value => check(typeof value === 'string' && /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(value) && value.length <= 214);
const packageName = value => value.startsWith('@') ? value.split('/').slice(0, 2).join('/') : value.split('/')[0];
const rootClass = kind => ({ 'import-statement': 'root-import', 'dynamic-import': 'root-dynamic', 'require-call': 'root-require' })[kind];
const order = ['header', 'package', 'dependency-edge', 'directory', 'file', 'unresolved'];
const key = row => row.record === 'dependency-edge' ? `${row.from}\0${row.edgeClass}\0${row.name}`
  : row.record === 'unresolved' ? `${row.reason}\0${row.sourceRef}` : `${row.packageId ?? ''}/${row.relativePath ?? ''}`;
const sorted = rows => rows.sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
function pin(value, maximum) { shape(value, ['size', 'sha256']); count(value.size, maximum); hash(value.sha256); }
function relative(root, value) {
  check(typeof value === 'string' && value.length > 0 && value.length <= 1024 && !value.includes('\\') && !value.startsWith('/'));
  const parts = value.split('/'); check(parts.length <= limits.depth && parts.every(part => part && part !== '.' && part !== '..'));
  const result = path.win32.join(root, ...parts); absolute(result); check(result.startsWith(`${root}\\`)); return result;
}
function packageId(root, value) {
  relative(root, value); const parts = value.split('/'); let index = 0;
  while (index < parts.length) {
    check(parts[index++] === 'node_modules'); const first = parts[index++]; check(typeof first === 'string');
    const item = first.startsWith('@') ? `${first}/${parts[index++]}` : first; name(item);
  }
  return value;
}
function rootRecord(profile, input) {
  // The original inventory text may exceed 2048 characters: never wrap it in canonicalJson.
  check(input && typeof input === 'object' && !types.isProxy(input) && Object.getPrototypeOf(input) === Object.prototype);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  check(Reflect.ownKeys(descriptors).length === 2 && ['text', 'pins'].every(k => descriptors[k] && 'value' in descriptors[k]));
  check(typeof descriptors.text.value === 'string');
  return readRuntimeResolutionInventory(profile, descriptors.text.value, descriptors.pins.value);
}
function headerCheck(header, profile, root) {
  shape(header, ['record', 'kind', 'version', 'evidenceClass', 'runId', 'profileManifestSha256', 'rootInventorySha256', 'buildCommitSha',
    'harnessCommitSha', 'approvalRef', 'metafileSha256', 'packageJson', 'packageLock', 'sourceRoot', 'runtime', 'counts']);
  check(header.kind === 'pfa-runtime-package-tree' && header.version === 1);
  const doc = root.document;
  for (const k of ['evidenceClass', 'runId', 'buildCommitSha', 'harnessCommitSha', 'approvalRef']) check(header[k] === doc[k]);
  check(header.profileManifestSha256 === profile.manifestSha256 && header.rootInventorySha256 === root.inventorySha256 && header.metafileSha256 === doc.metafile.file.sha256);
  absolute(header.sourceRoot); check(doc.dependencyRoots.length === 1 && doc.dependencyRoots[0] === `${header.sourceRoot}\\node_modules`);
  pin(header.packageJson, MiB); pin(header.packageLock, 8 * MiB);
  const control = doc.packageMetadata.find(f => f.path === `${header.sourceRoot}\\package.json`);
  check(control && control.size === header.packageJson.size && control.sha256 === header.packageJson.sha256);
  shape(header.runtime, ['executable', 'version', 'platform', 'arch']);
  check(same(header.runtime, { executable: doc.runtime.executable, version: doc.runtime.version, platform: doc.runtime.platform, arch: doc.runtime.arch }));
  shape(header.counts, ['packages', 'edges', 'directories', 'files', 'bytes', 'unresolved']);
  for (const k of Object.keys(header.counts)) count(header.counts[k], limits[k]);
}
function textRows(supplied) {
  let text = supplied;
  if (Buffer.isBuffer(text)) {
    check(text.length <= limits.text && !(text[0] === 0xef && text[1] === 0xbb && text[2] === 0xbf));
    text = new TextDecoder('utf-8', { fatal: true }).decode(text);
  }
  check(typeof text === 'string' && Buffer.byteLength(text) <= limits.text && Buffer.from(text).toString('utf8') === text);
  check(text.endsWith('\n') && !text.includes('\r') && !text.startsWith('\ufeff'));
  const lines = text.slice(0, -1).split('\n'); check(lines.length > 0 && lines.length <= limits.records);
  const rows = lines.map(line => { check(line.length > 0 && Buffer.byteLength(line) <= limits.line); return parse(line); });
  let previousRank = -1; let previousKey = '';
  for (const row of rows) {
    const rank = order.indexOf(row.record); check(rank >= 0 && rank >= previousRank);
    const current = key(row); check(rank !== previousRank || current > previousKey);
    previousRank = rank; previousKey = current;
  }
  check(rows[0].record === 'header' && rows.filter(r => r.record === 'header').length === 1); return { text, rows };
}

/** Pure accepted-input reader. A private inventory brand is not execution authority. */
export function readRuntimePackageTree(profile, input, suppliedText, callerPins) {
  try {
    const root = rootRecord(profile, input); const pins = parse(canonicalJson(callerPins));
    shape(pins, ['expectedTreeSha256', 'profileManifestSha256', 'rootInventorySha256', 'runId', 'buildCommitSha', 'harnessCommitSha', 'evidenceClass', 'approvalRef']);
    hash(pins.expectedTreeSha256); const { text, rows } = textRows(suppliedText); check(sha(text) === pins.expectedTreeSha256);
    const header = rows[0]; headerCheck(header, profile, root);
    for (const k of Object.keys(pins).filter(k => k !== 'expectedTreeSha256')) check(header[k] === pins[k]);
    const groups = Object.fromEntries(order.slice(1).map(k => [k, rows.filter(r => r.record === k)]));
    const packages = groups.package; const edges = groups['dependency-edge']; const directories = groups.directory;
    const files = groups.file; const unresolved = groups.unresolved; const packageMap = new Map(); const destinations = new Map();
    for (const [field, values] of Object.entries({ packages, edges, directories, files, unresolved })) {
      count(values.length, limits[field]); check(header.counts[field] === values.length);
    }
    const destination = (value, role) => { const prior = destinations.get(value.toLowerCase()); check(!prior); destinations.set(value.toLowerCase(), { value, role }); };
    for (const row of packages) {
      shape(row, ['record', 'packageId', 'name', 'version', 'manifestSize', 'manifestSha256', 'type']); packageId(header.sourceRoot, row.packageId); name(row.name);
      check(typeof row.version === 'string' && /^[0-9][A-Za-z0-9.+_-]{0,127}$/.test(row.version) && ['module', 'commonjs'].includes(row.type));
      check(row.packageId.endsWith(`node_modules/${row.name}`)); count(row.manifestSize, MiB); hash(row.manifestSha256);
      destination(row.packageId, 'package'); packageMap.set(row.packageId, row);
    }
    const blockers = new Set();
    for (const row of unresolved) {
      shape(row, ['record', 'reason', 'sourceRef', 'required']);
      check(['missing-root', 'esm-require-bridge', 'missing-required', 'native-addon', 'native-dll', 'opaque-data', 'unsupported-topology'].includes(row.reason));
      check(row.required === true && typeof row.sourceRef === 'string' && row.sourceRef.length > 0 && row.sourceRef.length <= 1024);
      blockers.add(`${row.reason}\0${row.sourceRef}`);
    }
    for (const row of directories) {
      shape(row, ['record', 'packageId', 'relativePath']); check(packageMap.has(row.packageId)); relative(header.sourceRoot, `${row.packageId}/${row.relativePath}`);
      check(!row.relativePath.split('/').includes('node_modules')); destination(`${row.packageId}/${row.relativePath}`, 'directory');
    }
    const fileMap = new Map(); let bytes = 0;
    for (const row of files) {
      shape(row, ['record', 'packageId', 'relativePath', 'size', 'sha256', 'assetKind']); check(packageMap.has(row.packageId));
      relative(header.sourceRoot, `${row.packageId}/${row.relativePath}`); check(!row.relativePath.split('/').includes('node_modules'));
      count(row.size, limits.file); hash(row.sha256); bytes += row.size; count(bytes, limits.bytes);
      const extension = path.win32.extname(row.relativePath).toLowerCase();
      const expected = ({ '.mjs': 'module', '.cjs': 'commonjs', '.json': 'json', '.node': 'native-addon', '.dll': 'native-dll', '.wasm': 'wasm' })[extension] ?? 'opaque';
      check(extension === '.js' ? ['module', 'commonjs'].includes(row.assetKind) : row.assetKind === expected);
      const location = `${row.packageId}/${row.relativePath}`; destination(location, 'file'); fileMap.set(location, row);
      if (['native-addon', 'native-dll'].includes(row.assetKind)) check(blockers.has(`${row.assetKind}\0${location}`));
    }
    for (const row of [...directories, ...files]) {
      const parent = path.posix.dirname(row.relativePath);
      check(parent === '.' || destinations.get(`${row.packageId}/${parent}`.toLowerCase())?.value === `${row.packageId}/${parent}` && destinations.get(`${row.packageId}/${parent}`.toLowerCase()).role === 'directory');
    }
    for (const row of packages) {
      const manifest = fileMap.get(`${row.packageId}/package.json`);
      check(manifest && manifest.size === row.manifestSize && manifest.sha256 === row.manifestSha256);
    }
    for (const row of edges) {
      shape(row, ['record', 'from', 'name', 'range', 'edgeClass', 'target', 'status']);
      check(row.from === '$root' || packageMap.has(row.from)); check(typeof row.range === 'string' && row.range.length <= 256);
      const rootEdge = row.from === '$root';
      check((rootEdge ? ['root-import', 'root-dynamic', 'root-require'] : ['required', 'optional', 'peer-required', 'peer-optional', 'bundled']).includes(row.edgeClass));
      if (rootEdge) { name(packageName(row.name)); check(row.range === ''); } else { name(row.name); check(row.range.length > 0 && !row.range.includes(':')); }
      check(['resolved', 'absent-optional', 'missing-required'].includes(row.status));
      if (row.status === 'resolved') check(packageMap.has(row.target) && packageMap.get(row.target).name === packageName(row.name));
      else {
        check(row.target === '');
        if (row.status === 'absent-optional') check(['optional', 'peer-optional'].includes(row.edgeClass));
        else check(blockers.has(`${rootEdge ? 'missing-root' : 'missing-required'}\0${row.from}:${row.name}`));
      }
      if (row.edgeClass === 'root-require') check(blockers.has(`esm-require-bridge\0require-call:${row.name}`));
    }
    const rootEdges = root.document.edges.filter(e => e.target.kind !== 'builtin');
    const declaredRootEdges = edges.filter(e => e.from === '$root'); check(declaredRootEdges.length === rootEdges.length);
    for (const original of rootEdges) {
      const row = declaredRootEdges.find(e => e.edgeClass === rootClass(original.kind) && e.name === original.specifier); check(row);
      if (row.status === 'resolved' && original.target.kind === 'file') {
        const selected = path.win32.relative(header.sourceRoot, original.target.file.path).replaceAll('\\', '/');
        check(selected.startsWith(`${row.target}/`)); const file = fileMap.get(selected);
        check(file && file.size === original.target.file.size && file.sha256 === original.target.file.sha256);
      }
    }
    const reached = new Set(declaredRootEdges.filter(e => e.status === 'resolved').map(e => e.target));
    for (let changed = true; changed;) { changed = false; for (const e of edges) if (reached.has(e.from) && e.status === 'resolved' && !reached.has(e.target)) { reached.add(e.target); changed = true; } }
    check(reached.size === packages.length);
    check(same(header.counts, { packages: packages.length, edges: edges.length, directories: directories.length, files: files.length, bytes, unresolved: unresolved.length }));
    const result = freeze({ kind: 'validated-runtime-package-tree', treeSha256: pins.expectedTreeSha256, header, packages, edges, directories, files, unresolved, profile, rootInventory: root });
    brands.add(result); return result;
  } catch { refuse(); }
}
export function requireRuntimePackageTree(record) { if (!brands.has(record)) refuse(); return record; }

/** Untrusted capture producer: known root blockers return before package bytes/children. */
export async function collectRuntimePackageTreeCandidate(profile, input, suppliedOptions) {
  return collectCandidate(profile, input, suppliedOptions, false);
}

/** Inert installed bytes only: native/data obligations remain unresolved records. */
export async function collectInstalledRuntimePackageTreeCandidate(profile, input, suppliedOptions) {
  return collectCandidate(profile, input, suppliedOptions, true);
}

async function collectCandidate(profile, input, suppliedOptions, installed) {
  try {
    const root = rootRecord(profile, input);
    if (installed) check(root.document.evidenceClass === 'declared-installed-candidate');
    const options = parse(canonicalJson(suppliedOptions));
    shape(options, ['sourceRoot', 'systemRoot', 'packageJson', 'packageLock']); absolute(options.sourceRoot); absolute(options.systemRoot);
    check(root.document.dependencyRoots.length === 1 && root.document.dependencyRoots[0] === `${options.sourceRoot}\\node_modules`);
    for (const [key, filename, maximum] of [['packageJson', 'package.json', MiB], ['packageLock', 'package-lock.json', 8 * MiB]]) {
      shape(options[key], ['path', 'size', 'sha256']); check(options[key].path === `${options.sourceRoot}\\${filename}`); pin({ size: options[key].size, sha256: options[key].sha256 }, maximum);
    }
    const blockers = []; const roots = [];
    for (const edge of root.document.edges.filter(e => e.target.kind !== 'builtin')) {
      const item = packageName(edge.specifier); name(item); const location = relative(options.sourceRoot, `node_modules/${item}`);
      let found = false;
      try { const node = fs.lstatSync(`${location}\\package.json`, { bigint: true }); check(node.isFile() && !node.isSymbolicLink() && node.nlink === 1n); found = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!found) blockers.push({ record: 'unresolved', reason: 'missing-root', sourceRef: `$root:${edge.specifier}`, required: true });
      else roots.push(`node_modules/${item}`);
      if (edge.kind === 'require-call') blockers.push({ record: 'unresolved', reason: 'esm-require-bridge', sourceRef: `require-call:${edge.specifier}`, required: true });
    }
    const unique = Array.from(new Map(blockers.map(b => [key(b), b])).values()); check(unique.length <= limits.unresolved);
    if (unique.length) return freeze({ status: 'blocked', evidenceClass: root.document.evidenceClass, profileManifestSha256: profile.manifestSha256,
      rootInventorySha256: root.inventorySha256, blockers: sorted(unique), packageByteCaptureStarted: false });
    return await capture(profile, root, options, Array.from(new Set(roots)), installed);
  } catch { refuse(); }
}

async function capture(profile, root, options, initial, installed) {
  const deadline = performance.now() + 300000; const active = new Set(); const snapshots = new Map(); const metadata = new Map(); const listings = new Map(); const contents = new Map();
  const tick = () => check(performance.now() <= deadline);
  // Ancestor sibling activity changes directory timestamps without changing identity.
  // Package directory membership is checked independently by exact name listings.
  const identity = node => (node.isDirectory() ? [node.dev, node.ino, node.mode, node.birthtimeNs]
    : [node.dev, node.ino, node.mode, node.nlink, node.size, node.birthtimeNs, node.ctimeNs, node.mtimeNs]).map(String).join(':');
  const full = value => relative(options.sourceRoot, value);
  const inspect = location => {
    tick(); const node = fs.lstatSync(location, { bigint: true });
    check(!node.isSymbolicLink() && (node.isFile() || node.isDirectory()) && fs.realpathSync.native(location) === location);
    if (node.isFile()) { check(node.nlink === 1n); count(Number(node.size), limits.file); }
    const previous = snapshots.get(location); check(!previous || previous === identity(node)); snapshots.set(location, identity(node));
    check(snapshots.size <= limits.files + limits.directories + limits.packages * 8); return node;
  };
  const ancestry = location => {
    const list = [location]; let prior = location;
    while (path.win32.dirname(prior) !== prior) { prior = path.win32.dirname(prior); list.unshift(prior); }
    return list;
  };
  const bind = (locations, rows) => rows.forEach((row, index) => {
    const location = locations[index]; const node = inspect(location);
    check(row.path === location && row.directory === node.isDirectory() && row.size === String(node.isFile() ? node.size : 0n));
    check(row.creationTicks === String(621355968000000000n + node.birthtimeNs / 100n));
    if (node.isFile()) check(row.writeTicks === String(621355968000000000n + node.mtimeNs / 100n));
    const signature = canonicalJson(node.isDirectory() ? { path: row.path, directory: true, attributes: row.attributes, creationTicks: row.creationTicks } : row);
    check(!metadata.has(location) || metadata.get(location) === signature); metadata.set(location, signature);
  });
  const verify = async locations => {
    let index = 0;
    while (index < locations.length) {
      const batch = []; let size = 2;
      while (index < locations.length && batch.length < 1024) {
        const next = Buffer.byteLength(JSON.stringify(locations[index])) + (batch.length ? 1 : 0); if (size + next > 128 * 1024) break;
        size += next; batch.push(locations[index++]);
      }
      check(batch.length > 0); tick(); bind(batch, await readWindowsMetadata(batch, options.systemRoot)); tick();
    }
  };
  const ensure = async location => {
    const paths = ancestry(location); paths.forEach(inspect); const fresh = paths.filter(p => !metadata.has(p)); if (fresh.length) await verify(fresh);
  };
  const read = (location, maximum) => {
    tick(); const before = inspect(location); check(before.isFile()); count(Number(before.size), maximum);
    const fd = fs.openSync(location, fs.constants.O_RDONLY); active.add(fd);
    try {
      check(identity(fs.fstatSync(fd, { bigint: true })) === identity(before));
      const parts = []; const buffer = Buffer.alloc(64 * 1024); let offset = 0;
      while (offset < Number(before.size)) { tick(); const got = fs.readSync(fd, buffer, 0, Math.min(buffer.length, Number(before.size) - offset), offset); check(got > 0);
        parts.push(Buffer.from(buffer.subarray(0, got))); offset += got; }
      check(identity(fs.fstatSync(fd, { bigint: true })) === identity(before)); inspect(location); return Buffer.concat(parts);
    } finally { fs.closeSync(fd); active.delete(fd); }
  };
  const json = bytes => { const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); check(parsed && typeof parsed === 'object' && !Array.isArray(parsed)); return parsed; };
  const small = async location => { if (!contents.has(location)) { await ensure(location); contents.set(location, read(location, MiB)); } return contents.get(location); };
  const directory = (location, maximum = limits.files + limits.directories) => {
    check(inspect(location).isDirectory()); const children = []; const opened = fs.opendirSync(location);
    try { for (let item; (item = opened.readSync()) !== null;) { tick(); children.push(item.name); check(children.length <= maximum); } }
    finally { opened.closeSync(); }
    const names = children.slice().sort(); const folded = new Set(); for (const item of names) { relative(location, item); check(!item.includes('/') && !folded.has(item.toLowerCase())); folded.add(item.toLowerCase()); }
    const signature = JSON.stringify(names); check(!listings.has(location) || listings.get(location) === signature); listings.set(location, signature); return names;
  };
  const find = (requester, dependency) => {
    let current = full(requester);
    for (;;) {
      if (path.win32.basename(current) !== 'node_modules') {
        const candidate = `${current}\\node_modules\\${dependency.replaceAll('/', '\\')}\\package.json`;
        try { const node = fs.lstatSync(candidate, { bigint: true }); check(node.isFile() && !node.isSymbolicLink() && node.nlink === 1n);
          return path.win32.relative(options.sourceRoot, path.win32.dirname(candidate)).replaceAll('\\', '/');
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      if (current === options.sourceRoot) return '';
      current = path.win32.dirname(current); check(current === options.sourceRoot || current.startsWith(`${options.sourceRoot}\\`));
    }
  };
  const blockers = []; const addBlocker = (reason, sourceRef) => {
    if (!blockers.some(b => b.reason === reason && b.sourceRef === sourceRef)) blockers.push({ record: 'unresolved', reason, sourceRef, required: true });
    check(blockers.length <= limits.unresolved);
  };
  const blocked = () => freeze({ status: 'blocked', evidenceClass: root.document.evidenceClass, profileManifestSha256: profile.manifestSha256,
    rootInventorySha256: root.inventorySha256, blockers: sorted(blockers), packageByteCaptureStarted: true });
  const unsupported = () => blockers.some(row => !installed || !['native-addon', 'native-dll', 'opaque-data'].includes(row.reason));
  try {
    for (const item of [options.packageJson, options.packageLock]) { await ensure(item.path); const bytes = read(item.path, item === options.packageJson ? MiB : 8 * MiB);
      check(bytes.length === item.size && sha(bytes) === item.sha256); contents.set(item.path, bytes); }
    const control = root.document.packageMetadata.find(p => p.path === options.packageJson.path);
    check(control && control.size === options.packageJson.size && control.sha256 === options.packageJson.sha256);
    const lock = json(contents.get(options.packageLock.path)); check(lock.lockfileVersion === 3 && lock.packages && typeof lock.packages === 'object' && !Array.isArray(lock.packages));
    const packages = []; const edges = []; const queue = initial.slice(); const seen = new Set();
    for (const e of root.document.edges.filter(e => e.target.kind !== 'builtin')) edges.push({ record: 'dependency-edge', from: '$root', name: e.specifier, range: '',
      edgeClass: rootClass(e.kind), target: `node_modules/${packageName(e.specifier)}`, status: 'resolved' });
    while (queue.length) {
      tick(); const id = queue.shift(); if (seen.has(id)) continue; packageId(options.sourceRoot, id); seen.add(id); check(seen.size <= limits.packages);
      const manifest = await small(`${full(id)}\\package.json`); const doc = json(manifest); name(doc.name);
      check(typeof doc.version === 'string' && ['module', 'commonjs', undefined].includes(doc.type));
      const locked = lock.packages[id]; check(locked && locked.version === doc.version && locked.link !== true);
      if (installed && Object.hasOwn(locked, 'name')) check(locked.name === doc.name);
      if (!id.endsWith(`node_modules/${doc.name}`)) { addBlocker('unsupported-topology', id); return blocked(); }
      packages.push({ record: 'package', packageId: id, name: doc.name, version: doc.version,
        manifestSize: manifest.length, manifestSha256: sha(manifest), type: doc.type ?? 'commonjs' });
      const declared = new Map();
      for (const [field, edgeClass] of [['dependencies', 'required'], ['optionalDependencies', 'optional'], ['peerDependencies', 'peer-required']]) {
        if (doc[field] === undefined) continue; check(doc[field] && typeof doc[field] === 'object' && !Array.isArray(doc[field]));
        const entries = Object.entries(doc[field]); check(entries.length <= 512);
        for (const [dependency, suppliedRange] of entries) { name(dependency); check(typeof suppliedRange === 'string' && suppliedRange.length > 0 && suppliedRange.length <= 256);
          let range = suppliedRange;
          if (range.includes(':')) {
            const prefix = `npm:${dependency}@`, candidate = range.startsWith(prefix) ? range.slice(prefix.length) : '';
            // Same-name registry aliases only. The pinned manifest retains raw spelling;
            // edge.range is the equivalent bounded registry range used by the v1 reader.
            if (!installed || !/^[~^]?(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})(?:-[0-9A-Za-z.-]{1,64})?$/.test(candidate)) {
              addBlocker('unsupported-topology', `${id}:${dependency}`); continue;
            }
            range = candidate;
          }
          if (field === 'peerDependencies' && declared.has(dependency)) continue;
          declared.set(dependency, { range, edgeClass: field === 'peerDependencies' && doc.peerDependenciesMeta?.[dependency]?.optional === true ? 'peer-optional' : edgeClass }); }
      }
      const bundled = doc.bundledDependencies ?? doc.bundleDependencies ?? [];
      check(Array.isArray(bundled) && bundled.length <= 512);
      for (const dependency of bundled) { name(dependency); if (!declared.has(dependency)) declared.set(dependency, { range: '*', edgeClass: 'bundled' }); }
      for (const [dependency, declaration] of declared) {
        const target = find(id, dependency); const optional = ['optional', 'peer-optional'].includes(declaration.edgeClass);
        edges.push({ record: 'dependency-edge', from: id, name: dependency, range: declaration.range, edgeClass: declaration.edgeClass,
          target, status: target ? 'resolved' : optional ? 'absent-optional' : 'missing-required' }); check(edges.length <= limits.edges);
        if (target) queue.push(target); else if (!optional) addBlocker('missing-required', `${id}:${dependency}`);
      }
    }
    if (blockers.length) return blocked();
    const directories = []; const pending = []; const tooling = []; let total = 0; let nestedWork = 0; let nestedInstances = 0;
    for (const pkg of packages) {
      const walk = (location, prefix = '') => {
        tick(); check(prefix.split('/').length <= limits.depth);
        for (const item of directory(location)) {
          const rel = prefix ? `${prefix}/${item}` : item; const child = `${location}\\${item}`; const node = inspect(child);
          if (node.isDirectory() && item === 'node_modules') {
            if (prefix) { addBlocker('unsupported-topology', `${pkg.packageId}/${rel}`); continue; }
            for (const namespace of directory(child, limits.packages)) {
              check(++nestedWork <= limits.packages * 2);
              const selection = installed ? toolingSelections.find(item => item.tooling.directory === `${pkg.packageId}/node_modules/${namespace}`) : undefined;
              if (selection) {
                const documents = new Map(selection.packages.filter(item => contents.has(`${full(item.id)}\\package.json`)).map(item => [item.id, json(contents.get(`${full(item.id)}\\package.json`))]));
                const validPackages = selection.packages.every(item => documents.get(item.id)?.name === item.name && documents.get(item.id)?.version === item.version && lock.packages[item.id]?.version === item.version);
                const validEdges = selection.edges.every(item => documents.get(item.from)?.dependencies?.[item.name] === item.declared &&
                  lock.packages[item.from]?.dependencies?.[item.name] === item.declared && edges.some(edge => edge.from === item.from && edge.name === item.name && edge.edgeClass === 'required' && edge.range === item.range && edge.target === item.target));
                const bin = value => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && value[selection.bin.name] === selection.bin.target;
                const valid = validPackages && validEdges && bin(documents.get(selection.bin.packageId)?.bin) && bin(lock.packages[selection.bin.packageId]?.bin);
                const location = `${child}\\.bin`, names = directory(location, 4);
                if (!valid || !same(names, selection.tooling.files.map(file => file.name))) { addBlocker('unsupported-topology', selection.tooling.directory); return; }
                for (const pin of selection.tooling.files) {
                  const filename = `${location}\\${pin.name}`, item = inspect(filename);
                  if (!item.isFile() || item.size !== BigInt(pin.size)) { addBlocker('unsupported-topology', `${selection.tooling.directory}/${pin.name}`); return; }
                  tooling.push({ location: filename, relativePath: `${selection.tooling.directory}/${pin.name}`, ...pin });
                }
                continue;
              }
              const scoped = namespace.startsWith('@');
              const installedNames = scoped ? directory(`${child}\\${namespace}`, limits.packages) : [namespace];
              for (const leaf of installedNames) {
                if (scoped) check(++nestedWork <= limits.packages * 2);
                check(++nestedInstances <= limits.packages); const nested = scoped ? `${namespace}/${leaf}` : leaf;
                if (!seen.has(`${pkg.packageId}/node_modules/${nested}`)) { addBlocker('unsupported-topology', `${pkg.packageId}/node_modules/${nested}`); return; }
              }
            }
            continue;
          }
          if (node.isDirectory()) {
            if (installed && pkg.packageId === 'node_modules/fast-geoip' && rel === 'data') addBlocker('opaque-data', `${pkg.packageId}/${rel}`);
            directories.push({ record: 'directory', packageId: pkg.packageId, relativePath: rel }); check(directories.length <= limits.directories); walk(child, rel);
          }
          else { total += Number(node.size); count(total, limits.bytes); pending.push({ pkg, location: child, relativePath: rel, size: Number(node.size) }); check(pending.length <= limits.files);
            if (/\.node$/i.test(item)) addBlocker('native-addon', `${pkg.packageId}/${rel}`);
            if (/\.dll$/i.test(item)) addBlocker('native-dll', `${pkg.packageId}/${rel}`);
            if (installed && /\.wasm$/i.test(item)) addBlocker('opaque-data', `${pkg.packageId}/${rel}`);
          }
        }
      };
      walk(full(pkg.packageId)); if (unsupported()) return blocked();
    }
    if (unsupported()) return blocked();
    const allPaths = Array.from(snapshots.keys()); await verify(allPaths);
    for (const item of tooling) {
      const bytes = read(item.location, 1024);
      if (bytes.length !== item.size || sha(bytes) !== item.sha256) { addBlocker('unsupported-topology', item.relativePath); return blocked(); }
      addBlocker('opaque-data', `generated-tooling-not-staged:${item.relativePath}:${item.size}:${item.sha256}`);
    }
    const files = [];
    for (const item of pending) {
      tick(); const extension = path.win32.extname(item.relativePath).toLowerCase(); let assetKind = ({ '.mjs': 'module', '.cjs': 'commonjs', '.json': 'json', '.wasm': 'wasm', '.node': 'native-addon', '.dll': 'native-dll' })[extension] ?? 'opaque';
      if (extension === '.js') {
        assetKind = item.pkg.type; let parent = path.posix.dirname(item.relativePath);
        while (parent !== '.') {
          const scope = `${full(item.pkg.packageId)}\\${parent.replaceAll('/', '\\')}\\package.json`;
          if (snapshots.has(scope)) { const document = json(await small(scope)); check(['module', 'commonjs', undefined].includes(document.type)); assetKind = document.type ?? 'commonjs'; break; }
          parent = path.posix.dirname(parent);
        }
      }
      const bytes = contents.get(item.location) ?? read(item.location, limits.file);
      files.push({ record: 'file', packageId: item.pkg.packageId, relativePath: item.relativePath, size: bytes.length, sha256: sha(bytes), assetKind });
    }
    await verify(Array.from(snapshots.keys()));
    for (const location of listings.keys()) { tick(); directory(location); }
    const header = { record: 'header', kind: 'pfa-runtime-package-tree', version: 1, evidenceClass: root.document.evidenceClass,
      runId: root.document.runId, profileManifestSha256: profile.manifestSha256, rootInventorySha256: root.inventorySha256,
      buildCommitSha: root.document.buildCommitSha, harnessCommitSha: root.document.harnessCommitSha, approvalRef: root.document.approvalRef,
      metafileSha256: root.document.metafile.file.sha256, packageJson: { size: options.packageJson.size, sha256: options.packageJson.sha256 },
      packageLock: { size: options.packageLock.size, sha256: options.packageLock.sha256 }, sourceRoot: options.sourceRoot,
      runtime: { executable: root.document.runtime.executable, version: root.document.runtime.version, platform: root.document.runtime.platform, arch: root.document.runtime.arch },
      counts: { packages: packages.length, edges: edges.length, directories: directories.length, files: files.length, bytes: total, unresolved: blockers.length } };
    const rows = [header, ...sorted(packages), ...sorted(edges), ...sorted(directories), ...sorted(files), ...sorted(blockers)]; const lines = []; let textSize = 0;
    check(rows.length <= limits.records);
    for (const row of rows) { tick(); const line = canonicalJson(row); const size = Buffer.byteLength(line); check(size <= limits.line);
      textSize += size + 1; check(textSize <= limits.text); lines.push(line); }
    const text = lines.join('\n') + '\n';
    // This remains untrusted candidate material: no private acceptance brand or execution claim.
    return freeze({ status: 'candidate', text, sha256: sha(text), summary: header.counts });
  } finally { let failed = false; for (const fd of active) { try { fs.closeSync(fd); } catch { failed = true; } } if (failed) refuse(); }
}
