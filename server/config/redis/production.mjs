import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Socket } from 'node:net';
import { types } from 'node:util';
import { requireProductionManifest } from '../../testing/production/manifest.mjs';
import { createRedisAdmissionDiagnostics } from './production-diagnostics.mjs';

const admissions = new WeakMap();
const refused = phase => new Error(`REDIS_ADMISSION_REFUSED:${phase}`);
const check = (value, phase) => { if (!value) throw refused(phase); };
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
function inputs(value) {
  check(value && typeof value === 'object' && !Array.isArray(value) && !types.isProxy(value), 'INPUT');
  check([Object.prototype, null].includes(Object.getPrototypeOf(value)), 'INPUT');
  const entries = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(entries);
  check(keys.length === 4 && ['manifest', 'service', 'credentials', 'signal'].every(key => entries[key] && 'value' in entries[key]), 'INPUT');
  const result = Object.fromEntries(keys.map(key => [key, entries[key].value]));
  check(result.signal instanceof AbortSignal && !result.signal.aborted, 'SIGNAL'); return result;
}
function serviceMatches(document, projection, credential) {
  const expected = document.redis, endpoint = document.endpoints.redis;
  check(projection.kind === 'owned-redis-service' && projection.runId === document.runId && projection.instanceId === expected.instanceId &&
    projection.endpoint.host === endpoint.host && projection.endpoint.port === endpoint.port &&
    ['serverVersion', 'database', 'aclUser', 'keyPrefix', 'credentialRef', 'credentialGeneration'].every(key => projection[key] === expected[key]) &&
    credential.runId === document.runId && credential.instanceId === expected.instanceId && credential.credentialRef === expected.credentialRef &&
    credential.credentialGeneration === expected.credentialGeneration && credential.ownershipReceiptId === projection.ownershipReceiptId &&
    /^[a-f0-9]{40}$/.test(projection.expectedRedisRunId), 'LINEAGE');
}
function infoFields(reply) {
  check(typeof reply === 'string' && Buffer.byteLength(reply) <= 16384, 'INFO');
  const fields = new Map();
  for (const line of reply.split('\r\n')) {
    if (!line || line.startsWith('#')) continue;
    const split = line.indexOf(':'); check(split > 0 && !fields.has(line.slice(0, split)), 'INFO');
    fields.set(line.slice(0, split), line.slice(split + 1));
  }
  return fields;
}
async function boundedWait(promise, milliseconds) {
  const deadline = performance.now() + milliseconds;
  let timer;
  try {
    const result = await Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(refused('CLOSE_DEADLINE')), milliseconds); })]);
    check(performance.now() < deadline, 'CLOSE_DEADLINE'); return result;
  } finally { clearTimeout(timer); }
}

/** Trusted bootstrap only. Consistency parsing and public receipts do not authorize this call. */
export async function admitProductionRedis(input) {
  const diagnostics = createRedisAdmissionDiagnostics();
  const withDiagnostic = (error, cause) => {
    Object.defineProperty(error, 'admissionDiagnostic', { value: diagnostics.snapshot(cause), enumerable: true });
    return error;
  };
  let args;
  try { diagnostics.enter('INPUT_GUARD'); args = inputs(input); }
  catch (error) { throw withDiagnostic(refused(error?.message === 'REDIS_ADMISSION_REFUSED:SIGNAL' ? 'SIGNAL' : 'INPUT'), error); }
  let manifest;
  try { diagnostics.enter('MANIFEST_GUARD'); manifest = requireProductionManifest(args.manifest); }
  catch { throw withDiagnostic(refused('MANIFEST'), refused('MANIFEST')); }
  const { document } = manifest;
  const connectionGeneration = randomUUID(), streams = new Map(), subscriptions = [];
  const deadline = performance.now() + document.timeouts.connectMs + document.timeouts.dependencyProbeMs;
  let active = true, client, lifetime, connectOutcome, closePromise, closeDeadline, admissionTimer, cancel, cleanupFault = false, constructed = false;
  const checkAdmission = () => { check(active && !args.signal.aborted && performance.now() < deadline, 'LIFETIME'); };
  const observeStream = () => {
    const stream = client?.stream;
    if (!stream) return;
    check(stream instanceof Socket, 'SOCKET');
    if (streams.has(stream)) return;
    let resolve;
    const closed = new Promise(value => { resolve = value; });
    const entry = { closed, observed: stream.closed === true };
    if (entry.observed) resolve();
    else stream.once('close', () => { entry.observed = true; resolve(); });
    streams.set(stream, entry);
  };
  const revoke = () => {
    active = false;
    try { lifetime?.revoke(); } catch { cleanupFault = true; throw refused('REVOCATION'); }
  };
  const lose = () => {
    diagnostics.record(refused('LIFETIME'));
    try { observeStream(); } catch { cleanupFault = true; }
    try { revoke(); } catch { cleanupFault = true; }
    cancel?.(refused('LIFETIME'));
  };
  const onConnect = () => {
    try { observeStream(); } catch (error) { diagnostics.record(error); cleanupFault = true; lose(); }
    if (!active || streams.size !== 1) {
      lose();
      if (client?.stream instanceof Socket) client.stream.destroy();
    }
  };
  const onError = error => { diagnostics.record(error); lose(); };
  const onAbort = () => { diagnostics.record(refused('ABORTED')); lose(); };
  const close = () => {
    closeDeadline ??= performance.now() + 2000;
    // Revocation is synchronous, including when the returned close task already exists.
    try { revoke(); } catch { cleanupFault = true; }
    if (closePromise) return closePromise;
    closePromise = (async () => {
      args.signal.removeEventListener('abort', onAbort);
      clearTimeout(admissionTimer);
      for (const unsubscribe of subscriptions.splice(0)) { try { unsubscribe(); } catch { cleanupFault = true; } }
      try { observeStream(); client?.disconnect(); observeStream(); } catch { cleanupFault = true; }
      // Drain the one connect attempt before finalizing the captured stream set.
      if (connectOutcome) { try { await boundedWait(connectOutcome, 400); } catch { cleanupFault = true; } }
      try { observeStream(); } catch { cleanupFault = true; }
      for (const [stream, entry] of streams) {
        if (!entry.observed) {
          try { await boundedWait(entry.closed, 200); }
          catch {
            // Only a stream captured from this exact private client may be destroyed.
            stream.destroy();
            try { await boundedWait(entry.closed, 400); } catch { cleanupFault = true; }
          }
        }
        if (!entry.observed) cleanupFault = true;
      }
      try { observeStream(); } catch { cleanupFault = true; }
      if (Array.from(streams.values()).some(entry => !entry.observed)) cleanupFault = true;
      try { lifetime?.assertClean(); } catch { cleanupFault = true; }
      if (constructed && streams.size === 0 && client?.status !== 'end') cleanupFault = true;
      check(!cleanupFault && performance.now() < closeDeadline, 'CLEANUP_UNVERIFIED');
      client?.removeListener('connect', onConnect);
      client?.removeListener('error', onError); client?.removeListener('close', lose); client?.removeListener('end', lose);
      client = undefined;
      return freeze({ connectionGeneration, closed: true });
    })();
    return closePromise;
  };
  const cancellation = new Promise((_resolve, reject) => { cancel = reject; });
  args.signal.addEventListener('abort', onAbort, { once: true });
  admissionTimer = setTimeout(() => { diagnostics.record(refused('DEADLINE')); lose(); }, Math.max(0, deadline - performance.now()));
  const work = (async () => {
    checkAdmission();
    // Literal-only rendezvous. No credential/service issuer or driver is imported by a cold getter.
    diagnostics.enter('CREDENTIAL_IMPORT');
    const credentials = await import('../../testing/production/redis-credentials.mjs'); checkAdmission();
    diagnostics.enter('CREDENTIAL_GUARD');
    credentials.requireRedisCredentials(args.credentials, args.service);
    diagnostics.enter('PRODUCER_IMPORT');
    const producer = await import('../../testing/production/redis-owned-service.mjs'); checkAdmission();
    diagnostics.enter('SERVICE_GUARD');
    const projection = producer.requireOwnedRedisService(args.service);
    diagnostics.enter('LINEAGE_GUARD');
    serviceMatches(document, projection, credentials.requireRedisCredentials(args.credentials, args.service));
    diagnostics.enter('RUNTIME_IMPORT');
    const [{ default: Redis }, connection, operations, rateLimit] = await Promise.all([
      import('ioredis'), import('./production-connection.mjs'), import('./production-operations.mjs'), import('./production-rate-limit.mjs'),
    ]);
    checkAdmission();
    const assertAuthority = () => {
      try {
        check(active && !args.signal.aborted, 'LIFETIME');
        const current = producer.requireOwnedRedisService(args.service);
        serviceMatches(document, current, credentials.requireRedisCredentials(args.credentials, args.service));
        check(current.expectedRedisRunId === projection.expectedRedisRunId && current.ownershipReceiptId === projection.ownershipReceiptId, 'LINEAGE');
      } catch (error) { diagnostics.record(error); throw error; }
    };
    diagnostics.enter('LIFETIME_SETUP');
    lifetime = connection.createProductionRedisLifetime({
      assertAuthority,
      dispatch: async command => {
        try { check(client, 'SOCKET'); return await client.call(command[0], ...command.slice(1)); }
        catch (error) { diagnostics.record(error); throw error; }
      },
      disconnect: () => { observeStream(); client?.disconnect(); },
      commandTimeoutMs: document.timeouts.dependencyProbeMs, operationTimeoutMs: document.timeouts.dependencyProbeMs,
    });
    subscriptions.push(credentials.onRedisCredentialsRevoked(args.credentials, lose));
    subscriptions.push(producer.onOwnedRedisServiceRevoked(args.service, lose));
    assertAuthority();
    await diagnostics.step('CREDENTIAL_SECRET', () => credentials.withRedisConnectionSecret(args.credentials, args.service, secret => diagnostics.capture(async () => {
      diagnostics.enter('SECRET_CALLBACK_LIFETIME'); checkAdmission();
      diagnostics.enter('SECRET_CALLBACK_AUTHORITY'); assertAuthority();
      diagnostics.enter('CLIENT_CONSTRUCTION');
      try { client = new Redis({
        host: document.endpoints.redis.host, port: document.endpoints.redis.port, db: 0,
        username: document.redis.aclUser, password: secret,
        lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0,
        connectTimeout: document.timeouts.connectMs, commandTimeout: document.timeouts.dependencyProbeMs,
        disconnectTimeout: 200, retryStrategy: () => null, reconnectOnError: () => false,
        autoResendUnfulfilledCommands: false, autoResubscribe: false, enableAutoPipelining: false,
        enableReadyCheck: false, disableClientInfo: true,
        // The pinned Windows ARM64 runtime loses peer metadata when the driver
        // enables TCP_NODELAY during connect. Keep the strict peer guard intact.
        noDelay: false,
      }); } catch (error) { diagnostics.record(error); throw error; }
      constructed = true;
      client.on('connect', onConnect); client.on('error', onError); client.on('close', lose); client.on('end', lose);
      const connecting = diagnostics.step('CONNECT', () => client.connect());
      connectOutcome = connecting.then(() => true, () => false);
      await connecting; diagnostics.enter('SOCKET_CHECK');
      diagnostics.socket({ observedStreams: streams.size, currentStreamObserved: streams.has(client?.stream),
        socketInstance: client?.stream instanceof Socket, destroyed: client?.stream?.destroyed,
        remoteAddressMatches: client?.stream?.remoteAddress === document.endpoints.redis.host,
        remotePortMatches: client?.stream?.remotePort === document.endpoints.redis.port, clientStatus: client?.status });
      diagnostics.enter('SOCKET_ADMISSION_LIFETIME'); checkAdmission();
      diagnostics.enter('SOCKET_STREAM'); observeStream();
      diagnostics.enter('SOCKET_AUTHORITY'); assertAuthority();
      diagnostics.enter('SOCKET_ENDPOINT');
      check(streams.size === 1 && client.stream instanceof Socket && !client.stream.destroyed && client.stream.remoteAddress === '127.0.0.1' && client.stream.remotePort === document.endpoints.redis.port, 'SOCKET');
      await diagnostics.step('PRIVATE_IDENTITY', () => producer.withOwnedRedisIdentity(args.service, expected => diagnostics.capture(async () => {
        diagnostics.enter('IDENTITY_CALLBACK_LIFETIME'); checkAdmission();
        diagnostics.enter('IDENTITY_CALLBACK_AUTHORITY'); assertAuthority();
        diagnostics.enter('IDENTITY_VALIDATION');
        check(expected.expectedRedisRunId === projection.expectedRedisRunId && typeof expected.markerKey === 'string' &&
          expected.markerKey.startsWith('pfa:owned-marker:') && !expected.markerKey.startsWith(document.redis.keyPrefix) &&
          typeof expected.markerValue === 'string' && expected.markerValue.length > 0, 'IDENTITY');
        await lifetime.runOperation(async () => {
          await diagnostics.step('SELECT_DATABASE', async () => { check(await lifetime.execute(['SELECT', '0']) === 'OK', 'DATABASE'); });
          await diagnostics.step('INFO_SERVER', async () => {
            const fields = infoFields(await lifetime.execute(['INFO', 'server']));
            check(fields.get('redis_version') === document.redis.serverVersion && fields.get('run_id') === projection.expectedRedisRunId &&
              fields.get('tcp_port') === String(document.endpoints.redis.port) && /^[1-9][0-9]*$/.test(fields.get('process_id') ?? ''), 'IDENTITY');
          });
          await diagnostics.step('WHOAMI', async () => { check(await lifetime.execute(['ACL', 'WHOAMI']) === document.redis.aclUser, 'AUTH'); });
          await diagnostics.step('MARKER', async () => { check(await lifetime.execute(['GET', expected.markerKey]) === expected.markerValue, 'IDENTITY'); });
        });
        diagnostics.enter('POST_IDENTITY_LIFETIME'); checkAdmission(); assertAuthority();
      })));
      diagnostics.enter('POST_IDENTITY_LIFETIME');
      checkAdmission(); assertAuthority();
    })));
    diagnostics.enter('POST_SECRET_LIFETIME');
    checkAdmission(); lifetime.assertCurrent();
    diagnostics.enter('FACADES');
    const appOperations = operations.createProductionRedisOperations(lifetime, document.redis.keyPrefix);
    const app = freeze({ ...appOperations, rateLimit: { createStore: prefix => rateLimit.createProductionRedisStore(lifetime, document.redis.keyPrefix, prefix) } });
    diagnostics.enter('PROJECTION');
    const publicProjection = freeze({ runId: document.runId, instanceId: projection.instanceId, redisRunId: projection.expectedRedisRunId,
      credentialRef: projection.credentialRef, credentialGeneration: projection.credentialGeneration, connectionGeneration,
      ownershipReceiptId: projection.ownershipReceiptId, endpoint: { ...projection.endpoint }, database: 0,
      serverVersion: projection.serverVersion, aclUser: projection.aclUser, keyPrefix: projection.keyPrefix });
    const admission = Object.freeze(Object.create(null));
    admissions.set(admission, { app, lifetime });
    return freeze({ admission, owner: { revoke, close, projection: () => publicProjection } });
  })();
  try {
    const result = await Promise.race([work, cancellation]); diagnostics.enter('RETURN_LIFETIME'); checkAdmission();
    requireProductionRedis(result.admission); return result;
  } catch (cause) {
    const admissionDiagnostic = diagnostics.snapshot(cause);
    let cleanupVerified = false;
    try { await close(); cleanupVerified = true; } catch { cleanupVerified = false; }
    const error = refused(cleanupVerified ? 'START' : 'CLEANUP_UNVERIFIED');
    Object.defineProperty(error, 'cleanupReceipt', { value: freeze({ connectionGeneration, closed: cleanupVerified, notOpened: !constructed }), enumerable: true });
    Object.defineProperty(error, 'admissionDiagnostic', { value: admissionDiagnostic, enumerable: true });
    throw error;
  } finally { clearTimeout(admissionTimer); }
}

/** Read-only guard; only actual factory completion can populate its private brand. */
export function requireProductionRedis(admission) {
  const state = admissions.get(admission); check(state, 'CAPABILITY');
  state.lifetime.assertCurrent(); return state.app;
}
/** Trusted slot lifecycle observer. No caller facts can create/revive an admission. */
export function onProductionRedisRevoked(admission, callback) {
  const state = admissions.get(admission); check(state, 'CAPABILITY'); return state.lifetime.onRevoked(callback);
}
