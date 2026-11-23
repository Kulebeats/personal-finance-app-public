import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer, Socket } from 'node:net';
import { runInNewContext } from 'node:vm';
import Redis from 'ioredis';

// Explicitly invoked synthetic loopback component test. It uses the actual
// driver connector and constructor options, never production admission brands,
// WSL/native Redis, an application or a genuine credential/service capability.
function constructorOptions(port) {
  const source = fs.readFileSync(new URL('./production.mjs', import.meta.url), 'utf8');
  const matches = Array.from(source.matchAll(/new Redis\((\{[\s\S]*?\})\)/g));
  assert.equal(matches.length, 1);
  // Evaluate only the reviewed options literal with synthetic fixed inputs.
  // The factory and its protected callbacks are never evaluated or replaced.
  return runInNewContext(`(${matches[0][1]})`, { document: { endpoints: { redis: { host: '127.0.0.1', port } },
    redis: { aclUser: 'synthetic-component-user' }, timeouts: { connectMs: 3000, dependencyProbeMs: 2000 } },
  secret: 'public-synthetic-component-secret' }, { timeout: 100 });
}

function commandFrom(buffer) {
  const first = buffer.indexOf('\r\n'); if (first < 0) return null;
  const count = Number(buffer.toString('utf8', 1, first));
  assert.equal(buffer[0], 42); assert.ok(Number.isSafeInteger(count) && count > 0 && count < 16);
  const args = []; let offset = first + 2;
  for (let index = 0; index < count; index++) {
    const end = buffer.indexOf('\r\n', offset); if (end < 0) return null;
    const size = Number(buffer.toString('utf8', offset + 1, end));
    assert.equal(buffer[offset], 36); assert.ok(Number.isSafeInteger(size) && size >= 0 && size <= 1024);
    if (buffer.length < end + 2 + size + 2) return null;
    assert.equal(buffer.toString('utf8', end + 2 + size, end + 2 + size + 2), '\r\n');
    args.push(buffer.toString('utf8', end + 2, end + 2 + size)); offset = end + 2 + size + 2;
  }
  return { args, consumed: offset };
}

async function syntheticLoopback(override) {
  let client, port, protocolFailure = false, authAcknowledged = false, clientCloseObserved = false;
  const peers = new Set(), timers = new Set(), streams = new Set(), observations = [], accepted = [];
  const server = createServer(peer => {
    peers.add(peer); peer.on('close', () => peers.delete(peer)); peer.on('error', () => {});
    accepted.push({ address: peer.remoteAddress, port: peer.remotePort, localPort: peer.localPort });
    let buffer = Buffer.alloc(0), pendingPing = false;
    peer.on('data', data => {
      try {
        buffer = Buffer.concat([buffer, data]); assert.ok(buffer.length <= 8192);
        let command;
        while ((command = commandFrom(buffer))) {
          buffer = buffer.subarray(command.consumed);
          if (command.args[0].toUpperCase() === 'AUTH') {
            assert.deepEqual(command.args.slice(1), ['synthetic-component-user', 'public-synthetic-component-secret']);
            const timer = setTimeout(() => {
              timers.delete(timer); authAcknowledged = true;
              if (!peer.destroyed) { peer.write('+OK\r\n'); if (pendingPing) { pendingPing = false; peer.write('+PONG\r\n'); } }
            }, 100);
            timers.add(timer);
          } else if (command.args[0].toUpperCase() === 'PING') {
            if (authAcknowledged) peer.write('+PONG\r\n'); else pendingPing = true;
          } else throw new Error('SYNTHETIC_COMMAND_REFUSED');
        }
      } catch { protocolFailure = true; peer.destroy(); }
    });
  });
  const snapshot = phase => {
    const stream = client?.stream;
    observations.push({ phase, streams: streams.size, currentObserved: streams.has(stream),
      socket: stream instanceof Socket, destroyed: stream?.destroyed === true,
      addressPresent: typeof stream?.remoteAddress === 'string' && stream.remoteAddress.length > 0,
      portPresent: Number.isSafeInteger(stream?.remotePort), addressMatches: stream?.remoteAddress === '127.0.0.1',
      portMatches: stream?.remotePort === port, localPort: stream?.localPort, authAcknowledged });
  };
  const overall = setTimeout(() => { protocolFailure = true; client?.disconnect(); for (const peer of peers) peer.destroy(); server.close(); }, 4000);
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve); });
    port = server.address().port;
    client = new Redis({ ...constructorOptions(port), ...override });
    client.on('error', () => {});
    client.on('connect', () => { streams.add(client.stream); snapshot('DRIVER_CONNECT'); });
    await client.connect(); snapshot('CONNECT_RESOLVED');
    assert.equal(await client.ping(), 'PONG'); snapshot('AFTER_COMMAND');
    assert.equal(protocolFailure, false); assert.equal(authAcknowledged, true);
    assert.equal(accepted.length, 1); assert.equal(accepted[0].address, '127.0.0.1'); assert.equal(accepted[0].localPort, port);
    assert.equal(accepted[0].port, client.stream.localPort);
  } finally {
    const stream = client?.stream;
    const closed = !stream || stream.closed ? Promise.resolve() : new Promise((resolve, reject) => {
      const timer = setTimeout(() => { stream.destroy(); reject(new Error('SYNTHETIC_SOCKET_CLOSE_TIMEOUT')); }, 750);
      stream.once('close', () => { clearTimeout(timer); clientCloseObserved = true; resolve(); });
    });
    client?.disconnect(); for (const timer of timers) clearTimeout(timer); for (const peer of peers) peer.destroy();
    try { await Promise.all([closed, new Promise(resolve => server.close(resolve))]); }
    finally { clearTimeout(overall); }
  }
  assert.equal(clientCloseObserved, true); assert.equal(client.stream.destroyed, true); assert.equal(server.listening, false);
  return { observations, clientCloseObserved, clientSocketDestroyed: true, serverClosed: true };
}

test('actual production driver options retain strict physical peer metadata on pinned Windows ARM64', async context => {
  assert.equal(process.version, 'v24.22.0'); assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'arm64');
  const original = await syntheticLoopback({ noDelay: true });
  const previous = original.observations.find(value => value.phase === 'CONNECT_RESOLVED');
  assert.equal(previous.addressPresent, false); assert.equal(previous.portPresent, false);
  assert.equal(previous.addressMatches, false); assert.equal(previous.portMatches, false);
  const configured = await syntheticLoopback();
  context.diagnostic(JSON.stringify({ componentOnly: true, noProductionCapability: true, original, configured }));
  for (const value of configured.observations) {
    assert.equal(value.streams, 1); assert.equal(value.currentObserved, true); assert.equal(value.socket, true);
    assert.equal(value.destroyed, false); assert.equal(value.addressMatches, true); assert.equal(value.portMatches, true);
  }
});
