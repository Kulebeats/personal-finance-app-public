import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileFunction } from 'node:vm';
import os from 'node:os';
// The Windows profile the custody fixtures live under, from the process token (os.userInfo),
// not USERPROFILE, which the fixed children override; a neutral placeholder off Windows.
const windowsProfile = process.platform === 'win32' ? os.userInfo().homedir : 'C:\\Users\\example';

// Deliberately duplicated in the fixed child: the child imports no local module.
// Any source change requires independently repinning BOTH closure members.
const executable = `${windowsProfile}\\AppData\\Local\\Packages\\OpenAI.Codex_2p2nqsd0c76g0\\LocalCache\\Local\\capital-r00-runtime\\node-v24.22.0-win-arm64\\node.exe`;
const source = path.dirname(fileURLToPath(import.meta.url));
const harness = ['application-native-resolution.mjs', 'application-native-resolution-child.mjs'].map(name => path.join(source, name));
const argv = ['--experimental-import-meta-resolve', harness[1]];
// Pin every libuv required_vars entry; omission would copy ambient Windows values.
// NODE_V8_COVERAGE must also be explicit: child_process otherwise forwards it.
const environment = { HOMEDRIVE: 'C:', HOMEPATH: '\\', LOGONSERVER: '\\\\localhost', PATH: 'C:\\Windows\\System32',
  PROCESSOR_ARCHITECTURE: 'ARM64', SYSTEMDRIVE: 'C:', SystemRoot: 'C:\\Windows', TEMP: 'C:\\Windows\\Temp', TZ: 'UTC',
  USERDOMAIN: 'LOCAL', USERNAME: 'native-resolution', USERPROFILE: 'C:\\Windows\\Temp', WINDIR: 'C:\\Windows',
  NODE_OPTIONS: '', NODE_PATH: '', NODE_V8_COVERAGE: '' };
const MiB = 1024 * 1024;
const refuse = () => { throw new Error('APPLICATION_NATIVE_RESOLUTION_REFUSED'); };
const check = value => { if (!value) refuse(); };
const stable = value => Array.isArray(value) ? '['+value.map(stable).join(',')+']' : value && typeof value === 'object'
  ? '{'+Object.keys(value).sort().map(key => JSON.stringify(key)+':'+stable(value[key])).join(',')+'}' : JSON.stringify(value);
const same = (a, b) => check(stable(a) === stable(b));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const shape = (value, keys) => check(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
const flags = { allRootsObserved: false, lookupFootprintComplete: false, transitiveClosureComplete: false, stageAccepted: false,
  custodyHeld: false, runtimeDependencyIdentity: false, runtimeModuleIdentity: false, executionAuthorized: false };
const limitations = ['RAW_RESOLUTION_DIAGNOSTIC_ONLY', 'COMPLETE_FOOTPRINT_MUST_BE_VERIFIED_BEFORE_INVOCATION',
  'NO_FILE_WINDOW_OR_CONTINUOUS_CUSTODY', 'JAVASCRIPT_SCOPE_NOT_ESTABLISHED', 'NO_APPLICATION_OR_PACKAGE_EVALUATION'];

function decode(text, maximum = 256 * 1024) {
  check(typeof text === 'string' && Buffer.byteLength(text) <= maximum);
  let depth = 0, quoted = false, escaped = false;
  for (const char of text) {
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') check(++depth <= 12);
    else if (char === '}' || char === ']') check(--depth >= 0);
  }
  check(!quoted && depth === 0);
  const value = JSON.parse(text); check(stable(value)+'\n' === text); return value;
}
function absolute(value) {
  check(typeof value === 'string' && /^[A-Z]:\\/.test(value) && value.length <= 1024
    && !/[\x00-\x1f\x7f%?#/]/.test(value) && path.win32.normalize(value) === value);
  for (const segment of value.slice(3).split('\\')) {
    check(segment && !/[ .]$/.test(segment) && !/[<>:"|*?]/.test(segment) && !/~\d/.test(segment));
    check(!/^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(segment));
  }
}
function validatePin(pin, maximum) {
  shape(pin, ['path', 'sizeBytes', 'sha256', 'dev', 'ino']); absolute(pin.path);
  check(Number.isSafeInteger(pin.sizeBytes) && pin.sizeBytes >= 0 && pin.sizeBytes <= maximum);
  check(typeof pin.sha256 === 'string' && /^[a-f0-9]{64}$/.test(pin.sha256) && !/^0+$/.test(pin.sha256));
  for (const key of ['dev', 'ino']) check(typeof pin[key] === 'string' && /^(?:0|[1-9][0-9]{0,29})$/.test(pin[key]));
  check(BigInt(pin.ino) > 0n);
}
function validateRequest(text) {
  check(process.version === 'v24.22.0' && process.platform === 'win32' && process.arch === 'arm64');
  check(process.execPath === executable);
  const request = decode(text);
  check(request.version===1||request.version===2);
  shape(request, ['kind', 'version', 'emissionRoot', 'runtime', 'harnessFiles', 'edges', 'deadlineMs',...(request.version===2?['syntaxCandidates']:[])]);
  check(request.kind === 'pfa-application-native-resolution-request'); absolute(request.emissionRoot);
  check(fs.realpathSync.native(request.emissionRoot) === request.emissionRoot && fs.lstatSync(request.emissionRoot).isDirectory());
  check(Number.isSafeInteger(request.deadlineMs) && request.deadlineMs > 0 && request.deadlineMs <= 60000);
  validatePin(request.runtime, 128 * MiB); check(request.runtime.path === executable);
  check(Array.isArray(request.harnessFiles) && request.harnessFiles.length === harness.length);
  request.harnessFiles.forEach((pin, i) => { validatePin(pin, MiB); check(pin.path === harness[i]); });
  check(Array.isArray(request.edges) && request.edges.length > 0 && request.edges.length <= 256);
  const tuples = new Set(); let occurrences = 0;
  for (const edge of request.edges) {
    shape(edge, ['parent', 'parentUrl', 'parentPin', 'kind', 'mode', 'specifier', 'occurrences']);
    check(typeof edge.parent === 'string' && /^[A-Za-z0-9._/-]{1,256}$/.test(edge.parent));
    check(edge.parent.split('/').every(segment => segment && segment !== '.' && segment !== '..'));
    const physical = path.win32.join(request.emissionRoot, ...edge.parent.split('/')); absolute(physical);
    check(physical.startsWith(request.emissionRoot+'\\') && edge.parentUrl === pathToFileURL(physical).href);
    validatePin(edge.parentPin, 32 * MiB); check(edge.parentPin.path === physical);
    check(['import', 'export', 'import-statement', 'dynamic-import', 'require', 'require-call'].includes(edge.kind));
    check(edge.mode === (['require', 'require-call'].includes(edge.kind) ? 'require' : edge.kind === 'dynamic-import' ? 'esm-dynamic' : 'esm-static'));
    check(edge.specifier === null || typeof edge.specifier === 'string' && edge.specifier.length > 0 && edge.specifier.length <= 256
      && !/[\x00-\x20\x7f%?\\]/.test(edge.specifier));
    check(Number.isSafeInteger(edge.occurrences) && edge.occurrences > 0 && (occurrences += edge.occurrences) <= 4096);
    const tuple = stable([edge.parent, edge.kind, edge.mode, edge.specifier]); check(!tuples.has(tuple)); tuples.add(tuple);
  }
  if(request.version===2){check(Array.isArray(request.syntaxCandidates)&&request.syntaxCandidates.length<=512);
    const paths=new Set(),identities=new Set();for(const pin of request.syntaxCandidates){validatePin(pin,32*MiB);check(path.extname(pin.path)==='.js');
      check(!paths.has(pin.path.toLowerCase())&&!identities.has(pin.dev+':'+pin.ino));paths.add(pin.path.toLowerCase());identities.add(pin.dev+':'+pin.ino);}}
  const pins = new Map(); let total = 0;
  for (const pin of [request.runtime, ...request.harnessFiles, ...request.edges.map(edge => edge.parentPin),...(request.version===2?request.syntaxCandidates:[])]) {
    const key = pin.path.toLowerCase();
    if (pins.has(key)) same(pin, pins.get(key));
    else { pins.set(key, pin); total += pin.sizeBytes; }
  }
  check(total <= 256 * MiB);if(request.version===2)check(pins.size<=512);
  return request;
}
const identity = node => [node.dev, node.ino, node.mode, node.nlink, node.size, node.birthtimeNs, node.ctimeNs, node.mtimeNs].map(String);
function verifyFile(pin, tick) {
  tick();
  const before = fs.lstatSync(pin.path, { bigint: true });
  check(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n && before.size === BigInt(pin.sizeBytes));
  check(String(before.dev) === pin.dev && String(before.ino) === pin.ino && fs.realpathSync.native(pin.path) === pin.path);
  const fd = fs.openSync(pin.path, 'r');
  try {
    same(identity(fs.fstatSync(fd, { bigint: true })), identity(before));
    const hasher = createHash('sha256'), buffer = Buffer.alloc(64 * 1024); let offset = 0;
    while (offset < pin.sizeBytes) {
      tick(); const size = fs.readSync(fd, buffer, 0, Math.min(buffer.length, pin.sizeBytes-offset), offset);
      check(size > 0); hasher.update(buffer.subarray(0, size)); offset += size;
    }
    check(hasher.digest('hex') === pin.sha256);
    same(identity(fs.fstatSync(fd, { bigint: true })), identity(before));
    same(identity(fs.lstatSync(pin.path, { bigint: true })), identity(before));
    check(fs.realpathSync.native(pin.path) === pin.path); tick();
  } finally { fs.closeSync(fd); }
}
function verifyPins(request, tick) {
  const pins = new Map([request.runtime, ...request.harnessFiles, ...request.edges.map(edge => edge.parentPin)].map(pin => [pin.path, pin]));
  for (const pin of pins.values()) verifyFile(pin, tick);
}
function invocation(request) {
  return { executable: request.runtime, version: process.version.slice(1), platform: process.platform, arch: process.arch,
    argv, environmentPolicy: 'clean-windows-arm64-utc-v1' };
}
function proveCommonJS(pin,tick){
  tick();const before=fs.lstatSync(pin.path,{bigint:true});
  check(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size===BigInt(pin.sizeBytes));
  check(String(before.dev)===pin.dev&&String(before.ino)===pin.ino&&fs.realpathSync.native(pin.path)===pin.path);
  const fd=fs.openSync(pin.path,'r');
  try{
    same(identity(fs.fstatSync(fd,{bigint:true})),identity(before));
    const bytes=Buffer.alloc(pin.sizeBytes);let offset=0;
    while(offset<bytes.length){tick();const count=fs.readSync(fd,bytes,offset,Math.min(64*1024,bytes.length-offset),offset);check(count>0);offset+=count;}
    check(digest(bytes)===pin.sha256);tick();
    let sourceText,status='unproven',reason='SOURCE_ENCODING_UNPROVEN';
    // ignoreBOM:true preserves U+FEFF in the decoded text. No wrapper, directive,
    // newline, hashbang rewrite, normalization or replacement character is added.
    try{sourceText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{}
    if(sourceText!==undefined){
      tick();reason='CJS_PARSE_NOT_PROVEN';
      try{
        // Positive branch only. The result is immediately discarded, never
        // invoked, cached, linked, exported or supplied a dynamic-import hook.
        compileFunction(sourceText,['exports','require','module','__filename','__dirname'],
          {filename:pin.path,lineOffset:0,columnOffset:0,produceCachedData:false});
        status='commonjs-parse';reason=null;
      }catch{}
    }
    tick();same(identity(fs.fstatSync(fd,{bigint:true})),identity(before));same(identity(fs.lstatSync(pin.path,{bigint:true})),identity(before));
    check(fs.realpathSync.native(pin.path)===pin.path);
    return {method:'node24-cjs-compile-v1',source:pin,status,reason};
  }finally{fs.closeSync(fd);}
}
// This fixed harness evaluates no application, parent, package or native addon.
function diagnoseEdge(edge) {
  if (edge.mode === 'require') return { kind: 'unsupported-edge', reason: 'REQUIRE_UNSUPPORTED' };
  if (edge.specifier === null) return { kind: 'unsupported-edge', reason: 'NONLITERAL_SPECIFIER' };
  if (!/^(?:@[A-Za-z0-9_-][A-Za-z0-9._-]*\/)?[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)*$/.test(edge.specifier)
    || edge.specifier.split('/').some(segment => segment === '.' || segment === '..')) {
    return { kind: 'unsupported-edge', reason: edge.specifier.startsWith('#') ? 'PACKAGE_IMPORTS_UNSUPPORTED' : 'SPECIFIER_TOPOLOGY_UNSUPPORTED' };
  }
  let url;
  try { url = import.meta.resolve(edge.specifier, edge.parentUrl); }
  catch (error) {
    check(typeof error?.code === 'string' && /^ERR_[A-Z_]{1,80}$/.test(error.code));
    return { kind: 'native-error', code: error.code };
  }
  const parsed = new URL(url); check(parsed.protocol === 'file:' && !parsed.search && !parsed.hash);
  const file = fileURLToPath(parsed); absolute(file); check(pathToFileURL(file).href === url);
  let node;
  try { node = fs.lstatSync(file, { bigint: true }); }
  catch (error) {
    if (error?.code === 'ENOENT') return { kind: 'missing-target', url };
    throw error;
  }
  check(!node.isSymbolicLink() && fs.realpathSync.native(file) === file);
  if (node.isDirectory()) return { kind: 'directory-target', url };
  check(node.isFile() && node.nlink === 1n);
  // Scope and source detection are deliberately not inferred by this transport.
  const format = { '.mjs': 'esm', '.cjs': 'commonjs', '.js': 'unestablished-js', '.json': 'json', '.node': 'native' }[path.extname(file)] ?? 'unsupported';
  return { kind: 'resolved-file', url, format };
}
async function main() {
  same(process.execArgv, ['--experimental-import-meta-resolve']); same(process.argv, [executable, harness[1]]);
  same(Object.keys(process.env).sort(), Object.keys(environment).sort());
  for (const [key, value] of Object.entries(environment)) check(process.env[key] === value);
  check(fs.realpathSync.native(environment.SystemRoot) === environment.SystemRoot);
  let text = '', bytes = 0;
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) { bytes += Buffer.byteLength(chunk); check(bytes <= 256 * 1024); text += chunk; }
  const started = performance.now(), request = validateRequest(text);
  const tick = () => check(performance.now()-started <= request.deadlineMs); tick(); verifyPins(request, tick);
  const syntaxCandidates=new Map((request.version===2?request.syntaxCandidates:[]).map(pin=>[pin.path,pin])),proofs=new Map();
  const rows = request.edges.map(edge => { tick();const diagnostic=diagnoseEdge(edge);
    if(request.version===2&&diagnostic.kind==='resolved-file'){
      diagnostic.syntaxProof=null;
      if(diagnostic.format==='unestablished-js'){
        const pin=syntaxCandidates.get(fileURLToPath(diagnostic.url));
        if(pin){const key=stable(pin);if(!proofs.has(key))proofs.set(key,proveCommonJS(pin,tick));diagnostic.syntaxProof=proofs.get(key);}
      }
    }
    return { ...edge, diagnostic }; });
  verifyPins(request, tick); tick();
  const result = { kind: 'untrusted-application-native-resolution-diagnostic', version: request.version, requestSha256: digest(text),
    invocation: invocation(request), rows, certifications: flags, limitations };
  const output = stable(result)+'\n'; check(Buffer.byteLength(output) <= MiB);
  process.stdout.write(output);
}
main().catch(() => { process.stderr.write('APPLICATION_NATIVE_RESOLUTION_REFUSED\n'); process.exitCode = 1; });
