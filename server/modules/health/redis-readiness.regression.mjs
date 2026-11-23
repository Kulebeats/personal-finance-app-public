import test from 'node:test';
import assert from 'node:assert/strict';
import { createRedisReadinessProbe } from './redis-readiness.ts';

function fixture() {
  const events = []; let value; let current = true;
  const operations = { assertCurrent() { if (!current) throw new Error('revoked'); },
    async setExpiring(key, next, ttlMs) { value = next; events.push(['set', key, ttlMs]); },
    async get(key) { events.push(['get', key]); return value; },
    async deleteKey(key) { events.push(['delete', key]); return 1; } };
  return { operations, events, revoke() { current = false; } };
}
test('actual Redis readiness operation writes, reads back and confirms cleanup on one binding', async () => {
  const f = fixture(); await createRedisReadinessProbe(f.operations)(new AbortController().signal);
  assert.deepEqual(f.events.map(row => row[0]), ['set', 'get', 'delete']);
  assert.equal(f.events[0][2], 5000); assert.match(f.events[0][1], /^health:readiness:[a-f0-9-]{36}$/);
  assert.equal(new Set(f.events.map(row => row[1])).size, 1);
});
test('aborting while SET is pending refuses before GET or cleanup success', async () => {
  const f = fixture(); let release; f.operations.setExpiring = () => new Promise(resolve => { release = resolve; });
  const abort = new AbortController(), pending = createRedisReadinessProbe(f.operations)(abort.signal);
  abort.abort(); release(); await assert.rejects(pending, /REDIS_READINESS_REFUSED/); assert.equal(f.events.length, 0);
});
test('revocation while GET is pending cannot release readiness success', async () => {
  const f = fixture(); let release;
  f.operations.get = () => new Promise(resolve => { release = resolve; });
  const pending = createRedisReadinessProbe(f.operations)(new AbortController().signal);
  await Promise.resolve(); f.revoke(); release('ignored'); await assert.rejects(pending, /revoked/);
  assert.equal(f.events.some(row => row[0] === 'delete'), false);
});
test('wrong readback and unconfirmed deletion cannot report healthy', async () => {
  const wrong = fixture(); wrong.operations.get = async () => 'wrong';
  await assert.rejects(createRedisReadinessProbe(wrong.operations)(new AbortController().signal), /REDIS_READINESS_REFUSED/);
  const absent = fixture(); absent.operations.deleteKey = async () => 0;
  await assert.rejects(createRedisReadinessProbe(absent.operations)(new AbortController().signal), /REDIS_READINESS_REFUSED/);
});
