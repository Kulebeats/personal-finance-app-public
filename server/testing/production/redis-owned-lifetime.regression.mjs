import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { captureOwnedProcess, settleOwnedCaptures, createOwnedProviderGate,
  closeOwnedSocket, createMonotonicFreshness, observeOwnedExitAndDrain, redactedRedisStartupDiagnostic,
  publicSupervisorObservation } from './redis-owned-lifetime.mjs';

// Low-level inert process/socket events only. No executable, WSL, Redis process,
// service brand, credential binding or public issuer is simulated by these tests.
function inertProcess() {
  const process = new EventEmitter(); process.pid = 42; process.kills = 0;
  process.stdout = new EventEmitter(); process.stderr = new EventEmitter(); process.stdin = new EventEmitter();
  process.stdin.end = () => {}; process.kill = () => { process.kills++; return true; };
  return process;
}

test('startup diagnostics expose only closed phase and reason literals', () => {
  const secret = 'DO_NOT_ECHO_private_AUTH_config_marker_or_error';
  assert.deepEqual(redactedRedisStartupDiagnostic('WINDOWS_CONNECT', { connectionFailure: 'TCP_REFUSED', message: secret }),
    { phase: 'WINDOWS_CONNECT', reason: 'TCP_REFUSED' });
  assert.deepEqual(redactedRedisStartupDiagnostic('AUTHENTICATE', new Error('OWNED_REDIS_RUNTIME_REFUSED:RESP_REJECTED')),
    { phase: 'AUTHENTICATE', reason: 'SERVER_REJECTED' });
  let reads = 0;
  assert.deepEqual(redactedRedisStartupDiagnostic('WINDOWS_CONNECT', { get connectionFailure() { return reads++ === 0 ? 'TCP_REFUSED' : secret; } }),
    { phase: 'WINDOWS_CONNECT', reason: 'TCP_REFUSED' });
  assert.equal(reads, 1);
  for (const error of [new Error(secret), { connectionFailure: secret, message: secret },
    { get message() { throw new Error(secret); }, cause: new Error(secret) }]) {
    const diagnostic = redactedRedisStartupDiagnostic(secret, error);
    assert.deepEqual(diagnostic, { phase: 'UNKNOWN', reason: 'UNCLASSIFIED' });
    assert.equal(JSON.stringify(diagnostic).includes(secret), false);
  }
});

test('native evidence drops unknown fields instead of serializing a whole supervisor row', () => {
  const secret = 'DO_NOT_ECHO_native_extra_field';
  const ready = { event: 'ready', pid: 42, startTicks: '9', listenerInode: '8', bootId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', exeDev: '1', exeIno: '2', supervisorPid: 41, secret };
  const stopped = { event: 'stopped', terminated: true, listenerClosed: true, pid: 42, startTicks: '9', config: secret };
  for (const row of [ready, stopped]) {
    const observed = publicSupervisorObservation(row);
    assert.equal(Object.isFrozen(observed), true); assert.equal(JSON.stringify(observed).includes(secret), false);
  }
  assert.throws(() => publicSupervisorObservation({ event: secret }), /OBSERVATION/);
  assert.throws(() => publicSupervisorObservation({ ...ready, pid: { secret } }), /OBSERVATION/);
});

test('spawned supervisor kill errors cannot stand in for process exit and drained pipes', async () => {
  const process = inertProcess(), tracking = observeOwnedExitAndDrain(process), gate = createOwnedProviderGate(), lease = gate.acquire();
  let failed = false, completed = false;
  process.on('error', () => { failed = true; });
  tracking.completion.then(() => { completed = true; });
  process.emit('spawn');
  process.kill = () => { process.emit('error', Object.assign(new Error('inert kill refusal'), { code: 'EPERM' })); return false; };
  process.kill();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(failed, true); assert.equal(completed, false);
  assert.deepEqual(tracking.snapshot(), { exited: false, drained: false });
  assert.equal(gate.release(lease, { cleanupVerified: false, connectionClosed: true }), false);
  process.emit('exit', 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, false); assert.deepEqual(tracking.snapshot(), { exited: true, drained: false });
  assert.throws(() => gate.acquire(), /PROVIDER_BUSY/);
  process.emit('close', 0);
  assert.deepEqual(await tracking.completion, { exited: true, drained: true });
  assert.equal(gate.release(lease, { cleanupVerified: false, connectionClosed: true }), false);
  assert.equal(gate.release(lease, { cleanupVerified: true, connectionClosed: true }), true);
});

test('a timed-out undrained process retains cleanup ownership and cannot claim no child', async () => {
  const process = inertProcess();
  const result = await captureOwnedProcess(process, { budgetMs: 5, killGraceMs: 5 });
  assert.equal(result.passed, false); assert.equal(result.cleanup.spawned, true);
  assert.equal(result.cleanup.ownedWindowsProcessExited, false); assert.equal(result.cleanup.outputDrained, false);
  assert.equal(result.cleanup.cleanupVerified, false); assert.ok(process.kills > 0);
  const blocked = await settleOwnedCaptures(5);
  assert.equal(blocked.cleanupVerified, false); assert.equal(blocked.pendingCount, 1);
  process.emit('exit', 1); process.emit('close', 1);
  assert.deepEqual(await settleOwnedCaptures(5), { cleanupVerified: true, pendingCount: 0 });
});

test('process exit without closed output pipes remains unverified', async () => {
  const process = inertProcess();
  const resultPromise = captureOwnedProcess(process, { budgetMs: 5, killGraceMs: 5 });
  process.emit('exit', 0);
  const result = await resultPromise;
  assert.equal(result.cleanup.ownedWindowsProcessExited, true);
  assert.equal(result.cleanup.outputDrained, false); assert.equal(result.cleanup.cleanupVerified, false);
  process.emit('close', 0);
  assert.equal((await settleOwnedCaptures(5)).cleanupVerified, true);
});

test('a complete inert capture requires both process exit and pipe closure', async () => {
  const process = inertProcess();
  const promise = captureOwnedProcess(process, { budgetMs: 100, killGraceMs: 5 });
  process.stdout.emit('data', Buffer.from('public observation'));
  process.emit('exit', 0); process.emit('close', 0);
  const result = await promise;
  assert.equal(result.passed, true); assert.equal(result.stdout.toString(), 'public observation');
  assert.equal(result.cleanup.cleanupVerified, true); assert.equal(process.kills, 0);
});

test('provider release requires the final connection and complete cleanup receipt', () => {
  const gate = createOwnedProviderGate(), first = gate.acquire();
  assert.equal(gate.release(first, { cleanupVerified: true, connectionClosed: false }), false);
  assert.throws(() => gate.acquire(), /PROVIDER_BUSY/);
  assert.equal(gate.release(first, { cleanupVerified: false, connectionClosed: true }), false);
  assert.throws(() => gate.acquire(), /PROVIDER_BUSY/);
  assert.equal(gate.release(first, { cleanupVerified: true, connectionClosed: true }), true);
  const second = gate.acquire();
  assert.equal(gate.release(first, { cleanupVerified: true, connectionClosed: true }), false);
  assert.throws(() => gate.acquire(), /PROVIDER_BUSY/);
  assert.equal(gate.release(second, { cleanupVerified: true, connectionClosed: true }), true);
});

test('admin socket close stays bounded and never treats destroy as observed closure', async () => {
  const socket = new EventEmitter(); socket.closed = false; let ended = 0, destroyed = 0;
  socket.end = () => { ended++; }; socket.destroy = () => { destroyed++; };
  const start = performance.now();
  assert.equal(await closeOwnedSocket(socket, 5, 5), false);
  assert.ok(performance.now() - start < 1000); assert.equal(ended, 1); assert.equal(destroyed, 1);
  assert.equal(socket.listenerCount('close'), 0);
});

test('admin socket close accepts an actual close event after its bounded destroy', async () => {
  const socket = new EventEmitter(); socket.closed = false; socket.end = () => {};
  socket.destroy = () => { socket.closed = true; socket.emit('close'); };
  assert.equal(await closeOwnedSocket(socket, 5, 5), true);
  assert.equal(socket.listenerCount('close'), 0);
});

test('wall-clock rollback cannot extend heartbeat freshness', async () => {
  const heartbeat = createMonotonicFreshness(5), original = Date.now;
  try {
    Date.now = () => -8640000000000000;
    assert.equal(heartbeat.fresh(), true);
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(heartbeat.fresh(), false);
    heartbeat.touch(); assert.equal(heartbeat.fresh(), true);
  } finally { Date.now = original; }
});
