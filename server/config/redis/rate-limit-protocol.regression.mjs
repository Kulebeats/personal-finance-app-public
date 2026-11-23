import assert from 'node:assert/strict';
import test from 'node:test';
import RedisStore from 'rate-limit-redis';
import { RATE_LIMIT_SCRIPTS, parseRateLimitCommand } from './rate-limit-protocol.mjs';

const prefix = 'pfa:production:r20redis20261029a:';
test('actual installed RedisStore operations use only pinned scripts and transform each logical key once', async () => {
  const commands = [];
  const store = new RedisStore({ prefix: 'rl:auth:', sendCommand: async (...args) => {
    const parsed = parseRateLimitCommand(prefix, args); commands.push(parsed);
    return parsed.operation === 'script-load' ? parsed.scriptSha1 : parsed.operation === 'increment' || parsed.operation === 'get' ? [1, 1000] : 1;
  } });
  store.init({ windowMs: 1000 });
  assert.equal((await store.increment('user:actor-1')).totalHits, 1);
  assert.equal((await store.get('user:actor-1')).totalHits, 1);
  await store.decrement('user:actor-1'); await store.resetKey('user:actor-1');
  assert.deepEqual(commands.map(row => row.operation), ['script-load', 'script-load', 'increment', 'get', 'decrement', 'delete']);
  for (const row of commands.filter(item => item.operation !== 'script-load')) {
    assert.equal(row.command[row.operation === 'increment' || row.operation === 'get' ? 3 : 1], `${prefix}rl:auth:user:actor-1`);
    assert.equal(Object.isFrozen(row), true); assert.equal(Object.isFrozen(row.command), true);
  }
});
test('pinned bodies preserve independently inventoried actual script identities', () => {
  assert.equal(RATE_LIMIT_SCRIPTS.increment.sha1, '81dbecea94d2d10514719b20ed51faf711529d9d');
  assert.equal(RATE_LIMIT_SCRIPTS.get.sha1, '6aeb97ed6086dcdeafdc6fda3999a0d0e38ec96a');
  assert.equal(RATE_LIMIT_SCRIPTS.increment.sha256, '12b85c922d5006b59b28235ef386fbba45e3af08719b15772efb0474ce7f1d3b');
});
for (const [name, command] of [
  ['arbitrary script', ['SCRIPT', 'LOAD', 'return 1']],
  ['script flush', ['SCRIPT', 'FLUSH']],
  ['arbitrary eval', ['EVAL', 'return 1', '0']],
  ['unknown SHA', ['EVALSHA', '0'.repeat(40), '1', 'rl:auth:user', '0', '1000']],
  ['wrong key count', ['EVALSHA', '81dbecea94d2d10514719b20ed51faf711529d9d', '2', 'rl:auth:user', '0', '1000']],
  ['noncanonical key count', ['EVALSHA', '81dbecea94d2d10514719b20ed51faf711529d9d', '01', 'rl:auth:user', '0', '1000']],
  ['reset override', ['EVALSHA', '81dbecea94d2d10514719b20ed51faf711529d9d', '1', 'rl:auth:user', '2', '1000']],
  ['unbounded window', ['EVALSHA', '81dbecea94d2d10514719b20ed51faf711529d9d', '1', 'rl:auth:user', '0', '86400001']],
  ['extra get argument', ['EVALSHA', '6aeb97ed6086dcdeafdc6fda3999a0d0e38ec96a', '1', 'rl:auth:user', 'extra']],
  ['outside limiter namespace', ['DEL', 'ai:household:counter']],
  ['foreign physical key', ['DEL', 'pfa:production:otherrun123:rl:auth:user']],
  ['empty limiter key', ['DEL', 'rl:auth:']],
  ['key glob', ['DECR', 'rl:auth:*']],
  ['admin command', ['CONFIG', 'GET', '*']],
]) test(`command boundary refuses ${name}`, () => assert.throws(() => parseRateLimitCommand(prefix, command), /REDIS_(?:STORE_COMMAND|KEY)_REFUSED/));
