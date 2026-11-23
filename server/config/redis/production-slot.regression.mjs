import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const resolved = [];
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (['ioredis', 'rate-limit-redis', 'express-rate-limit'].includes(specifier)) resolved.push(specifier);
  return next(specifier, context);
} });
const getter = await import('./production-slot.mjs');
const installer = await import('./production-slot-bootstrap.mjs');
hooks.deregister();

test('cold ordinary getter exports only a read path and imports no client/store package', () => {
  assert.deepEqual(Object.keys(getter), ['getProductionRedis']);
  assert.deepEqual(Object.keys(installer), ['installProductionRedis']);
  assert.deepEqual(resolved, []); assert.equal(getter.getProductionRedis(), null);
});
test('public JSON cannot install and failed installation cannot fall back to ordinary mode', () => {
  assert.throws(() => installer.installProductionRedis({ verified: true }), /REDIS_SLOT_REFUSED/);
  assert.throws(getter.getProductionRedis, /REDIS_SLOT_REFUSED/);
  assert.throws(() => installer.installProductionRedis({}), /REDIS_SLOT_REFUSED/);
  assert.throws(getter.getProductionRedis, /REDIS_SLOT_REFUSED/);
});

// No fake issuer is provided. Genuine successful install/revoke/reinstall and
// emitted parent-edge enforcement remain actual producer/build acceptance work.
