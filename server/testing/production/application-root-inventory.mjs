import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { absolute, relative, hash, uuid, shape, freeze } from './primitives.mjs';
import { graphCheck as check, graphDigest as digest, graphStable as stable, parseCanonicalGraphJson as parse } from './application-root-json.mjs';
import { readApplicationGraphDeclaration } from './application-root-graph.mjs';
import { applicationEntryPath } from './application-paths.mjs';

const records = new WeakMap();
const MiB = 1024 * 1024;
const refuse = () => { throw new Error('APPLICATION_INVENTORY_REFUSED'); };
const json = value => stable(value)+'\n';
const same = (a, b) => check(stable(a) === stable(b));
const list = (value, max, min = 0) => check(Array.isArray(value) && value.length >= min && value.length <= max);
const inside = (root, file) => file.startsWith(root+'\\');
const admitted = (roots, file) => roots.some(root => file === root || inside(root, file));
const url = file => pathToFileURL(file, { windows: true }).href;
const flags = Object.freeze({ allRootsObserved: false, transitiveClosureComplete: false, custodyHeld: false,
  runtimeDependencyIdentity: false, executionAuthorized: false });
function text(value) { check(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value)); }
function filePin(value, maximum, role = false) {
  shape(value, ['path', 'sizeBytes', 'sha256', ...(role ? ['role'] : [])]); absolute(value.path); hash(value.sha256);
  check(Number.isSafeInteger(value.sizeBytes) && value.sizeBytes > 0 && value.sizeBytes <= maximum);
}
function unique(values, key) {
  const seen = new Set();
  for (const value of values) { const name = key(value).toLowerCase(); check(!seen.has(name)); seen.add(name); }
}
function roots(value) {
  list(value, 16, 1); value.forEach(absolute); unique(value, root => root);
  for (let i = 0; i < value.length; i++) for (let j = i+1; j < value.length; j++) {
    check(!inside(value[i].toLowerCase(), value[j].toLowerCase()) && !inside(value[j].toLowerCase(), value[i].toLowerCase()));
  }
}
function identity(value) {
  shape(value, ['candidateId', 'evidenceClass', 'reviewRef', 'sourceRevision', 'harnessEntry', 'harnessFiles']);
  uuid(value.candidateId); text(value.reviewRef); hash(value.sourceRevision, 40);
  check(['synthetic-fixture', 'declared-installed-candidate'].includes(value.evidenceClass));
  absolute(value.harnessEntry); list(value.harnessFiles, 64, 1);
  value.harnessFiles.forEach(file => { filePin(file, MiB); check(/\.mjs$/.test(file.path)); });
  unique(value.harnessFiles, file => file.path);
  check(value.harnessFiles.some(file => file.path === value.harnessEntry));
}
function runtime(value, harnessEntry) {
  shape(value, ['executable', 'version', 'platform', 'arch', 'argv', 'environmentPolicy']);
  filePin(value.executable, 128 * MiB); check(path.win32.basename(value.executable.path) === 'node.exe');
  check(value.version === '24.22.0' && value.platform === 'win32' && value.arch === 'arm64');
  same(value.argv, ['--experimental-import-meta-resolve', harnessEntry]);
  check(value.environmentPolicy === 'clean-windows-arm64-utc-v1');
}
function policy(value) {
  shape(value, ['profile', 'additionalConditions', 'deadlineMs', 'metadataBatchSize']);
  check(value.profile === 'native-default-esm-v1'); same(value.additionalConditions, []);
  check(Number.isSafeInteger(value.deadlineMs) && value.deadlineMs > 0 && value.deadlineMs <= 60000);
  check(Number.isSafeInteger(value.metadataBatchSize) && value.metadataBatchSize > 0 && value.metadataBatchSize <= 1024);
}
function members(value, graph, root) {
  list(value, 256, 3); check(value.length === graph.members.length); unique(value, member => member.stagePath);
  const byPath = new Map(graph.members.map(member => [member.stagePath, member]));
  for (const member of value) {
    shape(member, ['stagePath', 'parentUrl', 'source', 'output', 'format', 'role']);
    const declared = byPath.get(member.stagePath); check(declared);
    const outputPath = relative(root, member.stagePath);
    check(member.parentUrl === url(outputPath)); same(member.source, declared.source);
    same(member.output, { path: outputPath, ...declared.output }); check(member.format === declared.format);
    const role = member.stagePath === graph.graph.application.stagePath ? 'application'
      : member.stagePath === graph.graph.trustedGraph.roots[0].stagePath ? 'getter'
      : member.stagePath === graph.graph.trustedGraph.roots[1].stagePath ? 'bootstrap' : 'trusted-dependency';
    check(member.role === role);
  }
}
function files(value, dependencyRoots, scopeRoots) {
  list(value, 512); unique(value, file => file.path);
  for (const file of value) {
    filePin(file, file.role === 'target' ? 32 * MiB : MiB, true);
    check(['target', 'manifest', 'project-manifest', 'lock'].includes(file.role));
    check(admitted(file.role === 'target' ? dependencyRoots : [...dependencyRoots, ...scopeRoots], file.path));
    if (file.role !== 'target') check(path.win32.basename(file.path) === (file.role === 'lock' ? 'package-lock.json' : 'package.json'));
  }
  return new Map(value.map(file => [file.path, file]));
}
function edgeKey(edge) { return stable([edge.parent, edge.kind, edge.specifier, edge.typeOnly === true]); }
function edges(value, graph, fileMap, dependencyRoots) {
  list(value, 4096); check(value.length === graph.edges.length);
  const declared = new Map(graph.edges.map(edge => [edgeKey(edge), edge]));
  const seen = new Set(), used = new Set(), blockers = [];
  for (const edge of value) {
    shape(edge, ['parent', 'kind', 'specifier', 'typeOnly', 'mode', 'occurrences', 'classification', 'target']);
    check(typeof edge.typeOnly === 'boolean'); const key = edgeKey(edge);
    const original = declared.get(key); check(original && !seen.has(key)); seen.add(key);
    for (const property of ['parent', 'kind', 'specifier', 'mode', 'occurrences', 'classification']) same(edge[property], original[property]);
    check(edge.typeOnly === (original.typeOnly === true));
    const target = edge.target;
    if (original.classification === 'internal') same(target, { kind: 'internal', stagePath: original.target });
    else if (original.classification === 'builtin') same(target, { kind: 'builtin', name: original.normalizedSpecifier });
    else if (original.classification === 'type-only') same(target, { kind: 'excluded', reason: 'type-only' });
    else if (original.classification === 'unsupported') {
      same(target, { kind: 'unsupported', reason: original.reason });
      blockers.push({ parent: edge.parent, kind: edge.kind, specifier: edge.specifier, reason: original.reason });
    } else {
      check(original.classification === 'package');
      if (target?.kind === 'unobserved') same(target, { kind: 'unobserved' });
      else if (target?.kind === 'blocked') {
        shape(target, ['kind', 'reason']);
        check(['PACKAGE_NOT_FOUND', 'PACKAGE_PATH_NOT_EXPORTED', 'UNSUPPORTED_LOOKUP_FOOTPRINT'].includes(target.reason));
        blockers.push({ parent: edge.parent, kind: edge.kind, specifier: edge.specifier, reason: target.reason });
      }
      else {
        shape(target, ['kind', 'path', 'format', 'packageManifest', 'scopeManifest']); check(target.kind === 'candidate-file');
        const file = fileMap.get(target.path), manifest = fileMap.get(target.packageManifest);
        check(file && (file.role === 'target' || file.role === 'manifest' && target.format === 'json') && manifest?.role === 'manifest');
        check(admitted(dependencyRoots, file.path));
        check(inside(path.win32.dirname(manifest.path), file.path));
        const extension = path.win32.extname(file.path);
        if (extension === '.js') check(target.format === 'esm' || target.format === 'commonjs');
        else check(target.format === ({ '.mjs': 'esm', '.cjs': 'commonjs', '.json': 'json', '.node': 'native' }[extension] ?? 'unsupported'));
        if (['native', 'json', 'unsupported'].includes(target.format)) {
          blockers.push({ parent: edge.parent, kind: edge.kind, specifier: edge.specifier, reason: 'UNSUPPORTED_SELECTED_FORMAT' });
        }
        if (target.scopeManifest !== null) {
          const scope = fileMap.get(target.scopeManifest); check(scope && ['manifest', 'project-manifest'].includes(scope.role));
          check(inside(path.win32.dirname(scope.path), file.path)); used.add(scope.path);
        } else check(extension !== '.js');
        const declaredScopes = [...fileMap.values()].filter(candidate => ['manifest', 'project-manifest'].includes(candidate.role)
          && inside(path.win32.dirname(candidate.path), file.path)).sort((a, b) => b.path.length - a.path.length);
        check(target.scopeManifest === declaredScopes[0]?.path);
        used.add(file.path); used.add(manifest.path);
      }
      blockers.push({ parent: edge.parent, kind: edge.kind, specifier: edge.specifier, reason: 'RESOLUTION_UNOBSERVED' });
    }
  }
  for (const file of fileMap.values()) check(used.has(file.path) || ['project-manifest', 'lock'].includes(file.role));
  return blockers;
}
function lookup(value, approvedRoots, pinnedFiles) {
  shape(value, ['directories', 'absent', 'footprint']); check(value.footprint === 'unobserved');
  list(value.directories, 4096); list(value.absent, 4096);
  check(value.directories.length + value.absent.length <= 4096);
  unique([...value.directories, ...value.absent], row => row.path);
  const directories = new Map(); let entries = 0;
  for (const directory of value.directories) {
    shape(directory, ['path', 'identity', 'entries']); absolute(directory.path); check(admitted(approvedRoots, directory.path));
    shape(directory.identity, ['dev', 'ino', 'birthtimeNs', 'attributes']);
    for (const key of ['dev', 'ino', 'birthtimeNs']) check(typeof directory.identity[key] === 'string' && /^(?:0|[1-9][0-9]{0,29})$/.test(directory.identity[key]));
    check(BigInt(directory.identity.ino) > 0n);
    check(Number.isInteger(directory.identity.attributes) && directory.identity.attributes >= 0 && directory.identity.attributes <= 0xffffffff && (directory.identity.attributes & 0x400) === 0 && (directory.identity.attributes & 16) !== 0);
    list(directory.entries, 4096); check((entries += directory.entries.length) <= 4096);
    unique(directory.entries, entry => entry.name);
    for (const entry of directory.entries) {
      shape(entry, ['name', 'kind']); check(typeof entry.name === 'string' && !entry.name.includes('/'));
      applicationEntryPath(directory.path, entry.name); check(['file', 'directory'].includes(entry.kind));
    }
    directories.set(directory.path, directory);
  }
  for (const absent of value.absent) {
    shape(absent, ['path', 'parent']); absolute(absent.path); absolute(absent.parent);
    check(path.win32.dirname(absent.path) === absent.parent && admitted(approvedRoots, absent.path));
    const parent = directories.get(absent.parent); check(parent);
    check(!parent.entries.some(entry => entry.name.toLowerCase() === path.win32.basename(absent.path).toLowerCase()));
  }
  const present = new Map();
  const add = (file, kind) => {
    const key = file.toLowerCase(), previous = present.get(key);
    if (previous) check(previous.path === file && previous.kind === kind);
    else present.set(key, { path: file, kind });
  };
  pinnedFiles.forEach(file => add(file.path, 'file'));
  for (const directory of value.directories) {
    add(directory.path, 'directory');
    directory.entries.forEach(entry => add(applicationEntryPath(directory.path, entry.name), entry.kind));
  }
  check(present.size + value.absent.length <= 4096);
  for (const absent of value.absent) for (const node of present.values()) {
    check(node.path.toLowerCase() !== absent.path.toLowerCase() && !inside(absent.path.toLowerCase(), node.path.toLowerCase()));
  }
  const listings = new Map(value.directories.map(directory => [directory.path.toLowerCase(), directory]));
  for (const node of present.values()) {
    let ancestor = path.win32.dirname(node.path);
    while (ancestor !== path.win32.dirname(ancestor)) {
      check(present.get(ancestor.toLowerCase())?.kind !== 'file');
      const directory = listings.get(ancestor.toLowerCase());
      if (directory) {
        const segments = node.path.slice(directory.path.length+1).split('\\');
        const entry = directory.entries.find(entry => entry.name.toLowerCase() === segments[0].toLowerCase());
        check(entry && entry.name === segments[0] && entry.kind === (segments.length > 1 ? 'directory' : node.kind));
        check(node.path.startsWith(directory.path+'\\'));
      }
      ancestor = path.win32.dirname(ancestor);
    }
  }
}
function selectedPins(document) {
  return [...document.identity.harnessFiles, document.runtime.executable, ...document.members.map(member => member.output),
    { path: relative(document.graph.emissionRoot, document.graph.relativePath), sizeBytes: document.graph.rawSize, sha256: document.graph.rawSha256 },
    ...document.files];
}
function totalFiles(document) {
  const pins = selectedPins(document);
  const seen = new Map(); let total = 0;
  for (const pin of pins) {
    const key = pin.path.toLowerCase(), previous = seen.get(key);
    if (previous) same({ path: pin.path, sizeBytes: pin.sizeBytes, sha256: pin.sha256 }, previous);
    else { seen.set(key, { path: pin.path, sizeBytes: pin.sizeBytes, sha256: pin.sha256 }); total += pin.sizeBytes; }
  }
  check(total <= 256 * MiB);
  for (const file of [...document.identity.harnessFiles, document.runtime.executable]) {
    check(!admitted([document.graph.emissionRoot, ...document.dependencyRoots].map(root => root.toLowerCase()), file.path.toLowerCase()));
  }
}

/** Structural declaration acceptance only. Independently supplied pins are not authenticated here. */
export function readApplicationRootInventory(graphText, inventoryText, pinText) {
  try {
    const pins = parse(pinText, 128 * 1024);
    shape(pins, ['inventorySha256', 'identity', 'graph', 'runtime', 'resolutionPolicy', 'dependencyRoots', 'scopeRoots']); hash(pins.inventorySha256);
    check(typeof inventoryText === 'string' && Buffer.byteLength(inventoryText, 'utf8') <= 2 * MiB && digest(inventoryText) === pins.inventorySha256);
    const document = parse(inventoryText, 2 * MiB);
    shape(document, ['kind', 'version', 'identity', 'graph', 'runtime', 'resolutionPolicy', 'dependencyRoots', 'scopeRoots', 'members', 'edges', 'files', 'lookup', 'certifications', 'limitations']);
    check(document.kind === 'pfa-application-root-inventory' && document.version === 1);
    for (const key of ['identity', 'graph', 'runtime', 'resolutionPolicy', 'dependencyRoots', 'scopeRoots']) same(document[key], pins[key]);
    identity(document.identity); runtime(document.runtime, document.identity.harnessEntry); policy(document.resolutionPolicy);
    roots(document.dependencyRoots); roots(document.scopeRoots);
    shape(document.graph, ['rawSha256', 'rawSize', 'graphSha256', 'schemaVersion', 'emissionRoot', 'relativePath']);
    check(document.graph.schemaVersion === 1 && document.graph.relativePath === '.runtime/production-profile.json');
    absolute(document.graph.emissionRoot);
    const graph = readApplicationGraphDeclaration(graphText, json({ rawSha256: document.graph.rawSha256, rawSize: document.graph.rawSize, graphSha256: document.graph.graphSha256 }));
    same(document.limitations, graph.limitations); same(document.certifications, flags);
    members(document.members, graph, document.graph.emissionRoot);
    const fileMap = files(document.files, document.dependencyRoots, document.scopeRoots);
    const blockers = edges(document.edges, graph, fileMap, document.dependencyRoots);
    lookup(document.lookup, [...document.dependencyRoots, ...document.scopeRoots, document.graph.emissionRoot], selectedPins(document));
    blockers.push({ parent: null, kind: null, specifier: null, reason: 'LOOKUP_FOOTPRINT_UNOBSERVED' }); check(blockers.length <= 128);
    totalFiles(document);
    const payload = freeze({ document, graph, blockers, certifications: { ...flags }, inventorySha256: pins.inventorySha256 });
    const record = freeze({ kind: 'validated-application-root-inventory', inventorySha256: pins.inventorySha256, certifications: { ...flags } });
    records.set(record, payload); return record;
  } catch { refuse(); }
}

export function requireApplicationRootInventory(record) {
  const payload = records.get(record);
  if (!payload) refuse();
  return payload;
}
