import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson, check, hash, label, parse, shape } from './common.mjs';

const sidecarName = 'fixture-objects.json';
const sidecarKind = 'synthetic-object-fixture-sidecar';
const maxSidecarBytes = 1024 * 1024;
const maxObjectBytes = 10 * 1024 * 1024;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const blobName = (checksum) => checksum + '.blob';

function sidecarObjects(sidecar) {
  try {
    shape(sidecar, ['kind', 'version', 'sourceStoreId', 'objects']);
    check(sidecar.kind === sidecarKind && sidecar.version === 1);
    label(sidecar.sourceStoreId);
    check(Array.isArray(sidecar.objects) && sidecar.objects.length > 0 && sidecar.objects.length <= 128);
    const keys = new Set();
    const versions = new Set();
    let total = 0;
    for (const entry of sidecar.objects) {
      shape(entry, ['key', 'mediaType', 'size', 'sha256', 'file', 'sourceVersion']);
      label(entry.key);
      hash(entry.sha256);
      check(typeof entry.mediaType === 'string' && /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(entry.mediaType));
      check(Number.isSafeInteger(entry.size) && entry.size > 0 && entry.size <= maxObjectBytes);
      check(entry.file === 'objects/' + blobName(entry.sha256));
      shape(entry.sourceVersion, ['kind', 'id']);
      const versionId = entry.sourceVersion.id;
      label(versionId);
      check(entry.sourceVersion.kind === 'versioned' && versionId.startsWith(sidecar.sourceStoreId + '/'));
      check(!keys.has(entry.key) && !versions.has(versionId));
      keys.add(entry.key);
      versions.add(versionId);
      total += entry.size;
    }
    check(total <= 64 * 1024 * 1024);
    return sidecar.objects;
  } catch (error) {
    throw new Error('invalid fixture sidecar', { cause: error });
  }
}

function identity(stat) {
  const fields = [stat.dev, stat.ino, stat.mode, stat.birthtimeNs];
  if (stat.isFile()) fields.push(stat.nlink, stat.size, stat.ctimeNs, stat.mtimeNs);
  return fields.map(String).join('/');
}

function directoryIdentity(directory) {
  const info = fs.lstatSync(directory, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || info.ino === 0n ||
      fs.realpathSync.native(directory) !== directory) throw new Error('invalid fixture directory custody');
  return identity(info);
}

// Pin all ancestors, including the parent of a capture that does not exist yet.
// These synchronous observations apply only to the owned, quiescent synthetic fixture.
function directoryCustody(directory) {
  if (!path.isAbsolute(directory) || path.normalize(directory) !== directory) throw new Error('invalid fixture directory path');
  const ancestors = [];
  for (let current = directory; ; current = path.dirname(current)) {
    ancestors.unshift(current);
    if (path.dirname(current) === current) break;
  }
  const pinned = new Map(ancestors.map((ancestor) => [ancestor, directoryIdentity(ancestor)]));
  return {
    verify() {
      for (const [ancestor, expected] of pinned) {
        if (directoryIdentity(ancestor) !== expected) throw new Error('fixture directory custody changed');
      }
    },
    add(child) {
      this.verify();
      pinned.set(child, directoryIdentity(child));
    },
  };
}

function verifyFile(file, expected) {
  const current = fs.lstatSync(file, { bigint: true });
  if (!current.isFile() || current.nlink !== 1n || identity(current) !== expected) {
    throw new Error('fixture artifact identity changed');
  }
}

function readArtifact(file, kind, maxBytes, custody) {
  custody.verify();
  const info = fs.lstatSync(file, { bigint: true, throwIfNoEntry: false });
  if (!info) throw new Error('missing ' + kind);
  if (!info.isFile() || info.nlink !== 1n || info.ino === 0n) throw new Error('invalid ' + kind + ' file');
  if (info.size > BigInt(maxBytes)) throw new Error(kind + ' size mismatch');
  const expected = identity(info);
  const fd = fs.openSync(file, fs.constants.O_RDONLY);
  try {
    if (identity(fs.fstatSync(fd, { bigint: true })) !== expected) throw new Error('fixture artifact identity changed');
    // Consume only the admitted size plus one EOF probe, even if the file grows.
    const bytes = Buffer.alloc(Number(info.size) + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = fs.readSync(fd, bytes, size, bytes.length - size, size);
      if (count === 0) break;
      size += count;
    }
    if (size !== Number(info.size)) throw new Error(kind + ' size mismatch');
    if (identity(fs.fstatSync(fd, { bigint: true })) !== expected) throw new Error('fixture artifact identity changed');
    verifyFile(file, expected);
    custody.verify();
    return { bytes: bytes.subarray(0, size), file, identity: expected };
  } finally {
    fs.closeSync(fd);
  }
}

function verifiedBlob(objectsDir, entry, custody) {
  const artifact = readArtifact(path.join(objectsDir, blobName(entry.sha256)), 'object blob', entry.size, custody);
  if (artifact.bytes.length !== entry.size) throw new Error('object blob size mismatch');
  if (sha256(artifact.bytes) !== entry.sha256) throw new Error('object blob checksum mismatch');
  return artifact;
}

/** Use a fresh directory inside an owned synthetic test root. All writers are quiesced by the synchronous capture. */
export function exportFixtureObjects(artifactDir, source) {
  const sidecar = { kind: sidecarKind, version: 1, sourceStoreId: source.id, objects: [] };
  const blobs = new Map();
  for (const [key, object] of source.entries()) {
    const checksum = sha256(object.bytes);
    if (checksum !== object.sha256) throw new Error('source fixture object checksum mismatch');
    const file = blobName(checksum);
    blobs.set(file, object.bytes);
    sidecar.objects.push({
      key, mediaType: object.mediaType, size: object.bytes.length, sha256: checksum, file: 'objects/' + file,
      sourceVersion: { kind: 'versioned', id: object.versionId },
    });
  }
  sidecarObjects(sidecar);
  const sidecarBytes = Buffer.from(canonicalJson(sidecar));
  const custody = directoryCustody(path.dirname(artifactDir));
  fs.mkdirSync(artifactDir);
  custody.add(artifactDir);
  const objectsDir = path.join(artifactDir, 'objects');
  fs.mkdirSync(objectsDir);
  custody.add(objectsDir);
  for (const [file, bytes] of blobs) {
    custody.verify();
    fs.writeFileSync(path.join(objectsDir, file), bytes, { flag: 'wx' });
    custody.verify();
  }
  const artifacts = sidecar.objects.map((entry) => verifiedBlob(objectsDir, entry, custody));
  const partial = path.join(artifactDir, sidecarName + '.partial');
  custody.verify();
  fs.writeFileSync(partial, sidecarBytes, { flag: 'wx' });
  const storedSidecar = readArtifact(partial, 'fixture sidecar', maxSidecarBytes, custody);
  if (sha256(storedSidecar.bytes) !== sha256(sidecarBytes)) throw new Error('fixture sidecar checksum mismatch');
  for (const artifact of artifacts) verifyFile(artifact.file, artifact.identity);
  verifyFile(storedSidecar.file, storedSidecar.identity);
  custody.verify();
  // Hard-link publication is atomic and refuses an occupied final name.
  fs.linkSync(partial, path.join(artifactDir, sidecarName));
  custody.verify();
  fs.unlinkSync(partial);
  custody.verify();
  return sha256(sidecarBytes);
}

/** Restore only fixture bytes and record each new version. The caller supplies the capture digest separately. */
export function restoreFixtureObjects(artifactDir, expectedSidecarSha256, destination) {
  if (destination.size !== 0) throw new Error('fixture destination must be empty');
  const custody = directoryCustody(artifactDir);
  const sidecarArtifact = readArtifact(path.join(artifactDir, sidecarName), 'fixture sidecar', maxSidecarBytes, custody);
  const sidecarBytes = sidecarArtifact.bytes;
  if (sha256(sidecarBytes) !== expectedSidecarSha256) throw new Error('fixture sidecar checksum mismatch');
  let sidecar;
  try {
    sidecar = parse(sidecarBytes.toString('utf8'));
  } catch (error) {
    throw new Error('invalid fixture sidecar', { cause: error });
  }
  const objects = sidecarObjects(sidecar);
  if (sidecar.sourceStoreId === destination.id) throw new Error('fixture destination must be distinct from source');

  const objectsDir = path.join(artifactDir, 'objects');
  custody.add(objectsDir);
  // Validate every artifact before inserting any object into the empty destination.
  const verified = objects.map((entry) => {
    return { entry, artifact: verifiedBlob(objectsDir, entry, custody) };
  });
  verifyFile(sidecarArtifact.file, sidecarArtifact.identity);
  for (const { artifact } of verified) verifyFile(artifact.file, artifact.identity);
  custody.verify();
  return verified.map(({ entry, artifact }) => {
    const restored = destination.put(entry.key, { bytes: artifact.bytes, mediaType: entry.mediaType });
    return {
      key: entry.key, sha256: entry.sha256,
      sourceVersionId: entry.sourceVersion.id, destinationVersionId: restored.versionId,
    };
  });
}
