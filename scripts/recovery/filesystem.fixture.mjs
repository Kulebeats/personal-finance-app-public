import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fixture } from './fixture.mjs';
import { canonicalJson, digest, readProducerIntent, readPublishedBundle, readRestoreAuthorization } from './contracts.mjs';

export function ownedFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pfa-r19-fs-'));
  t.after(() => {
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('pfa-r19-fs-')) throw new Error('unsafe test cleanup');
    fs.rmSync(root, { recursive: true, force: true });
  });
  const data = fixture();
  data.intent.artifactRoot = path.join(root, 'bundle'); data.intent.credentialRoot = path.join(root, 'private');
  fs.mkdirSync(data.intent.artifactRoot); fs.mkdirSync(path.join(root, 'bin'));
  fs.mkdirSync(path.join(data.intent.artifactRoot, 'objects'));
  const put = (file, bytes) => { fs.writeFileSync(file, bytes); return { size: Buffer.byteLength(bytes), sha256: createHash('sha256').update(bytes).digest('hex') }; };
  const toolSizes = {};
  for (const name of ['dump', 'restore']) {
    data.intent.tools[name].path = path.join(root, 'bin', `pg_${name}.exe`);
    const result = put(data.intent.tools[name].path, `synthetic-inert-${name}`);
    data.intent.tools[name].sha256 = result.sha256; toolSizes[name] = result.size;
  }
  data.producerPins = { ...data.producerPins, tools: structuredClone(data.intent.tools), artifactRoot: data.intent.artifactRoot, credentialRoot: data.intent.credentialRoot,
    expectedIntentSha256: digest(canonicalJson(data.intent)) };
  data.bundle.producerIntentSha256 = data.producerPins.expectedIntentSha256;
  const archive = path.join(data.intent.artifactRoot, 'database.dump');
  Object.assign(data.bundle.database, put(archive, 'SYNTHETIC INERT BYTES: not a database archive'));
  const blob = Buffer.from('synthetic-object-bytes'); const blobHash = createHash('sha256').update(blob).digest('hex');
  Object.assign(data.bundle.objects[0], { size: blob.length, sha256: blobHash, file: `objects/${blobHash}.blob` });
  put(path.join(data.intent.artifactRoot, ...data.bundle.objects[0].file.split('/')), blob);
  Object.assign(data.bundle.objectManifest, put(path.join(data.intent.artifactRoot, 'objects.json'), canonicalJson(data.bundle.objects)));
  put(path.join(data.intent.artifactRoot, 'bundle-manifest.json'), canonicalJson(data.bundle));
  Object.assign(data.authorization, { producerIntentSha256: data.producerPins.expectedIntentSha256, bundleSha256: digest(canonicalJson(data.bundle)),
    archiveSha256: data.bundle.database.sha256, objectManifestSha256: data.bundle.objectManifest.sha256 });
  Object.assign(data.restorePins, { expectedProducerSha256: data.producerPins.expectedIntentSha256, expectedBundleSha256: data.authorization.bundleSha256,
    expectedArchiveSha256: data.authorization.archiveSha256, expectedObjectManifestSha256: data.authorization.objectManifestSha256,
    expectedAuthorizationSha256: digest(canonicalJson(data.authorization)) });
  const producer = readProducerIntent(canonicalJson(data.intent), data.producerPins);
  const bundle = readPublishedBundle(canonicalJson(data.bundle), producer);
  const restore = readRestoreAuthorization(canonicalJson(data.authorization), producer, bundle, data.restorePins);
  return { root, data, producer, restore, archive, toolSizes, systemRoot: process.env.SystemRoot };
}
