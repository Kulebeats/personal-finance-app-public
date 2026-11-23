import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplyError } from 'ioredis';
import { createProductionRedisOperations } from './production-operations.mjs';
import { RATE_LIMIT_SCRIPTS } from './rate-limit-protocol.mjs';

const prefix = 'pfa:production:r20operationtest:';
function fixture(dispatch = async () => null) {
  let current = true; const commands = [];
  const binding = { assertCurrent() { if (!current) throw new Error('revoked'); }, revoke() { current = false; },
    runOperation: async action => action(),
    async execute(command) { commands.push(command); return dispatch(command); } };
  return { app: createProductionRedisOperations(binding, prefix), commands, revoke: binding.revoke, isCurrent: () => current };
}

test('pure operation view is frozen and cannot expose raw command/client/authority hooks', () => {
  const f = fixture();
  assert.deepEqual(Object.keys(f.app).sort(), ['analytics', 'assertCurrent', 'cache', 'quota', 'readiness']);
  for (const value of [f.app, f.app.cache, f.app.analytics, f.app.quota, f.app.readiness]) assert.equal(Object.isFrozen(value), true);
  assert.equal(f.app.admission, undefined); assert.equal(f.app.execute, undefined); assert.equal(f.app.owner, undefined);
});

test('cache JSON commands prefix once and require exact success/count replies', async () => {
  const values = new Map();
  const f = fixture(async command => {
    const [verb, key] = command;
    if (verb === 'GET') return values.get(key) ?? null;
    if (verb === 'SETEX') { values.set(key, command[3]); return 'OK'; }
    if (verb === 'DEL') return values.delete(key) ? 1 : 0;
  });
  assert.equal(f.app.cache.isEnabled(), true);
  assert.equal(await f.app.cache.setJson('core-cache:report:hh', { total: '1.00' }, 30), true);
  assert.deepEqual(await f.app.cache.getJson('core-cache:report:hh'), { total: '1.00' });
  assert.equal(await f.app.cache.deleteKey('core-cache:report:hh'), true);
  assert.equal(await f.app.cache.deleteKey('core-cache:report:hh'), false);
  assert.equal(await f.app.cache.getJson('core-cache:report:hh'), null);
  assert.equal(f.commands.every(command => command[1].startsWith(prefix + 'core-cache:')), true);
});

test('cache setters cannot modify limiter/marker/readiness/other-run keys and reject invalid TTL/value before dispatch', async () => {
  const f = fixture();
  for (const key of ['rl:auth:user:x', 'health:readiness:x', 'ai:ratelimit:hh', 'pfa:identity:x', prefix + 'core-cache:x', 'core-cache:x*']) {
    await assert.rejects(f.app.cache.setJson(key, 'value', 1));
  }
  for (const ttl of [0, -1, 0.5, 86401, '10']) await assert.rejects(f.app.cache.setJson('core-cache:x', 'value', ttl));
  await assert.rejects(f.app.cache.setJson('core-cache:x', undefined, 1));
  await assert.rejects(f.app.cache.setJson('core-cache:x', 'x'.repeat(1024 * 1024), 1));
  assert.equal(f.commands.length, 0); assert.equal(f.isCurrent(), true);
});

test('cache prefix invalidation awaits confirmed deduplicated physical deletes', async () => {
  let release;
  const a = prefix + 'core-cache:reports:a', b = prefix + 'core-cache:reports:b';
  const f = fixture(command => command[0] === 'SCAN' ? ['0', [a, a, b]] : new Promise(resolve => { release = resolve; }));
  let settled = false;
  const pending = f.app.cache.deleteByPrefix('core-cache:reports:').then(value => { settled = true; return value; });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(f.commands.at(-1), ['DEL', a, b]);
  release(2); assert.equal(await pending, 2);
});

test('out-of-prefix SCAN result refuses before any delete', async () => {
  const f = fixture(async () => ['0', ['pfa:production:foreignrun:core-cache:x']]);
  await assert.rejects(f.app.cache.deleteByPrefix('core-cache:'));
  assert.equal(f.commands.some(command => command[0] === 'DEL'), false); assert.equal(f.isCurrent(), false);
});

test('analytics actual backend shape preserves both layouts while excluding cross-colon overmatch', async () => {
  const legacy = prefix + 'analytics:dashboard:hh:v1:abcdef123456';
  const current = prefix + 'analytics:dashboard:hh:user:v1:abcdef123456';
  const other = prefix + 'analytics:dashboard:other:hh:v1:abcdef123456';
  const f = fixture(async command => command[0] === 'SCAN' ? ['0', [legacy, current, other]] : 2);
  assert.equal(await f.app.analytics.invalidate({ scope: 'household', householdId: 'hh' }), 2);
  assert.deepEqual(f.commands.at(-1), ['DEL', legacy, current]);
});

test('analytics rejects non-layout keys and cache cannot enter its namespace', async () => {
  const f = fixture();
  await assert.rejects(f.app.analytics.getJson('analytics:unknown:hh:v1:abcdef123456'));
  await assert.rejects(f.app.analytics.setJson('core-cache:x', {}, 1));
  await assert.rejects(f.app.cache.getJson('analytics:dashboard:hh:v1:abcdef123456'));
  assert.equal(f.commands.length, 0);
});

test('actual extracted readiness helper uses one expiring SET/readback/DEL1 sequence', async () => {
  let stored;
  const f = fixture(async command => command[0] === 'SET' ? (stored = command[2], 'OK') : command[0] === 'GET' ? stored : 1);
  await f.app.readiness.probe(new AbortController().signal);
  assert.deepEqual(f.commands.map(command => command[0]), ['SET', 'GET', 'DEL']);
  assert.match(f.commands[0][1], new RegExp('^' + prefix + 'health:readiness:'));
  assert.deepEqual(f.commands[0].slice(3), ['PX', '5000']);
  assert.equal(new Set(f.commands.map(command => command[1])).size, 1);
});

for (const [name, value] of [['SETEX failure', null], ['SETEX malformed success', 1]]) {
  test(`${name} rejects and revokes instead of returning optional false`, async () => {
    const f = fixture(async () => value);
    await assert.rejects(f.app.cache.setJson('core-cache:x', {}, 1)); assert.equal(f.isCurrent(), false);
  });
}
test('invalid cached JSON and impossible delete count revoke without fallback', async () => {
  const invalid = fixture(async () => '{bad'); await assert.rejects(invalid.app.cache.getJson('core-cache:x')); assert.equal(invalid.isCurrent(), false);
  const count = fixture(async () => 2); await assert.rejects(count.app.cache.deleteKey('core-cache:x')); assert.equal(count.isCurrent(), false);
});

test('late operation result cannot release success after connection revocation', async () => {
  let release;
  const f = fixture(() => new Promise(resolve => { release = resolve; }));
  const pending = f.app.cache.getJson('core-cache:x'); f.revoke(); release('{"late":true}');
  await assert.rejects(pending); assert.equal(f.isCurrent(), false);
});

test('quota uses only fixed scripts and one definite NOSCRIPT reload', async () => {
  let first = true;
  const f = fixture(async command => {
    if (command[0] === 'SCRIPT') return RATE_LIMIT_SCRIPTS.increment.sha1;
    if (first) { first = false; throw new ReplyError('NOSCRIPT No matching script.'); }
    return [2, 1200];
  });
  assert.deepEqual(await f.app.quota.increment('ai:ratelimit:hh', 60), { count: 2, ttlSeconds: 2 });
  assert.deepEqual(f.commands.map(command => command[0]), ['EVALSHA', 'SCRIPT', 'EVALSHA']);
  assert.deepEqual(f.commands[0], ['EVALSHA', RATE_LIMIT_SCRIPTS.increment.sha1, '1', prefix + 'ai:ratelimit:hh', '0', '60000']);
});
test('a NOSCRIPT-looking generic transport error cannot cause reload or mutation replay', async () => {
  const f = fixture(async () => { throw new Error('NOSCRIPT disguised uncertain transport error'); });
  await assert.rejects(f.app.quota.increment('ai:ratelimit:hh', 1));
  assert.equal(f.commands.length, 1); assert.equal(f.isCurrent(), false);
});
test('quota read distinguishes legitimate missing counters and validates numeric replies', async () => {
  const absent = fixture(async () => [null, -2]); assert.equal(await absent.app.quota.read('ai:ratelimit:hh'), null);
  const present = fixture(async () => ['5', 500]); assert.deepEqual(await present.app.quota.read('ai:ratelimit:hh'), { count: 5, ttlSeconds: 1 });
  const bad = fixture(async () => ['5junk', 500]); await assert.rejects(bad.app.quota.read('ai:ratelimit:hh')); assert.equal(bad.isCurrent(), false);
});
