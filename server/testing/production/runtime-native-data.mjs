import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { absolute, canonicalJson, freeze, parse, shape } from './primitives.mjs';

const MiB = 1024 * 1024;
const fail = phase => { throw new Error(`RUNTIME_NATIVE_DATA_REFUSED:${phase}`); };
const check = (value, phase) => { if (!value) fail(phase); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** Static PE import names only. This does not resolve or load a DLL. */
export function readArm64PeImports(bytes) {
  const phase = 'PE';
  try {
    check(Buffer.isBuffer(bytes) && !types.isProxy(bytes) && bytes.length >= 512 && bytes.length <= 32 * MiB, phase);
    const span = (offset, size) => check(Number.isSafeInteger(offset) && offset >= 0 && size >= 0 && offset + size <= bytes.length, phase);
    const u16 = offset => { span(offset, 2); return bytes.readUInt16LE(offset); };
    const u32 = offset => { span(offset, 4); return bytes.readUInt32LE(offset); };
    check(u16(0) === 0x5a4d, phase); const pe = u32(60); span(pe, 24);
    check(pe >= 64 && u32(pe) === 0x4550 && u16(pe + 4) === 0xaa64, phase);
    const count = u16(pe + 6); const optionalSize = u16(pe + 20); const optional = pe + 24;
    check(count > 0 && count <= 96 && optionalSize >= 112 && optionalSize <= 4096, phase);
    span(optional, optionalSize); check(u16(optional) === 0x20b, phase);
    const directoryCount = u32(optional + 108);
    check(directoryCount <= 16 && 112 + directoryCount * 8 <= optionalSize, phase);
    const sectionOffset = optional + optionalSize; span(sectionOffset, count * 40);
    const headers = u32(optional + 60); const imageSize = u32(optional + 56);
    check(headers >= sectionOffset + count * 40 && headers <= bytes.length && imageSize >= headers, phase);
    const sections = [];
    for (let i = 0; i < count; i++) {
      const offset = sectionOffset + i * 40; const virtualSize = u32(offset + 8); const address = u32(offset + 12);
      const size = u32(offset + 16); const raw = u32(offset + 20); const mapped = Math.max(virtualSize, size);
      check(mapped > 0 && address >= headers && address + mapped <= imageSize, phase);
      if (size) { span(raw, size); check(raw >= headers, phase); }
      for (const prior of sections) {
        check(address + mapped <= prior.address || prior.address + prior.mapped <= address, phase);
        if (size && prior.size) check(raw + size <= prior.raw || prior.raw + prior.size <= raw, phase);
      }
      sections.push({ address, mapped, raw, size });
    }
    const rva = (address, size) => {
      const candidates = sections.filter(s => address >= s.address && address + size <= s.address + s.size);
      check(candidates.length === 1, phase); const section = candidates[0]; return section.raw + address - section.address;
    };
    const directory = index => {
      if (index >= directoryCount) return { address: 0, size: 0 };
      const address = u32(optional + 112 + index * 8); const size = u32(optional + 116 + index * 8);
      check((address === 0) === (size === 0), phase); return { address, size };
    };
    const nameAt = address => {
      let value = '';
      for (let i = 0; i < 128; i++) {
        const valueByte = bytes[rva(address + i, 1)];
        if (!valueByte) { check(/^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:dll|exe)$/i.test(value), phase); return value; }
        check(valueByte >= 0x21 && valueByte <= 0x7e, phase); value += String.fromCharCode(valueByte);
      }
      fail(phase);
    };
    const imports = (index, stride, nameField) => {
      const table = directory(index); if (!table.address) return [];
      check(table.size >= stride && table.size <= 129 * stride && table.size % stride === 0, phase);
      const start = rva(table.address, table.size); const result = []; const seen = new Set(); let terminated = false;
      for (let offset = start; offset < start + table.size; offset += stride) {
        const empty = bytes.subarray(offset, offset + stride).every(value => value === 0);
        if (empty) { terminated = true; check(bytes.subarray(offset, start + table.size).every(value => value === 0), phase); break; }
        check(index !== 13 || u32(offset) === 1, phase); // Legacy VA-based delayed descriptors are unsupported.
        const name = nameAt(u32(offset + nameField)); const lower = name.toLowerCase();
        check(!seen.has(lower), phase); seen.add(lower); result.push(name);
      }
      check(terminated && result.length <= 128, phase); return result.sort(compare);
    };
    // Bound imports, CLR images and forwarded exports need a different resolver; none is supported here.
    check(directory(11).address === 0 && directory(14).address === 0, phase);
    const exported = directory(0);
    if (exported.address) {
      check(exported.size >= 40, phase); const start = rva(exported.address, exported.size); const functions = u32(start + 20);
      check(functions <= 65536, phase); const addresses = functions ? rva(u32(start + 28), functions * 4) : 0;
      for (let i = 0; i < functions; i++) {
        const address = u32(addresses + i * 4);
        check(address < exported.address || address >= exported.address + exported.size, phase);
      }
    }
    return freeze({ machine: 'arm64', format: 'PE32+', imports: imports(1, 20, 12), delayImports: imports(13, 32, 4) });
  } catch { fail(phase); }
}

const sharp = 'node_modules/sharp';
const native = 'node_modules/@img/sharp-win32-arm64';
const geo = 'node_modules/fast-geoip';
const nativeNames = ['libvips-42.dll', 'libvips-cpp-8.18.7.dll', 'sharp-win32-arm64-0.35.5.node'];
const controls = [
  `${sharp}/package.json`, ...['index', 'constructor', 'sharp', 'libvips'].flatMap(name => ['mjs', 'cjs'].map(ext => `${sharp}/dist/${name}.${ext}`)),
  `${native}/package.json`, `${native}/index.cjs`, `${native}/versions.json`, `${geo}/package.json`,
  ...['index', 'utils', 'params'].map(name => `${geo}/build/${name}.js`),
].sort(compare);
const expectedNames = [...controls, ...nativeNames.map(name => `${native}/lib/${name}`)].sort(compare);
const absentNames = [`${sharp}/src/build`, 'node_modules/@img/sharp-wasm32'];
const windowsImports = new Set([
  'kernel32.dll', 'advapi32.dll', 'shell32.dll', 'ole32.dll', 'user32.dll', 'ws2_32.dll', 'ntdll.dll', 'bcryptprimitives.dll',
  'bcrypt.dll', 'iphlpapi.dll', 'shlwapi.dll', 'dnsapi.dll', 'api-ms-win-core-synch-l1-2-0.dll',
  ...['stdio', 'heap', 'runtime', 'filesystem', 'private', 'string', 'time', 'math', 'convert', 'utility', 'locale',
    'environment', 'process', 'multibyte'].map(name => `api-ms-win-crt-${name}-l1-1-0.dll`),
]);
const identity = stat => [stat.dev, stat.ino, stat.size, stat.nlink, stat.mtimeNs, stat.ctimeNs, stat.birthtimeNs].join(':');

/** Returns untrusted static candidate bytes for one concrete installed package selection. No launch API. */
export function collectInstalledNativeDataCandidate(suppliedOptions) {
  let phase = 'INPUT';
  try {
    const options = parse(canonicalJson(suppliedOptions)); shape(options, ['sourceRoot', 'expectedFiles']); absolute(options.sourceRoot);
    check(Array.isArray(options.expectedFiles) && options.expectedFiles.length === expectedNames.length, phase);
    const expected = new Map();
    for (const [i, file] of options.expectedFiles.entries()) {
      shape(file, ['relativePath', 'size', 'sha256']); check(file.relativePath === expectedNames[i], phase);
      check(Number.isSafeInteger(file.size) && file.size > 0 && file.size <= 32 * MiB && /^[a-f0-9]{64}$/.test(file.sha256), phase);
      expected.set(file.relativePath, file);
    }
    const full = name => path.win32.join(options.sourceRoot, ...name.split('/'));
    const observed = new Map(); const directories = new Map(); let totalBytes = 0; const rows = [];
    const inspect = (name, directory) => {
      const stat = fs.lstatSync(name, { bigint: true });
      check(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1n) && stat.ino > 0n && fs.realpathSync.native(name) === name, phase);
      return stat;
    };
    const ancestry = name => {
      const result = []; for (let current = path.win32.dirname(name); ; current = path.win32.dirname(current)) {
        result.push(current); if (path.win32.dirname(current) === current) break;
      }
      return result;
    };
    const checkParents = name => {
      for (const parent of ancestry(name)) {
        const stat = inspect(parent, true); const prior = observed.get(parent);
        // Directory size/timestamp drift is independently checked through exact enumerated membership below.
        const value = `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
        check(!prior || prior.directory && prior.identity === value, phase); observed.set(parent, { directory: true, identity: value });
      }
    };
    const listing = name => {
      checkParents(name); inspect(name, true); const members = []; const directory = fs.opendirSync(name);
      try {
        for (let entry; (entry = directory.readSync()) !== null;) {
          check(members.length < 4096 && typeof entry.name === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(entry.name), phase); members.push(entry.name);
        }
      } finally { directory.closeSync(); }
      members.sort(compare); check(new Set(members.map(v => v.toLowerCase())).size === members.length, phase);
      const text = JSON.stringify(members); const prior = directories.get(name); check(!prior || prior === text, phase); directories.set(name, text); return members;
    };
    const absent = name => {
      checkParents(full(name));
      try { fs.lstatSync(full(name), { bigint: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      fail(phase);
    };
    const capture = (name, maximum, expectedPin) => {
      const location = full(name); checkParents(location); const before = inspect(location, false);
      check(before.size > 0n && before.size <= BigInt(maximum), phase);
      totalBytes += Number(before.size); check(totalBytes <= 224 * MiB, phase);
      const descriptor = fs.openSync(location, fs.constants.O_RDONLY);
      try {
        check(identity(before) === identity(fs.fstatSync(descriptor, { bigint: true })), phase);
        const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
        while (offset < bytes.length) { const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset); check(count > 0, phase); offset += count; }
        check(fs.readSync(descriptor, Buffer.alloc(1), 0, 1, bytes.length) === 0, phase);
        check(identity(before) === identity(fs.fstatSync(descriptor, { bigint: true })) && identity(before) === identity(inspect(location, false)), phase);
        const pin = { relativePath: name, size: bytes.length, sha256: sha(bytes) };
        check(!expectedPin || pin.size === expectedPin.size && pin.sha256 === expectedPin.sha256, phase);
        observed.set(location, { directory: false, identity: identity(before) }); return { bytes, pin };
      } finally { fs.closeSync(descriptor); }
    };
    phase = 'SELECTION'; absentNames.forEach(absent);
    check(JSON.stringify(listing(full(`${native}/lib`))) === JSON.stringify(nativeNames), phase);
    const documents = new Map();
    for (const name of controls) {
      const { bytes, pin } = capture(name, MiB, expected.get(name)); rows.push({ record: 'control-file', ...pin });
      if (name.endsWith('.json')) documents.set(name, JSON.parse(bytes.toString('utf8')));
    }
    const sharpPackage = documents.get(`${sharp}/package.json`); const nativePackage = documents.get(`${native}/package.json`); const geoPackage = documents.get(`${geo}/package.json`);
    check(sharpPackage.name === 'sharp' && sharpPackage.version === '0.35.5' && sharpPackage.exports?.['.']?.import?.default === './dist/index.mjs' &&
      sharpPackage.exports?.['.']?.require?.default === './dist/index.cjs' && sharpPackage.optionalDependencies?.['@img/sharp-win32-arm64'] === '0.35.5', phase);
    check(nativePackage.name === '@img/sharp-win32-arm64' && nativePackage.version === '0.35.5' && nativePackage.exports?.['./sharp.node'] === './index.cjs' &&
      JSON.stringify(nativePackage.os) === '["win32"]' && JSON.stringify(nativePackage.cpu) === '["arm64"]' && documents.get(`${native}/versions.json`).vips === '8.18.7', phase);
    check(geoPackage.name === 'fast-geoip' && geoPackage.version === '1.1.88' && geoPackage.main === 'build/index.js', phase);
    phase = 'NATIVE';
    for (const name of nativeNames) {
      const relativePath = `${native}/lib/${name}`; const { bytes, pin } = capture(relativePath, 32 * MiB, expected.get(relativePath));
      const parsed = readArm64PeImports(bytes); rows.push({ record: 'native-file', ...pin, machine: parsed.machine, format: parsed.format });
      for (const [importKind, names] of [['ordinary', parsed.imports], ['delay', parsed.delayImports]]) for (const dependency of names) {
        const lower = dependency.toLowerCase(); let target;
        if (nativeNames.includes(lower)) target = `${native}/lib/${lower}`;
        else if (windowsImports.has(lower)) target = 'trusted-windows-base';
        else if (lower === 'node.exe' && importKind === 'delay' && name.endsWith('.node')) target = 'trusted-node-runtime';
        else fail(phase);
        rows.push({ record: 'native-import', from: relativePath, importKind, name: dependency, target });
      }
    }
    phase = 'DATA'; const dataNames = listing(full(`${geo}/data`));
    check(dataNames.length > 1 && dataNames.includes('index.json') && dataNames.includes('locations.json') &&
      dataNames.every(name => /^(?:index|locations|i?(?:0|[1-9][0-9]{0,5}))\.json$/.test(name)), phase);
    let dataBytes = 0;
    for (const name of dataNames) {
      const { pin } = capture(`${geo}/data/${name}`, 16 * MiB); dataBytes += pin.size;
      check(dataBytes <= 192 * MiB, phase); rows.push({ record: 'data-file', ...pin });
    }
    phase = 'RECHECK'; absentNames.forEach(absent);
    for (const [name, previous] of directories) check(JSON.stringify(listing(name)) === previous, phase);
    for (const [name, prior] of observed) {
      const stat = inspect(name, prior.directory);
      check((prior.directory ? `${stat.dev}:${stat.ino}:${stat.birthtimeNs}` : identity(stat)) === prior.identity, phase);
    }
    const header = { record: 'header', kind: 'pfa-installed-native-data', version: 1, evidenceClass: 'static-file-snapshot', sourceLayout: 'node_modules',
      selection: 'sharp-0.35.5-win32-arm64+fast-geoip-1.1.88', counts: { controls: controls.length, nativeFiles: nativeNames.length, dataFiles: dataNames.length, dataBytes, totalBytes },
      absentProbes: absentNames, dataReadPattern: 'whole-json-or-locations-range-112n+1:111',
      remaining: ['windows-loader-path-observation', 'native-file-custody', 'data-read-consumer', 'installed-stage-integration', 'runtime-selection-input-enforcement'] };
    rows.sort((a, b) => compare(`${a.record}:${a.relativePath ?? a.from}:${a.importKind ?? ''}:${a.name ?? ''}`, `${b.record}:${b.relativePath ?? b.from}:${b.importKind ?? ''}:${b.name ?? ''}`));
    const text = [header, ...rows].map(row => canonicalJson(row)).join('\n') + '\n';
    check(Buffer.byteLength(text) <= 2 * MiB, phase);
    return Object.freeze({ kind: 'pfa-installed-native-data-candidate', text, sha256: sha(text), counts: freeze(header.counts) });
  } catch (error) {
    if (error.message?.startsWith('RUNTIME_NATIVE_DATA_REFUSED:')) throw error;
    fail(phase);
  }
}
