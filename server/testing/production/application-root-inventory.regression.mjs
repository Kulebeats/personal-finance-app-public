import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { readApplicationRootInventory, requireApplicationRootInventory } from './application-root-inventory.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const stable = value => Array.isArray(value) ? '['+value.map(stable).join(',')+']' : value && typeof value === 'object'
  ? '{'+Object.keys(value).sort().map(key => JSON.stringify(key)+':'+stable(value[key])).join(',')+'}' : JSON.stringify(value);
const json = value => stable(value)+'\n';
const pin = (path, sizeBytes = 42) => ({ path, sizeBytes, sha256: hash(path) });
const app = 'dist/production-application.js';
const getter = '.runtime/trusted/server/config/redis/production-slot.mjs';
const bootstrap = '.runtime/trusted/server/config/redis/production-slot-bootstrap.mjs';
const root = 'C:\\Fixture\\emission';
const abs = relative => root+'\\'+relative.replaceAll('/', '\\');
const url = relative => 'file:///C:/Fixture/emission/'+relative;
const source = path => ({ ...pin(path), format: path.endsWith('.ts') ? 'typescript' : 'javascript' });
const edge = (parent, specifier, kind = 'import', target = null) => ({ parent, specifier, kind, target, external: target === null });

function fixture() {
  const entry = source('server/production-application.ts');
  const graphBody = { schemaVersion: 1, provenance: { applicationBundle: true, applicationEntry: entry.path, architecture: 'arm64',
    compiler: 'esbuild', compilerVersion: '0.25.12', node: 'v24.22.0', platform: 'win32', splitting: false, target: 'node24', trustedModulesBundled: false },
    application: { stagePath: app, esbuildOutputPath: app, format: 'esm', source: entry, output: { sizeBytes: 42, sha256: hash('app-output') },
      inputs: [{ ...entry, imports: 2 }], imports: [{ ...edge(app, '../'+getter, 'import-statement', getter), external: true }, edge(app, 'example', 'import-statement')] },
    trustedGraph: { roots: [getter, bootstrap].map(stagePath => ({ stagePath, sourcePath: stagePath.slice(17) })),
      members: [getter, bootstrap].map(stagePath => ({ stagePath, format: 'esm', source: source(stagePath.slice(17)),
        output: { sizeBytes: 42, sha256: hash(stagePath) }, imports: [edge(stagePath, 'example')] })) } };
  const graph = { ...graphBody, graphSha256: hash(stable(graphBody)) };
  const graphText = json(graph);
  const harness = pin('C:\\Fixture\\harness\\observer.mjs');
  const identity = { candidateId: '12345678-1234-4234-8234-123456789abc', evidenceClass: 'synthetic-fixture',
    reviewRef: 'review-fixture-1', sourceRevision: 'a'.repeat(40), harnessEntry: harness.path, harnessFiles: [harness] };
  const document = { kind: 'pfa-application-root-inventory', version: 1, identity,
    graph: { rawSha256: hash(graphText), rawSize: Buffer.byteLength(graphText), graphSha256: graph.graphSha256, schemaVersion: 1,
      emissionRoot: root, relativePath: '.runtime/production-profile.json' },
    runtime: { executable: pin('C:\\Runtime\\node.exe'), version: '24.22.0', platform: 'win32', arch: 'arm64',
      argv: ['--experimental-import-meta-resolve', harness.path], environmentPolicy: 'clean-windows-arm64-utc-v1' },
    resolutionPolicy: { profile: 'native-default-esm-v1', additionalConditions: [], deadlineMs: 60000, metadataBatchSize: 1024 },
    dependencyRoots: ['C:\\Fixture\\node_modules'], scopeRoots: ['C:\\Fixture'],
    members: [graph.application, ...graph.trustedGraph.members].map(member => ({ stagePath: member.stagePath,
      parentUrl: url(member.stagePath), source: member.source, output: { path: abs(member.stagePath), ...member.output }, format: member.format,
      role: member.stagePath === app ? 'application' : member.stagePath === getter ? 'getter' : 'bootstrap' })),
    edges: [graph.application, ...graph.trustedGraph.members].flatMap(member => member.imports.map(item => ({
      parent: item.parent, kind: item.kind, specifier: item.specifier, typeOnly: false, mode: 'esm-static', occurrences: 1,
      classification: item.target ? 'internal' : 'package',
      target: item.target ? { kind: 'internal', stagePath: item.target } : { kind: 'unobserved' },
    }))),
    files: [], lookup: { directories: [], absent: [], footprint: 'unobserved' },
    certifications: { allRootsObserved: false, transitiveClosureComplete: false, custodyHeld: false, runtimeDependencyIdentity: false, executionAuthorized: false },
    limitations: ['compile-declaration-only', 'compiler-configuration-not-fully-pinned', 'graph-has-no-build-revision'],
  };
  return { graphText, document };
}
function materialize(f = fixture()) {
  const inventoryText = json(f.document);
  const pins = json({ inventorySha256: hash(inventoryText), identity: f.document.identity, graph: f.document.graph,
    runtime: f.document.runtime, resolutionPolicy: f.document.resolutionPolicy,
    dependencyRoots: f.document.dependencyRoots, scopeRoots: f.document.scopeRoots });
  return { graphText: f.graphText, inventoryText, pins };
}
function read(f = fixture()) { const m = materialize(f); return readApplicationRootInventory(m.graphText, m.inventoryText, m.pins); }
const refused = work => assert.throws(work, /APPLICATION_INVENTORY_REFUSED/);

test('binds a complete declaration census and creates only a private inert lineage', () => {
  const record = read(); const bound = requireApplicationRootInventory(record);
  assert.equal(bound.document.members.length, 3);
  assert.equal(bound.document.edges.length, 4);
  assert.equal(bound.blockers.length, 4);
  assert.equal(bound.certifications.allRootsObserved, false);
  assert.equal(Object.isFrozen(bound.document.runtime.argv), true);
  refused(() => requireApplicationRootInventory(JSON.parse(JSON.stringify(record))));
  refused(() => requireApplicationRootInventory({ ...record }));
  refused(() => requireApplicationRootInventory({ kind: 'validated-runtime-root-resolution' }));
});

test('rejects raw inventory drift even when self hashes are updated elsewhere', () => {
  const before = materialize(); const changed = fixture(); changed.document.identity.sourceRevision = 'b'.repeat(40);
  refused(() => readApplicationRootInventory(changed.graphText, materialize(changed).inventoryText, before.pins));
  const changedPins = JSON.parse(before.pins); changedPins.inventorySha256 = hash(materialize(changed).inventoryText);
  refused(() => readApplicationRootInventory(changed.graphText, materialize(changed).inventoryText, json(changedPins)));
});

test('rejects missing or collapsed edges, parent swaps and invented execution claims', () => {
  for (const mutate of [
    f => f.document.edges.pop(),
    f => { f.document.edges[1].parent = getter; },
    f => { f.document.edges[1].occurrences = 2; },
    f => { f.document.members[0].parentUrl += '?copy'; },
    f => { f.document.members[0].output.sha256 = hash('replacement'); },
    f => { f.document.certifications.executionAuthorized = true; },
    f => { f.document.lookup.footprint = 'complete'; },
  ]) { const f = fixture(); mutate(f); refused(() => read(f)); }
});

test('refuses runtime hooks, ambient policies, wrong entries and duplicate harness pins', () => {
  for (const mutate of [
    f => { f.document.runtime.argv.unshift('--import=evil.mjs'); },
    f => { f.document.runtime.environmentPolicy = 'inherit'; },
    f => { f.document.runtime.version = '22.23.2'; },
    f => { f.document.resolutionPolicy.additionalConditions = ['custom']; },
    f => { f.document.identity.harnessEntry = 'C:\\Fixture\\other.mjs'; },
    f => { f.document.identity.harnessFiles.push({ ...f.document.identity.harnessFiles[0] }); },
  ]) { const f = fixture(); mutate(f); refused(() => read(f)); }
});

function selected(f) {
  const file = { ...pin('C:\\Fixture\\node_modules\\example\\index.mjs'), role: 'target' };
  const manifest = { ...pin('C:\\Fixture\\node_modules\\example\\package.json'), role: 'manifest' };
  f.document.files = [file, manifest];
  f.document.edges[1].target = { kind: 'candidate-file', path: file.path, format: 'esm', packageManifest: manifest.path, scopeManifest: manifest.path };
}

test('preserves selected targets as unobserved candidates with independently bound metadata', () => {
  const f = fixture(); selected(f); const record = requireApplicationRootInventory(read(f));
  assert.equal(record.document.edges[1].target.kind, 'candidate-file');
  assert.equal(record.certifications.runtimeDependencyIdentity, false);
  assert.equal(record.blockers.filter(row => row.reason === 'RESOLUTION_UNOBSERVED').length, 3);
});

test('refuses escapes, missing manifest bindings, aliases and conflicting file pins', () => {
  for (const mutate of [
    f => { f.document.files[0].path = 'C:\\Outside\\index.mjs'; f.document.edges[1].target.path = f.document.files[0].path; },
    f => { f.document.files.pop(); },
    f => { f.document.edges[1].target.path = f.document.edges[1].target.path.toLowerCase(); },
    f => { f.document.files.push({ ...f.document.files[0], sha256: hash('other') }); },
    f => { f.document.edges[1].target.format = 'native'; },
  ]) { const f = fixture(); selected(f); mutate(f); refused(() => read(f)); }
});

test('refuses accessor inputs without invoking them and rejects duplicate JSON keys', () => {
  const m = materialize(); let touched = false;
  refused(() => readApplicationRootInventory(m.graphText, { get data() { touched = true; } }, m.pins));
  assert.equal(touched, false);
  const text = m.inventoryText.replace('"version":1', '"version":1,"version":1');
  const pins = JSON.parse(m.pins); pins.inventorySha256 = hash(text);
  refused(() => readApplicationRootInventory(m.graphText, text, json(pins)));
});

const directory = (path, entries = []) => ({ path, identity: { dev: '1', ino: '2', birthtimeNs: '10', attributes: 16 }, entries });
test('binds directory listings and negative probes without certifying their observation', () => {
  const f = fixture();
  f.document.lookup.directories.push(directory('C:\\Fixture\\node_modules'));
  f.document.lookup.absent.push({ path: 'C:\\Fixture\\node_modules\\nearer', parent: 'C:\\Fixture\\node_modules' });
  const payload = requireApplicationRootInventory(read(f));
  assert.equal(payload.document.lookup.absent.length, 1);
  assert.equal(payload.blockers.at(-1).reason, 'LOOKUP_FOOTPRINT_UNOBSERVED');
});

test('rejects absent paths or ancestors that contradict declared present files', () => {
  for (const absentPath of ['C:\\Fixture\\node_modules\\example', 'C:\\Fixture\\node_modules\\example\\index.mjs']) {
    const f = fixture(); selected(f);
    const parent = absentPath.slice(0, absentPath.lastIndexOf('\\'));
    f.document.lookup.directories.push(directory(parent));
    f.document.lookup.absent.push({ path: absentPath, parent });
    refused(() => read(f));
  }
});

test('rejects listings that omit a declared present child or give it the wrong kind', () => {
  for (const entries of [[], [{ name: 'index.mjs', kind: 'directory' }, { name: 'package.json', kind: 'file' }]]) {
    const f = fixture(); selected(f);
    f.document.lookup.directories.push(directory('C:\\Fixture\\node_modules\\example', entries));
    refused(() => read(f));
  }
});

test('rejects scope substitution above a declared nearer package manifest', () => {
  const f = fixture(); selected(f);
  f.document.files[0].path = 'C:\\Fixture\\node_modules\\example\\index.js';
  f.document.edges[1].target.path = f.document.files[0].path;
  const outer = { ...pin('C:\\Fixture\\package.json'), role: 'project-manifest' };
  f.document.files.push(outer); f.document.edges[1].target.scopeManifest = outer.path;
  refused(() => read(f));
});

test('rejects harness placement inside an emission root through a case alias', () => {
  const f = fixture(); const harness = pin('C:\\fixture\\emission\\observer.mjs');
  f.document.identity.harnessEntry = harness.path; f.document.identity.harnessFiles = [harness];
  f.document.runtime.argv[1] = harness.path;
  refused(() => read(f));
});

test('accepts consistent selected-file listings while retaining unobserved status', () => {
  const f = fixture(); selected(f);
  f.document.lookup.directories.push(directory('C:\\Fixture\\node_modules\\example', [
    { name: 'index.mjs', kind: 'file' }, { name: 'package.json', kind: 'file' },
  ]));
  assert.equal(requireApplicationRootInventory(read(f)).certifications.allRootsObserved, false);
});

test('preserves unsupported, builtin and type-only dispositions in the complete census', () => {
  const f = fixture(), graph = JSON.parse(f.graphText);
  graph.application.imports.push(edge(app, null, 'dynamic-import'), edge(app, 'path', 'import-statement'));
  graph.trustedGraph.members[0].imports.push({ ...edge(getter, 'type-definitions'), typeOnly: true });
  delete graph.graphSha256; const graphSha256 = hash(stable(graph)); f.graphText = json({ ...graph, graphSha256 });
  Object.assign(f.document.graph, { graphSha256, rawSha256: hash(f.graphText), rawSize: Buffer.byteLength(f.graphText) });
  f.document.edges.push(
    { parent: app, kind: 'dynamic-import', specifier: null, typeOnly: false, mode: 'esm-dynamic', occurrences: 1,
      classification: 'unsupported', target: { kind: 'unsupported', reason: 'NONLITERAL_SPECIFIER' } },
    { parent: app, kind: 'import-statement', specifier: 'path', typeOnly: false, mode: 'esm-static', occurrences: 1,
      classification: 'builtin', target: { kind: 'builtin', name: 'node:path' } },
    { parent: getter, kind: 'import', specifier: 'type-definitions', typeOnly: true, mode: 'esm-static', occurrences: 1,
      classification: 'type-only', target: { kind: 'excluded', reason: 'type-only' } },
  );
  const payload = requireApplicationRootInventory(read(f));
  assert.equal(payload.graph.coverage.builtinOccurrences, 1);
  assert.equal(payload.graph.coverage.typeOnlyOccurrences, 1);
  assert.equal(payload.blockers.some(row => row.reason === 'NONLITERAL_SPECIFIER'), true);
  f.document.edges.at(-1).target = { kind: 'unobserved' }; refused(() => read(f));
});

test('retains unsupported selected formats as measured candidates with explicit blockers', () => {
  for (const [extension, format] of [['node', 'native'], ['json', 'json'], ['wasm', 'unsupported']]) {
    const f = fixture(); selected(f);
    f.document.files[0].path = 'C:\\Fixture\\node_modules\\example\\entry.'+extension;
    Object.assign(f.document.edges[1].target, { path: f.document.files[0].path, format });
    const payload = requireApplicationRootInventory(read(f));
    assert.equal(payload.blockers.some(row => row.reason === 'UNSUPPORTED_SELECTED_FORMAT'), true);
    assert.equal(payload.certifications.executionAuthorized, false);
  }
});

test('retains unsuccessful package dispositions without inventing successful resolution', () => {
  for (const reason of ['PACKAGE_NOT_FOUND', 'PACKAGE_PATH_NOT_EXPORTED', 'UNSUPPORTED_LOOKUP_FOOTPRINT']) {
    const f = fixture(); f.document.edges[1].target = { kind: 'blocked', reason };
    const payload = requireApplicationRootInventory(read(f));
    assert.equal(payload.blockers.some(row => row.reason === reason), true);
    assert.equal(payload.certifications.allRootsObserved, false);
  }
  const f = fixture(); f.document.edges[1].target = { kind: 'blocked', reason: 'IGNORED' }; refused(() => read(f));
});

test('retains a selected package manifest as one pinned JSON file with two uses', () => {
  const f = fixture(); selected(f);
  f.document.files.shift(); const manifest = f.document.files[0];
  Object.assign(f.document.edges[1].target, { path: manifest.path, format: 'json' });
  const payload = requireApplicationRootInventory(read(f));
  assert.equal(payload.document.files.length, 1);
  assert.equal(payload.blockers.some(row => row.reason === 'UNSUPPORTED_SELECTED_FORMAT'), true);
  f.document.dependencyRoots = ['C:\\Other\\node_modules'];
  refused(() => read(f));
});

test('retains scoped-package directory entries without weakening emitted graph paths', () => {
  const f = fixture();
  f.document.lookup.directories.push(directory('C:\\Fixture\\node_modules', [{name:'@scope',kind:'directory'}]));
  f.document.lookup.directories.push(directory('C:\\Fixture\\node_modules\\@scope'));
  f.document.lookup.absent.push({path:'C:\\Fixture\\node_modules\\@scope\\missing',parent:'C:\\Fixture\\node_modules\\@scope'});
  assert.equal(requireApplicationRootInventory(read(f)).document.lookup.directories.length,2);
  f.document.members[0].stagePath = 'dist/@alias.js'; refused(()=>read(f));
});
