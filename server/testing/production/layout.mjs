import { check, shape, absolute, within, disjoint, relative, integer, hash } from './primitives.mjs';

export function validatePaths(paths) {
  const mutable = ['browserProfileRoot', 'pgdataRoot', 'publicTlsRoot', 'privateRoot']; const immutable = ['buildRoot', 'browserRuntimeRoot'];
  shape(paths, ['runRoot', ...immutable, ...mutable]); Object.values(paths).forEach(absolute);
  for (const key of mutable) check(within(paths.runRoot, paths[key]));
  const roots = [...immutable, ...mutable];
  roots.forEach((key, index) => roots.slice(index + 1).forEach((other) => disjoint(paths[key], paths[other])));
  for (const key of immutable) { if (!within(paths.runRoot, paths[key])) disjoint(paths.runRoot, paths[key]); }
}
export function filePin(value, root, maximum) {
  shape(value, ['path', 'size', 'sha256']); absolute(value.path); check(within(root, value.path)); integer(value.size, maximum); hash(value.sha256);
}
export function validateBuild(build, paths) {
  shape(build, ['commitSha', 'nodeVersion', 'nodePlatform', 'nodeArch', 'artifacts']); hash(build.commitSha, 40);
  check(build.nodeVersion === '24.22.0' && build.nodePlatform === 'win32' && build.nodeArch === 'arm64');
  check(Array.isArray(build.artifacts) && build.artifacts.length >= 2 && build.artifacts.length <= 512);
  let server = 0, index = 0, total = 0, previous = ''; const seen = new Set();
  for (const entry of build.artifacts) {
    shape(entry, ['role', 'relativePath', 'size', 'sha256']); relative(paths.buildRoot, entry.relativePath);
    check(entry.relativePath > previous && !seen.has(entry.relativePath.toLowerCase())); previous = entry.relativePath; seen.add(previous.toLowerCase());
    integer(entry.size, 100 * 1024 * 1024); hash(entry.sha256); total += entry.size;
    if (entry.role === 'server-entry') { check(entry.relativePath === 'index.js'); server++; }
    else if (entry.role === 'client-index') { check(entry.relativePath === 'public/index.html'); index++; }
    else { check(entry.role === 'client-asset' && entry.relativePath.startsWith('public/') && entry.relativePath !== 'public/index.html'); }
  }
  check(server === 1 && index === 1 && total <= 500 * 1024 * 1024);
}
