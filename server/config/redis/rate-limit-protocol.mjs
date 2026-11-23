import { createHash } from 'node:crypto';
import { physicalKey } from './keys.mjs';

const refuse = () => { throw new Error('REDIS_STORE_COMMAND_REFUSED'); };
const check = value => { if (!value) refuse(); };
const digest = (text, algorithm) => createHash(algorithm).update(text).digest('hex');
const script = (text, sha1, sha256) => {
  check(digest(text, 'sha1') === sha1 && digest(text, 'sha256') === sha256);
  return Object.freeze({ text, sha1, sha256 });
};
// Exact cooked bytes from installed rate-limit-redis 4.3.1, independently
// inventoried before this adapter. This is consistency, never service authority.
export const RATE_LIMIT_SCRIPTS = Object.freeze({
  increment: script(`local windowMs = tonumber(ARGV[2])
local resetOnChange = ARGV[1] == "1"
local timeToExpire = redis.call("PTTL", KEYS[1])
if timeToExpire <= 0 then
redis.call("SET", KEYS[1], 1, "PX", windowMs)
return { 1, windowMs }
end
local totalHits = redis.call("INCR", KEYS[1])
if resetOnChange then
redis.call("PEXPIRE", KEYS[1], windowMs)
timeToExpire = windowMs
end
return { totalHits, timeToExpire }`, '81dbecea94d2d10514719b20ed51faf711529d9d', '12b85c922d5006b59b28235ef386fbba45e3af08719b15772efb0474ce7f1d3b'),
  get: script(`local totalHits = redis.call("GET", KEYS[1])
local timeToExpire = redis.call("PTTL", KEYS[1])
return { totalHits, timeToExpire }`, '6aeb97ed6086dcdeafdc6fda3999a0d0e38ec96a', '1b24d5559985adb0b6c23be902e9e4691f07a3dc07bf6ed7c9df0a06ffb63d32'),
});
function limiterKey(runPrefix, key) {
  check(typeof key === 'string' && /^rl:(?:general|analytics|auth|ipauth|strict|expensive|upload):.+$/.test(key));
  return physicalKey(runPrefix, key);
}
/** Internal command translation only; no connection or public raw-command API. */
export function parseRateLimitCommand(runPrefix, command) {
  check(Array.isArray(command) && command.length >= 2 && command.length <= 6 && command.every(value => typeof value === 'string' && value.length <= 4096));
  if (command[0] === 'SCRIPT') {
    check(command.length === 3 && command[1] === 'LOAD');
    const selected = Object.values(RATE_LIMIT_SCRIPTS).find(value => value.text === command[2]); check(selected);
    return Object.freeze({ operation: 'script-load', scriptSha1: selected.sha1, command: Object.freeze([...command]) });
  }
  if (command[0] === 'EVALSHA') {
    const increment = command[1] === RATE_LIMIT_SCRIPTS.increment.sha1, get = command[1] === RATE_LIMIT_SCRIPTS.get.sha1;
    check((increment && command.length === 6 || get && command.length === 4) && command[2] === '1');
    const key = limiterKey(runPrefix, command[3]);
    if (increment) check(['0', '1'].includes(command[4]) && /^[1-9][0-9]{0,7}$/.test(command[5]) && Number(command[5]) <= 86400000);
    return Object.freeze({ operation: increment ? 'increment' : 'get', command: Object.freeze([command[0], command[1], '1', key, ...command.slice(4)]) });
  }
  check(command.length === 2 && ['DECR', 'DEL'].includes(command[0]));
  return Object.freeze({ operation: command[0] === 'DECR' ? 'decrement' : 'delete', command: Object.freeze([command[0], limiterKey(runPrefix, command[1])]) });
}
