import test from 'node:test';
import assert from 'node:assert/strict';
import RedisStore from 'rate-limit-redis';
import { ReplyError } from 'ioredis';
import { setTimeout as delay } from 'node:timers/promises';
import { createProductionRedisLifetime } from './production-connection.mjs';
import { parseRateLimitCommand, RATE_LIMIT_SCRIPTS } from './rate-limit-protocol.mjs';
import { createProductionRedisOperations } from './production-operations.mjs';

// Fake private transport/lifetime only: never an owned-service brand or factory admission.
function fixture(dispatch = async () => 'OK', budgets = {}) {
  let authority = true, disconnected = 0; const commands = [];
  const lifetime = createProductionRedisLifetime({
    assertAuthority() { if (!authority) throw new Error('authority ended'); },
    async dispatch(command) { commands.push(command); return dispatch(command); },
    disconnect() { disconnected++; }, commandTimeoutMs: 100, operationTimeoutMs: 100, ...budgets,
  });
  return { lifetime, commands, disconnects: () => disconnected, endAuthority() { authority = false; } };
}

test('internal lifetime validates finite budgets and rejects authority before dispatch', async () => {
  const options = { assertAuthority() {}, dispatch: async () => 'OK', disconnect() {}, commandTimeoutMs: 1, operationTimeoutMs: 1 };
  for (const value of [0, -1, 2001, Infinity, '1']) assert.throws(() => createProductionRedisLifetime({ ...options, commandTimeoutMs: value }));
  const f = fixture(); f.endAuthority(); await assert.rejects(f.lifetime.execute(['GET', 'key']));
  assert.equal(f.commands.length, 0); assert.equal(f.disconnects(), 1);
});

test('revocation before the dispatch microtask prevents any sender call', async () => {
  const f = fixture(); const pending = f.lifetime.execute(['GET', 'key']); f.lifetime.revoke();
  await assert.rejects(pending); assert.equal(f.commands.length, 0); assert.equal(f.disconnects(), 1);
});

test('revocation rejects pending work immediately and observes a later transport success', async () => {
  let release; const f = fixture(() => new Promise(resolve => { release = resolve; }));
  const pending = f.lifetime.execute(['GET', 'key']); await Promise.resolve();
  f.lifetime.revoke(); await assert.rejects(pending); release('late success'); await delay(1);
  assert.throws(f.lifetime.assertCurrent); assert.equal(f.commands.length, 1); assert.equal(f.disconnects(), 1);
});

test('command deadline closes the admission and observes later rejection', { timeout: 1000 }, async () => {
  let reject; const f = fixture(() => new Promise((_resolve, failure) => { reject = failure; }), { commandTimeoutMs: 15 });
  await assert.rejects(f.lifetime.execute(['GET', 'key']));
  assert.equal(f.disconnects(), 1); reject(new Error('late private error')); await delay(1);
  await assert.rejects(f.lifetime.execute(['GET', 'another'])); assert.equal(f.commands.length, 1);
});

test('overall operation deadline bounds many individually fast commands', { timeout: 1000 }, async () => {
  const f = fixture(async () => { await delay(8); return ['0', []]; }, { commandTimeoutMs: 100, operationTimeoutMs: 25 });
  const pending = f.lifetime.runOperation(async () => {
    for (let index = 0; index < 20; index++) await f.lifetime.execute(['SCAN', String(index)]);
    return 'must not succeed';
  });
  await assert.rejects(pending); const dispatched = f.commands.length;
  await delay(25); assert.equal(f.commands.length, dispatched); assert.ok(dispatched < 20); assert.equal(f.disconnects(), 1);
});

test('a known genuine Redis NOSCRIPT is the only command error retaining lifetime', async () => {
  const good = fixture(async () => { throw new ReplyError('NOSCRIPT No matching script.'); });
  await assert.rejects(good.lifetime.execute(['EVALSHA', RATE_LIMIT_SCRIPTS.get.sha1, '1', 'key']), /NOSCRIPT/);
  assert.doesNotThrow(good.lifetime.assertCurrent); good.lifetime.revoke();
  for (const [command, error] of [
    [['EVALSHA', RATE_LIMIT_SCRIPTS.get.sha1, '1', 'key'], new Error('NOSCRIPT unknown transport result')],
    [['EVALSHA', 'f'.repeat(40), '1', 'key'], new ReplyError('NOSCRIPT No matching script.')],
    [['GET', 'key'], new ReplyError('NOSCRIPT No matching script.')],
  ]) {
    const bad = fixture(async () => { throw error; });
    await assert.rejects(bad.lifetime.execute(command)); assert.throws(bad.lifetime.assertCurrent); assert.equal(bad.disconnects(), 1);
  }
});

test('pending work is capped without queueing more dispatches', async () => {
  const f = fixture(() => new Promise(() => {}), { commandTimeoutMs: 1000, operationTimeoutMs: 1000 });
  const pending = Array.from({ length: 65 }, () => f.lifetime.execute(['GET', 'key']));
  const results = await Promise.allSettled(pending);
  assert.equal(results.every(value => value.status === 'rejected'), true);
  assert.equal(f.commands.length, 0); assert.equal(f.disconnects(), 1);
});

test('revocation subscriptions are independent even for the same callback', () => {
  const f = fixture(); let calls = 0; const callback = () => { calls++; };
  const remove = f.lifetime.onRevoked(callback); f.lifetime.onRevoked(callback); remove();
  f.lifetime.revoke(); assert.equal(calls, 1); assert.equal(f.disconnects(), 1);
});

test('throwing observer cannot skip invalidation, later observers or disconnect', () => {
  const f = fixture(); const calls = [];
  f.lifetime.onRevoked(() => { calls.push('first'); assert.throws(f.lifetime.assertCurrent); throw new Error('secret observer text'); });
  f.lifetime.onRevoked(() => calls.push('last'));
  assert.throws(f.lifetime.revoke, error => {
    assert.equal(error instanceof AggregateError, true); assert.equal(String(error).includes('secret observer text'), false); return true;
  });
  assert.deepEqual(calls, ['first', 'last']); assert.equal(f.disconnects(), 1); assert.throws(f.lifetime.assertCurrent);
  f.lifetime.revoke(); assert.throws(f.lifetime.assertClean, /REDIS_CONNECTION_CLEANUP_REFUSED/);
});

test('actual installed RedisStore cannot replay an uncertain increment after lifetime deadline', { timeout: 1000 }, async () => {
  let release, simulatedWrites = 0;
  const f = fixture(async command => {
    if (command[0] === 'SCRIPT') return Object.values(RATE_LIMIT_SCRIPTS).find(script => script.text === command[2]).sha1;
    simulatedWrites++; return new Promise(resolve => { release = resolve; });
  }, { commandTimeoutMs: 15 });
  const store = new RedisStore({ prefix: 'rl:auth:', sendCommand: (...command) => f.lifetime.execute(parseRateLimitCommand('pfa:production:r20lifetimetest:', command).command) });
  await Promise.all([store.incrementScriptSha, store.getScriptSha]); store.init({ windowMs: 1000 });
  await assert.rejects(store.increment('user:x')); assert.equal(simulatedWrites, 1);
  assert.equal(f.commands.filter(command => command[0] === 'SCRIPT').length, 2);
  release([1, 1000]); await delay(1);
  assert.equal(simulatedWrites, 1); assert.equal(f.disconnects(), 1);
});

test('restricted multi-command cache invalidation obeys the actual lifetime operation deadline', { timeout: 1000 }, async () => {
  let cursor = 0;
  const f = fixture(async command => {
    assert.equal(command[0], 'SCAN'); await delay(8); return [String(++cursor), []];
  }, { operationTimeoutMs: 25 });
  const operations = createProductionRedisOperations(f.lifetime, 'pfa:production:r20lifetimetest:');
  await assert.rejects(operations.cache.deleteByPrefix('core-cache:'));
  assert.equal(f.commands.some(command => command[0] === 'DEL'), false); assert.equal(f.disconnects(), 1);
});

test('readiness cancellation immediately revokes a connection with pending GET', { timeout: 1000 }, async () => {
  let release, stored;
  const f = fixture(command => command[0] === 'SET' ? (stored = command[2], 'OK') : new Promise(resolve => { release = resolve; }));
  const operations = createProductionRedisOperations(f.lifetime, 'pfa:production:r20lifetimetest:');
  const controller = new AbortController();
  const pending = operations.readiness.probe(controller.signal).then(() => 'success', () => 'refused');
  for (let attempt = 0; attempt < 64 && !release; attempt++) await Promise.resolve();
  assert.equal(typeof release, 'function');
  controller.abort();
  const observed = await Promise.race([pending, delay(25).then(() => 'still-pending')]);
  release(stored); await pending;
  assert.equal(observed, 'refused'); assert.equal(f.disconnects(), 1);
  assert.equal(f.commands.some(command => command[0] === 'DEL'), false);
});

for (const [name, run, reply] of [
  ['cache.setJson', operations => operations.cache.setJson('core-cache:x', {}, 1), 'OK'],
  ['cache.deleteKey', operations => operations.cache.deleteKey('core-cache:x'), 1],
  ['analytics.setJson', operations => operations.analytics.setJson('analytics:dashboard:hh:user:v1:abcdef123456', {}, 1), 'OK'],
]) {
  test(`${name} observes the shorter whole-operation deadline`, { timeout: 1000 }, async () => {
    const f = fixture(async () => { await delay(60); return reply; }, { commandTimeoutMs: 250, operationTimeoutMs: 10 });
    const operations = createProductionRedisOperations(f.lifetime, 'pfa:production:r20lifetimetest:');
    try { await assert.rejects(run(operations)); assert.equal(f.disconnects(), 1); }
    finally { f.lifetime.revoke(); }
  });
}

const block = milliseconds => { const end = performance.now() + milliseconds; while (performance.now() < end) {} };
test('absolute command budget rejects blocked dispatch before its overdue timer can run', async () => {
  const f = fixture(async () => { block(40); return 'OK'; }, { commandTimeoutMs: 10, operationTimeoutMs: 250 });
  try { await assert.rejects(f.lifetime.execute(['GET', 'key'])); assert.equal(f.disconnects(), 1); }
  finally { f.lifetime.revoke(); }
});
test('absolute whole-operation budget rejects blocked success with a longer command budget', async () => {
  const f = fixture(async () => { block(40); return 'OK'; }, { commandTimeoutMs: 250, operationTimeoutMs: 10 });
  const operations = createProductionRedisOperations(f.lifetime, 'pfa:production:r20lifetimetest:');
  try { await assert.rejects(operations.cache.setJson('core-cache:x', {}, 1)); assert.equal(f.disconnects(), 1); }
  finally { f.lifetime.revoke(); }
});
test('expired outer operation refuses its next nested dispatch even before timer callbacks run', async () => {
  const f = fixture(async () => 'OK', { commandTimeoutMs: 250, operationTimeoutMs: 10 });
  try {
    const pending = f.lifetime.runOperation(async () => {
      await f.lifetime.execute(['GET', 'first']); block(40);
      return f.lifetime.execute(['GET', 'must-not-dispatch']);
    });
    await assert.rejects(pending);
    assert.deepEqual(f.commands, [['GET', 'first']]); assert.equal(f.disconnects(), 1);
  } finally { f.lifetime.revoke(); }
});
test('expired blocked NOSCRIPT cannot reach actual RedisStore reload/retry dispatch', async () => {
  const f = fixture(async command => {
    if (command[0] === 'SCRIPT') return Object.values(RATE_LIMIT_SCRIPTS).find(script => script.text === command[2]).sha1;
    block(40); throw new ReplyError('NOSCRIPT No matching script.');
  }, { commandTimeoutMs: 250, operationTimeoutMs: 10 });
  const store = new RedisStore({ prefix: 'rl:auth:', sendCommand: (...command) => f.lifetime.execute(parseRateLimitCommand('pfa:production:r20lifetimetest:', command).command) });
  await Promise.all([store.incrementScriptSha, store.getScriptSha]); store.init({ windowMs: 1000 });
  await assert.rejects(f.lifetime.runOperation(() => store.increment('user:x')));
  assert.equal(f.commands.filter(command => command[0] === 'SCRIPT').length, 2);
  assert.equal(f.commands.filter(command => command[0] === 'EVALSHA').length, 1);
  assert.equal(f.disconnects(), 1);
});
