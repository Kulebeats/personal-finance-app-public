import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const api = await import('./runtime-native-data.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./runtime-native-data.mjs', import.meta.url).href) return {};
  throw error;
});
const sha = value => createHash('sha256').update(value).digest('hex');
const root = 'C:\\Synthetic\\app';
const sharp = 'node_modules/sharp';
const native = 'node_modules/@img/sharp-win32-arm64';
const geo = 'node_modules/fast-geoip';

// Small PE32+ file, ordinary and RVA-based delayed import descriptors, never executable.
function pe(imports = ['KERNEL32.dll'], delayed = []) {
  const b = Buffer.alloc(4096); b.write('MZ'); b.writeUInt32LE(128, 60); b.write('PE\0\0', 128);
  b.writeUInt16LE(0xaa64, 132); b.writeUInt16LE(1, 134); b.writeUInt16LE(240, 148);
  const optional = 152; b.writeUInt16LE(0x20b, optional); b.writeUInt32LE(8192, optional + 56);
  b.writeUInt32LE(512, optional + 60); b.writeUInt32LE(16, optional + 108);
  const section = optional + 240; b.write('.rdata', section); b.writeUInt32LE(3584, section + 8);
  b.writeUInt32LE(4096, section + 12); b.writeUInt32LE(3584, section + 16); b.writeUInt32LE(512, section + 20);
  let stringOffset = 1536;
  for (const [names, index, start, stride, nameField] of [[imports, 1, 512, 20, 12], [delayed, 13, 1024, 32, 4]]) {
    if (!names.length) continue;
    b.writeUInt32LE(4096 + start - 512, optional + 112 + index * 8);
    b.writeUInt32LE((names.length + 1) * stride, optional + 116 + index * 8);
    for (const [i, name] of names.entries()) {
      const descriptor = start + i * stride;
      b.writeUInt32LE(index === 13 ? 1 : 4096 + 2500, descriptor);
      b.writeUInt32LE(4096 + stringOffset - 512, descriptor + nameField);
      b.write(name, stringOffset); stringOffset += name.length + 1;
    }
  }
  return b;
}
const parse = bytes => { assert.equal(typeof api.readArm64PeImports, 'function'); return api.readArm64PeImports(bytes); };
test('reads actual-target PE32+ ordinary and delayed DLL names without execution', () => {
  const result = parse(pe(['libvips-42.dll', 'KERNEL32.dll'], ['node.exe']));
  assert.deepEqual(result.imports, ['KERNEL32.dll', 'libvips-42.dll']);
  assert.deepEqual(result.delayImports, ['node.exe']);
  assert.equal(result.machine, 'arm64'); assert.equal(Object.isFrozen(result.imports), true);
});
for (const [name, change] of [
  ['truncation', b => b.subarray(0, 400)],
  ['wrong architecture', b => { b.writeUInt16LE(0x8664, 132); return b; }],
  ['PE32 optional header', b => { b.writeUInt16LE(0x10b, 152); return b; }],
  ['section raw overlap with headers', b => { b.writeUInt32LE(128, 412); return b; }],
  ['unmapped name RVA', b => { b.writeUInt32LE(0xffffffff, 524); return b; }],
  ['unterminated descriptor table', b => { b.writeUInt32LE(20, 276); return b; }],
  ['too many sections', b => { b.writeUInt16LE(97, 134); return b; }],
  ['bad directory count', b => { b.writeUInt32LE(17, 260); return b; }],
  ['case duplicate imports', () => pe(['KERNEL32.dll', 'kernel32.DLL'])],
  ['path import', () => pe(['../outside.dll'])],
  ['legacy VA-based delay imports', b => { b.writeUInt32LE(0, 1024); return b; }],
  ['export forwarder directory', b => {
    b.writeUInt32LE(0x1600, 264); b.writeUInt32LE(80, 268);
    const table = 2048; b.writeUInt32LE(1, table + 20); b.writeUInt32LE(0x1640, table + 28);
    b.writeUInt32LE(0x1644, 2112); b.write('OTHER.symbol', 2116); return b;
  }],
]) test(`refuses PE ${name}`, () => assert.throws(() => parse(change(pe(['KERNEL32.dll'], ['node.exe']))), /RUNTIME_NATIVE_DATA_REFUSED/));

function fixture(t, mutate = () => {}) {
  const bytes = new Map();
  const manifests = {
    [`${sharp}/package.json`]: { name: 'sharp', version: '0.35.5', exports: { '.': { import: { default: './dist/index.mjs' }, require: { default: './dist/index.cjs' } } }, optionalDependencies: { '@img/sharp-win32-arm64': '0.35.5' } },
    [`${native}/package.json`]: { name: '@img/sharp-win32-arm64', version: '0.35.5', exports: { './sharp.node': './index.cjs' }, os: ['win32'], cpu: ['arm64'] },
    [`${geo}/package.json`]: { name: 'fast-geoip', version: '1.1.88', main: 'build/index.js' },
  };
  for (const [name, value] of Object.entries(manifests)) bytes.set(name, Buffer.from(JSON.stringify(value)));
  for (const name of ['index', 'constructor', 'sharp', 'libvips']) for (const extension of ['mjs', 'cjs'])
    bytes.set(`${sharp}/dist/${name}.${extension}`, Buffer.from('globalThis.PFA_NATIVE_DATA_EVALUATED = true;'));
  bytes.set(`${native}/index.cjs`, Buffer.from('module.exports = require("./lib/sharp-win32-arm64-0.35.5.node");'));
  bytes.set(`${native}/versions.json`, Buffer.from('{"vips":"8.18.7"}'));
  for (const name of ['index', 'utils', 'params']) bytes.set(`${geo}/build/${name}.js`, Buffer.from('globalThis.PFA_NATIVE_DATA_EVALUATED = true;'));
  bytes.set(`${native}/lib/sharp-win32-arm64-0.35.5.node`, pe(['libvips-42.dll', 'libvips-cpp-8.18.7.dll', 'KERNEL32.dll'], ['node.exe']));
  bytes.set(`${native}/lib/libvips-cpp-8.18.7.dll`, pe(['libvips-42.dll', 'KERNEL32.dll']));
  bytes.set(`${native}/lib/libvips-42.dll`, pe(['KERNEL32.dll']));
  for (const name of ['index', 'locations', 'i0', '0']) bytes.set(`${geo}/data/${name}.json`, Buffer.from('[]'));
  const expectedFiles = Array.from(bytes, ([relativePath, b]) => ({ relativePath, size: b.length, sha256: sha(b) }))
    .filter(row => !row.relativePath.startsWith(`${geo}/data/`)).sort((a, b) => a.relativePath < b.relativePath ? -1 : 1);
  const files = new Map(); let inode = 1n;
  function directory(name) { if (files.has(name)) return; const parent = path.win32.dirname(name); if (parent !== name) directory(parent); files.set(name, { directory: true, ino: inode++ }); }
  directory(root);
  for (const [name, value] of bytes) { const full = path.win32.join(root, ...name.split('/')); directory(path.win32.dirname(full)); files.set(full, { bytes: value, ino: inode++ }); }
  // Published Sharp ships C++ source; only its earlier local build namespace must be absent.
  directory(path.win32.join(root, ...sharp.split('/'), 'src'));
  const handles = new Map(); let fd = 1; const reads = []; const opens = []; const directoryReads = [];
  const stat = node => ({ ino: node.ino, dev: 1n, size: BigInt(node.bytes?.length ?? 0), nlink: node.links ?? 1n, mtimeNs: 1n, ctimeNs: 1n,
    birthtimeNs: 1n, isDirectory: () => !!node.directory, isFile: () => !node.directory, isSymbolicLink: () => !!node.symlink });
  const get = name => { const node = files.get(name); if (!node) throw Object.assign(new Error('absent'), { code: 'ENOENT' }); return node; };
  t.mock.method(fs, 'lstatSync', name => stat(get(name)));
  t.mock.method(fs.realpathSync, 'native', name => { get(name); return name; });
  t.mock.method(fs, 'openSync', name => { opens.push(name); handles.set(fd, get(name)); return fd++; });
  t.mock.method(fs, 'fstatSync', handle => stat(handles.get(handle)));
  t.mock.method(fs, 'readSync', (handle, target, offset, length, position) => {
    const node = handles.get(handle); const chunk = node.bytes.subarray(position, position + length); chunk.copy(target, offset); reads.push(node);
    mutate({ files, handles, reads, node }); return chunk.length;
  });
  t.mock.method(fs, 'closeSync', handle => assert.equal(handles.delete(handle), true));
  t.mock.method(fs, 'readdirSync', name => Array.from(files.keys()).filter(p => p !== name && path.win32.dirname(p) === name).map(p => path.win32.basename(p)).sort());
  t.mock.method(fs, 'opendirSync', name => {
    const members = Array.from(files.keys()).filter(p => p !== name && path.win32.dirname(p) === name).map(p => path.win32.basename(p)).sort(); let index = 0;
    return { readSync: () => { directoryReads.push(name); return index < members.length ? { name: members[index++] } : null; }, closeSync: () => {} };
  });
  const collect = () => { assert.equal(typeof api.collectInstalledNativeDataCandidate, 'function'); return api.collectInstalledNativeDataCandidate({ sourceRoot: root, expectedFiles }); };
  return { files, bytes, expectedFiles, handles, reads, opens, directoryReads, collect };
}
test('captures concrete package DLL edges and all computed GeoIP data files without evaluating code', t => {
  const f = fixture(t); const result = f.collect(); const rows = result.text.trimEnd().split('\n').map(JSON.parse);
  assert.equal(result.kind, 'pfa-installed-native-data-candidate'); assert.equal(result.sha256, sha(result.text));
  assert.equal(rows.filter(r => r.record === 'data-file').length, 4);
  assert.equal(rows.filter(r => r.record === 'native-file').length, 3);
  assert.ok(rows.some(r => r.record === 'native-import' && r.name === 'node.exe' && r.importKind === 'delay' && r.target === 'trusted-node-runtime'));
  assert.ok(rows.some(r => r.record === 'native-import' && r.name === 'libvips-42.dll' && r.target === `${native}/lib/libvips-42.dll`));
  assert.equal(rows[0].evidenceClass, 'static-file-snapshot'); assert.equal(Object.hasOwn(result, 'executionAuthorized'), false);
  assert.equal(globalThis.PFA_NATIVE_DATA_EVALUATED, undefined); assert.equal(f.handles.size, 0);
});
for (const [name, mutate] of [
  ['missing addon', f => f.files.delete(`${root}\\${native.replaceAll('/', '\\')}\\lib\\sharp-win32-arm64-0.35.5.node`)],
  ['changed native bytes', f => f.files.get(`${root}\\${native.replaceAll('/', '\\')}\\lib\\libvips-42.dll`).bytes[100] = 1],
  ['unexpected native member', f => f.files.set(`${root}\\${native.replaceAll('/', '\\')}\\lib\\other.dll`, { bytes: pe(), ino: 999n })],
  ['earlier local addon probe', f => f.files.set(`${root}\\${sharp.replaceAll('/', '\\')}\\src\\build`, { directory: true, ino: 999n })],
  ['case alias data name', f => f.files.set(`${root}\\${geo.replaceAll('/', '\\')}\\data\\INDEX.json`, { bytes: Buffer.from('[]'), ino: 999n })],
  ['unknown data extension', f => f.files.set(`${root}\\${geo.replaceAll('/', '\\')}\\data\\extra.js`, { bytes: Buffer.from(''), ino: 999n })],
  ['nested data namespace', f => f.files.set(`${root}\\${geo.replaceAll('/', '\\')}\\data\\nested`, { directory: true, ino: 999n })],
  ['hardlinked data', f => { f.files.get(`${root}\\${geo.replaceAll('/', '\\')}\\data\\index.json`).links = 2n; }],
  ['symlink data', f => { f.files.get(`${root}\\${geo.replaceAll('/', '\\')}\\data\\index.json`).symlink = true; }],
  ['oversized data', f => { f.files.get(`${root}\\${geo.replaceAll('/', '\\')}\\data\\index.json`).bytes = Buffer.alloc(16 * 1024 * 1024 + 1); }],
]) test(`collector refuses ${name} and closes descriptors`, t => {
  const f = fixture(t); mutate(f); assert.throws(f.collect, /RUNTIME_NATIVE_DATA_REFUSED/); assert.equal(f.handles.size, 0);
});
test('collector refuses unknown PE dependency even when independent consistency pins match', t => {
  const f = fixture(t); const relativePath = `${native}/lib/libvips-42.dll`; const b = pe(['unreviewed.dll']);
  f.files.get(path.win32.join(root, ...relativePath.split('/'))).bytes = b;
  Object.assign(f.expectedFiles.find(v => v.relativePath === relativePath), { size: b.length, sha256: sha(b) });
  assert.throws(f.collect, /RUNTIME_NATIVE_DATA_REFUSED/); assert.equal(f.handles.size, 0);
});
test('collector refuses same-byte source replacement during capture', t => {
  let changed = false;
  const f = fixture(t, ({ files, node }) => {
    if (changed) return; changed = true;
    const entry = Array.from(files).find(([, value]) => value === node); files.set(entry[0], { ...node, ino: 9999n });
  });
  assert.throws(f.collect, /RUNTIME_NATIVE_DATA_REFUSED/); assert.equal(f.handles.size, 0);
});
test('bounded data enumeration stops at the first member over 4096', t => {
  const f = fixture(t); const data = `${root}\\${geo.replaceAll('/', '\\')}\\data`;
  for (let i = 1; i <= 5000; i++) f.files.set(`${data}\\${i}.json`, { bytes: Buffer.from('[]'), ino: BigInt(10000 + i) });
  assert.throws(f.collect, /RUNTIME_NATIVE_DATA_REFUSED/);
  assert.equal(f.directoryReads.filter(name => name === data).length, 4097);
  assert.equal(f.handles.size, 0);
});
test('collector refuses changed package selection with internally consistent caller pins', t => {
  const f = fixture(t); const relativePath = `${geo}/package.json`;
  const b = Buffer.from('{"name":"fast-geoip","version":"9.9.9","main":"build/index.js"}');
  f.files.get(path.win32.join(root, ...relativePath.split('/'))).bytes = b;
  Object.assign(f.expectedFiles.find(v => v.relativePath === relativePath), { size: b.length, sha256: sha(b) });
  assert.throws(f.collect, /RUNTIME_NATIVE_DATA_REFUSED/); assert.equal(f.handles.size, 0);
});
test('collector rejects getters without invoking them or reading selected files', t => {
  const f = fixture(t); let invoked = false;
  assert.throws(() => api.collectInstalledNativeDataCandidate({ sourceRoot: root, get expectedFiles() { invoked = true; return f.expectedFiles; } }), /RUNTIME_NATIVE_DATA_REFUSED/);
  assert.equal(invoked, false); assert.equal(f.opens.length, 0);
});
