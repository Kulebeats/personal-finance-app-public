import RedisStore from 'rate-limit-redis';
import rateLimit from 'express-rate-limit';
import { ReplyError } from 'ioredis';
import { parseRateLimitCommand } from './rate-limit-protocol.mjs';

const refused = () => new Error('REDIS_RATE_LIMIT_REFUSED');
const check = value => { if (!value) throw refused(); };
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const count = value => {
  const parsed = typeof value === 'string' && /^(?:0|[1-9][0-9]{0,15})$/.test(value) ? Number(value) : value;
  check(integer(parsed, 0, Number.MAX_SAFE_INTEGER)); return parsed;
};
const tiers = new Set(['rl:general:', 'rl:analytics:', 'rl:auth:', 'rl:ipauth:', 'rl:strict:', 'rl:expensive:', 'rl:upload:']);
const noScript = error => error instanceof ReplyError && /^NOSCRIPT(?:\s|$)/.test(error.message);

/** Actual library facade over private plumbing; this function cannot mint admission. */
export function createProductionRedisStore(binding, runPrefix, prefix) {
  check(tiers.has(prefix)); binding.assertCurrent();
  let initState = 'uninitialized';
  const revoke = () => { try { binding.revoke(); } finally { throw refused(); } };
  const sendCommand = async (...command) => {
    let parsed;
    try {
      binding.assertCurrent(); parsed = parseRateLimitCommand(runPrefix, command);
      const value = await binding.execute(parsed.command); binding.assertCurrent();
      if (parsed.operation === 'script-load') { check(value === parsed.scriptSha1); return value; }
      if (parsed.operation === 'delete') { check(integer(value, 0, 1)); return value; }
      if (parsed.operation === 'decrement') { check(integer(value, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)); return value; }
      check(Array.isArray(value) && value.length === 2);
      // Redis Lua false becomes RESP2 null. The actual library recognizes false
      // as missing; normalize only the exact null + PTTL -2 response.
      // https://redis.io/docs/latest/develop/programmability/lua-api/
      if (parsed.operation === 'get' && value[0] === null && value[1] === -2) return [false, -2];
      const hits = count(value[0]);
      check((parsed.operation === 'get' || hits > 0) && integer(value[1], 0, 86400000));
      return [hits, value[1]];
    } catch (error) {
      if (parsed && ['increment', 'get'].includes(parsed.operation) && noScript(error)) {
        binding.assertCurrent(); throw new ReplyError('NOSCRIPT No matching script.');
      }
      revoke();
    }
  };
  const store = new RedisStore({ prefix, sendCommand });
  // RedisStore starts both promises in its constructor; observe both at once.
  const startup = Promise.allSettled([store.incrementScriptSha, store.getScriptSha]).then(results => {
    if (results.some(result => result.status === 'rejected')) {
      initState = 'invalid';
      try { binding.revoke(); } catch { /* Lifetime retains cleanup faults for owner close. */ }
      return false;
    }
    return true;
  });
  const invoke = (method, key) => binding.runOperation(async () => {
    binding.assertCurrent(); check(initState === 'valid');
    const ready = await startup; binding.assertCurrent(); check(ready && initState === 'valid');
    const value = await store[method](key); binding.assertCurrent(); return value;
  });
  return Object.freeze({
    init(options) {
      if (initState !== 'uninitialized') { initState = 'invalid'; revoke(); }
      initState = 'invalid';
      try {
        binding.assertCurrent(); check(options && integer(options.windowMs, 1, 86400000));
        store.init(options); binding.assertCurrent(); initState = 'valid';
      } catch { revoke(); }
    },
    get: key => invoke('get', key),
    increment: key => invoke('increment', key),
    decrement: key => invoke('decrement', key),
    resetKey: key => invoke('resetKey', key),
  });
}

/** Actual Express middleware, with a final live guard at its protected next edge. */
export function createProductionRateLimiter(application, prefix, options) {
  application.assertCurrent();
  // Existing seven app tiers use neither fire-and-forget decrement feature.
  check(!options.skipFailedRequests && !options.skipSuccessfulRequests);
  const middleware = rateLimit({ ...options, passOnStoreError: false, store: application.rateLimit.createStore(prefix) });
  const guard = next => {
    try { application.assertCurrent(); } catch (error) { next(error); return false; }
    return true;
  };
  const wrapped = (request, response, next) => {
    if (!guard(next)) return;
    return middleware(request, response, error => {
      if (error) { next(error); return; }
      if (guard(next)) next();
    });
  };
  return Object.freeze(Object.assign(wrapped, {
    resetKey: key => middleware.resetKey(key),
    getKey: key => middleware.getKey(key),
  }));
}
