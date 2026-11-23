import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Socket } from 'node:net';
import { redactedRedisAdmissionDiagnostic, createRedisAdmissionDiagnostics } from './production-diagnostics.mjs';
import { readProductionManifest, canonicalJson, digest } from '../../testing/production/manifest.mjs';
import { manifestFixture, approvedFixturePins } from '../../testing/production/manifest.fixture.mjs';
import { createRedisCredentials, withRedisProvisioningSecret } from '../../testing/production/redis-credentials.mjs';

// Actual pure redaction/lifetime/credential sanitizers only. No service brand,
// client/socket, admission, positive issuer or native provider is simulated.
let sockets = 0;
const originalConnect = Socket.prototype.connect;
Socket.prototype.connect = function () { sockets++; throw new Error('DIAGNOSTIC_TEST_SOCKET_REFUSED'); };
after(() => { Socket.prototype.connect = originalConnect; assert.equal(sockets, 0); });

test('admission redaction retains only fixed phase and TCP/import/server reason labels', () => {
  const secret = 'PRIVATE_AUTH_CONFIGURATION_MARKER';
  for (const [error, reason] of [
    [{ code: 'ECONNREFUSED', message: secret }, 'TCP_REFUSED'],
    [{ code: 'ERR_MODULE_NOT_FOUND', message: secret }, 'IMPORT_REFUSED'],
    [{ name: 'ReplyError', message: `NOPERM ${secret}` }, 'SERVER_PERMISSION'],
    [{ name: 'ReplyError', message: `WRONGPASS ${secret}` }, 'SERVER_AUTH'],
    [{ name: 'ReplyError', message: `ERR ${secret}` }, 'SERVER_REJECTED'],
    [new Error('Command timed out'), 'COMMAND_TIMEOUT'],
    [new Error('REDIS_ADMISSION_REFUSED:DEADLINE'), 'ADMISSION_TIMEOUT'],
  ]) {
    const value = redactedRedisAdmissionDiagnostic('SELECT_DATABASE', error);
    assert.deepEqual(value, { phase: 'SELECT_DATABASE', reason });
    assert.equal(Object.isFrozen(value), true); assert.equal(JSON.stringify(value).includes(secret), false);
  }
});

test('unknown and throwing error values cannot escape through diagnostic serialization', () => {
  const secret = 'PRIVATE_CALLBACK_ERROR_CAUSE_STACK';
  for (const error of [secret, new Error(secret), { code: secret, name: secret, message: secret, stack: secret, cause: secret },
    { get code() { throw new Error(secret); } }, { get message() { throw new Error(secret); } }]) {
    const value = redactedRedisAdmissionDiagnostic(secret, error);
    assert.deepEqual(value, { phase: 'UNKNOWN', reason: 'UNCLASSIFIED' });
    assert.equal(JSON.stringify(value).includes(secret), false);
  }
});

test('changing diagnostic error getters are read once and never retained', () => {
  let codeReads = 0, messageReads = 0;
  const error = { get code() { return codeReads++ === 0 ? undefined : 'PRIVATE_CODE'; },
    get message() { return messageReads++ === 0 ? 'NOPERM private detail' : 'PRIVATE_MESSAGE'; }, name: 'ReplyError' };
  assert.deepEqual(redactedRedisAdmissionDiagnostic('MARKER', error), { phase: 'MARKER', reason: 'SERVER_PERMISSION' });
  assert.equal(codeReads, 1); assert.equal(messageReads, 1);
});

test('first causal diagnostic survives outer sanitized failures and later cleanup phase', async () => {
  const diagnostic = createRedisAdmissionDiagnostics();
  await assert.rejects(diagnostic.step('CREDENTIAL_SECRET', async () => {
    try { await diagnostic.step('INFO_SERVER', async () => { throw { name: 'ReplyError', message: 'NOPERM private info' }; }); }
    catch { throw new Error('REDIS_CREDENTIALS_REFUSED:ACTION'); }
  }), /REDIS_CREDENTIALS_REFUSED:ACTION/);
  const first = diagnostic.snapshot();
  diagnostic.enter('PRIVATE_CLEANUP_TEXT'); diagnostic.record(new Error('REDIS_ADMISSION_REFUSED:LIFETIME'));
  assert.equal(diagnostic.snapshot(), first);
  assert.deepEqual(first, { phase: 'INFO_SERVER', reason: 'SERVER_PERMISSION' });
});

test('raw dispatch reason survives actual lifetime and credential callback sanitizers', async () => {
  const { createProductionRedisLifetime } = await import('./production-connection.mjs');
  const document = manifestFixture(); document.redis.credentialGeneration = randomUUID();
  const text = canonicalJson(document);
  const manifest = readProductionManifest(text, { ...approvedFixturePins, expectedManifestSha256: digest(text),
    expectedServicesSha256: digest(canonicalJson({ endpoints: document.endpoints, postgres: document.postgres, redis: document.redis })) });
  const credentials = createRedisCredentials(manifest), diagnostic = createRedisAdmissionDiagnostics();
  let disconnected = 0;
  const lifetime = createProductionRedisLifetime({ assertAuthority() {}, disconnect() { disconnected++; },
    commandTimeoutMs: 100, operationTimeoutMs: 100,
    async dispatch() {
      const raw = Object.assign(new Error('NOPERM PRIVATE_CALLBACK_AUTH_MARKER'), { name: 'ReplyError' });
      diagnostic.record(raw); throw raw;
    },
  });
  await assert.rejects(withRedisProvisioningSecret(credentials.capability, () => diagnostic.step('SELECT_DATABASE',
    () => lifetime.runOperation(() => lifetime.execute(['SELECT', '0'])))), /REDIS_CREDENTIALS_REFUSED:ACTION/);
  assert.deepEqual(diagnostic.snapshot(), { phase: 'SELECT_DATABASE', reason: 'SERVER_PERMISSION' });
  assert.equal(JSON.stringify(diagnostic.snapshot()).includes('PRIVATE_CALLBACK_AUTH_MARKER'), false);
  assert.equal(disconnected, 1); credentials.owner.revoke();
});

test('a successful diagnostic step preserves its value and grants no admission facts', async () => {
  const diagnostic = createRedisAdmissionDiagnostics();
  assert.equal(await diagnostic.step('FACADES', async () => 7), 7);
  assert.deepEqual(diagnostic.snapshot(new Error('unclassified')), { phase: 'FACADES', reason: 'UNCLASSIFIED' });
  assert.deepEqual(Object.keys(diagnostic).sort(), ['capture', 'enter', 'record', 'snapshot', 'socket', 'step']);
});

test('whole callback capture preserves callback check failures before the actual credential sanitizer', async () => {
  const document = manifestFixture(); document.redis.credentialGeneration = randomUUID();
  const text = canonicalJson(document);
  const manifest = readProductionManifest(text, { ...approvedFixturePins, expectedManifestSha256: digest(text),
    expectedServicesSha256: digest(canonicalJson({ endpoints: document.endpoints, postgres: document.postgres, redis: document.redis })) });
  const credentials = createRedisCredentials(manifest);
  for (const [phase, message, reason] of [
    ['SECRET_CALLBACK_LIFETIME', 'REDIS_ADMISSION_REFUSED:LIFETIME', 'LIFETIME_REFUSED'],
    ['SECRET_CALLBACK_AUTHORITY', 'OWNED_REDIS_SERVICE_REFUSED:REVOKED', 'LIFETIME_REFUSED'],
    ['SOCKET_ADMISSION_LIFETIME', 'REDIS_ADMISSION_REFUSED:LIFETIME', 'LIFETIME_REFUSED'],
    ['SOCKET_STREAM', 'REDIS_ADMISSION_REFUSED:SOCKET', 'SOCKET_REFUSED'],
    ['SOCKET_AUTHORITY', 'REDIS_ADMISSION_REFUSED:LINEAGE', 'IDENTITY_REFUSED'],
    ['SOCKET_ENDPOINT', 'REDIS_ADMISSION_REFUSED:SOCKET', 'SOCKET_REFUSED'],
    ['IDENTITY_CALLBACK_LIFETIME', 'REDIS_ADMISSION_REFUSED:LIFETIME', 'LIFETIME_REFUSED'],
    ['IDENTITY_CALLBACK_AUTHORITY', 'REDIS_CREDENTIALS_REFUSED:SERVICE', 'CREDENTIAL_REFUSED'],
    ['IDENTITY_VALIDATION', 'REDIS_ADMISSION_REFUSED:IDENTITY', 'IDENTITY_REFUSED'],
    ['POST_IDENTITY_LIFETIME', 'REDIS_ADMISSION_REFUSED:LIFETIME', 'LIFETIME_REFUSED'],
  ]) {
    const diagnostic = createRedisAdmissionDiagnostics();
    assert.equal(typeof diagnostic.capture, 'function');
    await assert.rejects(withRedisProvisioningSecret(credentials.capability, () => diagnostic.capture(async () => {
      diagnostic.enter(phase); throw new Error(message);
    })), /REDIS_CREDENTIALS_REFUSED:ACTION/);
    assert.deepEqual(diagnostic.snapshot(), { phase, reason });
  }
  credentials.owner.revoke();
});

test('bounded socket predicates survive later mutation and contain no endpoint or client text', async () => {
  const diagnostic = createRedisAdmissionDiagnostics();
  assert.equal(typeof diagnostic.socket, 'function');
  const value = { observedStreams: 1, currentStreamObserved: true, socketInstance: true, destroyed: false,
    remoteAddressMatches: false, remotePortMatches: true, clientStatus: 'ready', rawAddress: 'PRIVATE_ENDPOINT', rawError: 'PRIVATE_AUTH' };
  diagnostic.socket(value); value.remoteAddressMatches = true;
  diagnostic.enter('SOCKET_ENDPOINT'); diagnostic.record(new Error('REDIS_ADMISSION_REFUSED:SOCKET'));
  const first = diagnostic.snapshot();
  assert.deepEqual(first, { phase: 'SOCKET_ENDPOINT', reason: 'SOCKET_REFUSED', socket: {
    observedAt: 'CONNECT_RESOLVED', observedStreams: 'ONE', currentStreamObserved: true, socketInstance: true, destroyed: false,
    remoteAddressMatches: false, remotePortMatches: true, clientStatus: 'ready' } });
  diagnostic.socket({ observedStreams: 0 });
  assert.equal(diagnostic.snapshot(), first); assert.equal(Object.isFrozen(first.socket), true);
  assert.equal(JSON.stringify(first).includes('PRIVATE'), false);
});

test('hostile socket predicates yield only bounded scalar unknowns and no getters escape', () => {
  const diagnostic = createRedisAdmissionDiagnostics();
  assert.equal(typeof diagnostic.socket, 'function');
  diagnostic.socket({ observedStreams: 500, get currentStreamObserved() { throw new Error('PRIVATE'); },
    socketInstance: 'PRIVATE', destroyed: {}, remoteAddressMatches: '127.0.0.1', remotePortMatches: 55465, clientStatus: 'PRIVATE' });
  assert.deepEqual(diagnostic.snapshot().socket, { observedAt: 'CONNECT_RESOLVED', observedStreams: 'MULTIPLE', currentStreamObserved: null,
    socketInstance: null, destroyed: null, remoteAddressMatches: null, remotePortMatches: null, clientStatus: 'UNKNOWN' });
});
