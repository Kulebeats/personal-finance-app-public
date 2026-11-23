import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOwnedS3Objects } from '../../server/core/__tests__/fixtures/owned-s3-objects.ts';
import { installNetworkGuard } from '../../server/testing/network-guard.mjs';
import { digest } from './common.mjs';
import { exportFixtureObjects } from './object-restore.fixture.mjs';

// Main runs this only through the parent test's bounded, owned child process.
assert.equal(process.argv.length, 4);
assert.equal(process.argv[2], '--owned-r19-post-link-crash');
const root = process.argv[3];
assert.equal(fs.realpathSync.native(root), root);
assert.equal(path.dirname(root), fs.realpathSync.native(os.tmpdir()));
assert.match(path.basename(root), /^pfa-r19-object-[a-zA-Z0-9]{6}$/);
assert.deepEqual(fs.readdirSync(root), []);
installNetworkGuard();

const source = createOwnedS3Objects();
const sourceVersions = [
  source.put('v1/receipt/11111111-2222-4333-8444-555555555555', {
    bytes: Buffer.from('R19 synthetic receipt\n'), mediaType: 'image/png',
  }).versionId,
  source.put('v1/attachment/22222222-3333-4444-8555-666666666666', {
    bytes: Buffer.from([0, 1, 127, 128, 255]), mediaType: 'application/octet-stream',
  }).versionId,
];
const artifactDir = path.join(root, 'crash-capture');
const final = path.join(artifactDir, 'fixture-objects.json');
const partial = final + '.partial';
const unlink = fs.unlinkSync;
fs.unlinkSync = function (file, ...args) {
  if (file !== partial) return unlink(file, ...args);
  // exportFixtureObjects has completed its actual linkSync and reached unlinkSync.
  // Park before native unlink so the parent can witness and forcibly stop this PID.
  const finalInfo = fs.lstatSync(final, { bigint: true });
  const partialInfo = fs.lstatSync(partial, { bigint: true });
  assert.equal(finalInfo.dev, partialInfo.dev);
  assert.equal(finalInfo.ino, partialInfo.ino);
  assert.equal(finalInfo.nlink, 2n);
  assert.equal(partialInfo.nlink, 2n);
  fs.writeSync(1, JSON.stringify({
    stage: 'post-link-pre-unlink', pid: process.pid, sourceStoreId: source.id, sourceVersions,
    sidecarSha256: digest(fs.readFileSync(final, 'utf8')),
  }) + '\n');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15000);
  throw new Error('parent did not terminate the parked synthetic capture');
};

exportFixtureObjects(artifactDir, source);
throw new Error('synthetic capture unexpectedly returned after the crash boundary');
