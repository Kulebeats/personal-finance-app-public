import nativeTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { readWindowsMetadata } from './windows-metadata.mjs';
import { ownedFixture } from './filesystem.fixture.mjs';
const test = (name, fn) => nativeTest(name, { skip: process.platform !== 'win32' }, fn);

test('actual metadata bridge uses fixed hidden PowerShell and treats supplied paths literally', async (t) => {
  const f = ownedFixture(t); const literal = path.join(f.root, 'literal-$([int]1)-[a].txt');
  fs.writeFileSync(literal, 'synthetic-only');
  const original = childProcess.execFile; const calls = [];
  t.mock.method(childProcess, 'execFile', function (...args) { calls.push(args); return Reflect.apply(original, childProcess, args); });
  const rows = await readWindowsMetadata([f.root, literal], f.systemRoot);
  assert.equal(rows[1].path, literal); assert.equal(rows[1].size, '14');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], path.join(f.systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
  assert.deepEqual(calls[0][1].slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']);
  assert.equal(calls[0][1][4].includes(f.root), false);
  assert.equal(calls[0][1][4].includes('Get-Item -LiteralPath'), true);
  assert.deepEqual(calls[0][2].env, { SystemRoot: f.systemRoot });
  assert.equal(calls[0][2].windowsHide, true); assert.equal(calls[0][2].shell, false);
});

test('actual bridge refuses a junction by ReparsePoint attribute rather than relying on Node link classification', async (t) => {
  const f = ownedFixture(t); const target = path.join(f.root, 'target'); const junction = path.join(f.root, 'junction');
  fs.mkdirSync(target); fs.symlinkSync(target, junction, 'junction');
  await assert.rejects(readWindowsMetadata([junction], f.systemRoot), /RECOVERY_METADATA_REFUSED/);
});

test('metadata boundary refuses malformed output including any ReparsePoint bit', async (t) => {
  const f = ownedFixture(t); const original = childProcess.execFile;
  for (const attributes of [0x400, 0x420, 0x410]) {
    t.mock.method(childProcess, 'execFile', function (executable, args, options, callback) {
      return Reflect.apply(original, childProcess, [executable, args, options, (error, stdout, stderr) => {
        if (error) return callback(error, stdout, stderr);
        const rows = JSON.parse(stdout); rows[0].attributes = attributes;
        callback(null, JSON.stringify(rows), stderr);
      }]);
    });
    await assert.rejects(readWindowsMetadata([f.root], f.systemRoot), /RECOVERY_REFUSED/);
    t.mock.restoreAll();
  }
});

test('metadata helper refuses drive-relative/POSIX/ADS input before starting the fixed child', async (t) => {
  const f = ownedFixture(t); const calls = [];
  t.mock.method(childProcess, 'execFile', (...args) => { calls.push(args); throw new Error('unexpected child'); });
  for (const file of ['C:relative', '/relative-drive', `${f.root}:stream`]) await assert.rejects(readWindowsMetadata([file], f.systemRoot), /RECOVERY_REFUSED/);
  assert.equal(calls.length, 0);
});
