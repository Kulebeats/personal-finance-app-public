import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteByPatterns } from './invalidation.mjs';
import { analyticsPatterns, analyticsKeyMatches, logicalKeyFromPhysical } from './keys.mjs';

function fixture(pages) {
  const deleted = []; let current = true;
  return { deleted, revoke() { current = false; }, binding: {
    assertCurrent() { if (!current) throw new Error('revoked'); },
    validateKey(key) { if (!key.startsWith('owned:')) throw new Error('foreign key'); },
    includeKey() { return true; },
    async scan() { return pages.shift(); },
    async deleteBatch(keys) { deleted.push(...keys); return keys.length; },
  } };
}
test('bounded scans deduplicate keys and return confirmed deletes only after each batch completes', async () => {
  const f = fixture([['1', ['owned:a', 'owned:b']], ['0', ['owned:b', 'owned:c']]]);
  let release, settled = false;
  f.binding.deleteBatch = keys => new Promise(resolve => { release = () => { f.deleted.push(...keys); resolve(keys.length); }; });
  const pending = deleteByPatterns(f.binding, ['owned:*']).then(value => { settled = true; return value; });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false); release(); assert.equal(await pending, 3); assert.deepEqual(f.deleted, ['owned:a', 'owned:b', 'owned:c']);
});
test('actual analytics wildcard overmatch never deletes another household when its user ID equals the target', async () => {
  const prefix = 'pfa:production:r20redis20261029a:', householdId = 'household-1';
  const target = [`${prefix}analytics:dashboard:${householdId}:v1:abcdef123456`, `${prefix}analytics:dashboard:${householdId}:user-7:v1:abcdef123456`];
  const other = `${prefix}analytics:dashboard:other-household:${householdId}:v1:abcdef123456`;
  const patterns = analyticsPatterns(prefix, { scope: 'household', householdId });
  // Independent matching model for these generated Redis glob patterns: '*'
  // matches colon too. The joined real-service acceptance must repeat this case.
  const matches = (pattern, key) => new RegExp('^' + pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(key);
  assert.equal(patterns.some(pattern => matches(pattern, other)), true, 'prove the broad pattern really includes the adversarial key');
  const deleted = [];
  const filter = { scope: 'household', householdId };
  const binding = { assertCurrent() {}, validateKey(key) { logicalKeyFromPhysical(prefix, key); }, includeKey: key => analyticsKeyMatches(prefix, key, filter),
    async scan(_cursor, pattern) { return ['0', [...target, other].filter(key => matches(pattern, key))]; },
    async deleteBatch(keys) { deleted.push(...keys); return keys.length; } };
  assert.equal(await deleteByPatterns(binding, patterns), 2); assert.deepEqual(deleted.sort(), target.sort()); assert.equal(deleted.includes(other), false);
});
test('a foreign key on a later scan page refuses before any deletion', async () => {
  const f = fixture([['1', ['owned:a']], ['0', ['foreign:b']]]);
  await assert.rejects(deleteByPatterns(f.binding, ['owned:*']), /foreign key/); assert.deepEqual(f.deleted, []);
});
test('scan failures and rejected deletes propagate without an apparent successful count', async () => {
  const f = fixture([]); f.binding.scan = async () => { throw new Error('scan failed'); };
  await assert.rejects(deleteByPatterns(f.binding, ['owned:*']), /scan failed/);
  const failed = fixture([['0', ['owned:a']]]); failed.binding.deleteBatch = async () => { throw new Error('delete failed'); };
  await assert.rejects(deleteByPatterns(failed.binding, ['owned:*']), /delete failed/);
});
test('revocation after a delete reply refuses old-generation success', async () => {
  const f = fixture([['0', ['owned:a']]]); f.binding.deleteBatch = async () => { f.revoke(); return 1; };
  await assert.rejects(deleteByPatterns(f.binding, ['owned:*']), /revoked/);
});
test('scan/key work limits refuse before deletion instead of looping indefinitely', async () => {
  const loops = fixture([]); loops.binding.scan = async () => ['1', ['owned:a']];
  await assert.rejects(deleteByPatterns(loops.binding, ['owned:*'], { maxScans: 2, maxKeys: 10, batchSize: 2 }), /REDIS_INVALIDATION_REFUSED/);
  const many = fixture([['0', ['owned:a', 'owned:b']]]);
  await assert.rejects(deleteByPatterns(many.binding, ['owned:*'], { maxScans: 2, maxKeys: 1, batchSize: 2 }), /REDIS_INVALIDATION_REFUSED/);
  assert.deepEqual(loops.deleted, []); assert.deepEqual(many.deleted, []);
  const skipped = fixture([['1', ['owned:a']], ['0', ['owned:b']]]); skipped.binding.includeKey = () => false;
  await assert.rejects(deleteByPatterns(skipped.binding, ['owned:*'], { maxScans: 2, maxKeys: 1, batchSize: 2 }), /REDIS_INVALIDATION_REFUSED/);
  assert.deepEqual(skipped.deleted, [], 'non-target scan results also consume the finite work budget');
});
test('unconfirmed command replies refuse and zero confirmed deletions remain truthful', async () => {
  for (const reply of [-1, 2, NaN, '1']) {
    const f = fixture([['0', ['owned:a']]]); f.binding.deleteBatch = async () => reply;
    await assert.rejects(deleteByPatterns(f.binding, ['owned:*']), /REDIS_INVALIDATION_REFUSED/);
  }
  const empty = fixture([['0', ['owned:a']]]); empty.binding.deleteBatch = async () => 0;
  assert.equal(await deleteByPatterns(empty.binding, ['owned:*']), 0);
});
