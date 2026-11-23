import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createOwnedS3Objects } from '../../server/core/__tests__/fixtures/owned-s3-objects.ts';
import { superviseCrashChild } from './object-restore-supervision.fixture.mjs';

function supervisionFixture(t) {
  const parent = fs.realpathSync.native(os.tmpdir());
  const prefix = 'pfa-r19-object-';
  const root = fs.mkdtempSync(path.join(parent, prefix));
  const pending = path.join(root, 'synthetic-capture.partial');
  const bytes = Buffer.from('owned incomplete synthetic capture');
  fs.writeFileSync(pending, bytes, { flag: 'wx' });
  const removeRoot = () => {
    if (fs.realpathSync.native(root) !== root || path.dirname(root) !== parent || !path.basename(root).startsWith(prefix)) {
      throw new Error('unsafe test cleanup');
    }
    fs.rmSync(root, { recursive: true, force: true });
  };
  // These cases spawn no process. The fallback removes only their owned data if an assertion fails.
  t.after(() => { if (fs.existsSync(root)) removeRoot(); });
  const cleanup = t.mock.fn(removeRoot);
  const child = Object.assign(new EventEmitter(), {
    pid: 123456, exitCode: null, signalCode: null,
    stdout: new EventEmitter(), stderr: new EventEmitter(), kill: t.mock.fn(() => true),
  });
  const diagnostics = [];
  const supervision = superviseCrashChild(child, { diagnostic: (message) => diagnostics.push(message) });
  const closed = t.mock.fn();
  supervision.closed.then(closed);
  return { child, supervision, diagnostics, closed, root, pending, bytes, cleanup };
}

test('supervision retains an errored child and owned data until actual close after the boundary witness', async (t) => {
  const f = supervisionFixture(t);
  const witness = { stage: 'post-link-pre-unlink', pid: f.child.pid };
  f.child.stdout.emit('data', Buffer.from(JSON.stringify(witness) + '\n'));
  assert.deepEqual(await f.supervision.boundary, witness);
  const failure = new Error('synthetic owned-child kill failure');
  const kill = t.mock.method(f.child, 'kill', () => {
    f.child.emit('error', failure);
    return false;
  });
  assert.equal(f.child.kill('SIGKILL'), false);
  await Promise.resolve();
  assert.deepEqual(kill.mock.calls.map(({ arguments: args }) => args), [['SIGKILL']]);
  assert.deepEqual(f.diagnostics, ['crash fixture child error: ' + failure.message]);
  assert.equal(f.child.exitCode, null);
  assert.equal(f.child.signalCode, null);
  assert.equal(f.closed.mock.callCount(), 0);
  assert.throws(() => f.supervision.cleanup(f.cleanup), /child close is unconfirmed/);
  assert.equal(f.cleanup.mock.callCount(), 0);
  assert.deepEqual(fs.readFileSync(f.pending), f.bytes);

  f.child.exitCode = 1;
  f.child.emit('close', 1, null);
  assert.deepEqual(await f.supervision.closed, { code: 1, signal: null, error: failure });
  assert.equal(f.closed.mock.callCount(), 1);
  f.supervision.cleanup(f.cleanup);
  assert.equal(f.cleanup.mock.callCount(), 1);
  assert.equal(fs.existsSync(f.root), false);
});

test('supervision reports spawn failure and waits for its following close before cleanup', async (t) => {
  const f = supervisionFixture(t);
  f.child.pid = undefined;
  const failure = new Error('synthetic child spawn failure');
  const destination = createOwnedS3Objects();
  const put = t.mock.method(destination, 'put');
  const continuation = f.supervision.boundary.then(() => destination.put(
    'v1/receipt/11111111-2222-4333-8444-555555555555', { bytes: f.bytes, mediaType: 'image/png' },
  ));
  const rejected = assert.rejects(continuation, (error) => error === failure);
  f.child.emit('error', failure);
  await rejected;
  assert.deepEqual(f.diagnostics, ['crash fixture child error: ' + failure.message]);
  assert.equal(f.closed.mock.callCount(), 0);
  assert.equal(f.child.kill.mock.callCount(), 0);
  assert.equal(put.mock.callCount(), 0);
  assert.equal(destination.size, 0);
  assert.throws(() => f.supervision.cleanup(f.cleanup), /child close is unconfirmed/);
  assert.equal(f.cleanup.mock.callCount(), 0);
  assert.deepEqual(fs.readFileSync(f.pending), f.bytes);

  f.child.exitCode = -1;
  f.child.emit('close', -1, null);
  assert.deepEqual(await f.supervision.closed, { code: -1, signal: null, error: failure });
  assert.equal(f.closed.mock.callCount(), 1);
  assert.equal(f.child.kill.mock.callCount(), 0);
  assert.deepEqual(f.supervision.output(), { stdout: '', stderr: '' });
  assert.equal(put.mock.callCount(), 0);
  assert.equal(destination.size, 0);
  f.supervision.cleanup(f.cleanup);
  assert.equal(f.cleanup.mock.callCount(), 1);
  assert.equal(fs.existsSync(f.root), false);
});

test('supervision observation deadline retains owned data while close is unconfirmed', async (t) => {
  const f = supervisionFixture(t);
  const witness = { stage: 'post-link-pre-unlink', pid: f.child.pid };
  f.child.stdout.emit('data', Buffer.from(JSON.stringify(witness) + '\n'));
  assert.deepEqual(await f.supervision.boundary, witness);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // Model the existing runner's 20-second cleanup deadline through the same cleanup gate.
  const deadline = t.mock.fn(() => f.supervision.cleanup(f.cleanup));
  setTimeout(deadline, 20000);
  t.mock.timers.tick(19999);
  assert.equal(deadline.mock.callCount(), 0);
  assert.equal(f.closed.mock.callCount(), 0);
  assert.throws(() => t.mock.timers.tick(1), /child close is unconfirmed/);
  await Promise.resolve();
  assert.equal(deadline.mock.callCount(), 1);
  assert.equal(f.closed.mock.callCount(), 0);
  assert.equal(f.cleanup.mock.callCount(), 0);
  assert.equal(f.child.exitCode, null);
  assert.equal(f.child.signalCode, null);
  assert.equal(f.child.kill.mock.callCount(), 0);
  assert.deepEqual(f.diagnostics, []);
  assert.deepEqual(fs.readFileSync(f.pending), f.bytes);

  f.child.exitCode = 0;
  f.child.emit('close', 0, null);
  assert.deepEqual(await f.supervision.closed, { code: 0, signal: null, error: undefined });
  assert.equal(f.closed.mock.callCount(), 1);
  f.supervision.cleanup(f.cleanup);
  assert.equal(f.cleanup.mock.callCount(), 1);
  assert.equal(fs.existsSync(f.root), false);
});
