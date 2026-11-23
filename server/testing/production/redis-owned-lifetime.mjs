import { performance } from 'node:perf_hooks';

// Internal mechanics only. These helpers neither issue nor verify a Redis
// service. The issuer's native path supplies the actual returned process/socket.
const outstanding = new Map();
const ownedSupervisors = new Set();

const startupPhases = new Set(['CREDENTIAL_PROVISIONING', 'NATIVE_START', 'NATIVE_LIFETIME', 'WINDOWS_CONNECT', 'AUTHENTICATE',
  'INFO_SERVER', 'IDENTITY_CHECK', 'WHOAMI', 'DATABASES', 'DEFAULT_USER', 'MARKER', 'NATIVE_LIFETIME_AFTER_ADMISSION',
  'HOST_POSTCHECK', 'LIFETIME_BEFORE_BIND', 'PROJECTION', 'BIND_CREDENTIALS', 'LIFETIME_AFTER_BIND']);
const startupReasons = new Map([
  ['OWNED_REDIS_RUNTIME_REFUSED:RESP_REJECTED', 'SERVER_REJECTED'], ['OWNED_REDIS_RUNTIME_REFUSED:RESP', 'PROTOCOL_REFUSED'],
  ['OWNED_REDIS_RUNTIME_REFUSED:COMMAND_TIMEOUT', 'COMMAND_TIMEOUT'], ['OWNED_REDIS_RUNTIME_REFUSED:CONNECTION', 'CONNECTION_CLOSED'],
  ['OWNED_REDIS_RUNTIME_REFUSED:CONNECTION_CLOSED', 'CONNECTION_CLOSED'], ['OWNED_REDIS_RUNTIME_REFUSED:REGISTRATION', 'HOST_REFUSED'],
  ['OWNED_REDIS_RUNTIME_REFUSED:CONNECT_CANCELLED', 'LIFETIME_REFUSED'],
  ['OWNED_REDIS_SERVICE_REFUSED:LIFETIME', 'LIFETIME_REFUSED'], ['OWNED_REDIS_SERVICE_REFUSED:REVOKED', 'LIFETIME_REFUSED'],
  ['OWNED_REDIS_SERVICE_REFUSED:AUTH', 'AUTH_REFUSED'], ['OWNED_REDIS_SERVICE_REFUSED:IDENTITY', 'IDENTITY_REFUSED'],
  ['OWNED_REDIS_SERVICE_REFUSED:INFO', 'PROTOCOL_REFUSED'], ['OWNED_REDIS_SERVICE_REFUSED:DATABASES', 'DATABASES_REFUSED'],
  ['OWNED_REDIS_SERVICE_REFUSED:DEFAULT_USER', 'DEFAULT_USER_REFUSED'], ['OWNED_REDIS_SERVICE_REFUSED:MARKER', 'MARKER_REFUSED'],
  ['REDIS_CREDENTIALS_REFUSED:CAPABILITY', 'CREDENTIAL_REFUSED'], ['REDIS_CREDENTIALS_REFUSED:PHASE', 'CREDENTIAL_REFUSED'],
  ['REDIS_CREDENTIALS_REFUSED:SERVICE', 'CREDENTIAL_REFUSED'], ['REDIS_CREDENTIALS_REFUSED:REVOKED', 'CREDENTIAL_REFUSED'],
]);
const connectionReasons = new Set(['TCP_REFUSED', 'TCP_TIMEOUT', 'TCP_RESET', 'TCP_UNREACHABLE', 'TCP_PERMISSION', 'SOCKET_FAILURE']);
/** Only literal vocabulary may cross the secret-bearing startup boundary. */
export function redactedRedisStartupDiagnostic(phase, error) {
  let reason = 'UNCLASSIFIED';
  try {
    const connectionFailure = error?.connectionFailure;
    if (connectionReasons.has(connectionFailure)) reason = connectionFailure;
    else reason = startupReasons.get(error?.message) ?? reason;
  } catch { /* Even a throwing error getter cannot expose its text or cause. */ }
  return Object.freeze({ phase: startupPhases.has(phase) ? phase : 'UNKNOWN', reason });
}

/** Public evidence projection, not an issuer or a source of process authority. */
export function publicSupervisorObservation(row) {
  const pid = value => Number.isSafeInteger(value) && value > 1;
  const decimal = value => typeof value === 'string' && /^\d+$/.test(value);
  if (row.event === 'ready' && pid(row.pid) && pid(row.supervisorPid) && decimal(row.startTicks) && decimal(row.listenerInode) &&
      decimal(row.exeDev) && decimal(row.exeIno) && typeof row.bootId === 'string' && /^[a-f0-9-]{36}$/.test(row.bootId)) return Object.freeze({ event: 'ready', pid: row.pid, startTicks: row.startTicks,
    listenerInode: row.listenerInode, bootId: row.bootId, exeDev: row.exeDev, exeIno: row.exeIno, supervisorPid: row.supervisorPid });
  if (row.event === 'stopped' && typeof row.terminated === 'boolean' && typeof row.listenerClosed === 'boolean' &&
      (row.pid === null || pid(row.pid)) && (row.startTicks === null || decimal(row.startTicks))) return Object.freeze({ event: 'stopped', terminated: row.terminated,
    listenerClosed: row.listenerClosed, pid: row.pid, startTicks: row.startTicks });
  throw new Error('OWNED_REDIS_RUNTIME_REFUSED:OBSERVATION');
}

// Errors (including kill EPERM) do not prove either of these observations.
export function observeOwnedExitAndDrain(child) {
  ownedSupervisors.add(child);
  let exited = false, drained = false, complete;
  const completion = new Promise(resolve => { complete = resolve; });
  const snapshot = () => Object.freeze({ exited, drained });
  const finish = () => { if (exited && drained) { ownedSupervisors.delete(child); complete(snapshot()); } };
  child.once('exit', () => { exited = true; finish(); });
  child.once('close', () => { drained = true; finish(); });
  return Object.freeze({ completion, snapshot });
}

export function createOwnedProviderGate() {
  let current;
  return Object.freeze({
    acquire() {
      if (current) throw new Error('OWNED_REDIS_SERVICE_REFUSED:PROVIDER_BUSY');
      current = Object.freeze(Object.create(null)); return current;
    },
    release(token, receipt) {
      if (current !== token || receipt?.cleanupVerified !== true || receipt.connectionClosed !== true) return false;
      current = undefined; return true;
    },
  });
}

export function createMonotonicFreshness(budgetMs) {
  let last = performance.now();
  return Object.freeze({ touch() { last = performance.now(); }, fresh() {
    const age = performance.now() - last;
    return Number.isFinite(age) && age >= 0 && age <= budgetMs;
  } });
}

function closeWithin(socket, budgetMs) {
  let listener, timer;
  const promise = new Promise(resolve => {
    const finish = observed => { clearTimeout(timer); socket.removeListener('close', listener); resolve(observed); };
    listener = () => finish(true);
    if (socket.closed) { resolve(true); return; }
    socket.once('close', listener); timer = setTimeout(() => finish(false), budgetMs);
  });
  return promise;
}
export async function closeOwnedSocket(socket, endMs = 1000, destroyMs = 1000) {
  const graceful = closeWithin(socket, endMs);
  try { socket.end(); } catch { /* Destroy still has its own finite closure proof. */ }
  if (await graceful) return true;
  const forced = closeWithin(socket, destroyMs);
  try { socket.destroy(); } catch { /* A method call is not an observed close. */ }
  return forced;
}

function receipt(state) {
  return Object.freeze({ kind: 'owned-redis-capture-cleanup', spawned: state.spawned,
    ownedWindowsProcessExited: state.exited, outputDrained: state.closed,
    cleanupVerified: state.exited && state.closed });
}
function killOwned(state) {
  if (state.exited && state.closed) return;
  try { state.child.kill(); } catch { /* Keep ownership and unverified disposition. */ }
}

/** A deadline may return failure, but never drops an undrained owned handle. */
export function captureOwnedProcess(child, { budgetMs, killGraceMs = 2000, limitBytes = 16384, input } = {}) {
  const state = { child, spawned: Number.isSafeInteger(child.pid) && child.pid > 0, exited: false, closed: false,
    failure: undefined, bytes: 0, stderr: 0, chunks: [], finish: undefined, closedPromise: undefined };
  let resolveClosed;
  state.closedPromise = new Promise(resolve => { resolveClosed = resolve; });
  outstanding.set(child, state);
  return new Promise(resolve => {
    let finished = false, deadline, grace;
    state.finish = code => {
      if (finished) return; finished = true; clearTimeout(deadline); clearTimeout(grace);
      resolve(Object.freeze({ passed: code === 0 && !state.failure && state.stderr === 0 && state.exited && state.closed,
        failure: state.failure ?? (code === 0 ? null : 'EXIT'), stdout: Buffer.concat(state.chunks), cleanup: receipt(state) }));
    };
    const refuse = code => {
      state.failure ||= code; killOwned(state);
      if (!grace) grace = setTimeout(() => state.finish(null), killGraceMs);
    };
    child.stdout.on('data', bytes => {
      state.bytes += bytes.length;
      if (state.bytes > limitBytes) refuse('OUTPUT'); else state.chunks.push(bytes);
    });
    child.stderr.on('data', bytes => { state.stderr += bytes.length; refuse('STDERR'); });
    child.once('error', () => { if (!state.spawned) state.exited = true; refuse('PROCESS'); });
    child.once('exit', () => { state.exited = true; });
    child.once('close', code => {
      state.closed = true; resolveClosed();
      if (state.exited) outstanding.delete(child);
      state.finish(code);
    });
    if (input !== undefined) {
      child.stdin.on('error', () => refuse('INPUT'));
      try { child.stdin.end(input); } catch { refuse('INPUT'); }
    }
    deadline = setTimeout(() => refuse('TIMEOUT'), budgetMs);
  });
}

/** Cleanup operates on retained handles, never numeric PIDs or caller facts. */
export async function settleOwnedCaptures(graceMs = 2000) {
  const retained = Array.from(outstanding.values());
  for (const state of retained) killOwned(state);
  if (retained.length) {
    let timer;
    try { await Promise.race([Promise.all(retained.map(state => state.closedPromise)),
      new Promise(resolve => { timer = setTimeout(resolve, graceMs); })]); }
    finally { clearTimeout(timer); }
  }
  return Object.freeze({ cleanupVerified: outstanding.size === 0, pendingCount: outstanding.size });
}
