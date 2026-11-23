import { validateManifest, markerFor } from '../../server/testing/test-target.mjs';
import { canonicalJson, digest, parse, check, shape, hash, label, instant, freeze } from './common.mjs';
import { absolute, apiFor, child, disjoint } from './paths.mjs';
export { canonicalJson, digest } from './common.mjs';

const verified = new WeakMap();
const certifications = freeze({ filesystemIdentity: false, liveDatabaseIdentity: false, actualBinaryHash: false, executionAuthorized: false });
function record(kind, document, sha256) { const value = freeze({ kind, document, sha256, certifications }); verified.set(value, kind); return value; }
export function requireRecord(value, kind) { check(verified.get(value) === kind); return value; }
function same(a, b) { check(canonicalJson(a) === canonicalJson(b)); }
function target(value, endpoint) {
  shape(value, ['version', 'disposable', 'synthetic', 'host', 'port', 'database', 'runId']);
  check(value.host === '127.0.0.1' && value.port !== 5432 && typeof value.runId === 'string'); same({ host: value.host, port: value.port }, endpoint);
  try { validateManifest(value, value.runId); } catch { check(false); }
}
function tool(value, name) {
  shape(value, ['name', 'path', 'version', 'sha256']); check(value.name === name && typeof value.version === 'string' && /^18\.\d{1,3}$/.test(value.version));
  absolute(value.path); hash(value.sha256);
  const basename = apiFor(value.path).basename(value.path);
  check(basename === (apiFor(value.path).sep === '\\' ? `${name}.exe` : name));
}
function pinsCopy(value) { return parse(canonicalJson(value)); }
export function readProducerIntent(text, trustedPins) {
  const pins = pinsCopy(trustedPins);
  shape(pins, ['expectedIntentSha256', 'producerSha', 'candidateSha', 'rollbackSha', 'schemaSha256', 'journalSha256',
    'sourceTargetSha256', 'restoreTargetSha256', 'tools', 'artifactRoot', 'credentialRoot', 'endpoint', 'databaseUser', 'approvalRef']);
  hash(pins.expectedIntentSha256); check(digest(text) === pins.expectedIntentSha256);
  const value = parse(text);
  shape(value, ['kind', 'version', 'profile', 'runId', 'issuedAt', 'approvalRef', 'producerSha', 'candidateSha', 'rollbackSha',
    'schemaSha256', 'journalSha256', 'source', 'restore', 'tools', 'artifactRoot', 'credentialRoot', 'databaseUser', 'limits', 'outputs']);
  check(value.kind === 'producer-intent' && value.version === 1 && value.profile === 'local-synthetic');
  check(typeof value.runId === 'string' && /^[a-z][a-z0-9]{7,31}$/.test(value.runId)); instant(value.issuedAt); label(value.approvalRef);
  for (const key of ['producerSha', 'candidateSha', 'rollbackSha']) { hash(value[key], 40); same(value[key], pins[key]); }
  for (const key of ['schemaSha256', 'journalSha256']) { hash(value[key]); same(value[key], pins[key]); }
  shape(pins.endpoint, ['host', 'port']); check(pins.endpoint.host === '127.0.0.1' && Number.isInteger(pins.endpoint.port) && pins.endpoint.port > 0 && pins.endpoint.port <= 65535 && pins.endpoint.port !== 5432);
  target(value.source, pins.endpoint); target(value.restore, pins.endpoint);
  check(value.source.database !== value.restore.database && value.source.runId !== value.restore.runId);
  hash(pins.sourceTargetSha256); hash(pins.restoreTargetSha256);
  check(digest(canonicalJson(value.source)) === pins.sourceTargetSha256 && digest(canonicalJson(value.restore)) === pins.restoreTargetSha256);
  shape(value.tools, ['dump', 'restore']); tool(value.tools.dump, 'pg_dump'); tool(value.tools.restore, 'pg_restore'); same(value.tools, pins.tools);
  absolute(value.artifactRoot); absolute(value.credentialRoot); disjoint(value.artifactRoot, value.credentialRoot);
  check(apiFor(value.tools.dump.path) === apiFor(value.artifactRoot) && apiFor(value.tools.restore.path) === apiFor(value.artifactRoot));
  check(typeof value.databaseUser === 'string' && /^[a-z_][a-z0-9_]{0,62}$/.test(value.databaseUser) && !['postgres', 'root'].includes(value.databaseUser));
  for (const key of ['artifactRoot', 'credentialRoot', 'databaseUser', 'approvalRef']) same(value[key], pins[key]);
  shape(value.limits, ['connectTimeoutSeconds', 'processTimeoutMs']);
  check(Number.isInteger(value.limits.connectTimeoutSeconds) && value.limits.connectTimeoutSeconds >= 1 && value.limits.connectTimeoutSeconds <= 30);
  check(Number.isInteger(value.limits.processTimeoutMs) && value.limits.processTimeoutMs >= 1 && value.limits.processTimeoutMs <= 4 * 60 * 60 * 1000);
  same(value.outputs, { archive: 'database.dump', objectManifest: 'objects.json', bundleManifest: 'bundle-manifest.json' });
  return record('producer', value, pins.expectedIntentSha256);
}
function artifact(value, expectedFile) {
  shape(value, ['file', 'size', 'sha256']); check(value.file === expectedFile && Number.isSafeInteger(value.size) && value.size > 0 && value.size <= 1024 ** 3); hash(value.sha256);
}
function object(value, root) {
  shape(value, ['key', 'purpose', 'parentId', 'householdId', 'requesterId', 'mediaType', 'size', 'sha256', 'sourceVersion', 'file']);
  check(typeof value.key === 'string');
  const match = /^v1\/(receipt|receipt-thumbnail|attachment|goal-image|profile-picture|banner|merchant-logo)\/([a-f0-9-]{36})$/.exec(value.key);
  check(match && match[1] === value.purpose);
  for (const id of [match[2], value.parentId, value.householdId, value.requesterId]) check(typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id));
  check(typeof value.mediaType === 'string' && /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(value.mediaType));
  check(Number.isSafeInteger(value.size) && value.size > 0 && value.size <= 10 * 1024 * 1024); hash(value.sha256);
  check(value.file === `objects/${value.sha256}.blob`); child(root, value.file);
  if (value.sourceVersion?.kind === 'versioned') { shape(value.sourceVersion, ['kind', 'id']); check(typeof value.sourceVersion.id === 'string' && /^[a-zA-Z0-9._+/-]{1,256}$/.test(value.sourceVersion.id)); }
  else { shape(value.sourceVersion, ['kind']); check(value.sourceVersion.kind === 'unversioned-immutable'); }
}
export function readPublishedBundle(text, producer) {
  requireRecord(producer, 'producer'); const value = parse(text); const intent = producer.document;
  shape(value, ['kind', 'version', 'state', 'runId', 'producerIntentSha256', 'candidateSha', 'schemaSha256', 'journalSha256',
    'sourceTargetSha256', 'cutAt', 'publishedAt', 'database', 'objectManifest', 'objects']);
  check(value.kind === 'published-bundle' && value.version === 1 && value.state === 'complete' && value.runId === intent.runId);
  check(value.producerIntentSha256 === producer.sha256 && value.sourceTargetSha256 === digest(canonicalJson(intent.source)));
  for (const key of ['candidateSha', 'schemaSha256', 'journalSha256']) same(value[key], intent[key]);
  check(instant(value.cutAt) >= instant(intent.issuedAt) && instant(value.publishedAt) >= instant(value.cutAt));
  artifact(value.database, intent.outputs.archive); artifact(value.objectManifest, intent.outputs.objectManifest);
  check(Array.isArray(value.objects) && value.objects.length > 0 && value.objects.length <= 128);
  const keys = new Set(); let total = 0;
  for (const entry of value.objects) { object(entry, intent.artifactRoot); check(!keys.has(entry.key)); keys.add(entry.key); total += entry.size; }
  check(total <= 64 * 1024 * 1024);
  return record('bundle', value, digest(text)); // Integrity structure only; restore needs external provenance pins.
}
export function readRestoreAuthorization(text, producer, bundle, trustedPins) {
  requireRecord(producer, 'producer'); requireRecord(bundle, 'bundle');
  const pins = pinsCopy(trustedPins);
  shape(pins, ['expectedAuthorizationSha256', 'expectedProducerSha256', 'expectedBundleSha256', 'expectedArchiveSha256',
    'expectedObjectManifestSha256', 'expectedSecurityAuthoritySha256', 'recoveryAsOfAt', 'expectedTemplate0BaselineSha256', 'approvalRef']);
  for (const key of Object.keys(pins).filter((key) => key.endsWith('Sha256'))) hash(pins[key]);
  check(digest(text) === pins.expectedAuthorizationSha256); const value = parse(text);
  shape(value, ['kind', 'version', 'runId', 'approvalRef', 'issuedAt', 'recoveryAsOfAt', 'producerIntentSha256', 'bundleSha256',
    'archiveSha256', 'objectManifestSha256', 'sourceTargetSha256', 'restoreTargetSha256', 'template0BaselineSha256', 'quarantine', 'security']);
  check(value.kind === 'restore-authorization' && value.version === 1 && value.runId === producer.document.runId && value.quarantine === true);
  check(bundle.document.producerIntentSha256 === producer.sha256 && pins.expectedProducerSha256 === producer.sha256);
  check(value.producerIntentSha256 === producer.sha256 && value.bundleSha256 === bundle.sha256 && pins.expectedBundleSha256 === bundle.sha256);
  check(value.archiveSha256 === bundle.document.database.sha256 && value.archiveSha256 === pins.expectedArchiveSha256);
  check(value.objectManifestSha256 === bundle.document.objectManifest.sha256 && value.objectManifestSha256 === pins.expectedObjectManifestSha256);
  check(value.sourceTargetSha256 === digest(canonicalJson(producer.document.source)) && value.restoreTargetSha256 === digest(canonicalJson(producer.document.restore)));
  check(value.template0BaselineSha256 === pins.expectedTemplate0BaselineSha256 && value.approvalRef === pins.approvalRef); label(value.approvalRef);
  check(value.recoveryAsOfAt === pins.recoveryAsOfAt && instant(value.recoveryAsOfAt) >= instant(bundle.document.publishedAt));
  check(instant(value.issuedAt) >= instant(value.recoveryAsOfAt) && instant(value.recoveryAsOfAt) - instant(bundle.document.cutAt) <= 24 * 60 * 60 * 1000);
  shape(value.security, ['mode', 'authoritySha256', 'watermarkAt']);
  check(value.security.mode === 'synthetic-no-post-cut-markers' && value.security.authoritySha256 === pins.expectedSecurityAuthoritySha256);
  check(instant(value.security.watermarkAt) === instant(value.recoveryAsOfAt));
  return record('restore', { authorization: value, producer: producer.document, bundle: bundle.document,
    expectedMarkers: { source: markerFor(producer.document.source), restore: markerFor(producer.document.restore) } }, pins.expectedAuthorizationSha256);
}
