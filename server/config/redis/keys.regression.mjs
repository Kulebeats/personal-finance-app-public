import assert from 'node:assert/strict';
import test from 'node:test';
import { runKeyPrefix, physicalKey, logicalKeyFromPhysical, prefixPattern, analyticsPatterns, analyticsKeyMatches } from './keys.mjs';

const prefix = 'pfa:production:r20redis20261029a:';
test('run namespace is exact and logical keys transform once', () => {
  assert.equal(runKeyPrefix('r20redis20261029a'), prefix);
  assert.equal(physicalKey(prefix, 'rl:auth:ip:2001:db8::/56'), `${prefix}rl:auth:ip:2001:db8::/56`);
  assert.equal(logicalKeyFromPhysical(prefix, `${prefix}analytics:dashboard:household-1:user-1:v1:abc`), 'analytics:dashboard:household-1:user-1:v1:abc');
});
test('physical scan members cannot escape, double-prefix or widen an application namespace', () => {
  for (const key of ['pfa:production:otherrun123:ai:hh:tool', `${prefix}${prefix}ai:hh:tool`, `${prefix}__identity:private`, `${prefix}rl:unknown:key`])
    assert.throws(() => logicalKeyFromPhysical(prefix, key), /REDIS_KEY_REFUSED/);
  assert.throws(() => physicalKey(prefix, `${prefix}ai:hh:tool`), /REDIS_KEY_REFUSED/);
});
test('caller glob/control syntax refuses before a physical key or scan pattern exists', () => {
  for (const suffix of ['*', '?', '[ab]', '\\*', '\n', '\0']) {
    assert.throws(() => physicalKey(prefix, `ai:hh:${suffix}`), /REDIS_KEY_REFUSED/);
    assert.throws(() => prefixPattern(prefix, `ai:hh:${suffix}`), /REDIS_KEY_REFUSED/);
  }
  assert.equal(prefixPattern(prefix, 'ai:household-1:'), `${prefix}ai:household-1:*`);
});
test('analytics invalidation generates exact legacy/current household boundaries internally', () => {
  assert.deepEqual(analyticsPatterns(prefix, { scope: 'household', householdId: 'household-1' }), [
    `${prefix}analytics:*:household-1:v1:*`, `${prefix}analytics:*:household-1:*:v1:*`,
  ]);
  assert.deepEqual(analyticsPatterns(prefix, { scope: 'endpoint', endpoint: 'netWorth', householdId: 'household-1' }), [
    `${prefix}analytics:netWorth:household-1:v1:*`, `${prefix}analytics:netWorth:household-1:*:v1:*`,
  ]);
  for (const householdId of ['household*', 'household:other', '', 'household\\escape'])
    assert.throws(() => analyticsPatterns(prefix, { scope: 'household', householdId }), /REDIS_KEY_REFUSED/);
  assert.throws(() => analyticsPatterns(prefix, { scope: 'endpoint', endpoint: '*', householdId: 'household-1' }), /REDIS_KEY_REFUSED/);
});
test('invalid run/prefix declarations and empty keys refuse', () => {
  for (const runId of ['short', 'UPPERRUN123', 'validrun123:*']) assert.throws(() => runKeyPrefix(runId), /REDIS_KEY_REFUSED/);
  for (const badPrefix of ['shared:', `${prefix}extra:`, 'pfa:production:short:']) assert.throws(() => physicalKey(badPrefix, 'ai:hh:tool'), /REDIS_KEY_REFUSED/);
  assert.throws(() => physicalKey(prefix, ''), /REDIS_KEY_REFUSED/);
});
test('analytics membership uses endpoint and household segments in legacy/current keys, not glob coincidence', () => {
  const filter = { scope: 'household', householdId: 'household-1' };
  assert.equal(analyticsKeyMatches(prefix, `${prefix}analytics:dashboard:household-1:v1:abcdef123456`, filter), true);
  assert.equal(analyticsKeyMatches(prefix, `${prefix}analytics:dashboard:household-1:user-7:v1:abcdef123456`, filter), true);
  assert.equal(analyticsKeyMatches(prefix, `${prefix}analytics:dashboard:other-household:household-1:v1:abcdef123456`, filter), false);
  assert.equal(analyticsKeyMatches(prefix, `${prefix}analytics:netWorth:household-1:user-7:v1:abcdef123456`, { ...filter, scope: 'endpoint', endpoint: 'dashboard' }), false);
});
