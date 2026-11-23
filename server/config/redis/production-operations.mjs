import { ReplyError } from 'ioredis';
import { physicalKey, prefixPattern, logicalKeyFromPhysical, analyticsLogicalKeyMatches, analyticsPatterns, analyticsKeyMatches } from './keys.mjs';
import { deleteByPatterns } from './invalidation.mjs';
import { RATE_LIMIT_SCRIPTS } from './rate-limit-protocol.mjs';
import { createRedisReadinessProbe } from '../../modules/health/redis-readiness.ts';

const refuse = () => { throw new Error('REDIS_OPERATION_REFUSED'); };
const check = value => { if (!value) refuse(); };
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const definiteNoScript = error => error instanceof ReplyError && /^NOSCRIPT(?:\s|$)/.test(error.message);

/** Internal pure facade over a binding. Cannot issue factory admission or install a slot. */
export function createProductionRedisOperations(binding, runPrefix) {
  physicalKey(runPrefix, 'core-cache:validate');
  const assertCurrent = () => binding.assertCurrent();
  const revoke = () => { try { binding.revoke(); } finally { refuse(); } };
  const network = async (command, validate, allowNoScript = false) => {
    assertCurrent();
    try {
      const value = await binding.execute(command); assertCurrent();
      check(validate(value)); return value;
    } catch (error) {
      if (allowNoScript && definiteNoScript(error)) { assertCurrent(); throw new ReplyError('NOSCRIPT No matching script.'); }
      revoke();
    }
  };
  const operation = action => binding.runOperation(async () => {
    assertCurrent();
    try { const value = await action(); assertCurrent(); return value; }
    catch { revoke(); }
  });
  const scopedKey = (key, namespace) => {
    check(typeof key === 'string' && key.startsWith(namespace));
    if (namespace === 'analytics:') {
      const householdId = key.split(':')[2];
      check(analyticsLogicalKeyMatches(key, { scope: 'household', householdId }));
    }
    return physicalKey(runPrefix, key);
  };
  const readJson = async (key, namespace) => {
    const physical = scopedKey(key, namespace);
    const result = await operation(async () => {
      const text = await network(['GET', physical], value => value === null || typeof value === 'string' && Buffer.byteLength(value) <= 1024 * 1024);
      return text === null ? null : JSON.parse(text);
    });
    assertCurrent(); return result;
  };
  const writeJson = (key, value, ttl, namespace) => {
    const physical = scopedKey(key, namespace); check(integer(ttl, 1, 86400));
    let text; try { text = JSON.stringify(value); } catch { refuse(); }
    check(typeof text === 'string' && Buffer.byteLength(text) <= 1024 * 1024);
    return operation(() => network(['SETEX', physical, String(ttl), text], result => result === 'OK'));
  };
  const invalidate = (patterns, includeKey) => operation(() => deleteByPatterns({
    assertCurrent,
    validateKey: key => { logicalKeyFromPhysical(runPrefix, key); },
    includeKey,
    scan: (cursor, pattern, count) => network(['SCAN', cursor, 'MATCH', pattern, 'COUNT', String(count)], () => true),
    deleteBatch: keys => network(['DEL', ...keys], value => integer(value, 0, keys.length)),
  }, patterns));

  const cache = Object.freeze({
    assertCurrent,
    isEnabled() { assertCurrent(); return true; },
    getJson: key => readJson(key, 'core-cache:'),
    async setJson(key, value, ttl) { await writeJson(key, value, ttl, 'core-cache:'); assertCurrent(); return true; },
    async deleteKey(key) {
      const physical = scopedKey(key, 'core-cache:');
      const count = await operation(() => network(['DEL', physical], value => integer(value, 0, 1))); assertCurrent(); return count === 1;
    },
    async deleteByPrefix(prefix) {
      const physical = scopedKey(prefix, 'core-cache:'), pattern = prefixPattern(runPrefix, prefix);
      const count = await invalidate([pattern], key => key.startsWith(physical)); assertCurrent(); return count;
    },
  });
  const analytics = Object.freeze({
    assertCurrent,
    getJson: key => readJson(key, 'analytics:'),
    async setJson(key, value, ttl) { await writeJson(key, value, ttl, 'analytics:'); assertCurrent(); },
    async invalidate(filter) {
      const patterns = analyticsPatterns(runPrefix, filter);
      const count = await invalidate(patterns, key => analyticsKeyMatches(runPrefix, key, filter)); assertCurrent(); return count;
    },
  });
  const readinessProbe = createRedisReadinessProbe({
    assertCurrent,
    async setExpiring(key, value, ttl) {
      check(/^health:readiness:[a-f0-9-]{36}$/.test(key) && ttl === 5000 && typeof value === 'string');
      await network(['SET', physicalKey(runPrefix, key), value, 'PX', '5000'], result => result === 'OK'); assertCurrent();
    },
    get: key => network(['GET', physicalKey(runPrefix, key)], value => value === null || typeof value === 'string'),
    deleteKey: key => network(['DEL', physicalKey(runPrefix, key)], value => integer(value, 0, 1)),
  });
  const fixedScript = async (script, key, args) => {
    const command = ['EVALSHA', script.sha1, '1', key, ...args];
    try { return await network(command, () => true, true); }
    catch (error) {
      if (!definiteNoScript(error)) throw error;
      await network(['SCRIPT', 'LOAD', script.text], value => value === script.sha1);
      return network(command, () => true);
    }
  };
  const quotaKey = key => { check(typeof key === 'string' && /^ai:ratelimit:[A-Za-z0-9_-]{1,128}$/.test(key)); return physicalKey(runPrefix, key); };
  const counter = (value, missing) => {
    check(Array.isArray(value) && value.length === 2);
    if (missing && (value[0] === null || value[0] === false) && value[1] === -2) return null;
    const count = typeof value[0] === 'string' && /^(?:0|[1-9][0-9]{0,15})$/.test(value[0]) ? Number(value[0]) : value[0];
    check(integer(count, missing ? 0 : 1, Number.MAX_SAFE_INTEGER) && integer(value[1], 0, 86400000));
    return Object.freeze({ count, ttlSeconds: Math.ceil(value[1] / 1000) });
  };
  const quota = Object.freeze({
    async increment(key, ttl) {
      const physical = quotaKey(key); check(integer(ttl, 1, 86400));
      const result = await operation(async () => counter(await fixedScript(RATE_LIMIT_SCRIPTS.increment, physical, ['0', String(ttl * 1000)]), false));
      assertCurrent(); return result;
    },
    async read(key) {
      const physical = quotaKey(key);
      const result = await operation(async () => counter(await fixedScript(RATE_LIMIT_SCRIPTS.get, physical, []), true));
      assertCurrent(); return result;
    },
  });
  const readiness = Object.freeze({
    async probe(signal) {
      check(signal instanceof AbortSignal);
      let revokeFailed = false;
      const abort = () => { try { binding.revoke(); } catch { revokeFailed = true; } };
      signal.addEventListener('abort', abort, { once: true });
      try {
        if (signal.aborted) abort();
        await operation(() => readinessProbe(signal)); assertCurrent();
      } finally {
        signal.removeEventListener('abort', abort);
        if (revokeFailed) refuse();
      }
    },
  });
  return Object.freeze({ assertCurrent, cache, analytics, quota, readiness });
}
