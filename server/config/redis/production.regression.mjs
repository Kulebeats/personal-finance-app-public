import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Socket } from 'node:net';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readProductionManifest, canonicalJson, digest } from '../../testing/production/manifest.mjs';
import { manifestFixture, approvedFixturePins } from '../../testing/production/manifest.fixture.mjs';
import { createRedisCredentials, withRedisProvisioningSecret } from '../../testing/production/redis-credentials.mjs';

const packages = [];
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (['ioredis', 'rate-limit-redis', 'express-rate-limit'].includes(specifier)) packages.push(specifier);
  return next(specifier, context);
} });
const factory = await import('./production.mjs'); hooks.deregister();

let attemptedSockets = 0;
const originalConnect = Socket.prototype.connect;
Socket.prototype.connect = function () { attemptedSockets++; throw new Error('UNIT_SOCKET_CREATION_DENIED'); };
after(() => { Socket.prototype.connect = originalConnect; });

function declaration() {
  const document = manifestFixture(); document.redis.credentialGeneration = randomUUID();
  const pins = { ...approvedFixturePins, expectedManifestSha256: digest(canonicalJson(document)),
    expectedServicesSha256: digest(canonicalJson({ endpoints: document.endpoints, postgres: document.postgres, redis: document.redis })) };
  return readProductionManifest(canonicalJson(document), pins);
}

test('cold factory guard import resolves no driver/store package and constructs no socket', () => {
  assert.deepEqual(packages, []); assert.equal(attemptedSockets, 0);
  assert.deepEqual(Object.keys(factory).sort(), ['admitProductionRedis', 'onProductionRedisRevoked', 'requireProductionRedis']);
});

test('public receipts and proxies cannot replace the private admission brand', () => {
  for (const value of [null, {}, { kind: 'admitted-production-redis', verified: true }, new Proxy({}, {})]) {
    assert.throws(() => factory.requireProductionRedis(value), /REDIS_ADMISSION_REFUSED:CAPABILITY/);
    assert.throws(() => factory.onProductionRedisRevoked(value, () => {}), /REDIS_ADMISSION_REFUSED:CAPABILITY/);
  }
  assert.equal(attemptedSockets, 0);
});

test('closed factory input refuses overrides, proxies and accessors before callback or network work', async () => {
  let getterCalls = 0;
  const base = { manifest: {}, service: {}, credentials: {}, signal: new AbortController().signal };
  const accessor = { ...base }; Object.defineProperty(accessor, 'manifest', { get() { getterCalls++; return {}; }, enumerable: true });
  for (const input of [null, [], {}, { ...base, client: {} }, { ...base, url: 'redis://foreign' }, new Proxy(base, {}), accessor, { ...base, signal: { aborted: false } }]) {
    await assert.rejects(factory.admitProductionRedis(input), /REDIS_ADMISSION_REFUSED:/);
  }
  assert.equal(getterCalls, 0); assert.equal(attemptedSockets, 0);
});

test('an already aborted signal refuses before manifest/credential/service resolution', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(factory.admitProductionRedis({ manifest: {}, service: {}, credentials: {}, signal: controller.signal }), error => {
    assert.equal(error.message, 'REDIS_ADMISSION_REFUSED:SIGNAL');
    assert.deepEqual(error.admissionDiagnostic, { phase: 'INPUT_GUARD', reason: 'SIGNAL_REFUSED' }); return true;
  });
  assert.equal(attemptedSockets, 0);
});

test('only the genuine production manifest reaches credential admission', async () => {
  const manifest = declaration();
  for (const value of [manifest.document, structuredClone(manifest), new Proxy(manifest, {})]) {
    await assert.rejects(factory.admitProductionRedis({ manifest: value, service: {}, credentials: {}, signal: new AbortController().signal }), error => {
      assert.equal(error.message, 'REDIS_ADMISSION_REFUSED:MANIFEST');
      assert.deepEqual(error.admissionDiagnostic, { phase: 'MANIFEST_GUARD', reason: 'MANIFEST_REFUSED' }); return true;
    });
  }
  assert.equal(attemptedSockets, 0);
});

test('unbound genuine credentials and public service facts refuse without a local producer or socket', async () => {
  const manifest = declaration(), issued = createRedisCredentials(manifest);
  let protectedCallbacks = 0;
  const input = { manifest, service: { kind: 'owned-redis-service', ...manifest.document.redis, verified: true }, credentials: issued.capability, signal: new AbortController().signal };
  await assert.rejects(factory.admitProductionRedis(input).then(() => { protectedCallbacks++; }), error => {
    assert.equal(error.message, 'REDIS_ADMISSION_REFUSED:START');
    assert.equal(error.cleanupReceipt.closed, true); assert.equal(error.cleanupReceipt.notOpened, true);
    assert.deepEqual(error.admissionDiagnostic, { phase: 'CREDENTIAL_GUARD', reason: 'CREDENTIAL_REFUSED' });
    assert.equal(error.cause, undefined); assert.equal(error.stack.includes('ERR_MODULE_NOT_FOUND'), false); return true;
  });
  assert.equal(protectedCallbacks, 0); assert.equal(attemptedSockets, 0);
  // A failed connection admission does not revoke this independently owned run credential.
  await withRedisProvisioningSecret(issued.capability, async secret => { assert.equal(typeof secret, 'string'); });
  issued.owner.revoke();
});
