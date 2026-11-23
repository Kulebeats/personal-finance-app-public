import path from 'node:path';
import { isBuiltin } from 'node:module';
import { shape, hash, integer, relative, freeze } from './primitives.mjs';
import { graphCheck as check, graphRefuse as refuse, graphDigest as digest, graphStable as stable, parseCanonicalGraphJson as parse } from './application-root-json.mjs';

const MiB = 1024 * 1024;
const appPath = 'dist/production-application.js';
const entryPath = 'server/production-application.ts';
const getter = '.runtime/trusted/server/config/redis/production-slot.mjs';
const bootstrap = '.runtime/trusted/server/config/redis/production-slot-bootstrap.mjs';
const roots = [getter, bootstrap];
const trustedPrefix = '.runtime/trusted/';
// These stateless adapters are shared by the accepted emitter's two graphs.
// This exception never permits a bundled identity module or an aliased copy.
const sharedFacades = new Set([
  'server/config/redis/invalidation.mjs',
  'server/config/redis/keys.mjs',
  'server/config/redis/production-rate-limit.mjs',
  'server/config/redis/rate-limit-protocol.mjs',
  'server/modules/health/redis-readiness.ts',
]);
const safePath = value => { relative('C:\\ApplicationDeclaration', value); return value; };
const equal = (left, right) => stable(left) === stable(right);
const bounded = (values, max, min = 0) => { check(Array.isArray(values) && values.length >= min && values.length <= max); };
function pin(value) { shape(value, ['sizeBytes', 'sha256']); integer(value.sizeBytes, 32 * MiB); check(value.sizeBytes > 0); hash(value.sha256); }
function source(value, input = false) {
  shape(value, ['path', 'format', 'sizeBytes', 'sha256', ...(input ? ['imports'] : [])]);
  safePath(value.path); pin({ sizeBytes: value.sizeBytes, sha256: value.sha256 });
  check(value.format === 'typescript' ? /\.(?:ts|tsx|mts|cts)$/.test(value.path) : value.format === 'javascript' && /\.(?:js|mjs|cjs)$/.test(value.path));
  if (input) check(Number.isSafeInteger(value.imports) && value.imports >= 0 && value.imports <= 4096);
}
function uniquePaths(rows, select) {
  const seen = new Set();
  for (const row of rows) { const key = select(row).toLowerCase(); check(!seen.has(key)); seen.add(key); }
}
function provenance(value) {
  shape(value, ['applicationBundle', 'applicationEntry', 'architecture', 'compiler', 'compilerVersion', 'node', 'platform', 'splitting', 'target', 'trustedModulesBundled']);
  check(value.applicationBundle === true && value.applicationEntry === entryPath && value.architecture === 'arm64' &&
    value.compiler === 'esbuild' && /^\d+\.\d+\.\d+$/.test(value.compilerVersion) && value.node === 'v24.22.0' &&
    value.platform === 'win32' && value.splitting === false && value.target === 'node24' && value.trustedModulesBundled === false);
}
function member(value, application) {
  shape(value, ['stagePath', 'format', 'source', 'output', 'imports', ...(application ? ['inputs', 'esbuildOutputPath'] : [])]);
  safePath(value.stagePath); source(value.source); pin(value.output); check(value.format === 'esm');
  bounded(value.imports, 4096);
  if (application) {
    check(value.stagePath === appPath && value.esbuildOutputPath === appPath && value.source.path === entryPath);
    bounded(value.inputs, 8192, 1); value.inputs.forEach(input => source(input, true)); uniquePaths(value.inputs, input => input.path);
    const own = value.inputs.find(input => input.path === entryPath); check(own);
    const { imports, ...ownPin } = own; check(equal(ownPin, value.source));
  } else {
    check(value.source.path.startsWith('server/') && /\.(?:ts|mjs)$/.test(value.source.path));
    check(value.stagePath === trustedPrefix + value.source.path.replace(/\.ts$/, '.mjs'));
  }
}

function normalizeEdge(edge, parent, members) {
  shape(edge, ['parent', 'specifier', 'target', 'kind', 'external', ...(Object.hasOwn(edge, 'typeOnly') ? ['typeOnly'] : [])]);
  check(edge.parent === parent && typeof edge.external === 'boolean');
  check(['import', 'export', 'import-statement', 'dynamic-import', 'require', 'require-call'].includes(edge.kind));
  check(edge.specifier === null || typeof edge.specifier === 'string' && edge.specifier.length > 0 && edge.specifier.length <= 256 && !/[\x00-\x20\x7f%?\\]/.test(edge.specifier));
  const typeOnly = Object.hasOwn(edge, 'typeOnly');
  if (typeOnly) check(edge.typeOnly === true && edge.specifier !== null && ['import', 'export'].includes(edge.kind));
  check(edge.target === null || typeof edge.target === 'string');
  if (edge.target !== null) {
    safePath(edge.target); check(members.has(edge.target));
    check(typeof edge.specifier === 'string' && /^\.\.?\//.test(edge.specifier));
    check(path.posix.normalize(path.posix.join(path.posix.dirname(parent), edge.specifier)) === edge.target);
    const relativeTarget = path.posix.relative(path.posix.dirname(parent), edge.target);
    check(edge.specifier === (relativeTarget.startsWith('../') ? relativeTarget : './'+relativeTarget));
    if (parent === appPath) check(edge.external === true && edge.target === getter && edge.specifier === '../'+getter && edge.kind === 'import-statement' && !typeOnly);
    else check(edge.external === false);
  } else {
    check(edge.external === true);
    check(edge.specifier === null || !/^\.\.?\//.test(edge.specifier));
  }
  let classification, reason = null, normalizedSpecifier = edge.specifier;
  const mode = ['require', 'require-call'].includes(edge.kind) ? 'require' : edge.kind === 'dynamic-import' ? 'esm-dynamic' : 'esm-static';
  if (typeOnly) classification = 'type-only';
  else if (mode === 'require') { classification = 'unsupported'; reason = 'REQUIRE_UNSUPPORTED'; }
  else if (edge.specifier === null) { classification = 'unsupported'; reason = 'NONLITERAL_SPECIFIER'; }
  else if (edge.target !== null) classification = 'internal';
  else if (isBuiltin(edge.specifier)) { classification = 'builtin'; normalizedSpecifier = `node:${edge.specifier.replace(/^node:/, '')}`; }
  else if (/^(?:@[A-Za-z0-9_-][A-Za-z0-9._-]*\/)?[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)*$/.test(edge.specifier) && !edge.specifier.split('/').some(part => part === '.' || part === '..')) classification = 'package';
  else { classification = 'unsupported'; reason = edge.specifier.startsWith('#') ? 'PACKAGE_IMPORTS_UNSUPPORTED' : 'SPECIFIER_TOPOLOGY_UNSUPPORTED'; }
  return { ...edge, classification, mode, normalizedSpecifier, reason, occurrences: 1 };
}

/** Pure compile-declaration validation. No filesystem reads, resolution or authority brand. */
export function readApplicationGraphDeclaration(text, pinText) {
  try {
    const pins = parse(pinText, 4096); shape(pins, ['rawSha256', 'rawSize', 'graphSha256']);
    hash(pins.rawSha256); hash(pins.graphSha256); integer(pins.rawSize, MiB);
    check(typeof text === 'string' && Buffer.byteLength(text, 'utf8') === pins.rawSize && digest(text) === pins.rawSha256);
    const graph = parse(text, MiB); shape(graph, ['application', 'graphSha256', 'provenance', 'schemaVersion', 'trustedGraph']);
    check(graph.schemaVersion === 1 && graph.graphSha256 === pins.graphSha256);
    const { graphSha256, ...body } = graph; check(digest(stable(body)) === graphSha256); provenance(graph.provenance);
    member(graph.application, true); shape(graph.trustedGraph, ['members', 'roots']);
    bounded(graph.trustedGraph.members, 255, 2); bounded(graph.trustedGraph.roots, 2, 2);
    graph.trustedGraph.members.forEach(value => member(value, false));
    const trustedPins = new Set(), trustedOutputPins = new Set();
    for (const value of graph.trustedGraph.members) {
      const key = `${value.source.sha256}:${value.source.sizeBytes}`;
      check(!trustedPins.has(key)); trustedPins.add(key);
      const outputKey = `${value.output.sha256}:${value.output.sizeBytes}`;
      check(!trustedOutputPins.has(outputKey)); trustedOutputPins.add(outputKey);
    }
    const members = [graph.application, ...graph.trustedGraph.members]; uniquePaths(members, value => value.stagePath); uniquePaths(members, value => value.source.path);
    const byPath = new Map(members.map(value => [value.stagePath, value]));
    graph.trustedGraph.roots.forEach((root, index) => {
      shape(root, ['sourcePath', 'stagePath']); check(root.stagePath === roots[index] && root.sourcePath === roots[index].slice(trustedPrefix.length));
      check(byPath.get(root.stagePath)?.source.path === root.sourcePath);
    });
    for (const input of graph.application.inputs) for (const trusted of graph.trustedGraph.members) {
      if (sharedFacades.has(input.path) && input.path === trusted.source.path) {
        const { imports, ...inputPin } = input;
        check(equal(inputPin, trusted.source));
        continue;
      }
      check(input.path.toLowerCase() !== trusted.source.path.toLowerCase());
      check(input.sha256 !== trusted.source.sha256 || input.sizeBytes !== trusted.source.sizeBytes);
    }
    const normalized = new Map(); let occurrences = 0;
    for (const owner of members) for (const value of owner.imports) {
      check(++occurrences <= 4096);
      const edge = normalizeEdge(value, owner.stagePath, byPath);
      const key = stable([edge.parent, edge.kind, edge.specifier, edge.typeOnly === true]);
      const previous = normalized.get(key);
      if (previous) { check(equal({ ...previous, occurrences: 1 }, edge)); previous.occurrences++; }
      else normalized.set(key, edge);
    }
    const edges = [...normalized.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value);
    check(edges.filter(edge => edge.parent === appPath && edge.target === getter).reduce((n, edge) => n + edge.occurrences, 0) === 1);
    const reached = new Set(roots), queue = [...roots];
    while (queue.length) {
      const parent = queue.shift();
      for (const edge of edges) if (edge.parent === parent && edge.target && !reached.has(edge.target)) {
        reached.add(edge.target); queue.push(edge.target);
      }
    }
    check(graph.trustedGraph.members.every(value => reached.has(value.stagePath)));
    const blockers = edges.filter(edge => edge.classification === 'unsupported').map(({ parent, kind, specifier, reason, occurrences }) => ({ parent, kind, specifier, reason, occurrences }));
    check(blockers.length <= 128 && edges.filter(edge => edge.target === null).length <= 256);
    const count = classification => edges.filter(edge => edge.classification === classification).reduce((n, edge) => n + edge.occurrences, 0);
    return freeze({ kind: 'application-graph-declaration', rawSha256: pins.rawSha256, graphSha256, graph, members, edges, blockers,
      coverage: { importOccurrences: occurrences, internalOccurrences: count('internal'), builtinOccurrences: count('builtin'), typeOnlyOccurrences: count('type-only'), packageOccurrences: count('package'), unsupportedOccurrences: count('unsupported') },
      certifications: { allRootsObserved: false, transitiveClosureComplete: false, custodyHeld: false, runtimeDependencyIdentity: false, executionAuthorized: false },
      limitations: ['compile-declaration-only', 'compiler-configuration-not-fully-pinned', 'graph-has-no-build-revision'] });
  } catch { refuse(); }
}
