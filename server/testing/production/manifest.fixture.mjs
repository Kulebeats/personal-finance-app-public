// Inert declarations only: no named path/service/certificate is observed or created.
export function manifestFixture() {
  const runId = 'r20profile20261015a1'; const publicRoot = 'C:\\Synthetic\\run\\public-tls';
  const ca = { file: { path: `${publicRoot}\\ca.pem`, size: 500, sha256: '1'.repeat(64) }, derSha256: 'a'.repeat(64) };
  return {
    kind: 'pfa-production-profile', version: 1, profile: 'local-production-v1', runId,
    issuedAt: '2026-10-15T00:00:00.000Z', approvalRef: 'review/r20-synthetic', harnessCommitSha: '2'.repeat(40),
    paths: { runRoot: 'C:\\Synthetic\\run', buildRoot: 'C:\\Synthetic\\build', browserRuntimeRoot: 'C:\\Synthetic\\chromium',
      browserProfileRoot: 'C:\\Synthetic\\run\\profile', pgdataRoot: 'C:\\Synthetic\\run\\pgdata', publicTlsRoot: publicRoot, privateRoot: 'C:\\Synthetic\\run\\private' },
    build: { commitSha: '1'.repeat(40), nodeVersion: '24.22.0', nodePlatform: 'win32', nodeArch: 'arm64', artifacts: [
      { role: 'server-entry', relativePath: 'index.js', size: 100, sha256: '4'.repeat(64) },
      { role: 'client-asset', relativePath: 'public/assets/app.js', size: 100, sha256: '6'.repeat(64) },
      { role: 'client-index', relativePath: 'public/index.html', size: 100, sha256: '5'.repeat(64) },
    ] },
    endpoints: { browserOrigin: 'https://127.0.0.1:55441', terminator: { host: '127.0.0.1', port: 55441 },
      backend: { host: '127.0.0.1', port: 55442 }, browserEgressProxy: { host: '127.0.0.1', port: 55443 },
      postgres: { host: '127.0.0.1', port: 55444 }, redis: { host: '127.0.0.1', port: 55445 } },
    postgres: { clusterId: '11111111-1111-4111-8111-111111111111', serverVersion: '18.6',
      target: { version: 1, disposable: true, synthetic: true, host: '127.0.0.1', port: 55444, database: `pfa_completion_r20_${runId}_test`, runId },
      expectedMarker: `pfa-synthetic-test:v1:${runId}:pfa_completion_r20_${runId}_test`, role: 'pfa_profile',
      credentialRef: '22222222-2222-4222-8222-222222222222', credentialGeneration: '33333333-3333-4333-8333-333333333333',
      schema: { sourceSha256: '7'.repeat(64), journalSha256: '8'.repeat(64),
        migrations: [{ name: '0000_fixture', sha256: '9'.repeat(64), journalWhenMs: 1730000000000 }] } },
    redis: { instanceId: '44444444-4444-4444-8444-444444444444', serverVersion: '8.2.1', transport: 'tcp', database: 0,
      aclUser: `pfa_${runId}`, credentialRef: '55555555-5555-4555-8555-555555555555', credentialGeneration: '66666666-6666-4666-8666-666666666666', keyPrefix: `pfa:production:${runId}:` },
    tls: { https: { identityHost: '127.0.0.1', rejectUnauthorized: true, ca,
      leaf: { file: { path: `${publicRoot}\\https.pem`, size: 500, sha256: '2'.repeat(64) }, derSha256: 'b'.repeat(64) } },
      postgres: { identityHost: '127.0.0.1', rejectUnauthorized: true, ca: structuredClone(ca),
        leaf: { file: { path: `${publicRoot}\\pg.pem`, size: 500, sha256: '3'.repeat(64) }, derSha256: 'c'.repeat(64) } } },
    chromium: { engine: 'chromium', version: '145.0.7632.6', executable: { path: 'C:\\Synthetic\\chromium\\chrome.exe', size: 1000, sha256: 'd'.repeat(64) },
      trust: { contract: 'chromium145-servercertificate-v1', relativeDatabasePath: 'Default/ServerCertificate', databaseVersion: 1,
        lastCompatibleVersion: 1, caDerSha256: 'a'.repeat(64), trustMetadataHex: '0a020803' },
      ignoreHTTPSErrors: false, proxyBypass: '<-loopback>', quic: false, launchPolicy: 'pfa-chromium145-strict-v1' },
    policy: { nodeEnv: 'production', serverTimezone: 'UTC', actorTimezone: 'Africa/Lusaka',
      appOrigin: 'https://127.0.0.1:55441', clientOrigin: 'https://127.0.0.1:55441', forwarding: 'strip-and-set-single-hop-v1', egress: 'exact-role-routing-v1',
      providers: 'disabled', mail: 'disabled', push: 'disabled', workers: 'disabled' },
    timeouts: { connectMs: 3000, dependencyProbeMs: 1500, navigationMs: 10000, runMs: 60000 },
  };
}

// Literal separately held expectations for exactly the unmutated synthetic fixture.
// These are test declaration pins, never owner/dispatch provenance or defaults.
export const approvedFixturePins = Object.freeze({
  expectedManifestSha256: 'cc269f5fa8e1fba3cbc44999d1c510c96b52af2723741fdc1e9d2f48aed08303', runId: 'r20profile20261015a1', profile: 'local-production-v1',
  buildCommitSha: '1'.repeat(40), harnessCommitSha: '2'.repeat(40), approvalRef: 'review/r20-synthetic',
  expectedArtifactsSha256: '462f0d769aa8c3a5b1f6f50fc5a6573d85c0ab39c4cf40bf021436f280b1f4b2',
  expectedServicesSha256: '6465eb24374b5d82ee2464e09f9e598c3627d57b8bfec16f1f1d1b8cc9c7b613',
  expectedSecuritySha256: 'e78a32f3dc81c21618574ac65fd67bb63c0a286972460e8b7ad1764d35972829',
});
