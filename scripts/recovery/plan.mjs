import { markerFor } from '../../server/testing/test-target.mjs';
import { requireRecord } from './contracts.mjs';
import { check, shape, canonicalJson, parse, freeze } from './common.mjs';
import { absolute, apiFor, contained, child, disjoint } from './paths.mjs';

// Pure expectations, not a launcher. No environment, filesystem or process reads.
function environment(intent, supplied) {
  const runtime = parse(canonicalJson(supplied));
  shape(runtime, ['passfile', 'temporaryRoot', 'systemRoot']);
  // This first native planning contract targets the selected Windows host only.
  check(apiFor(intent.artifactRoot).sep === '\\');
  contained(intent.credentialRoot, runtime.passfile);
  contained(intent.credentialRoot, runtime.temporaryRoot);
  disjoint(runtime.passfile, runtime.temporaryRoot);
  absolute(runtime.systemRoot); check(apiFor(runtime.systemRoot).sep === '\\');
  return {
    PGPASSFILE: runtime.passfile, PGSSLMODE: 'disable',
    PGCONNECT_TIMEOUT: String(intent.limits.connectTimeoutSeconds), PGAPPNAME: `pfa-recovery-${intent.runId}`,
    SystemRoot: runtime.systemRoot, TEMP: runtime.temporaryRoot, TMP: runtime.temporaryRoot,
  };
}
function connection(intent, target) {
  return ['--host', target.host, '--port', String(target.port), '--username', intent.databaseUser, '--dbname', target.database, '--no-password'];
}
function base(stage, intent, target, tool, supplied) {
  return {
    stage, executable: tool.path, expectedBinarySha256: tool.sha256, expectedBinaryVersion: tool.version,
    target, expectedMarker: markerFor(target), shell: false, timeoutMs: intent.limits.processTimeoutMs,
    env: environment(intent, supplied),
    certifications: { filesystemIdentity: false, liveDatabaseIdentity: false, actualBinaryHash: false, executionAuthorized: false },
  };
}
export function planCapture(producer, runtime) {
  requireRecord(producer, 'producer'); const intent = producer.document;
  return freeze({ ...base('capture', intent, intent.source, intent.tools.dump, runtime), producerIntentSha256: producer.sha256,
    argv: [...connection(intent, intent.source), '--format=custom', '--no-comments', '--no-privileges',
      '--file', child(intent.artifactRoot, `${intent.outputs.archive}.partial`)],
  });
}
export function planRestore(restore, runtime) {
  requireRecord(restore, 'restore'); const { producer: intent, authorization } = restore.document;
  return freeze({ ...base('restore', intent, intent.restore, intent.tools.restore, runtime), authorizationSha256: restore.sha256,
    expectedArchiveSha256: authorization.archiveSha256, quarantine: true,
    argv: [...connection(intent, intent.restore), '--no-owner', '--no-privileges', '--no-comments', '--exit-on-error',
      '--single-transaction', child(intent.artifactRoot, intent.outputs.archive)],
  });
}
