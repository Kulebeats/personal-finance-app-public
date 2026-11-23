import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import rateLimit from 'express-rate-limit';
import { ReplyError } from 'ioredis';
import { createProductionRedisStore, createProductionRateLimiter } from './production-rate-limit.mjs';
import { createProductionRedisLifetime } from './production-connection.mjs';
import { RATE_LIMIT_SCRIPTS } from './rate-limit-protocol.mjs';

const prefix = 'pfa:production:r20storefacade:';
function fixture(reply) {
  const commands = []; let count = 0, disconnected = 0;
  const binding = createProductionRedisLifetime({ assertAuthority() {}, disconnect() { disconnected++; }, commandTimeoutMs: 100, operationTimeoutMs: 100,
    async dispatch(command) {
      commands.push(command);
      if (reply) return reply(command);
      if (command[0] === 'SCRIPT') return Object.values(RATE_LIMIT_SCRIPTS).find(value => value.text === command[2]).sha1;
      if (command[0] === 'EVALSHA') return command[1] === RATE_LIMIT_SCRIPTS.increment.sha1 ? [++count, 1000] : [String(count), 1000];
      return command[0] === 'DECR' ? --count : (count = 0, 1);
    } });
  const store = createProductionRedisStore(binding, prefix, 'rl:auth:');
  return { store, binding, commands, disconnects: () => disconnected,
    application: { assertCurrent: binding.assertCurrent, rateLimit: { createStore: () => store } } };
}
const options = { windowMs: 1000, limit: 1, standardHeaders: false, legacyHeaders: false, keyGenerator: () => 'user:x', validate: false };
const request = () => ({ ip: '127.0.0.1', headers: {}, method: 'GET', path: '/', socket: { remoteAddress: '127.0.0.1' }, app: { get: () => false } });
function response() { return Object.assign(new EventEmitter(), { headersSent: false, writableEnded: false, statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, send() { this.writableEnded = true; return this; } }); }

test('facade delegates actual store operations while hiding sendCommand and mutable script/options state', async () => {
  const f = fixture(); f.store.init({ windowMs: 1000 });
  assert.equal(Object.isFrozen(f.store), true);
  assert.deepEqual(Object.keys(f.store).sort(), ['decrement', 'get', 'increment', 'init', 'resetKey']);
  assert.equal(f.store.sendCommand, undefined); assert.equal(f.store.incrementScriptSha, undefined);
  assert.equal((await f.store.increment('user:x')).totalHits, 1);
  assert.equal((await f.store.get('user:x')).totalHits, 1);
  await f.store.decrement('user:x'); await f.store.resetKey('user:x');
  assert.equal(f.commands.filter(command => command[0] === 'SCRIPT').length, 2);
  assert.equal(f.commands.filter(command => command[0] !== 'SCRIPT').every(command => command.includes(prefix + 'rl:auth:user:x')), true);
  f.binding.revoke();
});

test('unknown tier refuses before constructor script loads', () => {
  const f = fixture(); assert.throws(() => createProductionRedisStore(f.binding, prefix, 'rl:unknown:'));
  f.binding.revoke();
});
test('uninitialized and permanently invalid init state reject all later methods', async () => {
  const first = fixture(); await assert.rejects(first.store.increment('user:x')); first.binding.revoke();
  const f = fixture(); assert.throws(() => f.store.init({ windowMs: 0 }));
  assert.throws(() => f.store.init({ windowMs: 1000 }));
  for (const method of ['get', 'increment', 'decrement', 'resetKey']) await assert.rejects(f.store[method]('user:x'));
  assert.equal(f.commands.some(command => command[0] === 'EVALSHA'), false); f.binding.revoke();
});
test('actual Express catches init error but retained facade refusal prevents protected callback', async () => {
  const f = fixture(), logged = [], errors = [];
  const middleware = rateLimit({ ...options, windowMs: 0, store: f.store, logger: { error: (...args) => logged.push(args), warn() {} } });
  await middleware(request(), response(), error => errors.push(error));
  assert.ok(logged.length > 0); assert.equal(errors.length, 1); assert.equal(errors[0] instanceof Error, true);
  assert.equal(f.commands.some(command => command[0] === 'EVALSHA'), false); f.binding.revoke();
});
test('reinitializing a valid store makes the facade permanently invalid', async () => {
  const f = fixture(); f.store.init({ windowMs: 1000 });
  assert.throws(() => f.store.init({ windowMs: 2000 }));
  await assert.rejects(f.store.increment('user:x')); f.binding.revoke();
});
for (const repeated of [false, true]) {
  test(`${repeated ? 'repeated' : 'invalid'} init cannot bypass refusal through actual Express skip`, async () => {
    const f = fixture(); let allowed = 0; const errors = [], logged = [];
    if (repeated) f.store.init({ windowMs: 1000 });
    const middleware = createProductionRateLimiter(f.application, 'rl:auth:', {
      ...options, windowMs: repeated ? 1000 : 0, skip: () => true,
      logger: { error: (...args) => logged.push(args), warn() {} },
    });
    try {
      await middleware(request(), response(), error => error ? errors.push(error) : allowed++);
      assert.ok(logged.length > 0); assert.equal(allowed, 0); assert.equal(errors.length, 1); assert.equal(f.disconnects(), 1);
    } finally { f.binding.revoke(); }
  });
}
test('both constructor script-load rejections are observed and methods cannot succeed', async () => {
  const f = fixture(async () => { throw new Error('private startup failure'); });
  f.store.init({ windowMs: 1000 }); await assert.rejects(f.store.increment('user:x'));
  assert.equal(f.commands.some(command => command[0] === 'EVALSHA'), false); assert.equal(f.disconnects(), 1);
});
test('wrong script hash and malformed count reply revoke without apparent library success', async () => {
  const wrong = fixture(async () => 'f'.repeat(40)); wrong.store.init({ windowMs: 1000 }); await assert.rejects(wrong.store.increment('user:x')); assert.equal(wrong.disconnects(), 1);
  const malformed = fixture(async command => command[0] === 'SCRIPT' ? Object.values(RATE_LIMIT_SCRIPTS).find(value => value.text === command[2]).sha1 : ['1junk', 1000]);
  malformed.store.init({ windowMs: 1000 }); await assert.rejects(malformed.store.increment('user:x')); assert.equal(malformed.disconnects(), 1);
});
test('known RESP2 missing get reply stays a finite library counter result rather than NaN', async () => {
  const f = fixture(async command => command[0] === 'SCRIPT' ? Object.values(RATE_LIMIT_SCRIPTS).find(value => value.text === command[2]).sha1 : [null, -2]);
  f.store.init({ windowMs: 1000 }); const result = await f.store.get('user:x');
  assert.equal(result.totalHits, 0); assert.equal(Number.isFinite(result.resetTime.getTime()), true); f.binding.revoke();
});
for (const value of [[false, -2], [null, -1], [null, 0], ['0', -2]]) {
  test(`only the exact null/-2 missing tuple is normalized (${JSON.stringify(value)})`, async () => {
    const f = fixture(async command => command[0] === 'SCRIPT' ? Object.values(RATE_LIMIT_SCRIPTS).find(item => item.text === command[2]).sha1 : value);
    f.store.init({ windowMs: 1000 }); await assert.rejects(f.store.get('user:x')); assert.equal(f.disconnects(), 1);
  });
}
test('actual middleware enforces threshold and does not run protected next after store failure', async () => {
  const f = fixture(); let allowed = 0, denied = 0; const errors = [];
  const middleware = createProductionRateLimiter(f.application, 'rl:auth:', { ...options, handler() { denied++; } });
  await middleware(request(), response(), error => error ? errors.push(error) : allowed++);
  await middleware(request(), response(), error => error ? errors.push(error) : allowed++);
  assert.equal(allowed, 1); assert.equal(denied, 1); assert.equal(errors.length, 0);
  f.binding.revoke(); await middleware(request(), response(), error => error ? errors.push(error) : allowed++);
  assert.equal(allowed, 1); assert.equal(errors.length, 1);
});
test('revocation while actual middleware awaits limit cannot pass its final protected callback edge', async () => {
  const f = fixture(); let release, protectedCalls = 0; const errors = [];
  const middleware = createProductionRateLimiter(f.application, 'rl:auth:', { ...options, limit: () => new Promise(resolve => { release = resolve; }) });
  const pending = middleware(request(), response(), error => error ? errors.push(error) : protectedCalls++);
  for (let attempt = 0; attempt < 256 && !release; attempt++) await Promise.resolve();
  assert.equal(typeof release, 'function'); f.binding.revoke(); release(1); await pending;
  assert.equal(protectedCalls, 0); assert.equal(errors.length, 1);
});
test('only actual Redis NOSCRIPT may reload; generic lookalike cannot replay', async () => {
  let evaluations = 0;
  const safe = fixture(async command => {
    if (command[0] === 'SCRIPT') return Object.values(RATE_LIMIT_SCRIPTS).find(value => value.text === command[2]).sha1;
    if (++evaluations === 1) throw new ReplyError('NOSCRIPT No matching script.'); return [1, 1000];
  });
  safe.store.init({ windowMs: 1000 }); assert.equal((await safe.store.increment('user:x')).totalHits, 1); assert.equal(evaluations, 2); safe.binding.revoke();
  const unsafe = fixture(async command => {
    if (command[0] === 'SCRIPT') return Object.values(RATE_LIMIT_SCRIPTS).find(value => value.text === command[2]).sha1;
    throw new Error('NOSCRIPT uncertain socket error');
  });
  unsafe.store.init({ windowMs: 1000 }); await assert.rejects(unsafe.store.increment('user:x'));
  assert.equal(unsafe.commands.filter(command => command[0] === 'EVALSHA').length, 1);
  assert.equal(unsafe.commands.filter(command => command[0] === 'SCRIPT').length, 2);
});
