// Synthetic contract data only. No files, tools, targets or credentials exist here.
import { canonicalJson, digest } from './contracts.mjs';
export function fixture() {
  const target = (role, runId) => ({ version: 1, disposable: true, synthetic: true, host: '127.0.0.1', port: 55432,
    database: `pfa_completion_r19_${role}_${runId}_test`, runId });
  const tools = { dump: { name: 'pg_dump', version: '18.6', path: 'C:\\Owned\\bin\\pg_dump.exe', sha256: '6'.repeat(64) },
    restore: { name: 'pg_restore', version: '18.6', path: 'C:\\Owned\\bin\\pg_restore.exe', sha256: '7'.repeat(64) } };
  const intent = { kind: 'producer-intent', version: 1, profile: 'local-synthetic', runId: 'r19recover20261015a1',
    issuedAt: '2026-10-15T01:00:00.000Z', approvalRef: 'review/r19-producer', producerSha: '1'.repeat(40), candidateSha: '2'.repeat(40), rollbackSha: '3'.repeat(40),
    schemaSha256: '4'.repeat(64), journalSha256: '5'.repeat(64), source: target('src', 'r19src20261015a1'), restore: target('dst', 'r19dst20261015a1'), tools,
    artifactRoot: 'C:\\Owned\\recovery\\r19recover20261015a1', credentialRoot: 'C:\\Owned\\private\\r19recover20261015a1', databaseUser: 'pfa_campaign',
    limits: { connectTimeoutSeconds: 5, processTimeoutMs: 600000 }, outputs: { archive: 'database.dump', objectManifest: 'objects.json', bundleManifest: 'bundle-manifest.json' } };
  const producerPins = { expectedIntentSha256: digest(canonicalJson(intent)), producerSha: intent.producerSha, candidateSha: intent.candidateSha,
    rollbackSha: intent.rollbackSha, schemaSha256: intent.schemaSha256, journalSha256: intent.journalSha256,
    sourceTargetSha256: digest(canonicalJson(intent.source)), restoreTargetSha256: digest(canonicalJson(intent.restore)),
    tools: structuredClone(tools), artifactRoot: intent.artifactRoot, credentialRoot: intent.credentialRoot,
    endpoint: { host: '127.0.0.1', port: 55432 }, databaseUser: intent.databaseUser, approvalRef: intent.approvalRef };
  const id = '11111111-2222-4333-8444-555555555555';
  const bundle = { kind: 'published-bundle', version: 1, state: 'complete', runId: intent.runId, producerIntentSha256: producerPins.expectedIntentSha256,
    candidateSha: intent.candidateSha, schemaSha256: intent.schemaSha256, journalSha256: intent.journalSha256, sourceTargetSha256: producerPins.sourceTargetSha256,
    cutAt: '2026-10-15T01:01:00.000Z', publishedAt: '2026-10-15T01:02:00.000Z',
    database: { file: 'database.dump', size: 123, sha256: '8'.repeat(64) }, objectManifest: { file: 'objects.json', size: 456, sha256: '9'.repeat(64) },
    objects: [{ key: `v1/receipt/${id}`, purpose: 'receipt', parentId: id, householdId: id, requesterId: id, mediaType: 'image/png',
      size: 10, sha256: 'a'.repeat(64), sourceVersion: { kind: 'unversioned-immutable' }, file: `objects/${'a'.repeat(64)}.blob` }] };
  const authorization = { kind: 'restore-authorization', version: 1, runId: intent.runId, approvalRef: 'review/r19-restore',
    issuedAt: '2026-10-15T01:04:00.000Z', recoveryAsOfAt: '2026-10-15T01:03:00.000Z', producerIntentSha256: producerPins.expectedIntentSha256,
    bundleSha256: digest(canonicalJson(bundle)), archiveSha256: bundle.database.sha256, objectManifestSha256: bundle.objectManifest.sha256,
    sourceTargetSha256: producerPins.sourceTargetSha256, restoreTargetSha256: producerPins.restoreTargetSha256, template0BaselineSha256: 'b'.repeat(64),
    quarantine: true, security: { mode: 'synthetic-no-post-cut-markers', authoritySha256: 'c'.repeat(64), watermarkAt: '2026-10-15T01:03:00.000Z' } };
  const restorePins = { expectedAuthorizationSha256: digest(canonicalJson(authorization)), expectedProducerSha256: producerPins.expectedIntentSha256,
    expectedBundleSha256: authorization.bundleSha256, expectedArchiveSha256: authorization.archiveSha256,
    expectedObjectManifestSha256: authorization.objectManifestSha256, expectedSecurityAuthoritySha256: authorization.security.authoritySha256,
    recoveryAsOfAt: authorization.recoveryAsOfAt, expectedTemplate0BaselineSha256: authorization.template0BaselineSha256, approvalRef: authorization.approvalRef };
  return { intent, producerPins, bundle, authorization, restorePins };
}
