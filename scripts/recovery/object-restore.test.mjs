import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createOwnedS3Objects } from '../../server/core/__tests__/fixtures/owned-s3-objects.ts';
import { canonicalJson, digest } from './common.mjs';
import { exportFixtureObjects, restoreFixtureObjects } from './object-restore.fixture.mjs';
import { superviseCrashChild } from './object-restore-supervision.fixture.mjs';

const expected = [
  {
    key: 'v1/receipt/11111111-2222-4333-8444-555555555555',
    mediaType: 'image/png',
    bytes: Buffer.from('R19 synthetic receipt\n'),
    sha256: 'e97c72e7b90c8776c853338735d0b3ece3c12923b63ce327271ff915dd422563',
  },
  {
    key: 'v1/attachment/22222222-3333-4444-8555-666666666666',
    mediaType: 'application/octet-stream',
    bytes: Buffer.from([0, 1, 127, 128, 255]),
    sha256: '0150a92bb1212cd00516b65fde0704614760000963874fcbb11eaa734ee87809',
  },
];

function fixtureRoot(t) {
  const parent = fs.realpathSync.native(os.tmpdir());
  const prefix = 'pfa-r19-object-';
  const root = fs.mkdtempSync(path.join(parent, prefix));
  t.after(() => {
    if (fs.realpathSync.native(root) !== root || path.dirname(root) !== parent || !path.basename(root).startsWith(prefix)) {
      throw new Error('unsafe test cleanup');
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function seedObjects(objects = expected) {
  const source = createOwnedS3Objects();
  const sourceVersions = objects.map(({ key, bytes, mediaType }) => source.put(key, { bytes, mediaType }).versionId);
  return { source, sourceVersions };
}

function capture(t, objects = expected) {
  const artifactDir = path.join(fixtureRoot(t), 'capture');
  const { source, sourceVersions } = seedObjects(objects);
  const sidecarSha256 = exportFixtureObjects(artifactDir, source);
  const sourceStoreId = source.id;
  source.retire();
  assert.throws(() => source.get(objects[0].key), /retired/);
  return { artifactDir, sidecarSha256, sourceStoreId, sourceVersions };
}

const sidecarFile = (dir) => path.join(dir, 'fixture-objects.json');
const blobFile = (dir, { sha256 }) => path.join(dir, 'objects', sha256 + '.blob');

function observeBlobReads(t, blob, beforeRead = () => {}) {
  const identity = fs.lstatSync(blob, { bigint: true });
  const fstat = fs.fstatSync;
  const readFile = fs.readFileSync;
  const read = fs.readSync;
  const matches = (stat) => stat.dev === identity.dev && stat.ino === identity.ino;
  const tracked = (file) => file === blob || (typeof file === 'number' && matches(fstat(file, { bigint: true })));
  let bytes = 0;
  t.mock.method(fs, 'readFileSync', (file, ...args) => {
    const selected = tracked(file);
    if (selected) beforeRead();
    const prior = bytes;
    const data = readFile(file, ...args);
    if (selected) bytes = prior + Buffer.byteLength(data);
    return data;
  });
  t.mock.method(fs, 'readSync', (fd, ...args) => {
    const selected = tracked(fd);
    if (selected) beforeRead();
    const count = read(fd, ...args);
    if (selected) bytes += count;
    return count;
  });
  return { matches, bytes: () => bytes };
}

test('reconstructs both objects and maps their source versions after the source retires', (t) => {
  const f = capture(t);
  const destination = createOwnedS3Objects();
  assert.equal(destination.size, 0);
  const mappings = restoreFixtureObjects(f.artifactDir, f.sidecarSha256, destination);
  const sidecar = JSON.parse(fs.readFileSync(sidecarFile(f.artifactDir), 'utf8'));

  assert.equal(sidecar.kind, 'synthetic-object-fixture-sidecar');
  assert.equal(sidecar.sourceStoreId, f.sourceStoreId);
  assert.equal(destination.size, expected.length);
  assert.deepEqual(sidecar.objects, expected.map(({ key, bytes, sha256, mediaType }, index) => ({
    key, mediaType, size: bytes.length, sha256, file: 'objects/' + sha256 + '.blob',
    sourceVersion: { kind: 'versioned', id: f.sourceVersions[index] },
  })));
  assert.deepEqual(mappings, expected.map(({ key, bytes, sha256, mediaType }, index) => {
    const restored = destination.get(key);
    const sourceVersionId = f.sourceVersions[index];
    assert.deepEqual(fs.readFileSync(blobFile(f.artifactDir, { sha256 })), bytes);
    assert.deepEqual(restored.bytes, bytes);
    assert.equal(restored.sha256, sha256);
    assert.equal(restored.mediaType, mediaType);
    assert.notEqual(restored.versionId, sourceVersionId);
    assert.equal(destination.get(key, sourceVersionId), undefined);
    assert.deepEqual(destination.get(key, restored.versionId), restored);
    return { key, sha256, sourceVersionId, destinationVersionId: restored.versionId };
  }));
});

test('restores two distinct object records from one content-addressed blob', (t) => {
  const [receipt, attachment] = expected;
  const sameBytes = [receipt, { ...attachment, bytes: receipt.bytes, sha256: receipt.sha256 }];
  const f = capture(t, sameBytes);
  const blob = receipt.sha256 + '.blob';
  assert.deepEqual(fs.readdirSync(path.join(f.artifactDir, 'objects')), [blob]);
  assert.deepEqual(fs.readFileSync(blobFile(f.artifactDir, receipt)), receipt.bytes);
  const destination = createOwnedS3Objects();
  const mappings = restoreFixtureObjects(f.artifactDir, f.sidecarSha256, destination);
  assert.equal(destination.size, 2);
  assert.deepEqual(mappings.map(({ key, sourceVersionId, sha256 }) => ({ key, sourceVersionId, sha256 })),
    sameBytes.map(({ key, sha256 }, index) => ({ key, sha256, sourceVersionId: f.sourceVersions[index] })));
  assert.notEqual(mappings[0].destinationVersionId, mappings[1].destinationVersionId);
  for (const [index, { key, bytes, mediaType, sha256 }] of sameBytes.entries()) {
    const { destinationVersionId, sourceVersionId } = mappings[index];
    const stored = destination.get(key, destinationVersionId);
    assert.notEqual(destinationVersionId, sourceVersionId);
    assert.deepEqual(stored.bytes, bytes);
    assert.equal(stored.mediaType, mediaType);
    assert.equal(stored.sha256, sha256);
  }
});

for (const [name, modify, error] of [
  ['missing blob', (file) => fs.unlinkSync(file), /missing object blob/],
  ['same-length corrupt blob', (file) => fs.writeFileSync(file, Buffer.alloc(5)), /object blob checksum mismatch/],
  ['truncated blob', (file) => fs.truncateSync(file, 1), /object blob size mismatch/],
]) {
  test('rejects a ' + name + ' without restoring any objects', (t) => {
    const f = capture(t);
    const destination = createOwnedS3Objects();
    modify(blobFile(f.artifactDir, expected[1]));
    assert.throws(() => restoreFixtureObjects(f.artifactDir, f.sidecarSha256, destination), error);
    assert.equal(destination.size, 0);
  });
}

test('rejects a missing sidecar without restoring any objects', (t) => {
  const f = capture(t);
  const destination = createOwnedS3Objects();
  fs.unlinkSync(sidecarFile(f.artifactDir));
  assert.throws(() => restoreFixtureObjects(f.artifactDir, f.sidecarSha256, destination), /missing fixture sidecar/);
  assert.equal(destination.size, 0);
});

test('rejects a synthetic restore through an ancestor junction', (t) => {
  const f = capture(t);
  const root = path.dirname(f.artifactDir);
  const storage = path.join(root, 'owned-storage');
  const actualCapture = path.join(storage, 'capture');
  const junction = path.join(root, 'capture-junction');
  const aliasedCapture = path.join(junction, 'capture');
  fs.mkdirSync(storage);
  fs.renameSync(f.artifactDir, actualCapture);
  fs.symlinkSync(storage, junction, 'junction');

  try {
    assert.ok(fs.lstatSync(junction).isSymbolicLink());
    assert.ok(fs.lstatSync(aliasedCapture).isDirectory());
    assert.equal(fs.realpathSync.native(aliasedCapture), fs.realpathSync.native(actualCapture));
    assert.equal(digest(fs.readFileSync(sidecarFile(aliasedCapture), 'utf8')), f.sidecarSha256);
    const destination = createOwnedS3Objects();
    const restore = t.mock.fn(() => restoreFixtureObjects(aliasedCapture, f.sidecarSha256, destination));
    try { restore(); } catch { /* Assert the recorded outcome below. */ }
    assert.deepEqual({ refused: restore.mock.calls[0].error instanceof Error, restored: destination.size },
      { refused: true, restored: 0 });
  } finally {
    fs.unlinkSync(junction);
  }
});

test('refuses synthetic export through an ancestor junction before writing artifacts', (t) => {
  const root = fixtureRoot(t);
  const storage = path.join(root, 'separate-storage');
  const junction = path.join(root, 'export-junction');
  const actualCapture = path.join(storage, 'capture');
  fs.mkdirSync(storage);
  fs.symlinkSync(storage, junction, 'junction');

  try {
    assert.ok(fs.lstatSync(junction).isSymbolicLink());
    assert.equal(fs.realpathSync.native(junction), fs.realpathSync.native(storage));
    assert.deepEqual(fs.readdirSync(storage), []);
    const { source } = seedObjects();
    const attemptExport = t.mock.fn(() => exportFixtureObjects(path.join(junction, 'capture'), source));
    try { attemptExport(); } catch { /* Compare refusal and the separate directory state together. */ }
    assert.deepEqual({
      refused: attemptExport.mock.calls[0].error instanceof Error,
      published: fs.existsSync(sidecarFile(actualCapture)),
      blobCount: fs.existsSync(path.join(actualCapture, 'objects')) ? fs.readdirSync(path.join(actualCapture, 'objects')).length : 0,
      entries: fs.readdirSync(storage),
    }, { refused: true, published: false, blobCount: 0, entries: [] });
  } finally {
    fs.unlinkSync(junction);
  }
});

test('retains an unpublished partial capture when the second synthetic blob write fails', (t) => {
  const artifactDir = path.join(fixtureRoot(t), 'capture');
  const { source } = seedObjects();
  const first = blobFile(artifactDir, expected[0]);
  const second = blobFile(artifactDir, expected[1]);
  const failure = new Error('synthetic second blob write refusal');
  const writeFile = fs.writeFileSync;
  const writes = t.mock.method(fs, 'writeFileSync', (file, ...args) => {
    if (file === second) throw failure;
    return writeFile(file, ...args);
  });

  assert.throws(() => exportFixtureObjects(artifactDir, source), (error) => error === failure);
  assert.deepEqual(writes.mock.calls.map((call) => call.arguments[0]), [first, second]);
  assert.deepEqual(fs.readFileSync(first), expected[0].bytes);
  assert.equal(fs.existsSync(second), false);
  assert.equal(fs.existsSync(sidecarFile(artifactDir)), false);
  assert.throws(() => exportFixtureObjects(artifactDir, source), { code: 'EEXIST' });
  assert.deepEqual(writes.mock.calls.map((call) => call.arguments[0]), [first, second]);
  assert.deepEqual(fs.readdirSync(path.join(artifactDir, 'objects')), [path.basename(first)]);
  assert.deepEqual(fs.readFileSync(first), expected[0].bytes);
  assert.equal(fs.existsSync(sidecarFile(artifactDir)), false);
});

test('does not publish a completed synthetic capture with a corrupt blob', (t) => {
  const artifactDir = path.join(fixtureRoot(t), 'capture');
  const { source, sourceVersions } = seedObjects();
  const object = expected[1];
  const corrupt = Buffer.from(object.bytes);
  corrupt[0] ^= 0xff;
  const selectedBlob = blobFile(artifactDir, object);
  const sidecar = sidecarFile(artifactDir);
  const writeFile = fs.writeFileSync;
  let injected = false;
  let published = false;
  const witnessPublication = (file) => {
    if (file === sidecar && fs.existsSync(sidecar)) published = true;
  };
  for (const method of ['renameSync', 'linkSync', 'copyFileSync']) {
    const publishFile = fs[method];
    t.mock.method(fs, method, (sourceFile, destinationFile, ...args) => {
      try { return publishFile(sourceFile, destinationFile, ...args); }
      finally { witnessPublication(destinationFile); }
    });
  }
  t.mock.method(fs, 'writeFileSync', (file, bytes, ...args) => {
    try {
      const result = writeFile(file, bytes, ...args);
      if (file === selectedBlob && !injected) {
        assert.deepEqual(fs.readFileSync(file), object.bytes);
        writeFile(file, corrupt);
        assert.deepEqual(fs.readFileSync(file), corrupt);
        injected = true;
      }
      return result;
    } finally {
      witnessPublication(file);
    }
  });

  const captureAttempt = t.mock.fn(() => exportFixtureObjects(artifactDir, source));
  try { captureAttempt(); } catch { /* Check the recorded publication outcome. */ }
  assert.ok(injected, 'the selected blob was corrupted after its successful write');
  assert.deepEqual(source.get(object.key, sourceVersions[1]).bytes, object.bytes);
  source.retire();
  const [{ result, error }] = captureAttempt.mock.calls;
  if (error) {
    assert.equal(published, false, 'a refused capture must never have published its sidecar');
    assert.equal(fs.existsSync(sidecar), false, 'a refused capture must remain unpublished');
    return;
  }

  const text = fs.readFileSync(sidecar, 'utf8');
  assert.equal(digest(text), result);
  assert.deepEqual(JSON.parse(text).objects.map(({ key, sha256, size }) => ({ key, sha256, size })),
    expected.map(({ key, sha256, bytes }) => ({ key, sha256, size: bytes.length })));
  const destination = createOwnedS3Objects();
  const put = t.mock.method(destination, 'put');
  const restore = t.mock.fn(() => restoreFixtureObjects(artifactDir, result, destination));
  try { restore(); } catch { /* Check whether the published capture is restorable. */ }
  assert.deepEqual({
    error: restore.mock.calls[0].error?.message ?? null, puts: put.mock.callCount(), objects: destination.size,
  }, { error: null, puts: expected.length, objects: expected.length }, 'a completed capture must restore both pinned objects');
  for (const entry of expected) assert.deepEqual(destination.get(entry.key).bytes, entry.bytes);
});

test('refuses synthetic export after its parent is replaced during directory creation', (t) => {
  const root = fixtureRoot(t);
  const parent = path.join(root, 'capture-parent');
  const parked = path.join(root, 'original-parent');
  const storage = path.join(root, 'separate-storage');
  const artifactDir = path.join(parent, 'capture');
  const redirected = path.join(storage, 'capture');
  fs.mkdirSync(parent);
  fs.mkdirSync(storage);
  fs.mkdirSync(redirected);
  assert.deepEqual(fs.readdirSync(redirected), []);
  const { source } = seedObjects();
  const mkdir = fs.mkdirSync;
  let swapped = false;
  t.mock.method(fs, 'mkdirSync', (file, ...args) => {
    const result = mkdir(file, ...args);
    if (file === artifactDir && !swapped) {
      fs.renameSync(parent, parked);
      fs.symlinkSync(storage, parent, 'junction');
      swapped = true;
    }
    return result;
  });

  try {
    const attemptExport = t.mock.fn(() => exportFixtureObjects(artifactDir, source));
    try { attemptExport(); } catch { /* Compare the reached swap and actual output state. */ }
    assert.ok(swapped, 'the requested parent was replaced after creating its child');
    assert.ok(fs.lstatSync(parent).isSymbolicLink());
    assert.equal(fs.realpathSync.native(artifactDir), fs.realpathSync.native(redirected));
    const originalCapture = path.join(parked, 'capture');
    if (fs.existsSync(originalCapture)) assert.deepEqual(fs.readdirSync(originalCapture), []);
    assert.deepEqual({
      refused: attemptExport.mock.calls[0].error instanceof Error,
      redirectedEntries: fs.readdirSync(redirected).sort(),
      redirectedBlobs: fs.existsSync(path.join(redirected, 'objects')) ? fs.readdirSync(path.join(redirected, 'objects')).length : 0,
    }, { refused: true, redirectedEntries: [], redirectedBlobs: 0 });
  } finally {
    if (swapped) fs.unlinkSync(parent);
  }
});

test('does not publish a synthetic sidecar after a partial sidecar write', (t) => {
  const artifactDir = path.join(fixtureRoot(t), 'capture');
  const { source } = seedObjects();
  const final = sidecarFile(artifactDir);
  const failure = new Error('synthetic interrupted sidecar write');
  const sidecarPrefix = Buffer.from('{"kind":"synthetic-object-fixture-sidecar"');
  const writeFile = fs.writeFileSync;
  let fragment;
  let faults = 0;
  t.mock.method(fs, 'writeFileSync', (file, bytes, ...args) => {
    if (Buffer.isBuffer(bytes) && bytes.subarray(0, sidecarPrefix.length).equals(sidecarPrefix)) {
      fragment = bytes.subarray(0, 10);
      writeFile(file, fragment, ...args);
      faults++;
      throw failure;
    }
    return writeFile(file, bytes, ...args);
  });

  assert.throws(() => exportFixtureObjects(artifactDir, source), Error);
  assert.equal(faults, 1);
  for (const entry of expected) assert.deepEqual(fs.readFileSync(blobFile(artifactDir, entry)), entry.bytes);
  const published = fs.existsSync(final);
  if (published) {
    assert.deepEqual(fs.readFileSync(final), fragment);
    const destination = createOwnedS3Objects();
    assert.throws(() => restoreFixtureObjects(artifactDir, digest(fragment.toString('utf8')), destination), /invalid fixture sidecar/);
    assert.equal(destination.size, 0);
  }
  assert.equal(published, false, 'a partial sidecar appeared at the published path');
});

test('rejects a synthetic restore after an identical-byte blob replacement', (t) => {
  const f = capture(t);
  const blob = blobFile(f.artifactDir, expected[1]);
  const displaced = path.join(path.dirname(f.artifactDir), 'original-blob');
  const lstat = fs.lstatSync;
  const original = lstat(blob, { bigint: true });
  let swapped = false;
  t.mock.method(fs, 'lstatSync', (file, options) => {
    const result = lstat(file, options);
    if (file === blob && !swapped) {
      fs.renameSync(blob, displaced);
      fs.copyFileSync(displaced, blob, fs.constants.COPYFILE_EXCL);
      swapped = true;
    }
    return result;
  });

  const destination = createOwnedS3Objects();
  const restore = t.mock.fn(() => restoreFixtureObjects(f.artifactDir, f.sidecarSha256, destination));
  try { restore(); } catch { /* Assert the recorded outcome below. */ }
  assert.ok(swapped, 'the selected blob was swapped after its initial lstat');
  assert.notEqual(lstat(blob, { bigint: true }).ino, original.ino);
  assert.deepEqual(fs.readFileSync(blob), expected[1].bytes);
  assert.deepEqual(fs.readFileSync(displaced), expected[1].bytes);
  assert.deepEqual({ refused: restore.mock.calls[0].error instanceof Error, restored: destination.size },
    { refused: true, restored: 0 });
});

test('refuses a synthetic blob that already exceeds its declared size before reading it', (t) => {
  const f = capture(t);
  const object = expected[1];
  const blob = blobFile(f.artifactDir, object);
  fs.truncateSync(blob, object.bytes.length + 64 * 1024);
  const readback = observeBlobReads(t, blob);
  const destination = createOwnedS3Objects();
  const put = t.mock.method(destination, 'put');
  assert.throws(() => restoreFixtureObjects(f.artifactDir, f.sidecarSha256, destination));
  assert.equal(put.mock.callCount(), 0);
  assert.equal(destination.size, 0);
  assert.equal(readback.bytes(), 0, 'a known oversized blob must be refused before reading');
});

test('bounds synthetic blob reads when the file grows after its initial size check', (t) => {
  const f = capture(t);
  const object = expected[1];
  const blob = blobFile(f.artifactDir, object);
  const declared = object.bytes.length;
  const oversized = declared + 64 * 1024;
  const lstat = fs.lstatSync;
  const fstat = fs.fstatSync;
  let inspectedSize;
  let grew = false;
  const readback = observeBlobReads(t, blob, () => {
    if (grew) return;
    assert.equal(inspectedSize, declared);
    fs.truncateSync(blob, oversized);
    grew = true;
  });
  t.mock.method(fs, 'lstatSync', (file, options) => {
    const stat = lstat(file, options);
    if (file === blob && !grew) inspectedSize = Number(stat.size);
    return stat;
  });
  t.mock.method(fs, 'fstatSync', (fd, options) => {
    const stat = fstat(fd, options);
    if (!grew && readback.matches(fstat(fd, { bigint: true }))) inspectedSize = Number(stat.size);
    return stat;
  });

  const destination = createOwnedS3Objects();
  const put = t.mock.method(destination, 'put');
  assert.throws(() => restoreFixtureObjects(f.artifactDir, f.sidecarSha256, destination));
  assert.ok(grew, 'the selected blob must grow after the reader observes its size');
  const after = lstat(blob, { bigint: true });
  assert.ok(readback.matches(after), 'the same file grew in place');
  assert.equal(Number(after.size), oversized);
  assert.equal(put.mock.callCount(), 0);
  assert.equal(destination.size, 0);
  assert.ok(readback.bytes() <= declared + 1, `read ${readback.bytes()} bytes for a ${declared}-byte blob`);
});

test('rejects a sidecar with swapped source versions against the pinned digest', (t) => {
  const f = capture(t);
  const destination = createOwnedS3Objects();
  const file = sidecarFile(f.artifactDir);
  const sidecar = JSON.parse(fs.readFileSync(file, 'utf8'));
  [sidecar.objects[0].sourceVersion, sidecar.objects[1].sourceVersion] =
    [sidecar.objects[1].sourceVersion, sidecar.objects[0].sourceVersion];
  fs.writeFileSync(file, canonicalJson(sidecar));
  assert.throws(() => restoreFixtureObjects(f.artifactDir, f.sidecarSha256, destination), /fixture sidecar checksum mismatch/);
  assert.equal(destination.size, 0);
});

for (const [name, modify] of [
  ['a repeated object key', (sidecar) => { sidecar.objects[1].key = sidecar.objects[0].key; }],
  ['a foreign source version', (sidecar) => { sidecar.objects[1].sourceVersion.id = 'another-store/2'; }],
]) {
  test('rejects ' + name + ' even with a matching sidecar digest', (t) => {
    const f = capture(t);
    const destination = createOwnedS3Objects();
    const file = sidecarFile(f.artifactDir);
    const sidecar = JSON.parse(fs.readFileSync(file, 'utf8'));
    modify(sidecar);
    const text = canonicalJson(sidecar);
    const changedDigest = digest(text);
    assert.notEqual(changedDigest, f.sidecarSha256);
    fs.writeFileSync(file, text);
    assert.throws(() => restoreFixtureObjects(f.artifactDir, changedDigest, destination), /invalid fixture sidecar/);
    assert.equal(destination.size, 0);
  });
}

test('refuses an empty destination with the captured source identity', (t) => {
  const f = capture(t);
  const destination = Object.assign(createOwnedS3Objects(), { id: f.sourceStoreId });
  assert.equal(destination.size, 0);
  assert.throws(() => restoreFixtureObjects(f.artifactDir, f.sidecarSha256, destination), /destination must be distinct from source/);
  assert.equal(destination.size, 0);
});

test('refuses to overwrite a published fixture or restore into a nonempty store', (t) => {
  const f = capture(t);
  const destination = createOwnedS3Objects();
  const { key, bytes, mediaType } = expected[0];
  const prior = destination.put(key, { bytes, mediaType });
  assert.throws(() => exportFixtureObjects(f.artifactDir, destination), { code: 'EEXIST' });
  assert.throws(() => restoreFixtureObjects(f.artifactDir, f.sidecarSha256, destination), /destination must be empty/);
  assert.equal(destination.size, 1);
  assert.deepEqual(destination.get(key), prior);
});


test('consumes verified descriptors and closes them after successful restore', (t) => {
  const f = capture(t);
  const open = fs.openSync;
  const descriptors = [];
  const files = [sidecarFile(f.artifactDir), ...expected.map((entry) => blobFile(f.artifactDir, entry))];
  t.mock.method(fs, 'openSync', (file, ...args) => {
    const fd = open(file, ...args);
    if (files.includes(file)) descriptors.push(fd);
    return fd;
  });
  const readFile = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file, ...args) => {
    assert.ok(!files.includes(file) && !descriptors.includes(file), 'restore must consume its bounded descriptor reader');
    return readFile(file, ...args);
  });
  const destination = createOwnedS3Objects();
  restoreFixtureObjects(f.artifactDir, f.sidecarSha256, destination);
  assert.equal(descriptors.length, files.length);
  for (const fd of descriptors) assert.throws(() => fs.fstatSync(fd), { code: 'EBADF' });
  for (const entry of expected) assert.deepEqual(destination.get(entry.key).bytes, entry.bytes);
});

test('closes the verified descriptor when a synthetic blob read fails', (t) => {
  const f = capture(t);
  const blob = blobFile(f.artifactDir, expected[1]);
  const open = fs.openSync;
  const read = fs.readSync;
  const failure = new Error('synthetic descriptor read interruption');
  let descriptor;
  t.mock.method(fs, 'openSync', (file, ...args) => {
    const fd = open(file, ...args);
    if (file === blob) descriptor = fd;
    return fd;
  });
  t.mock.method(fs, 'readSync', (fd, ...args) => {
    if (fd === descriptor) throw failure;
    return read(fd, ...args);
  });
  const destination = createOwnedS3Objects();
  const put = t.mock.method(destination, 'put');
  assert.throws(() => restoreFixtureObjects(f.artifactDir, f.sidecarSha256, destination), (error) => error === failure);
  assert.equal(put.mock.callCount(), 0);
  assert.equal(destination.size, 0);
  assert.equal(typeof descriptor, 'number');
  assert.throws(() => fs.fstatSync(descriptor), { code: 'EBADF' });
});

test('refuses replacement of a blob path after opening its verified descriptor', (t) => {
  const f = capture(t);
  const blob = blobFile(f.artifactDir, expected[1]);
  const original = path.join(path.dirname(f.artifactDir), 'opened-blob');
  const open = fs.openSync;
  let swapped = false;
  t.mock.method(fs, 'openSync', (file, ...args) => {
    const fd = open(file, ...args);
    if (file === blob && !swapped) {
      fs.renameSync(blob, original);
      fs.copyFileSync(original, blob, fs.constants.COPYFILE_EXCL);
      swapped = true;
    }
    return fd;
  });
  const destination = createOwnedS3Objects();
  const put = t.mock.method(destination, 'put');
  assert.throws(() => restoreFixtureObjects(f.artifactDir, f.sidecarSha256, destination));
  assert.ok(swapped);
  assert.equal(put.mock.callCount(), 0);
  assert.equal(destination.size, 0);
});

test('refuses export after its parent is replaced by another ordinary directory', (t) => {
  const root = fixtureRoot(t);
  const parent = path.join(root, 'parent');
  const parked = path.join(root, 'parked');
  const artifactDir = path.join(parent, 'capture');
  fs.mkdirSync(parent);
  const { source } = seedObjects();
  const mkdir = fs.mkdirSync;
  let swapped = false;
  t.mock.method(fs, 'mkdirSync', (file, ...args) => {
    const result = mkdir(file, ...args);
    if (file === artifactDir && !swapped) {
      fs.renameSync(parent, parked);
      mkdir(parent);
      mkdir(artifactDir);
      swapped = true;
    }
    return result;
  });
  assert.throws(() => exportFixtureObjects(artifactDir, source), /custody changed/);
  assert.ok(swapped);
  assert.deepEqual(fs.readdirSync(artifactDir), []);
  assert.deepEqual(fs.readdirSync(path.join(parked, 'capture')), []);
});

test('retains verified blobs and an unpublished sidecar when final publication is interrupted', (t) => {
  const artifactDir = path.join(fixtureRoot(t), 'capture');
  const { source } = seedObjects();
  const final = sidecarFile(artifactDir);
  const failure = new Error('synthetic sidecar publication interruption');
  const link = fs.linkSync;
  t.mock.method(fs, 'linkSync', (sourceFile, destinationFile, ...args) => {
    if (destinationFile === final) throw failure;
    return link(sourceFile, destinationFile, ...args);
  });
  assert.throws(() => exportFixtureObjects(artifactDir, source), (error) => error === failure);
  assert.equal(fs.existsSync(final), false);
  const partial = fs.readFileSync(final + '.partial', 'utf8');
  assert.equal(JSON.parse(partial).kind, 'synthetic-object-fixture-sidecar');
  for (const entry of expected) assert.deepEqual(fs.readFileSync(blobFile(artifactDir, entry)), entry.bytes);
  const destination = createOwnedS3Objects();
  assert.throws(() => restoreFixtureObjects(artifactDir, digest(partial), destination), /missing fixture sidecar/);
  assert.equal(destination.size, 0);
});

test('refuses a conflicting final sidecar without overwriting its bytes', (t) => {
  const artifactDir = path.join(fixtureRoot(t), 'capture');
  const { source } = seedObjects();
  const final = sidecarFile(artifactDir);
  const occupied = Buffer.from('synthetic competing sidecar');
  const link = fs.linkSync;
  t.mock.method(fs, 'linkSync', (sourceFile, destinationFile, ...args) => {
    if (destinationFile === final) fs.writeFileSync(final, occupied, { flag: 'wx' });
    return link(sourceFile, destinationFile, ...args);
  });
  assert.throws(() => exportFixtureObjects(artifactDir, source), { code: 'EEXIST' });
  assert.deepEqual(fs.readFileSync(final), occupied);
});

test('fails closed after a child crashes post-link and recovers through a fresh capture directory', { timeout: 20000 }, async (t) => {
  let supervision;
  const root = fixtureRoot({
    after(cleanup) {
      t.after(() => {
        assert.ok(supervision, 'child observation is uninitialized; retaining the owned fixture root');
        supervision.cleanup(cleanup);
      });
    },
  });
  const fixture = fileURLToPath(new URL('./object-restore-post-link-crash.fixture.mjs', import.meta.url));
  const temporaryParent = fs.realpathSync.native(os.tmpdir());
  const env = { TEMP: temporaryParent, TMP: temporaryParent, TZ: 'UTC', LANG: 'C', LC_ALL: 'C' };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  const child = spawn(process.execPath, [fixture, '--owned-r19-post-link-crash', root], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), env,
    shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000, killSignal: 'SIGKILL',
  });
  supervision = superviseCrashChild(child, t);
  const { closed, boundary } = supervision;

  try {
    const witness = await boundary;
    assert.equal(witness.stage, 'post-link-pre-unlink');
    assert.equal(witness.pid, child.pid);
    assert.match(witness.sourceStoreId, /^[a-f0-9-]{36}$/);
    assert.deepEqual(witness.sourceVersions, [witness.sourceStoreId + '/1', witness.sourceStoreId + '/2']);
    const artifactDir = path.join(root, 'crash-capture');
    const final = sidecarFile(artifactDir);
    const partial = final + '.partial';
    const sidecarText = canonicalJson({
      kind: 'synthetic-object-fixture-sidecar', version: 1, sourceStoreId: witness.sourceStoreId,
      objects: expected.map(({ key, mediaType, bytes, sha256 }, index) => ({
        key, mediaType, size: bytes.length, sha256, file: 'objects/' + sha256 + '.blob',
        sourceVersion: { kind: 'versioned', id: witness.sourceVersions[index] },
      })),
    });
    const sidecarSha256 = digest(sidecarText);
    assert.equal(witness.sidecarSha256, sidecarSha256);

    const incompleteState = () => {
      const finalInfo = fs.lstatSync(final, { bigint: true });
      const partialInfo = fs.lstatSync(partial, { bigint: true });
      assert.ok(finalInfo.isFile() && partialInfo.isFile());
      assert.equal(finalInfo.dev, partialInfo.dev);
      assert.equal(finalInfo.ino, partialInfo.ino);
      assert.equal(finalInfo.nlink, 2n);
      assert.equal(partialInfo.nlink, 2n);
      assert.equal(fs.readFileSync(final, 'utf8'), sidecarText);
      assert.equal(fs.readFileSync(partial, 'utf8'), sidecarText);
      assert.deepEqual(fs.readdirSync(artifactDir).sort(), ['fixture-objects.json', 'fixture-objects.json.partial', 'objects']);
      assert.deepEqual(fs.readdirSync(path.join(artifactDir, 'objects')).sort(), expected.map(({ sha256 }) => sha256 + '.blob').sort());
      for (const entry of expected) assert.deepEqual(fs.readFileSync(blobFile(artifactDir, entry)), entry.bytes);
      return { dev: finalInfo.dev, ino: finalInfo.ino, ctimeNs: finalInfo.ctimeNs, mtimeNs: finalInfo.mtimeNs };
    };
    const beforeCrash = incompleteState();
    // Terminate only this child while its exporter is blocked before native unlink.
    assert.equal(child.kill('SIGKILL'), true);
    const termination = await closed;
    assert.equal(termination.error, undefined);
    assert.equal(termination.signal, 'SIGKILL');
    assert.equal(termination.code, null);
    const { stdout, stderr } = supervision.output();
    assert.equal(stderr, '');
    assert.equal(stdout.trim().split('\n').length, 1);
    assert.deepEqual(incompleteState(), beforeCrash);

    const destination = createOwnedS3Objects();
    const put = t.mock.method(destination, 'put');
    assert.throws(() => restoreFixtureObjects(artifactDir, sidecarSha256, destination), /invalid fixture sidecar file/);
    assert.equal(put.mock.callCount(), 0);
    assert.equal(destination.size, 0);
    const { source, sourceVersions } = seedObjects();
    assert.notEqual(source.id, witness.sourceStoreId);
    assert.throws(() => exportFixtureObjects(artifactDir, source), { code: 'EEXIST' });
    assert.deepEqual(incompleteState(), beforeCrash);

    // The interrupted directory stays quarantined. A new synthetic source makes a new capture.
    const freshDir = path.join(root, 'fresh-capture');
    const freshSha256 = exportFixtureObjects(freshDir, source);
    source.retire();
    assert.throws(() => source.get(expected[0].key), /retired/);
    assert.equal(fs.existsSync(sidecarFile(freshDir) + '.partial'), false);
    assert.equal(fs.lstatSync(sidecarFile(freshDir), { bigint: true }).nlink, 1n);
    const restored = createOwnedS3Objects();
    assert.equal(restored.size, 0);
    const mappings = restoreFixtureObjects(freshDir, freshSha256, restored);
    assert.equal(restored.size, expected.length);
    assert.deepEqual(mappings, expected.map(({ key, bytes, mediaType, sha256 }, index) => {
      const object = restored.get(key);
      assert.deepEqual(object.bytes, bytes);
      assert.equal(object.sha256, sha256);
      assert.equal(object.mediaType, mediaType);
      assert.notEqual(object.versionId, sourceVersions[index]);
      assert.equal(restored.get(key, sourceVersions[index]), undefined);
      assert.equal(restored.get(key, witness.sourceVersions[index]), undefined);
      assert.deepEqual(restored.get(key, object.versionId), object);
      return { key, sha256, sourceVersionId: sourceVersions[index], destinationVersionId: object.versionId };
    }));
    assert.deepEqual(incompleteState(), beforeCrash);
    t.diagnostic(JSON.stringify({
      boundary: witness.stage, childPid: child.pid, termination: termination.signal,
      incompleteSidecarLinks: 2, incompletePuts: put.mock.callCount(), sidecarSha256,
      freshSidecarSha256: freshSha256, freshObjects: restored.size,
    }));
  } finally {
    if (child.pid && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  }
});
