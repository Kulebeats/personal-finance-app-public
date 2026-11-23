import { randomBytes } from 'node:crypto';
import { requireProductionManifest } from './manifest.mjs';

const credentials = new WeakMap();
const issued = new Set();
const refuse = code => { throw new Error(`REDIS_CREDENTIALS_REFUSED:${code}`); };
const observerFailure = () => new Error('REDIS_CREDENTIALS_OBSERVER_FAILED');

function stateFor(capability) {
  const state = credentials.get(capability);
  if (!state) refuse('CAPABILITY');
  return state;
}
function live(state) { if (state.phase === 'revoked') refuse('REVOKED'); }
function revoke(state) {
  if (state.phase === 'revoked') return;
  state.phase = 'revoked'; state.secret = undefined;
  const failures = [], unsubscribe = state.unsubscribe;
  state.unsubscribe = undefined;
  if (unsubscribe) { try { unsubscribe(); } catch { failures.push(observerFailure()); } }
  const listeners = Array.from(state.listeners); state.listeners.clear();
  for (const listener of listeners) {
    try { listener.callback(); } catch { failures.push(observerFailure()); }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'REDIS_CREDENTIALS_OBSERVERS_FAILED');
}
function matching(state, projection) {
  const { document } = state.manifest, expected = document.redis, endpoint = document.endpoints.redis;
  return projection.kind === 'owned-redis-service' && projection.runId === document.runId &&
    projection.instanceId === expected.instanceId && projection.endpoint?.host === endpoint.host && projection.endpoint?.port === endpoint.port &&
    ['serverVersion', 'database', 'aclUser', 'keyPrefix', 'credentialRef', 'credentialGeneration'].every(key => projection[key] === expected[key]) &&
    typeof projection.expectedRedisRunId === 'string' && projection.expectedRedisRunId.length > 0 &&
    typeof projection.ownershipReceiptId === 'string' && projection.ownershipReceiptId.length > 0;
}

/** Trusted bootstrap issuer only. Manifest consistency is not launch authority. */
export function createRedisCredentials(input) {
  let manifest;
  try { manifest = requireProductionManifest(input); } catch { refuse('MANIFEST'); }
  const { runId, redis } = manifest.document;
  const allocation = `${runId}|${redis.credentialRef}|${redis.credentialGeneration}`;
  if (issued.has(allocation)) refuse('DUPLICATE');
  const capability = Object.freeze(Object.create(null));
  const state = { manifest, phase: 'unbound', secret: randomBytes(32).toString('base64url'),
    provisioning: false, listeners: new Set(), service: undefined, requireService: undefined, unsubscribe: undefined,
    expectedRedisRunId: undefined, public: undefined };
  credentials.set(capability, state); issued.add(allocation);
  return Object.freeze({ capability, owner: Object.freeze({ revoke: () => revoke(state) }) });
}

/** Only the trusted producer callback receives provisioning material. */
export async function withRedisProvisioningSecret(capability, action) {
  const state = stateFor(capability); live(state);
  if (state.phase !== 'unbound' || state.provisioning) refuse('PHASE');
  if (typeof action !== 'function') refuse('ACTION');
  state.provisioning = true;
  let result;
  try { result = await action(state.secret); }
  catch { live(state); refuse('ACTION'); }
  finally { state.provisioning = false; }
  live(state);
  if (state.phase !== 'unbound') refuse('PHASE');
  return result;
}

/** One-time async rendezvous with the genuine producer; never accept public facts. */
export async function bindRedisCredentials(capability, service) {
  const state = stateFor(capability); live(state);
  if (state.phase !== 'unbound' || state.provisioning) refuse('PHASE');
  state.phase = 'binding';
  try {
    // Constant literal only. No producer stub, configurable verifier or fallback.
    const producer = await import('./redis-owned-service.mjs');
    live(state);
    const projection = producer.requireOwnedRedisService(service);
    if (!matching(state, projection)) refuse('SERVICE');
    state.service = service; state.requireService = producer.requireOwnedRedisService;
    state.expectedRedisRunId = projection.expectedRedisRunId;
    state.public = Object.freeze({ runId: projection.runId, credentialRef: projection.credentialRef,
      credentialGeneration: projection.credentialGeneration, instanceId: projection.instanceId, ownershipReceiptId: projection.ownershipReceiptId });
    state.phase = 'bound';
    const unsubscribe = producer.onOwnedRedisServiceRevoked(service, () => revoke(state));
    if (state.phase !== 'bound') { unsubscribe(); refuse('REVOKED'); }
    state.unsubscribe = unsubscribe;
    requireRedisCredentials(capability, service);
  } catch {
    // Error details from provisioning/producer code may contain secrets. Keep only the code.
    try { revoke(state); } catch { refuse('REVOCATION'); }
    refuse('SERVICE');
  }
}

export function requireRedisCredentials(capability, service) {
  const state = stateFor(capability); live(state);
  if (state.phase !== 'bound' || state.service !== service) refuse('SERVICE');
  try {
    const projection = state.requireService(service);
    if (!matching(state, projection) || projection.ownershipReceiptId !== state.public.ownershipReceiptId ||
      projection.expectedRedisRunId !== state.expectedRedisRunId) refuse('SERVICE');
  } catch {
    try { revoke(state); } catch { refuse('REVOCATION'); }
    refuse('SERVICE');
  }
  live(state);
  return state.public;
}

/** Factory only: check both bound lifetimes before dispatch and after the await. */
export async function withRedisConnectionSecret(capability, service, action) {
  requireRedisCredentials(capability, service);
  if (typeof action !== 'function') refuse('ACTION');
  const state = stateFor(capability);
  let result;
  try { result = await action(state.secret); }
  catch { requireRedisCredentials(capability, service); refuse('ACTION'); }
  requireRedisCredentials(capability, service);
  return result;
}

export function onRedisCredentialsRevoked(capability, callback) {
  const state = stateFor(capability);
  if (typeof callback !== 'function') refuse('OBSERVER');
  if (state.phase === 'revoked') {
    try { callback(); } catch { throw observerFailure(); }
    return () => {};
  }
  const listener = { callback }; state.listeners.add(listener);
  return () => { state.listeners.delete(listener); };
}
