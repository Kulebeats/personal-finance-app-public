import { randomBytes, randomUUID } from 'node:crypto';
import { requireProductionManifest } from './manifest.mjs';
import { withRedisProvisioningSecret, bindRedisCredentials } from './redis-credentials.mjs';
import { launchOwnedRedisSupervisor, connectOwnedRedisAdmin, verifyOwnedRedisHost } from './redis-owned-runtime.mjs';
import { createOwnedProviderGate, settleOwnedCaptures, redactedRedisStartupDiagnostic } from './redis-owned-lifetime.mjs';

// This issuer belongs only to the reviewed trusted bootstrap graph. Module
// consistency and private branding do not authenticate arbitrary public callers.
// The actual native launch/identity path is required before any service is issued.
const services = new WeakMap();
const provider = createOwnedProviderGate();
const refuse = phase => { throw new Error(`OWNED_REDIS_SERVICE_REFUSED:${phase}`); };
const observerError = () => new Error('OWNED_REDIS_SERVICE_OBSERVER_FAILED');
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

function stateFor(service) {
  const state = services.get(service);
  if (!state) refuse('CAPABILITY');
  return state;
}

function live(state) {
  if (state.revoked || !state.runtime?.alive() || !state.controller || state.controller.exitCode !== null || state.controller.signalCode !== null || state.controller.killed) refuse('REVOKED');
}

function revoke(state) {
  if (state.revoked) return;
  state.revoked = true; state.generation++;
  const listeners = Array.from(state.listeners); state.listeners.clear();
  const failures = [];
  for (const listener of listeners) {
    try { listener.callback(); } catch { failures.push(observerError()); }
  }
  if (failures.length) throw new AggregateError(failures, 'OWNED_REDIS_SERVICE_OBSERVERS_FAILED');
}

/** Public projections cannot mint the private service lineage. */
export function requireOwnedRedisService(service) {
  const state = stateFor(service); live(state);
  return state.projection;
}

/** Trusted factory lifecycle subscription; observers cannot prevent fanout. */
export function onOwnedRedisServiceRevoked(service, callback) {
  const state = stateFor(service);
  if (typeof callback !== 'function') refuse('OBSERVER');
  if (state.revoked) {
    try { callback(); } catch { throw observerError(); }
    return () => {};
  }
  const listener = { callback }; state.listeners.add(listener);
  return () => { state.listeners.delete(listener); };
}

/** Expectations stay private; only the factory's actual connection observes Redis. */
export async function withOwnedRedisIdentity(service, action) {
  const state = stateFor(service); live(state);
  if (typeof action !== 'function') refuse('ACTION');
  const generation = state.generation;
  let result;
  try { result = await action(state.identity); }
  catch { live(state); refuse('ACTION'); }
  live(state);
  if (state.generation !== generation) refuse('REVOKED');
  return result;
}

function redisConfiguration(document, secret, supervisorUser, supervisorSecret, markerKey) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret) || !/^[A-Za-z0-9_-]{43}$/.test(supervisorSecret)) refuse('SECRET');
  // The marker is outside the application write namespace and readable only by
  // exact key. Redis 7.0.15 ACL syntax and SELECT 1 denial remain actual gates.
  const appAcl = ['-@all', '+auth', '+get', '+set', '+setex', '+del', '+scan', '+incr', '+decr', '+pttl', '+pexpire',
    '+script|load', '+evalsha', '+info|server', '+acl|whoami', '-select', '+select|0'].join(' ');
  return [
    'bind 127.0.0.1', `port ${document.endpoints.redis.port}`, 'protected-mode yes', 'daemonize no', 'supervised no',
    'save ""', 'appendonly no', 'databases 1', 'maxmemory 64mb', 'maxmemory-policy noeviction', 'dir /var/lib/redis',
    'logfile ""', 'loglevel warning', 'user default off',
    `user ${document.redis.aclUser} reset on >${secret} ~${document.redis.keyPrefix}* %R~${markerKey} ${appAcl}`,
    `user ${supervisorUser} reset on >${supervisorSecret} ~* -@all +auth +info|server +acl|whoami +acl|getuser +config|get +set`,
    '',
  ].join('\n');
}

function infoFields(reply) {
  if (typeof reply !== 'string' || reply.length > 16384) refuse('INFO');
  const fields = new Map();
  for (const line of reply.split('\r\n')) {
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf(':'); if (separator < 1) refuse('INFO');
    const key = line.slice(0, separator); if (fields.has(key)) refuse('INFO');
    fields.set(key, line.slice(separator + 1));
  }
  return fields;
}

/** Actual issuer, imported only by the reviewed trusted local bootstrap.
 * A genuine consistency manifest is necessary; it is not execution permission.
 * No caller-supplied PID, observation, verifier or public projection can issue it.
 */
export async function startOwnedRedisService(input, credentials) {
  let manifest;
  try { manifest = requireProductionManifest(input); } catch { refuse('MANIFEST'); }
  const { document } = manifest;
  if (document.redis.serverVersion !== '7.0.15' || document.redis.database !== 0 || document.endpoints.redis.host !== '127.0.0.1') refuse('ALLOCATION');
  const lease = provider.acquire();
  const state = { revoked: false, generation: 0, listeners: new Set(), controller: undefined, runtime: undefined,
    projection: undefined, identity: undefined, stopPromise: undefined, observerFailure: false, startupCleanup: undefined,
    connectionCleanupFailed: false, provisioningEntered: false, phase: 'CREDENTIAL_PROVISIONING', startupDiagnostic: undefined };
  let admin;
  const connectionAbort = new AbortController();
  const lose = () => { connectionAbort.abort(); try { revoke(state); } catch { state.observerFailure = true; } };
  const step = async (phase, action) => {
    state.phase = phase;
    try { return await action(); }
    catch (error) { state.startupDiagnostic ??= redactedRedisStartupDiagnostic(phase, error); throw error; }
  };
  const stop = () => {
    if (state.stopPromise) return state.stopPromise;
    // Revoke before any await. Observer exceptions must never prevent cleanup.
    lose();
    state.stopPromise = (async () => {
      let receipt, connectionClosed = !admin && !state.connectionCleanupFailed;
      try { if (admin) connectionClosed = await admin.close() === true; }
      catch { connectionClosed = false; }
      finally {
        try { receipt = state.runtime ? await state.runtime.stop() : state.startupCleanup ?? freeze({ kind: 'owned-redis-shutdown',
          notLaunched: !state.provisioningEntered, cleanupVerified: !state.provisioningEntered }); }
        catch { receipt = freeze({ kind: 'owned-redis-shutdown', cleanupVerified: false }); }
      }
      const captures = await settleOwnedCaptures();
      if (receipt.kind === 'owned-redis-capture-cleanup') receipt = { kind: 'owned-redis-shutdown', notLaunched: !receipt.spawned,
        redisNotLaunched: true, cleanupVerified: captures.cleanupVerified, originalCaptureCleanup: receipt };
      const finalReceipt = freeze({ ...receipt, ownedCaptureCleanup: captures,
        cleanupVerified: receipt.cleanupVerified && connectionClosed && captures.cleanupVerified, connectionClosed, runId: document.runId, instanceId: document.redis.instanceId,
        ownershipReceiptId: state.projection?.ownershipReceiptId ?? null, authorityRevoked: state.revoked,
        observerFailure: state.observerFailure });
      provider.release(lease, finalReceipt);
      return finalReceipt;
    })();
    return state.stopPromise;
  };
  try {
    // Binding is deliberately after this provisioning callback returns: the
    // credential owner forbids binding while its secret callback is active.
    const actual = await step('CREDENTIAL_PROVISIONING', () => withRedisProvisioningSecret(credentials, async secret => {
      state.provisioningEntered = true;
      const supervisorUser = `pfa_owner_${randomBytes(12).toString('hex')}`;
      const supervisorSecret = randomBytes(32).toString('base64url');
      const markerKey = `pfa:owned-marker:${randomUUID()}`;
      const markerValue = randomBytes(32).toString('base64url');
      let runtime;
      try {
        runtime = await step('NATIVE_START', () => launchOwnedRedisSupervisor({ port: document.endpoints.redis.port,
          config: redisConfiguration(document, secret, supervisorUser, supervisorSecret, markerKey),
          runMs: document.timeouts.runMs, onLost: lose }));
      } catch (error) { state.startupCleanup = error?.cleanupReceipt; throw error; }
      state.runtime = runtime; state.controller = runtime.child;
      await step('NATIVE_LIFETIME', () => { if (state.revoked || !runtime.alive()) refuse('LIFETIME'); });
      try { admin = await step('WINDOWS_CONNECT', () => connectOwnedRedisAdmin(document.endpoints.redis.port, document.timeouts.connectMs,
        { signal: connectionAbort.signal, alive: () => !state.revoked && runtime.alive() })); }
      catch (error) { state.connectionCleanupFailed = error?.connectionCleanupFailed === true; throw error; }
      await step('AUTHENTICATE', async () => { if (await admin.command('AUTH', supervisorUser, supervisorSecret) !== 'OK') refuse('AUTH'); });
      const fields = await step('INFO_SERVER', async () => infoFields(await admin.command('INFO', 'server')));
      await step('IDENTITY_CHECK', () => {
        if (fields.get('redis_version') !== '7.0.15' || fields.get('process_id') !== String(runtime.observed.pid) ||
            fields.get('tcp_port') !== String(document.endpoints.redis.port) || !/^[a-f0-9]{40}$/.test(fields.get('run_id') ?? '')) refuse('IDENTITY');
      });
      await step('WHOAMI', async () => { if (await admin.command('ACL', 'WHOAMI') !== supervisorUser) refuse('AUTH'); });
      await step('DATABASES', async () => {
        const databases = await admin.command('CONFIG', 'GET', 'databases');
        if (!Array.isArray(databases) || databases.length !== 2 || databases[0] !== 'databases' || databases[1] !== '1') refuse('DATABASES');
      });
      await step('DEFAULT_USER', async () => {
        const defaultUser = await admin.command('ACL', 'GETUSER', 'default');
        const flagsIndex = Array.isArray(defaultUser) ? defaultUser.indexOf('flags') : -1;
        const flags = flagsIndex >= 0 ? defaultUser[flagsIndex + 1] : undefined;
        if (!Array.isArray(flags) || !flags.includes('off') || flags.includes('on')) refuse('DEFAULT_USER');
      });
      await step('MARKER', async () => { if (await admin.command('SET', markerKey, markerValue) !== 'OK') refuse('MARKER'); });
      await step('NATIVE_LIFETIME_AFTER_ADMISSION', () => { if (state.revoked || !runtime.alive()) refuse('LIFETIME'); });
      await step('HOST_POSTCHECK', () => verifyOwnedRedisHost());
      return { markerKey, markerValue, expectedRedisRunId: fields.get('run_id') };
    }));
    await step('LIFETIME_BEFORE_BIND', () => { if (state.revoked || !state.runtime?.alive()) refuse('LIFETIME'); });
    state.phase = 'PROJECTION';
    const service = Object.freeze(Object.create(null));
    state.identity = freeze(actual);
    state.projection = freeze({ kind: 'owned-redis-service', runId: document.runId, instanceId: document.redis.instanceId,
      endpoint: { ...document.endpoints.redis }, serverVersion: document.redis.serverVersion, database: document.redis.database,
      aclUser: document.redis.aclUser, keyPrefix: document.redis.keyPrefix, credentialRef: document.redis.credentialRef,
      credentialGeneration: document.redis.credentialGeneration, expectedRedisRunId: actual.expectedRedisRunId, ownershipReceiptId: randomUUID() });
    services.set(service, state);
    await step('BIND_CREDENTIALS', () => bindRedisCredentials(credentials, service));
    await step('LIFETIME_AFTER_BIND', () => live(state));
    const ownershipReceipt = freeze({ kind: 'owned-redis-process-association', ownershipReceiptId: state.projection.ownershipReceiptId,
      manifestSha256: manifest.manifestSha256, runId: document.runId, instanceId: document.redis.instanceId,
      endpoint: { ...document.endpoints.redis }, serverVersion: document.redis.serverVersion, expectedRedisRunId: actual.expectedRedisRunId,
      credentialRef: document.redis.credentialRef, credentialGeneration: document.redis.credentialGeneration,
      installedPackageVersion: '5:7.0.15-1ubuntu0.24.04.5', installedBinarySha256: '54a0ace7ff91c089ff23ee102420be96926db4bb436a50c9616440995f3dc113',
      installationReceiptSha256: '55c51cb61557518cca85a4e0b6543660516ccf1bf178e2e76db08474e3f7c873',
      windowsControllerPid: state.controller.pid, host: state.runtime.host, linux: { ...state.runtime.observed },
      authenticatedProcessIdMatched: true, databases: 1, defaultUserEnabled: false });
    return freeze({ service, owner: { stop, ownershipReceipt, revoke: () => {
      try { revoke(state); } catch { state.observerFailure = true; throw new Error('OWNED_REDIS_SERVICE_OBSERVERS_FAILED'); }
    } } });
  } catch (error) {
    // A launch refusal may already carry a complete cleanup receipt. No error
    // detail from secret-bearing admission/configuration crosses this boundary.
    const diagnostic = state.startupDiagnostic ?? redactedRedisStartupDiagnostic(state.phase, error);
    const receipt = await stop();
    const refusal = new Error(`OWNED_REDIS_SERVICE_REFUSED:${receipt.cleanupVerified ? 'START' : 'CLEANUP_UNVERIFIED'}`);
    Object.defineProperty(refusal, 'cleanupReceipt', { value: receipt, enumerable: true });
    Object.defineProperty(refusal, 'startupDiagnostic', { value: diagnostic, enumerable: true });
    throw refusal;
  }
}
