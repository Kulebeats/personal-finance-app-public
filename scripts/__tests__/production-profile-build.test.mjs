import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildProductionProfile } from '../build-production-profile.mjs';

const ENTRY = 'server/index.ts';
const GETTER = 'server/config/redis/production-slot.mjs';
const BOOTSTRAP = 'server/config/redis/production-slot-bootstrap.mjs';
const TRUSTED_ENTRIES = [GETTER, BOOTSTRAP];
const AUTHORITY = ['server/config/redis/production.mjs', 'server/config/redis/production-slot-state.mjs'];
const DECLARED = [
  GETTER,
  BOOTSTRAP,
  'server/config/redis/production-slot-state.mjs',
  'server/config/redis/production.mjs',
  'server/modules/health/redis-readiness.ts',
];

async function fixture(t, { applicationSource, productionSource, tsconfigSource, extras = {} } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'r20-production-profile-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sources = {
    [ENTRY]: applicationSource ?? `import { getProductionRedis } from './config/redis/production-slot.mjs';\nexport const read = getProductionRedis;\n`,
    [GETTER]: `export { readInstalledProductionRedis as getProductionRedis } from './production-slot-state.mjs';\n`,
    [BOOTSTRAP]: `export { installInPrivateProductionRedisCell as installProductionRedis } from './production-slot-state.mjs';\n`,
    'server/config/redis/production-slot-state.mjs': `import { requireProductionRedis } from './production.mjs';\nconst privateCell = new WeakMap();\nexport function readInstalledProductionRedis() { return privateCell.get(requireProductionRedis); }\nexport function installInPrivateProductionRedisCell(value) { privateCell.set(requireProductionRedis, value); }\n`,
    'server/config/redis/production.mjs': productionSource ?? `import { createRedisReadinessProbe } from '../../modules/health/redis-readiness.ts';\nconst admissions = new WeakMap();\nexport function requireProductionRedis(value) { return admissions.get(value); }\nexport function readinessFactory() { return createRedisReadinessProbe; }\n`,
    'server/modules/health/redis-readiness.ts': `import type { ReadinessProbe } from '../../core/readiness';\nexport function createRedisReadinessProbe(): ReadinessProbe { return async () => {}; }\n`,
    'server/core/readiness.ts': `export type ReadinessProbe = (signal: AbortSignal) => Promise<void>;\n`,
    'tsconfig.json': tsconfigSource ?? JSON.stringify({ compilerOptions: { moduleResolution: 'Bundler', baseUrl: '.' } }),
    ...extras,
  };
  for (const [relative, source] of Object.entries(sources)) {
    const target = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, source, 'utf8');
  }
  return root;
}

function build(root, options = {}) {
  return buildProductionProfile({
    projectRoot: root,
    applicationEntry: ENTRY,
    publicGetterSource: GETTER,
    trustedEntries: TRUSTED_ENTRIES,
    authorityModules: AUTHORITY,
    declaredTrustedMembers: DECLARED,
    ...options,
  });
}

test('compiles a bundled application and a path-preserving trusted closure in memory', async t => {
  const root = await fixture(t);
  const result = await build(root);
  const manifest = result.manifest;
  assert.equal(manifest.application.stagePath, 'dist/production-application.js');
  assert.equal(manifest.application.format, 'esm');
  assert.equal(manifest.application.imports.filter(edge => edge.target === '.runtime/trusted/server/config/redis/production-slot.mjs').length, 1);
  const application = Buffer.from(result.outputs.get('dist/production-application.js')).toString('utf8');
  assert.match(application, /\.\.\/\.runtime\/trusted\/server\/config\/redis\/production-slot\.mjs/);
  const getterPath = '.runtime/trusted/server/config/redis/production-slot.mjs';
  const getter = Buffer.from(result.outputs.get(getterPath)).toString('utf8');
  assert.match(getter, /from ["']\.\/production-slot-state\.mjs["']/);
  const getterMember = manifest.trustedGraph.members.find(member => member.stagePath === getterPath);
  assert.deepEqual(getterMember.imports.map(({ specifier, target, kind }) => ({ specifier, target, kind })), [{
    specifier: './production-slot-state.mjs',
    target: '.runtime/trusted/server/config/redis/production-slot-state.mjs',
    kind: 'export',
  }]);
  const statePath = '.runtime/trusted/server/config/redis/production-slot-state.mjs';
  const stateMember = manifest.trustedGraph.members.find(member => member.stagePath === statePath);
  assert.equal(stateMember.imports.some(edge => edge.specifier === './production.mjs' && edge.target === '.runtime/trusted/server/config/redis/production.mjs' && edge.kind === 'import'), true);
  const stateOutput = Buffer.from(result.outputs.get(statePath)).toString('utf8');
  assert.match(stateOutput, /from ["']\.\/production\.mjs["']/);
  assert.equal(manifest.trustedGraph.members.some(member => member.stagePath === '.runtime/trusted/server/modules/health/redis-readiness.mjs'), true);
  const production = manifest.trustedGraph.members.find(member => member.source.path === 'server/config/redis/production.mjs');
  assert.equal(production.imports.some(edge => edge.specifier === '../../modules/health/redis-readiness.mjs' && edge.target === '.runtime/trusted/server/modules/health/redis-readiness.mjs'), true);
  const productionOutput = Buffer.from(result.outputs.get(production.stagePath)).toString('utf8');
  assert.match(productionOutput, /from ["']\.\.\/\.\.\/modules\/health\/redis-readiness\.mjs["']/);
  const readiness = Buffer.from(result.outputs.get('.runtime/trusted/server/modules/health/redis-readiness.mjs')).toString('utf8');
  assert.match(readiness, /createRedisReadinessProbe/);
  assert.match(manifest.application.output.sha256, /^[a-f0-9]{64}$/);
  assert.ok(manifest.application.output.sizeBytes > 0);
  assert.equal(manifest.provenance.trustedModulesBundled, false);
  assert.match(manifest.graphSha256, /^[a-f0-9]{64}$/);
});

test('records rewritten static and literal dynamic TypeScript-to-MJS edges exactly as emitted', async t => {
  const readinessPath = 'server/modules/health/redis-readiness.ts';
  const readinessSource = `import type { ReadinessProbe } from '../../core/readiness';
import { redisKeyPrefix } from '../../config/redis/keys.mjs';
export function createRedisReadinessProbe(): ReadinessProbe {
  return async () => { void redisKeyPrefix; await import('../../config/redis/rate-limit-protocol.mjs'); };
}
`;
  const root = await fixture(t, {
    extras: {
      [readinessPath]: readinessSource,
      'server/config/redis/keys.mjs': `export const redisKeyPrefix = 'redis:';\n`,
      'server/config/redis/rate-limit-protocol.mjs': `export const rateLimitProtocol = true;\n`,
    },
  });
  const declaredTrustedMembers = [...DECLARED, 'server/config/redis/keys.mjs', 'server/config/redis/rate-limit-protocol.mjs'];
  const result = await build(root, { declaredTrustedMembers });
  const readinessStage = '.runtime/trusted/server/modules/health/redis-readiness.mjs';
  const readinessMember = result.manifest.trustedGraph.members.find(member => member.stagePath === readinessStage);
  const staticEdge = readinessMember.imports.find(edge => edge.kind === 'import');
  const dynamicEdge = readinessMember.imports.find(edge => edge.kind === 'dynamic-import');
  assert.deepEqual(
    { specifier: staticEdge.specifier, target: staticEdge.target },
    { specifier: '../../config/redis/keys.mjs', target: '.runtime/trusted/server/config/redis/keys.mjs' },
  );
  assert.deepEqual(
    { specifier: dynamicEdge.specifier, target: dynamicEdge.target },
    { specifier: '../../config/redis/rate-limit-protocol.mjs', target: '.runtime/trusted/server/config/redis/rate-limit-protocol.mjs' },
  );
  const emitted = Buffer.from(result.outputs.get(readinessStage)).toString('utf8');
  assert.match(emitted, /from ["']\.\.\/\.\.\/config\/redis\/keys\.mjs["']/);
  assert.match(emitted, /import\(["']\.\.\/\.\.\/config\/redis\/rate-limit-protocol\.mjs["']\)/);
});

test('defaults to the deferred production application module, not the self-starting CLI entry', async t => {
  const source = `import './config/redis/production-slot.mjs';\nexport async function startApplication() { return 'deferred-start'; }\n`;
  const root = await fixture(t, {
    extras: {
      'server/production-application.ts': source,
      'server/index-prod.ts': `import 'dotenv/config';\nimport { startApplication } from './production-application';\n(async () => { await startApplication(); })();\nexport { startApplication };\n`,
    },
  });
  const result = await buildProductionProfile({
    projectRoot: root,
    publicGetterSource: GETTER,
    trustedEntries: TRUSTED_ENTRIES,
    authorityModules: AUTHORITY,
    declaredTrustedMembers: DECLARED,
  });
  const emitted = Buffer.from(result.outputs.get('dist/production-application.js')).toString('utf8');
  assert.equal(result.manifest.provenance.applicationEntry, 'server/production-application.ts');
  assert.equal(result.manifest.application.source.path, 'server/production-application.ts');
  assert.match(emitted, /export\s*\{[^}]*\bstartApplication\b[^}]*\}/);
  assert.match(emitted, /deferred-start/);
  assert.doesNotMatch(emitted, /dotenv\/config|index-prod-only|\(async\s*\(\)\s*=>/);
  assert.doesNotMatch(emitted, /(?<!function )\bstartApplication\s*\(\s*\)/);
});

test('rejects a private authority module bundled into the application', async t => {
  const root = await fixture(t, { applicationSource: `import './config/redis/production-slot-state.mjs';\nimport './config/redis/production-slot.mjs';\n` });
  await assert.rejects(build(root), /DUPLICATED_AUTHORITY/);
});

test('pins the default trusted closure and rejects an unreviewed transitive module', async t => {
  const root = await fixture(t, {
    productionSource: `import './unreviewed.mjs';\nexport const ok = true;\n`,
    extras: { 'server/config/redis/unreviewed.mjs': 'export const newAuthority = true;\n' },
  });
  await assert.rejects(buildProductionProfile({
    projectRoot: root,
    applicationEntry: ENTRY,
    publicGetterSource: GETTER,
    trustedEntries: TRUSTED_ENTRIES,
    authorityModules: AUTHORITY,
  }), /UNDECLARED_TRUSTED_MEMBER: discovered=\[server\/config\/redis\/unreviewed\.mjs\]/);
});

test('bundles literal internal application imports without generating shared chunks', async t => {
  const root = await fixture(t, {
    applicationSource: `import './config/redis/production-slot.mjs';\nvoid import('./worker.ts');\n`,
    extras: { 'server/worker.ts': 'export const worker = true;\n' },
  });
  const result = await build(root);
  assert.equal(result.manifest.application.imports.some(edge => edge.specifier.includes('worker')), false);
  assert.equal(result.manifest.application.inputs.some(input => input.path === 'server/worker.ts'), true);
  assert.equal([...result.outputs.keys()].filter(name => name.startsWith('dist/')).length, 1);
});

test('rejects nonliteral application dynamic imports', async t => {
  const root = await fixture(t, {
    applicationSource: `import './config/redis/production-slot.mjs';\nconst leaf = './worker.mjs';\nvoid import(leaf);\n`,
  });
  await assert.rejects(build(root), /NONLITERAL_DYNAMIC_IMPORT/);
});

test('rejects colliding source-to-stage mappings', async t => {
  const root = await fixture(t, {
    productionSource: `import './private-state.ts';\nimport './private-state.mjs';\nexport const ok = true;\n`,
    extras: {
      'server/config/redis/private-state.ts': 'export const fromTypeScript = true;\n',
      'server/config/redis/private-state.mjs': 'export const fromJavaScript = true;\n',
    },
  });
  await assert.rejects(build(root, { declaredTrustedMembers: [...DECLARED, 'server/config/redis/private-state.ts', 'server/config/redis/private-state.mjs'] }), /OUTPUT_PATH_COLLISION/);
});

test('rejects ambiguous extensionless trusted imports', async t => {
  const root = await fixture(t, {
    productionSource: `import './ambiguous';\nexport const ok = true;\n`,
    extras: {
      'server/config/redis/ambiguous.ts': 'export const fromTypeScript = true;\n',
      'server/config/redis/ambiguous.mjs': 'export const fromJavaScript = true;\n',
    },
  });
  await assert.rejects(build(root, { declaredTrustedMembers: [...DECLARED, 'server/config/redis/ambiguous.ts', 'server/config/redis/ambiguous.mjs'] }), /AMBIGUOUS_INTERNAL_IMPORT/);
});

test('rejects nonliteral internal dynamic imports in trusted modules', async t => {
  const root = await fixture(t, { productionSource: `const leaf = './leaf.mjs';\nawait import(leaf);\nexport const ok = true;\n` });
  await assert.rejects(build(root), /NONLITERAL_DYNAMIC_IMPORT/);
});

test('rejects unresolved internal imports instead of emitting a dangling graph edge', async t => {
  const root = await fixture(t, { productionSource: `import './missing.mjs';\nexport const ok = true;\n` });
  await assert.rejects(build(root), /UNRESOLVED_INTERNAL_IMPORT/);
});

test('rejects discovered trusted members omitted from the declared graph', async t => {
  const root = await fixture(t);
  await assert.rejects(build(root, { declaredTrustedMembers: [GETTER, BOOTSTRAP, 'server/config/redis/production-slot-state.mjs', 'server/config/redis/production.mjs'] }), /UNDECLARED_TRUSTED_MEMBER/);
});

test('fails closed on malformed TypeScript configuration', async t => {
  const root = await fixture(t, { tsconfigSource: '{ "compilerOptions": {' });
  await assert.rejects(build(root), /PRODUCTION_PROFILE_TSCONFIG_(?:READ_FAILED|INVALID)/);
});

test('fails closed when TypeScript configuration cannot be read', async t => {
  const root = await fixture(t);
  await rm(path.join(root, 'tsconfig.json'));
  await mkdir(path.join(root, 'tsconfig.json'));
  await assert.rejects(build(root), /PRODUCTION_PROFILE_TSCONFIG_READ_FAILED/);
});

test('binds application source pins to the exact bytes passed to esbuild', async t => {
  const original = `import './config/redis/production-slot.mjs';\nexport const snapshotValue = 'captured';\n`;
  const root = await fixture(t, { applicationSource: original });
  let mutated = false;
  const result = await build(root, {
    onApplicationInputSnapshot: async snapshot => {
      if (!mutated && snapshot.path === ENTRY) {
        mutated = true;
        await writeFile(path.join(root, ENTRY), original.replace('captured', 'changed-after-snapshot'), 'utf8');
      }
    },
  });
  assert.equal(mutated, true);
  assert.equal(result.manifest.application.source.sha256, createHash('sha256').update(original).digest('hex'));
  const application = Buffer.from(result.outputs.get('dist/production-application.js')).toString('utf8');
  assert.match(application, /captured/);
  assert.doesNotMatch(application, /changed-after-snapshot/);
});

test('treats configured path aliases as internal and rejects a missing alias target', async t => {
  const root = await fixture(t, {
    tsconfigSource: JSON.stringify({ compilerOptions: { moduleResolution: 'Bundler', baseUrl: '.', paths: { '@trusted/*': ['server/config/redis/*'] } } }),
    productionSource: `import '@trusted/missing.mjs';\nexport const ok = true;\n`,
  });
  await assert.rejects(build(root), /UNRESOLVED_INTERNAL_IMPORT/);
});

test('emits deterministic source and output pins without evaluating application code', async t => {
  const root = await fixture(t);
  const first = await build(root);
  const second = await build(root);
  assert.equal(first.manifest.graphSha256, second.manifest.graphSha256);
  assert.deepEqual([...first.outputs.keys()].sort(), [...second.outputs.keys()].sort());
  for (const [name, bytes] of first.outputs) assert.deepEqual(bytes, second.outputs.get(name));
});

