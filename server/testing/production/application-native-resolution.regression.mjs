import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import test from 'node:test';
import os from 'node:os';
// The Windows profile the custody fixtures live under, from the process token (os.userInfo),
// not USERPROFILE, which the fixed children override; a neutral placeholder off Windows.
const windowsProfile = process.platform === 'win32' ? os.userInfo().homedir : 'C:\\Users\\example';

const executable = `${windowsProfile}\\AppData\\Local\\Packages\\OpenAI.Codex_2p2nqsd0c76g0\\LocalCache\\Local\\capital-r00-runtime\\node-v24.22.0-win-arm64\\node.exe`;
const source = path.dirname(fileURLToPath(import.meta.url));
const cleanEnvironment = { HOMEDRIVE: 'C:', HOMEPATH: '\\', LOGONSERVER: '\\\\localhost', PATH: 'C:\\Windows\\System32',
  PROCESSOR_ARCHITECTURE: 'ARM64', SYSTEMDRIVE: 'C:', SystemRoot: 'C:\\Windows', TEMP: 'C:\\Windows\\Temp', TZ: 'UTC',
  USERDOMAIN: 'LOCAL', USERNAME: 'native-resolution', USERPROFILE: 'C:\\Windows\\Temp', WINDIR: 'C:\\Windows',
  NODE_OPTIONS: '', NODE_PATH: '', NODE_V8_COVERAGE: '' };
const hash = value => createHash('sha256').update(value).digest('hex');
const stable = value => Array.isArray(value) ? '['+value.map(stable).join(',')+']' : value && typeof value === 'object'
  ? '{'+Object.keys(value).sort().map(key => JSON.stringify(key)+':'+stable(value[key])).join(',')+'}' : JSON.stringify(value);
const json = value => stable(value)+'\n';
const pin = name => {
  const stat = fs.lstatSync(name, { bigint: true });
  return { path: name, sizeBytes: Number(stat.size), sha256: hash(fs.readFileSync(name)), dev: String(stat.dev), ino: String(stat.ino) };
};
let diagnose;
try { ({ diagnoseApplicationNativeResolution: diagnose } = await import('./application-native-resolution.mjs')); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }

test('exposes only the fixed raw native-resolution transport contract', () => {
  assert.equal(typeof diagnose, 'function', 'the fixed native-resolution transport is required');
});

function write(name, value) { fs.mkdirSync(path.dirname(name), { recursive: true }); fs.writeFileSync(name, value); }
function fixture() {
  const base = path.resolve('.local/r20-native-resolution'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'fixture-'));
  const marker = path.join(root, 'EVALUATED');
  const poison = `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'evaluated'); throw new Error('SELECTED_CODE_MUST_NOT_RUN');\n`;
  write(path.join(root, 'package.json'), JSON.stringify({ name: 'owned-fixture', type: 'module' }));
  const parent = 'dist/application.mjs'; write(path.join(root, ...parent.split('/')), poison);
  const request = { kind: 'pfa-application-native-resolution-request', version: 1, emissionRoot: root,
    runtime: pin(executable), harnessFiles: ['application-native-resolution.mjs', 'application-native-resolution-child.mjs'].map(name => pin(path.join(source, name))),
    edges: [], deadlineMs: 10000 };
  const edge = (specifier, overrides = {}) => {
    const emitted = overrides.parent ?? parent, physical = path.join(root, ...emitted.split('/'));
    return { parent: emitted, parentUrl: pathToFileURL(physical).href, parentPin: pin(physical),
      kind: 'import-statement', mode: 'esm-static', specifier, occurrences: 1, ...overrides };
  };
  const pkg = (name, manifest, files = {}) => {
    const directory = path.join(root, 'node_modules', ...name.split('/'));
    write(path.join(directory, 'package.json'), JSON.stringify({ name, ...manifest }));
    for (const [name, bytes] of Object.entries(files)) write(path.join(directory, name), bytes);
    return directory;
  };
  return { root, marker, poison, request, edge, pkg, close: () => {
    assert.ok(path.resolve(root).startsWith(base+path.sep)); fs.rmSync(root, { recursive: true, force: true });
  } };
}
const invoke = request => { const text = json(request); return diagnose(text, hash(text)); };
const refused = /APPLICATION_NATIVE_RESOLUTION_REFUSED/;

test('resolves poisoned application and package files from each actual emitted parent without evaluation', async () => {
  const f = fixture();
  try {
    const outer = f.pkg('nearest', { type: 'module', exports: './entry.mjs' }, { 'entry.mjs': f.poison });
    const innerParent = 'dist/nested/parent.mjs'; write(path.join(f.root, ...innerParent.split('/')), f.poison);
    const inner = path.join(f.root, 'dist/nested/node_modules/nearest');
    write(path.join(inner, 'package.json'), JSON.stringify({ name: 'nearest', type: 'module', exports: './entry.mjs' }));
    write(path.join(inner, 'entry.mjs'), f.poison);
    f.request.edges = [f.edge('nearest', { occurrences: 2 }), f.edge('nearest', {
      parent: innerParent, parentUrl: pathToFileURL(path.join(f.root, ...innerParent.split('/'))).href,
      kind: 'dynamic-import', mode: 'esm-dynamic', occurrences: 3 })];
    const result = await invoke(f.request);
    assert.equal(result.kind, 'untrusted-application-native-resolution-diagnostic');
    assert.equal(result.rows.length, 2);
    assert.deepEqual(result.rows.map(row => row.diagnostic.url), [outer, inner].map(root => pathToFileURL(path.join(root, 'entry.mjs')).href));
    for (let i = 0; i < 2; i++) {
      for (const key of ['parent', 'parentUrl', 'parentPin', 'kind', 'mode', 'specifier', 'occurrences']) assert.deepEqual(result.rows[i][key], f.request.edges[i][key]);
    }
    assert.equal(fs.existsSync(f.marker), false);
    assert.equal(Object.isFrozen(result.rows[0].diagnostic), true);
    assert.equal(Object.values(result.certifications).every(value => value === false), true);
    assert.equal(result.certifications.lookupFootprintComplete, false);
    assert.equal(result.certifications.executionAuthorized, false);
  } finally { f.close(); }
});

test('uses native default conditional exports in a clean child despite poisoned ambient options', async () => {
  const f = fixture();
  const old = { NODE_OPTIONS: process.env.NODE_OPTIONS, NODE_PATH: process.env.NODE_PATH,
    NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE, USERPROFILE: process.env.USERPROFILE, CAPITAL_SECRET: process.env.CAPITAL_SECRET };
  try {
    const directory = f.pkg('conditions', { type: 'module', exports: { custom: './custom.mjs', import: './import.mjs', default: './default.mjs' } },
      { 'custom.mjs': f.poison, 'import.mjs': f.poison, 'default.mjs': f.poison });
    const preload = path.join(f.root, 'preload.mjs'); write(preload, f.poison);
    process.env.NODE_OPTIONS = '--conditions=custom --import='+pathToFileURL(preload).href;
    process.env.NODE_PATH = f.root; process.env.CAPITAL_SECRET = 'must-never-enter-child';
    process.env.NODE_V8_COVERAGE = path.join(f.root, 'must-not-create-coverage'); process.env.USERPROFILE = f.root;
    f.request.edges = [f.edge('conditions')];
    const result = await invoke(f.request);
    assert.equal(result.rows[0].diagnostic.url, pathToFileURL(path.join(directory, 'import.mjs')).href);
    assert.deepEqual(result.invocation.argv, ['--experimental-import-meta-resolve', path.join(source, 'application-native-resolution-child.mjs')]);
    assert.equal(result.invocation.environmentPolicy, 'clean-windows-arm64-utc-v1');
    assert.equal(fs.existsSync(f.marker), false);
    assert.equal(fs.existsSync(path.join(f.root, 'must-not-create-coverage')), false);
  } finally {
    for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    f.close();
  }
});

test('preserves exports denial, missing file, directory and unestablished JavaScript as distinct raw diagnostics', async () => {
  const f = fixture();
  try {
    f.pkg('require-only', { exports: { require: './entry.cjs' } }, { 'entry.cjs': f.poison });
    f.pkg('excluded', { exports: './entry.mjs' }, { 'entry.mjs': f.poison, 'hidden.mjs': f.poison });
    f.pkg('missing', { exports: './absent.mjs' });
    const directory = f.pkg('directory', { exports: './folder' }); fs.mkdirSync(path.join(directory, 'folder'));
    f.pkg('typeless', { exports: './entry.js' }, { 'entry.js': f.poison });
    f.request.edges = ['require-only', 'excluded/hidden.mjs', 'missing', 'directory', 'typeless'].map(name => f.edge(name));
    const result = await invoke(f.request);
    assert.deepEqual(result.rows.slice(0, 2).map(row => row.diagnostic), [
      { kind: 'native-error', code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }, { kind: 'native-error', code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }]);
    assert.equal(result.rows[2].diagnostic.kind, 'missing-target');
    assert.equal(result.rows[3].diagnostic.kind, 'directory-target');
    assert.equal(result.rows[4].diagnostic.format, 'unestablished-js');
    assert.equal(result.certifications.allRootsObserved, false);
    assert.equal(fs.existsSync(f.marker), false);
  } finally { f.close(); }
});

test('preserves require and nonliteral blockers instead of resolving them as ESM', async () => {
  const f = fixture();
  try {
    f.request.edges = [f.edge('unused', { kind: 'require-call', mode: 'require' }), f.edge(null, { kind: 'dynamic-import', mode: 'esm-dynamic' })];
    const result = await invoke(f.request);
    assert.deepEqual(result.rows.map(row => row.diagnostic), [{ kind: 'unsupported-edge', reason: 'REQUIRE_UNSUPPORTED' },
      { kind: 'unsupported-edge', reason: 'NONLITERAL_SPECIFIER' }]);
  } finally { f.close(); }
});

test('refuses independent request, runtime and fixed harness pin drift', async () => {
  const f = fixture();
  try {
    f.request.edges = [f.edge('absent')]; const text = json(f.request);
    await assert.rejects(diagnose(text, hash('other')), refused);
    const runtime = structuredClone(f.request); runtime.runtime.sha256 = hash('wrong runtime'); await assert.rejects(invoke(runtime), refused);
    const child = structuredClone(f.request); child.harnessFiles[1].sha256 = hash('wrong child'); await assert.rejects(invoke(child), refused);
    const arbitrary = structuredClone(f.request); arbitrary.harnessFiles[1] = pin(path.join(f.root, 'dist/application.mjs'));
    await assert.rejects(invoke(arbitrary), refused);
    const substitute = structuredClone(f.request); substitute.runtime.path = path.join(f.root, 'node.exe');
    await assert.rejects(invoke(substitute), refused);
    const parent = structuredClone(f.request); parent.edges[0].parentPin.sha256 = hash('wrong physical parent');
    await assert.rejects(invoke(parent), refused);
  } finally { f.close(); }
});

test('refuses caller invocation controls, duplicate tuples, mismatched modes and parent URL aliases', async () => {
  const f = fixture();
  try {
    f.request.edges = [f.edge('absent')];
    for (const [key, value] of [['harnessEntry', path.join(f.root, 'dist/application.mjs')], ['argv', ['--conditions=custom']], ['environment', {}], ['resolver', 'native']]) {
      await assert.rejects(invoke({ ...f.request, [key]: value }), refused);
    }
    const duplicate = structuredClone(f.request); duplicate.edges.push({ ...duplicate.edges[0], occurrences: 2 }); await assert.rejects(invoke(duplicate), refused);
    const mode = structuredClone(f.request); mode.edges[0].mode = 'require'; await assert.rejects(invoke(mode), refused);
    for (const suffix of ['?query', '#hash']) {
      const alias = structuredClone(f.request); alias.edges[0].parentUrl += suffix; await assert.rejects(invoke(alias), refused);
    }
    const swapped = structuredClone(f.request); swapped.edges[0].parentUrl = pathToFileURL(path.join(f.root, 'index.mjs')).href;
    await assert.rejects(invoke(swapped), refused);
    const missing = structuredClone(f.request); missing.edges[0].parent = 'dist/missing.mjs';
    missing.edges[0].parentUrl = pathToFileURL(path.join(f.root, 'dist/missing.mjs')).href;
    missing.edges[0].parentPin.path = path.join(f.root, 'dist/missing.mjs');
    await assert.rejects(invoke(missing), refused);
    await assert.rejects(diagnose(textWithDuplicateKind(f.request), hash(textWithDuplicateKind(f.request))), refused);
  } finally { f.close(); }
});
function textWithDuplicateKind(request) { return json(request).replace('"kind":"pfa-application-native-resolution-request"', '"kind":"pfa-application-native-resolution-request","kind":"pfa-application-native-resolution-request"'); }

test('the fixed child refuses actual flag and environment mismatches before resolution', () => {
  const f = fixture();
  try {
    f.request.edges = [f.edge('absent')];
    const child = path.join(source, 'application-native-resolution-child.mjs');
    for (const [argv, env] of [[[], { ...cleanEnvironment }],
      [['--experimental-import-meta-resolve', '--conditions=custom'], { ...cleanEnvironment }],
      [['--experimental-import-meta-resolve'], { ...cleanEnvironment, CAPITAL_SECRET: 'refuse' }]]) {
      const result = spawnSync(executable, [...argv, child], { input: json(f.request), encoding: 'utf8', env,
        windowsHide: true, shell: false, timeout: 10000, maxBuffer: 1024 * 1024 });
      assert.equal(result.status, 1); assert.equal(result.stdout, '');
      assert.match(result.stderr, refused);
    }
  } finally { f.close(); }
});

test('waits for the actual fixed child to close after native timeout and stdin failure', async () => {
  const f = fixture(), originalExec = childProcess.execFile;
  try {
    f.pkg('bounded', { exports: './entry.mjs' }, { 'entry.mjs': f.poison }); f.request.edges = [f.edge('bounded')];
    for (const failure of ['timeout', 'stdin']) {
      let spawned = false, closed = false;
      childProcess.execFile = function(exe, args, options, callback) {
        assert.equal(exe, executable);
        assert.deepEqual(args, ['--experimental-import-meta-resolve', path.join(source, 'application-native-resolution-child.mjs')]);
        const child = originalExec(exe, args, { ...options, ...(failure === 'timeout' ? { timeout: 1 } : {}) }, callback);
        spawned = true; child.once('close', () => { closed = true; });
        if (failure === 'stdin') process.nextTick(() => child.stdin.emit('error', new Error('INJECTED_STDIN_FAILURE')));
        return child;
      };
      syncBuiltinESMExports();
      await assert.rejects(invoke(f.request), refused);
      assert.equal(spawned, true); assert.equal(closed, true);
    }
    assert.equal(fs.existsSync(f.marker), false);
  } finally { childProcess.execFile = originalExec; syncBuiltinESMExports(); f.close(); }
});

test('refuses an expired measurement deadline and a hardlinked physical parent', async () => {
  const f = fixture();
  try {
    f.request.edges = [f.edge('unused', { kind: 'require-call', mode: 'require' })];
    await assert.rejects(invoke({ ...f.request, deadlineMs: 1 }), refused);
    const selected = f.request.edges[0].parentPin.path;
    fs.linkSync(selected, path.join(f.root, 'parent-alias.mjs'));
    await assert.rejects(invoke(f.request), refused);
  } finally { f.close(); }
});

// RED preparation: these controls require a successful real fixed-child result
// before comparing proof behavior. Schema rejection is not their RED oracle.
function formatCases(marker){
  const canary=`require('node:fs').writeFileSync(${JSON.stringify(marker)},'selected body ran');throw new Error('MUST_NOT_RUN');`;
  const positive=[['ordinary',canary],['empty',''],['comments','/* import export await import.meta */\n'+canary],
    ['strings',`const words='export default await import.meta';const template=\`import x from "x"\`;const re=/export\\s+default/;${canary}`],
    ['return','return 42;'+canary],['var-wrapper','var exports,require,module,__filename,__dirname;'+canary],
    ['nested-shadow','function nested(){let require;const module=1;class exports{};return module;}'+canary],
    ['dynamic-import',`void import('node:fs');${canary}`],['global-process',`globalThis.__r20_FORMAT_MUST_NOT_RUN=1;process.exitCode=93;${canary}`],['bom','\ufeff'+canary]];
  const negative=[['static-import',`import fs from 'node:fs';${canary}`],['static-export','export const value=1;'],
    ['import-meta','void import.meta.url;'],['top-await','await Promise.resolve();'],['expression-await','void (1+(await Promise.resolve(2)));'],
    ['return-export','return 1;export {};'],['invalid','const = ;'],['destructure','const {value:require}={};']];
  for(const name of ['exports','require','module','__filename','__dirname'])for(const kind of ['let','const','class'])
    negative.push([kind+'-'+name,kind==='class'?`class ${name}{}`:`${kind} ${name}=1;`]);
  return {positive,negative};
}
function proofFixture(f,cases){
  f.request.version=2;f.request.deadlineMs=60000;f.request.syntaxCandidates=[];
  const expected=[];for(const [name,bytes]of cases){const directory=f.pkg('proof-'+name,{exports:'./entry.js'},{'entry.js':bytes}),file=path.join(directory,'entry.js');
    f.request.edges.push(f.edge('proof-'+name));const source=pin(file);f.request.syntaxCandidates.push(source);expected.push(source);}
  return expected;
}
test('format proof RED native positive compilation recognizes exact CommonJS bodies without invoking them',async()=>{
  const f=fixture();try{const cases=formatCases(f.marker).positive,expected=proofFixture(f,cases),result=await invoke(f.request);
    assert.equal(result.version,2,'the actual version2 fixed child must finish, not refuse its schema');assert.equal(result.rows.length,cases.length);
    assert.equal(fs.existsSync(f.marker),false);assert.equal(Object.values(result.certifications).every(value=>value===false),true);
    for(const row of result.rows){assert.equal(row.diagnostic.kind,'resolved-file');assert.equal(row.diagnostic.format,'unestablished-js');}
    console.log(json({kind:'format-proof-native-positive-reached',rows:result.rows.length,poisonEvaluated:false,proofs:result.rows.map(row=>row.diagnostic.syntaxProof)}));
    assert.deepEqual(result.rows.map(row=>row.diagnostic.syntaxProof),expected.map(source=>({method:'node24-cjs-compile-v1',source,status:'commonjs-parse',reason:null})),
      'positive CommonJS compilation behavior is missing after successful actual resolution');
  }finally{f.close();}
});
test('format proof RED native failures remain source-bound unproven diagnostics without guessing ESM',async()=>{
  const f=fixture();try{const cases=formatCases(f.marker).negative,expected=proofFixture(f,cases),result=await invoke(f.request);
    assert.equal(result.version,2);assert.equal(result.rows.length,cases.length);assert.equal(fs.existsSync(f.marker),false);
    for(const row of result.rows){assert.equal(row.diagnostic.kind,'resolved-file');assert.equal(row.diagnostic.format,'unestablished-js');}
    console.log(json({kind:'format-proof-native-unproven-reached',rows:result.rows.length,proofs:result.rows.map(row=>row.diagnostic.syntaxProof)}));
    assert.deepEqual(result.rows.map(row=>row.diagnostic.syntaxProof),expected.map(source=>({method:'node24-cjs-compile-v1',source,status:'unproven',reason:'CJS_PARSE_NOT_PROVEN'})),
      'compile failure must produce the fixed unproven result, never an ESM inference');
  }finally{f.close();}
});
test('format proof RED invalid UTF8 cannot become replacement-character CommonJS evidence',async()=>{
  const f=fixture();try{const expected=proofFixture(f,[['encoding',Buffer.from([0xff,0xfe,0x61])]]),result=await invoke(f.request);
    assert.equal(result.version,2);assert.equal(result.rows[0].diagnostic.kind,'resolved-file');assert.equal(fs.existsSync(f.marker),false);
    assert.deepEqual(result.rows[0].diagnostic.syntaxProof,{method:'node24-cjs-compile-v1',source:expected[0],status:'unproven',reason:'SOURCE_ENCODING_UNPROVEN'});
  }finally{f.close();}
});
test('format proof protocol opt-in is closed and old version1 diagnostics retain their exact byte shape',async()=>{
  const f=fixture();try{proofFixture(f,[['compat','module.exports=1;']]);const modern=await invoke(f.request);
    assert.equal(modern.version,2);assert.equal(Object.hasOwn(modern.rows[0].diagnostic,'syntaxProof'),true);
    const old=structuredClone(f.request);old.version=1;delete old.syntaxCandidates;const legacy=await invoke(old);
    assert.equal(legacy.version,1);assert.deepEqual(legacy.rows[0].diagnostic,{kind:'resolved-file',url:modern.rows[0].diagnostic.url,format:'unestablished-js'});
    for(const mutate of [r=>r.syntaxCandidates.push({...r.syntaxCandidates[0]}),r=>r.syntaxCandidates[0].path+='?alias',
      r=>r.syntaxCandidates[0].path=r.syntaxCandidates[0].path.replace('entry.js','entry.mjs'),r=>r.compilerOptions={},r=>r.syntaxCandidates[0].sourceText='module.exports=1;',
      r=>r.version=3]){const changed=structuredClone(f.request);mutate(changed);await assert.rejects(invoke(changed),refused);}
  }finally{f.close();}
});

test('format proof integrity refuses selected pin and byte drift instead of returning a syntax result', async () => {
  const f = fixture();
  try {
    proofFixture(f, [['integrity', 'module.exports=1;']]);
    const selected = f.request.syntaxCandidates[0];
    const baseline = await invoke(f.request);
    assert.equal(baseline.rows[0].diagnostic.syntaxProof.status, 'commonjs-parse');
    for (const [key, value] of [['sha256', hash('wrong bytes')], ['sizeBytes', selected.sizeBytes + 1],
      ['dev', String(BigInt(selected.dev) + 1n)], ['ino', String(BigInt(selected.ino) + 1n)], ['sizeBytes', 32 * 1024 * 1024 + 1]]) {
      const changed = structuredClone(f.request);
      changed.syntaxCandidates[0][key] = value;
      await assert.rejects(invoke(changed), refused, key);
    }
    // Same-length, still-valid JavaScript must not inherit the earlier proof.
    write(selected.path, 'module.exports=2;');
    await assert.rejects(invoke(f.request), refused);
    write(selected.path, 'module.exports=1;');
    fs.linkSync(selected.path, path.join(f.root, 'selected-alias.js'));
    await assert.rejects(invoke(f.request), refused);
    assert.equal(fs.existsSync(f.marker), false);
  } finally { f.close(); }
});

test('format proof integrity never substitutes another selected source or an unrequested compilation', async () => {
  const f = fixture();
  try {
    proofFixture(f, [['first', 'module.exports=1;'], ['second', 'module.exports=2;']]);
    f.request.syntaxCandidates = [f.request.syntaxCandidates[1]];
    const result = await invoke(f.request);
    assert.equal(result.rows[0].diagnostic.syntaxProof, null);
    assert.deepEqual(result.rows[1].diagnostic.syntaxProof.source, f.request.syntaxCandidates[0]);
    assert.equal(result.rows[1].diagnostic.syntaxProof.status, 'commonjs-parse');
    assert.equal(result.rows[0].diagnostic.format, 'unestablished-js');
    assert.equal(fs.existsSync(f.marker), false);
  } finally { f.close(); }
});

test('format proof integrity rejects forged child method source status and invocation fields', async () => {
  const f = fixture(), originalExec = childProcess.execFile;
  try {
    proofFixture(f, [['first', 'module.exports=1;'], ['second', 'module.exports=2;']]);
    const baseline = await invoke(f.request);
    assert.equal(baseline.rows[0].diagnostic.syntaxProof.status, 'commonjs-parse');
    const mutations = [
      result => { result.rows[0].diagnostic.syntaxProof.method = 'caller-supplied'; },
      result => { result.rows[0].diagnostic.syntaxProof.source = result.rows[1].diagnostic.syntaxProof.source; },
      result => { result.rows[0].diagnostic.syntaxProof.source.sha256 = hash('forged'); },
      result => { result.rows[0].diagnostic.syntaxProof.source.dev = '0'; },
      result => { result.rows[0].diagnostic.syntaxProof.source.ino = '0'; },
      result => { result.rows[0].diagnostic.syntaxProof.reason = 'CJS_PARSE_NOT_PROVEN'; },
      result => { result.rows[0].diagnostic.syntaxProof.status = 'esm'; },
      result => { result.rows[0].diagnostic.syntaxProof.sourceText = 'module.exports=1;'; },
      result => { result.invocation.version = '24.22.1'; },
    ];
    for (const mutate of mutations) {
      let reached = false, closed = false;
      childProcess.execFile = function (exe, args, options, callback) {
        const child = originalExec(exe, args, options, (error, output, stderr) => {
          if (error) return callback(error, output, stderr);
          const result = JSON.parse(output); mutate(result); reached = true;
          callback(null, json(result), stderr);
        });
        child.once('close', () => { closed = true; });
        return child;
      };
      syncBuiltinESMExports();
      await assert.rejects(invoke(f.request), refused);
      assert.equal(reached, true, 'the real child must succeed before its response is corrupted');
      assert.equal(closed, true);
    }
    assert.equal(fs.existsSync(f.marker), false);
  } finally { childProcess.execFile = originalExec; syncBuiltinESMExports(); f.close(); }
});

test('format proof hashbang and BOM hashbang retain distinct exact-source compilation outcomes', async () => {
  const f = fixture();
  try {
    const canary = `require('node:fs').writeFileSync(${JSON.stringify(f.marker)},'executed');`;
    const expected = proofFixture(f, [['hashbang', '#!/usr/bin/env node\n' + canary],
      ['bom-hashbang', '\ufeff#!/usr/bin/env node\n' + canary]]);
    const result = await invoke(f.request);
    // Pinned Node accepts a hashbang at offset zero. Preserving the BOM makes
    // the second body unproven; stripping it would incorrectly prove both.
    assert.deepEqual(result.rows.map(row => row.diagnostic.syntaxProof), [
      { method: 'node24-cjs-compile-v1', source: expected[0], status: 'commonjs-parse', reason: null },
      { method: 'node24-cjs-compile-v1', source: expected[1], status: 'unproven', reason: 'CJS_PARSE_NOT_PROVEN' },
    ]);
    assert.equal(fs.existsSync(f.marker), false);
  } finally { f.close(); }
});
