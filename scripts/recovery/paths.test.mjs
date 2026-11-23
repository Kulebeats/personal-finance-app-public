import test from 'node:test';
import assert from 'node:assert/strict';
import { absolute, contained, child, disjoint } from './paths.mjs';
import { canonicalJson } from './common.mjs';

test('lexical aliases, ambiguous native paths and URL-like values refuse', () => {
  for (const path of ['relative', 'C:relative', '\\\\server\\share', '\\\\?\\C:\\Owned',
    'C:\\Owned\\..\\outside', 'C:\\Owned/escape', 'C:\\Owned\\CON.txt', 'C:\\Owned\\NUL',
    'C:\\Owned\\file:stream', 'C:\\Owned\\privat~1', 'C:\\Owned\\file.', 'C:\\Owned\\file ',
    'C:\\Owned\\encoded%2fpath', 'C:\\Owned\\file\n', '/owned/../escape', '//server/share', 'https://127.0.0.1/path']) {
    assert.throws(() => absolute(path), /RECOVERY_REFUSED/, path);
  }
});

test('strict descendants and disjoint roots are lexical, case-aware and separator-aware', () => {
  assert.equal(contained('C:\\Owned', 'C:\\owned\\child'), 'C:\\owned\\child');
  assert.equal(child('C:\\Owned', 'objects/a.blob'), 'C:\\Owned\\objects\\a.blob');
  for (const path of ['C:\\Owned', 'C:\\OwnedSibling\\child', 'D:\\Owned\\child', '/Owned/child']) {
    assert.throws(() => contained('C:\\Owned', path), /RECOVERY_REFUSED/);
  }
  assert.throws(() => disjoint('C:\\Owned', 'C:\\owned\\nested'), /RECOVERY_REFUSED/);
  assert.throws(() => child('C:\\Owned', 'objects/../outside'), /RECOVERY_REFUSED/);
  assert.throws(() => contained('/Owned', '/owned/child'), /RECOVERY_REFUSED/);
  // A real junction could still occupy either lexical path: no filesystem was read.
  assert.equal(absolute('C:\\Owned\\possible-junction'), 'C:\\Owned\\possible-junction');
});

test('canonical input refuses hidden symbol fields and array properties instead of silently dropping them', () => {
  const object = { version: 1 }; object[Symbol('hidden')] = 'PRIVATE_SENTINEL';
  const array = [1]; Object.defineProperty(array, 'hidden', { value: 'PRIVATE_SENTINEL' });
  for (const value of [object, array, new Array(2), { version: 1.5 }]) assert.throws(() => canonicalJson(value), /RECOVERY_REFUSED/);
});
