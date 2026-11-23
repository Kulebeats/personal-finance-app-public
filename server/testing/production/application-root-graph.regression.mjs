import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { readApplicationGraphDeclaration } from './application-root-graph.mjs';

const digest = text => createHash('sha256').update(text).digest('hex');
const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
const getter = '.runtime/trusted/server/config/redis/production-slot.mjs';
const bootstrap = '.runtime/trusted/server/config/redis/production-slot-bootstrap.mjs';
const app = 'dist/production-application.js';
const pin = label => ({ sizeBytes: 42, sha256: digest(label) });
const source = (name, format = 'javascript') => ({ path: name, format, ...pin(name) });
const edge = (parent, specifier, kind = 'import', target = null) => ({ parent, specifier, kind, target, external: target === null });
function fixture() {
  const entry = source('server/production-application.ts', 'typescript');
  return { schemaVersion: 1, provenance: { applicationBundle: true, applicationEntry: entry.path, architecture: 'arm64',
    compiler: 'esbuild', compilerVersion: '0.25.12', node: 'v24.22.0', platform: 'win32', splitting: false, target: 'node24', trustedModulesBundled: false },
  application: { stagePath: app, esbuildOutputPath: app, format: 'esm', source: entry, output: pin('app-output'), inputs: [{ ...entry, imports: 2 }],
    imports: [{ ...edge(app, '../'+getter, 'import-statement', getter), external: true }, edge(app, 'example-package', 'import-statement')] },
  trustedGraph: { roots: [getter, bootstrap].map(stagePath => ({ stagePath, sourcePath: stagePath.slice('.runtime/trusted/'.length) })),
    members: [getter, bootstrap].map(stagePath => ({ stagePath, format: 'esm', source: source(stagePath.slice('.runtime/trusted/'.length)), output: pin(stagePath),
      imports: [edge(stagePath, 'example-package'), edge(stagePath, 'node:path')] })) } };
}
function materialize(graph = fixture()) {
  const { graphSha256: omitted, ...body } = graph;
  const graphSha256 = digest(stable(body));
  const text = stable({ ...body, graphSha256 }) + '\n';
  return { text, pins: stable({ rawSha256: digest(text), rawSize: Buffer.byteLength(text), graphSha256 }) + '\n' };
}
const read = graph => { const { text, pins } = materialize(graph); return readApplicationGraphDeclaration(text, pins); };

test('keeps parent-specific package edges and raw/digest identities distinct without execution authority', () => {
  const graph = fixture(); graph.application.imports.push(edge(app, 'example-package', 'import-statement'));
  const result = read(graph);
  assert.equal(result.members.length, 3);
  assert.equal(result.edges.filter(value => value.classification === 'package').length, 3);
  assert.equal(result.edges.find(value => value.parent === app && value.classification === 'package').occurrences, 2);
  assert.notEqual(result.rawSha256, result.graphSha256);
  assert.equal(result.coverage.importOccurrences, 7);
  assert.equal(result.coverage.internalOccurrences, 1);
  assert.equal(result.coverage.builtinOccurrences, 2);
  assert.equal(result.certifications.executionAuthorized, false);
  assert.equal(result.certifications.custodyHeld, false);
  assert.equal(Object.isFrozen(result.graph.application.imports), true);
});

test('refuses duplicate JSON keys, missing newline, alternate encodings and object accessors', () => {
  const { text, pins } = materialize();
  for (const changed of [text.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'), text.trimEnd(), '\ufeff'+text, text.replace('"esm"', '"\\u0065sm"')]) {
    const repinned = stable({ ...JSON.parse(pins), rawSha256: digest(changed), rawSize: Buffer.byteLength(changed) })+'\n';
    assert.throws(() => readApplicationGraphDeclaration(changed, repinned), /APPLICATION_GRAPH_REFUSED/);
  }
  let touched = false;
  assert.throws(() => readApplicationGraphDeclaration({ get data() { touched = true; return text; } }, pins), /APPLICATION_GRAPH_REFUSED/);
  assert.equal(touched, false);
});

test('rejects raw drift even if the changed graph has a new self digest', () => {
  const original = materialize(); const graph = fixture(); graph.application.output = pin('other-output');
  assert.throws(() => readApplicationGraphDeclaration(materialize(graph).text, original.pins), /APPLICATION_GRAPH_REFUSED/);
  const bad = JSON.parse(original.text); bad.graphSha256 = digest('forged');
  const text = stable(bad)+'\n';
  const pins = stable({ rawSha256: digest(text), rawSize: Buffer.byteLength(text), graphSha256: bad.graphSha256 })+'\n';
  assert.throws(() => readApplicationGraphDeclaration(text, pins), /APPLICATION_GRAPH_REFUSED/);
});

test('rejects old entry, parent substitution, removed trusted target and altered application getter', () => {
  const mutations = [
    graph => { graph.application.source.path = 'server/index-prod.ts'; },
    graph => { graph.application.imports[1].parent = getter; },
    graph => { graph.trustedGraph.members.shift(); },
    graph => { graph.application.imports[0].target = bootstrap; },
    graph => { graph.application.imports.shift(); },
  ];
  for (const mutate of mutations) { const graph = fixture(); mutate(graph); assert.throws(() => read(graph), /APPLICATION_GRAPH_REFUSED/); }
});

test('rejects unsafe or conflicting members and source mappings', () => {
  for (const mutate of [
    graph => graph.trustedGraph.members.push({ ...graph.trustedGraph.members[0] }),
    graph => { graph.trustedGraph.members[0].stagePath += '?copy'; },
    graph => { graph.trustedGraph.members[0].source.path = '../escape.mjs'; },
    graph => { graph.trustedGraph.members[0].stagePath = getter.toUpperCase(); },
    graph => graph.application.inputs.push({ ...graph.trustedGraph.members[0].source, imports: 0 }),
    graph => graph.application.inputs.push({ ...graph.trustedGraph.members[0].source, path: 'server/copied-authority.mjs', imports: 0 }),
  ]) { const graph = fixture(); mutate(graph); assert.throws(() => read(graph), /APPLICATION_GRAPH_REFUSED/); }
});

test('retains require, nonliteral and package imports as explicit unsupported blockers', () => {
  const graph = fixture();
  graph.application.imports.push(edge(app, 'require-only', 'require-call'), edge(app, null, 'dynamic-import'), edge(app, '#private', 'import-statement'));
  const result = read(graph);
  assert.deepEqual(result.blockers.map(value => value.reason).sort(), ['NONLITERAL_SPECIFIER', 'PACKAGE_IMPORTS_UNSUPPORTED', 'REQUIRE_UNSUPPORTED']);
  assert.equal(result.coverage.unsupportedOccurrences, 3);
  assert.equal(result.certifications.allRootsObserved, false);
});

test('retains type-only rows without counting them as runtime resolution', () => {
  const graph = fixture(); graph.trustedGraph.members[0].imports.push({ ...edge(getter, 'types-only', 'import'), typeOnly: true });
  const result = read(graph);
  assert.equal(result.coverage.typeOnlyOccurrences, 1);
  assert.equal(result.edges.find(value => value.specifier === 'types-only').classification, 'type-only');
});

test('walks every trusted edge through multiple levels and refuses disconnected members', () => {
  const graph = fixture();
  const first = '.runtime/trusted/server/config/redis/first.mjs';
  const second = '.runtime/trusted/server/config/redis/second.mjs';
  for (const stagePath of [first, second]) graph.trustedGraph.members.push({
    stagePath, format: 'esm', source: source(stagePath.slice('.runtime/trusted/'.length)),
    output: pin(stagePath), imports: [],
  });
  graph.trustedGraph.members[0].imports.push(edge(getter, './first.mjs', 'import', first));
  graph.trustedGraph.members[2].imports.push(edge(first, './second.mjs', 'export', second));
  assert.equal(read(graph).members.length, 5);
  graph.trustedGraph.members[2].imports = [];
  assert.throws(() => read(graph), /APPLICATION_GRAPH_REFUSED/);
});

test('accepts source inputs with zero declared imports', () => {
  const graph = fixture();
  graph.application.inputs.push({ ...source('server/constants.ts', 'typescript'), imports: 0 });
  assert.equal(read(graph).graph.application.inputs.length, 2);
});

test('permits pinned stateless facade overlap while refusing changed source bytes', () => {
  const graph = fixture();
  const shared = source('server/config/redis/keys.mjs');
  const stagePath = '.runtime/trusted/'+shared.path;
  graph.application.inputs.push({ ...shared, imports: 0 });
  graph.trustedGraph.members.push({ stagePath, format: 'esm', source: shared, output: pin('shared-output'), imports: [] });
  graph.trustedGraph.members[0].imports.push(edge(getter, './keys.mjs', 'import', stagePath));
  assert.equal(read(graph).members.length, 4);
  graph.application.inputs[1].sha256 = digest('substituted');
  assert.throws(() => read(graph), /APPLICATION_GRAPH_REFUSED/);
});

test('refuses unknown fields, unsupported kinds and excessive nesting or sizes', () => {
  for (const mutate of [
    graph => { graph.executionAuthorized = true; },
    graph => { graph.application.imports[1].kind = 'magic'; },
    graph => { graph.application.output.sizeBytes = 33 * 1024 * 1024; },
    graph => { graph.provenance.trustedModulesBundled = true; },
    graph => { graph.application.inputs.push({ ...graph.application.inputs[0] }); },
  ]) { const graph = fixture(); mutate(graph); assert.throws(() => read(graph), /APPLICATION_GRAPH_REFUSED/); }
  assert.throws(() => readApplicationGraphDeclaration('['.repeat(40)+'0'+']'.repeat(40), '{}\n'), /APPLICATION_GRAPH_REFUSED/);
  assert.throws(() => readApplicationGraphDeclaration(' '.repeat(1024*1024+1), '{}\n'), /APPLICATION_GRAPH_REFUSED/);
});

test('rejects internal path aliases and renamed identical trusted authority', () => {
  const graph = fixture();
  graph.trustedGraph.members[0].imports.push(edge(getter, './unused/../production-slot-bootstrap.mjs', 'import', bootstrap));
  assert.throws(() => read(graph), /APPLICATION_GRAPH_REFUSED/);
  const copied = fixture();
  const copy = structuredClone(copied.trustedGraph.members[0]);
  copy.source.path = 'server/config/redis/copied-authority.mjs';
  copy.stagePath = '.runtime/trusted/'+copy.source.path;
  copy.imports = [];
  copied.trustedGraph.members.push(copy);
  copied.trustedGraph.members[0].imports.push(edge(getter, './copied-authority.mjs', 'import', copy.stagePath));
  assert.throws(() => read(copied), /APPLICATION_GRAPH_REFUSED/);
});

test('rejects nonliteral type-only edges and counts their external bound', () => {
  const graph = fixture();
  graph.trustedGraph.members[0].imports.push({ ...edge(getter, null), typeOnly: true });
  assert.throws(() => read(graph), /APPLICATION_GRAPH_REFUSED/);
  const excessive = fixture();
  for (let i = 0; i < 257; i++) excessive.trustedGraph.members[0].imports.push({ ...edge(getter, 'types-'+i), typeOnly: true });
  assert.throws(() => read(excessive), /APPLICATION_GRAPH_REFUSED/);
});

test('refuses literal relative edges without an exact mapped target', () => {
  for (const specifier of ['./production-slot-bootstrap.mjs', './missing.mjs']) {
    const graph = fixture();
    graph.trustedGraph.members[0].imports.push(edge(getter, specifier));
    assert.throws(() => read(graph), /APPLICATION_GRAPH_REFUSED/);
  }
});

test('refuses identical emitted trusted bytes even with different source pins', () => {
  const graph = fixture();
  graph.trustedGraph.members[1].output = { ...graph.trustedGraph.members[0].output };
  assert.throws(() => read(graph), /APPLICATION_GRAPH_REFUSED/);
});

test('bounds parsing of independently pinned deep and oversized raw documents', () => {
  for (const text of ['['.repeat(40)+'0'+']'.repeat(40)+'\n', ' '.repeat(1024*1024+1)]) {
    const pins = stable({ rawSha256: digest(text), rawSize: Buffer.byteLength(text), graphSha256: digest('body') })+'\n';
    assert.throws(() => readApplicationGraphDeclaration(text, pins), /APPLICATION_GRAPH_REFUSED/);
  }
});
