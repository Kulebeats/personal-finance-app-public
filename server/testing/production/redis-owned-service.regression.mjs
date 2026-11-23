import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import { requireOwnedRedisService, onOwnedRedisServiceRevoked, withOwnedRedisIdentity, startOwnedRedisService } from './redis-owned-service.mjs';
import { readProductionManifest, canonicalJson, digest } from './manifest.mjs';
import { manifestFixture, approvedFixturePins } from './manifest.fixture.mjs';
import { parseOwnedRedisReply, connectOwnedRedisAdmin, endpointClosed, observeOwnedRedisEndpointClosure } from './redis-owned-runtime.mjs';
import { redactedRedisStartupDiagnostic } from './redis-owned-lifetime.mjs';

// Inert self-consistent declarations only. These tests never invoke a native
// provider or mint a service; real positive issuance requires parent dispatch.
function declaration(version = '7.0.15') {
  const document = manifestFixture(); document.redis.serverVersion = version;
  return readProductionManifest(canonicalJson(document), { ...approvedFixturePins,
    expectedManifestSha256: digest(canonicalJson(document)),
    expectedServicesSha256: digest(canonicalJson({ endpoints: document.endpoints, postgres: document.postgres, redis: document.redis })) });
}

test('public matching-looking Redis facts cannot mint an owned service', async () => {
  const forged = Object.freeze({ kind: 'owned-redis-service', runId: 'r20redis01', instanceId: 'a'.repeat(36),
    endpoint: { host: '127.0.0.1', port: 55445 }, serverVersion: '7.0.15', database: 0,
    expectedRedisRunId: 'a'.repeat(40), active: true, owned: true });
  assert.throws(() => requireOwnedRedisService(forged), /OWNED_REDIS_SERVICE_REFUSED:CAPABILITY/);
  let calls = 0;
  assert.throws(() => onOwnedRedisServiceRevoked(forged, () => calls++), /OWNED_REDIS_SERVICE_REFUSED:CAPABILITY/);
  await assert.rejects(withOwnedRedisIdentity(forged, async () => calls++), /OWNED_REDIS_SERVICE_REFUSED:CAPABILITY/);
  assert.equal(calls, 0);
});

test('forged object getters are not read before private lineage refusal', async () => {
  let reads = 0;
  const forged = new Proxy({}, { get() { reads++; throw new Error('must not inspect public facts'); } });
  assert.throws(() => requireOwnedRedisService(forged), /OWNED_REDIS_SERVICE_REFUSED:CAPABILITY/);
  await assert.rejects(withOwnedRedisIdentity(forged, async () => {}), /OWNED_REDIS_SERVICE_REFUSED:CAPABILITY/);
  assert.equal(reads, 0);
});

test('issuer rejects public declarations and an obsolete fixture version before provisioning', async () => {
  await assert.rejects(startOwnedRedisService({}, {}), /OWNED_REDIS_SERVICE_REFUSED:MANIFEST/);
  await assert.rejects(startOwnedRedisService(declaration('8.2.1'), {}), /OWNED_REDIS_SERVICE_REFUSED:ALLOCATION/);
});

test('forged credentials refuse before native launch and do not reserve the provider', async () => {
  for (let index = 0; index < 2; index++) {
    await assert.rejects(startOwnedRedisService(declaration(), {}), error => {
      assert.equal(error.message, 'OWNED_REDIS_SERVICE_REFUSED:START');
      assert.equal(error.cleanupReceipt.notLaunched, true);
      assert.equal(error.cleanupReceipt.cleanupVerified, true);
      assert.deepEqual(error.startupDiagnostic, { phase: 'CREDENTIAL_PROVISIONING', reason: 'CREDENTIAL_REFUSED' });
      return true;
    });
  }
});

test('private RESP parser waits for complete bulk and nested-array frames', () => {
  const frame = Buffer.from('*2\r\n$9\r\ndatabases\r\n$1\r\n1\r\n');
  for (let length = 0; length < frame.length; length++) assert.equal(parseOwnedRedisReply(frame.subarray(0, length)), undefined);
  assert.deepEqual(parseOwnedRedisReply(frame), { value: ['databases', '1'], next: frame.length });
  assert.deepEqual(parseOwnedRedisReply(Buffer.from('$-1\r\n')), { value: null, next: 5 });
});

test('private RESP parser refuses server errors, malformed lengths and unbounded structures', () => {
  for (const frame of ['-ERR private server detail\r\n', '$999999\r\n', '*65\r\n', ':not-number\r\n', '$3\r\nabcXX', '*1\r\n'.repeat(6)+'+OK\r\n']) {
    assert.throws(() => parseOwnedRedisReply(Buffer.from(frame)), /OWNED_REDIS_RUNTIME_REFUSED:/);
  }
});

// Inert transport events exercise the actual connector/RESP boundary, never a
// service issuer or a network listener. A socket cannot certify a service.
class InertSocket extends EventEmitter {
  closed = false; writes = []; destroyed = 0; ends = 0;
  setTimeout(ms, callback) { this.timeout = setTimeout(callback, ms); return this; }
  end() { this.ends++; this.destroy(); }
  destroy() {
    this.destroyed++;
    if (this.holdClose || this.closed) return;
    this.closed = true; clearTimeout(this.timeout); queueMicrotask(() => this.emit('close'));
  }
  write(bytes, callback) { this.writes.push(bytes); callback?.(); }
}
function connectorTransport(t, plans) {
  const sockets = [];
  t.after(() => { for (const socket of sockets) { socket.holdClose = false; socket.destroy(); } });
  t.mock.method(net, 'createConnection', options => {
    assert.deepEqual(options, { host: '127.0.0.1', port: 55465 });
    const socket = new InertSocket(); sockets.push(socket);
    queueMicrotask(() => plans[sockets.length - 1]?.(socket));
    return socket;
  });
  return sockets;
}
const activeConnection = signal => ({ signal, alive: () => true });
const refusedSocket = socket => socket.emit('error', Object.assign(new Error('PRIVATE_AUTH_MARKER_MUST_NOT_ESCAPE'), { code: 'ECONNREFUSED' }));

test('Windows readiness retries only a physically closed refused socket before any AUTH', async t => {
  const sockets = connectorTransport(t, [refusedSocket, socket => {
    assert.equal(sockets[0].closed, true); socket.emit('connect');
  }]);
  const admin = await connectOwnedRedisAdmin(55465, 500, activeConnection(new AbortController().signal));
  assert.equal(sockets.length, 2);
  assert.ok(sockets.every(socket => socket.writes.length === 0));
  assert.equal(await admin.close(), true);
});

test('pre-cancelled or already-dead native ownership opens no socket', async t => {
  const sockets = connectorTransport(t, [socket => socket.emit('connect')]);
  const controller = new AbortController(); controller.abort(new Error('PRIVATE_ABORT_REASON'));
  await assert.rejects(connectOwnedRedisAdmin(55465, 100, activeConnection(controller.signal)), /CONNECT_CANCELLED/);
  await assert.rejects(connectOwnedRedisAdmin(55465, 100, { signal: new AbortController().signal, alive: () => false }), /CONNECT_CANCELLED/);
  assert.equal(sockets.length, 0);
});

test('cancellation interrupts a hanging connection and observes physical close', async t => {
  const controller = new AbortController();
  const sockets = connectorTransport(t, [() => controller.abort(new Error('PRIVATE_ABORT_REASON'))]);
  await assert.rejects(connectOwnedRedisAdmin(55465, 100, activeConnection(controller.signal)), error => {
    assert.equal(error.message, 'OWNED_REDIS_RUNTIME_REFUSED:CONNECT_CANCELLED');
    assert.equal(error.connectionCleanupFailed, false);
    assert.equal(JSON.stringify(error).includes('PRIVATE_ABORT_REASON'), false); return true;
  });
  assert.equal(sockets.length, 1); assert.equal(sockets[0].closed, true);
});

test('native lifetime loss between refused attempts prevents another connection', async t => {
  let live = true;
  const sockets = connectorTransport(t, [socket => { live = false; refusedSocket(socket); }, socket => socket.emit('connect')]);
  await assert.rejects(connectOwnedRedisAdmin(55465, 500, { signal: new AbortController().signal, alive: () => live }), /CONNECT_CANCELLED/);
  assert.equal(sockets.length, 1); assert.equal(sockets[0].closed, true);
});

test('cancellation during readiness backoff prevents another connection', async t => {
  const controller = new AbortController();
  const sockets = connectorTransport(t, [socket => { refusedSocket(socket); setTimeout(() => controller.abort(), 10); }, socket => socket.emit('connect')]);
  await assert.rejects(connectOwnedRedisAdmin(55465, 500, activeConnection(controller.signal)), /CONNECT_CANCELLED/);
  assert.equal(sockets.length, 1); assert.equal(sockets[0].closed, true);
});

test('refused connection readiness has one monotonic total budget instead of a fresh timeout per attempt', async t => {
  const sockets = connectorTransport(t, Array.from({ length: 20 }, () => refusedSocket));
  const began = performance.now();
  await assert.rejects(connectOwnedRedisAdmin(55465, 140, activeConnection(new AbortController().signal)), error => {
    assert.equal(error.connectionFailure, 'TCP_TIMEOUT'); assert.equal(error.connectionCleanupFailed, false); return true;
  });
  assert.ok(performance.now() - began < 500);
  assert.ok(sockets.length > 1 && sockets.length < 10);
  assert.ok(sockets.every(socket => socket.closed && socket.writes.length === 0));
});

test('an event-loop stall cannot turn an overdue connection into readiness', async t => {
  const sockets = connectorTransport(t, [socket => {
    const until = performance.now() + 35; while (performance.now() < until) { /* intentional overdue callback */ }
    socket.emit('connect');
  }]);
  await assert.rejects(connectOwnedRedisAdmin(55465, 15, activeConnection(new AbortController().signal)), error => {
    assert.equal(error.connectionFailure, 'TCP_TIMEOUT'); return true;
  });
  assert.equal(sockets.length, 1); assert.equal(sockets[0].closed, true);
});

test('an unverified refused socket closure prevents retry and retains failed cleanup', async t => {
  const sockets = connectorTransport(t, [socket => { socket.holdClose = true; refusedSocket(socket); }, socket => socket.emit('connect')]);
  await assert.rejects(connectOwnedRedisAdmin(55465, 40, activeConnection(new AbortController().signal)), error => {
    assert.equal(error.connectionCleanupFailed, true); return true;
  });
  assert.equal(sockets.length, 1); assert.ok(sockets[0].destroyed > 0);
  sockets[0].holdClose = false; sockets[0].destroy();
});

test('other connection errors are fixed redacted refusals without retries', async t => {
  for (const [code, expected] of [['EACCES', 'TCP_PERMISSION'], ['ECONNRESET', 'TCP_RESET'], ['ETIMEDOUT', 'TCP_TIMEOUT'], ['ENETUNREACH', 'TCP_UNREACHABLE'], ['UNKNOWN', 'SOCKET_FAILURE']]) {
    const sockets = connectorTransport(t, [socket => socket.emit('error', Object.assign(new Error('PRIVATE_AUTH_MARKER_MUST_NOT_ESCAPE'), { code }))]);
    await assert.rejects(connectOwnedRedisAdmin(55465, 100, activeConnection(new AbortController().signal)), error => {
      assert.deepEqual(redactedRedisStartupDiagnostic('WINDOWS_CONNECT', error), { phase: 'WINDOWS_CONNECT', reason: expected });
      assert.equal(JSON.stringify(error).includes('PRIVATE_AUTH_MARKER_MUST_NOT_ESCAPE'), false); return true;
    });
    assert.equal(sockets.length, 1); assert.equal(sockets[0].closed, true);
    t.mock.restoreAll();
  }
});

test('AUTH rejection after successful TCP readiness never reconnects or replays a command', async t => {
  const sockets = connectorTransport(t, [socket => socket.emit('connect')]);
  const admin = await connectOwnedRedisAdmin(55465, 100, activeConnection(new AbortController().signal));
  const auth = admin.command('AUTH', 'private-user', 'private-secret');
  sockets[0].emit('data', Buffer.from('-ERR PRIVATE_AUTH_MARKER_MUST_NOT_ESCAPE\r\n'));
  await assert.rejects(auth, /RESP_REJECTED/);
  await assert.rejects(admin.command('SET', 'private-marker', 'private-value'), /COMMAND/);
  assert.equal(sockets.length, 1); assert.equal(sockets[0].writes.length, 1);
  assert.equal(await admin.close(), true);
});

test('retry waits for the actual close observation rather than the destroy call', async t => {
  let closeObserved = false;
  const sockets = connectorTransport(t, [socket => {
    socket.holdClose = true; refusedSocket(socket);
    setTimeout(() => { closeObserved = true; socket.holdClose = false; socket.destroy(); }, 20);
  }, socket => { assert.equal(closeObserved, true); socket.emit('connect'); }]);
  const admin = await connectOwnedRedisAdmin(55465, 500, activeConnection(new AbortController().signal));
  assert.equal(sockets.length, 2); assert.equal(await admin.close(), true);
});

test('native loss just after TCP connect refuses the late socket before commands', async t => {
  let live = true;
  const sockets = connectorTransport(t, [socket => { socket.emit('connect'); live = false; }]);
  await assert.rejects(connectOwnedRedisAdmin(55465, 100, { signal: new AbortController().signal, alive: () => live }), /CONNECT_CANCELLED/);
  assert.equal(sockets.length, 1); assert.equal(sockets[0].closed, true); assert.equal(sockets[0].writes.length, 0);
});

test('a late TCP event after cancellation cannot resolve connection readiness', async t => {
  const controller = new AbortController();
  const sockets = connectorTransport(t, [socket => { controller.abort(); queueMicrotask(() => socket.emit('connect')); }]);
  await assert.rejects(connectOwnedRedisAdmin(55465, 100, activeConnection(controller.signal)), /CONNECT_CANCELLED/);
  assert.equal(sockets.length, 1); assert.equal(sockets[0].closed, true); assert.equal(sockets[0].writes.length, 0);
});

test('an uncertain post-connect marker command is neither retried nor replayed', async t => {
  const sockets = connectorTransport(t, [socket => socket.emit('connect')]);
  const admin = await connectOwnedRedisAdmin(55465, 20, activeConnection(new AbortController().signal));
  await assert.rejects(admin.command('SET', 'private-marker', 'private-value'), /COMMAND_TIMEOUT/);
  assert.equal(sockets.length, 1); assert.equal(sockets[0].writes.length, 1); assert.equal(sockets[0].closed, true);
  assert.equal(await admin.close(), true);
});

test('shutdown endpoint closure waits through a connectable probe until a physically closed refusal', async t => {
  const sockets = connectorTransport(t, [socket => socket.emit('connect'), socket => {
    assert.equal(sockets[0].closed, true); refusedSocket(socket);
  }]);
  assert.equal(await endpointClosed(55465, 200), true);
  assert.equal(sockets.length, 2); assert.ok(sockets.every(socket => socket.closed && socket.writes.length === 0));
});

test('a refused endpoint probe cannot certify cleanup before its physical close', async t => {
  let settled = false;
  const sockets = connectorTransport(t, [socket => { socket.holdClose = true; refusedSocket(socket); }]);
  const result = endpointClosed(55465, 100).then(value => { settled = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  sockets[0].holdClose = false; sockets[0].destroy();
  assert.equal(await result, true); assert.equal(sockets.length, 1);
});

test('unobserved endpoint probe closure remains false even after ECONNREFUSED', async t => {
  const sockets = connectorTransport(t, [socket => { socket.holdClose = true; refusedSocket(socket); }]);
  assert.equal(await endpointClosed(55465, 35), false);
  assert.equal(sockets.length, 1); assert.equal(sockets[0].closed, false);
});

test('a continuously connectable Windows endpoint exhausts one bounded cleanup budget', async t => {
  const sockets = connectorTransport(t, Array.from({ length: 20 }, () => socket => socket.emit('connect')));
  const began = performance.now();
  assert.equal(await endpointClosed(55465, 140), false);
  assert.ok(performance.now() - began < 500);
  assert.ok(sockets.length > 1 && sockets.length < 10);
  assert.ok(sockets.every(socket => socket.closed && socket.writes.length === 0));
});

test('endpoint timeout and unrelated TCP errors never certify closed or retry', async t => {
  for (const code of ['EACCES', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', undefined]) {
    const sockets = connectorTransport(t, [socket => {
      if (code) socket.emit('error', Object.assign(new Error('PRIVATE_ENDPOINT_ERROR'), { code }));
    }]);
    assert.equal(await endpointClosed(55465, 35), false);
    assert.equal(sockets.length, 1); assert.equal(sockets[0].closed, true);
    t.mock.restoreAll();
  }
});

test('an overdue refusal after an event-loop stall cannot certify endpoint cleanup', async t => {
  const sockets = connectorTransport(t, [socket => {
    const until = performance.now() + 35; while (performance.now() < until) { /* overdue callback */ }
    refusedSocket(socket);
  }]);
  assert.equal(await endpointClosed(55465, 15), false);
  assert.equal(sockets.length, 1); assert.equal(sockets[0].closed, true);
});

test('endpoint refusal whose physical closure arrives after the deadline remains false', async t => {
  const sockets = connectorTransport(t, [socket => {
    socket.holdClose = true; refusedSocket(socket);
    setTimeout(() => { socket.holdClose = false; socket.destroy(); }, 80);
  }]);
  assert.equal(await endpointClosed(55465, 30), false);
  assert.equal(sockets.length, 1);
});

test('endpoint observation contains only fixed outcome literals and cleanup scalars', async t => {
  const sockets = connectorTransport(t, [socket => socket.emit('error', Object.assign(new Error('PRIVATE_ENDPOINT_ERROR'), { code: 'EACCES' }))]);
  const observation = await observeOwnedRedisEndpointClosure(55465, 100);
  assert.deepEqual(observation, { closed: false, attempts: 1, lastOutcome: 'TCP_ERROR', lastProbeClosed: true, deadlineExceeded: false });
  assert.equal(Object.isFrozen(observation), true); assert.equal(JSON.stringify(observation).includes('PRIVATE_ENDPOINT_ERROR'), false);
  assert.equal(sockets.length, 1);
});

test('endpoint refusal observation records an incomplete physical probe close', async t => {
  connectorTransport(t, [socket => { socket.holdClose = true; refusedSocket(socket); }]);
  const observation = await observeOwnedRedisEndpointClosure(55465, 30);
  assert.deepEqual(observation, { closed: false, attempts: 1, lastOutcome: 'TCP_REFUSED', lastProbeClosed: false, deadlineExceeded: true });
});

test('endpoint snapshot cannot publish success if its own deadline check is overdue', async t => {
  connectorTransport(t, [refusedSocket]);
  let reads = 0;
  t.mock.method(performance, 'now', () => reads++ >= 5 ? 100 : 0);
  const observation = await observeOwnedRedisEndpointClosure(55465, 50);
  assert.equal(observation.deadlineExceeded, true); assert.equal(observation.closed, false);
  assert.equal(observation.lastOutcome, 'TCP_REFUSED'); assert.equal(observation.lastProbeClosed, true);
});

test('endpoint observation cannot widen the existing 750ms cleanup budget', async t => {
  const sockets = connectorTransport(t, []);
  for (const budget of [0, 751, -1, Infinity, NaN, 1.5]) {
    await assert.rejects(observeOwnedRedisEndpointClosure(55465, budget), /ENDPOINT_BUDGET/);
  }
  assert.equal(sockets.length, 0);
});
