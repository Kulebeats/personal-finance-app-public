import nativeTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { attestRecoveryFiles } from './filesystem.mjs';
import { ownedFixture } from './filesystem.fixture.mjs';
const test = (name, fn) => nativeTest(name, { skip: process.platform !== 'win32' }, fn);

test('reads exact independently pinned files through stable descriptors without execution certification', async (t) => {
  const f = ownedFixture(t);
  const open = fs.openSync; const descriptors = [];
  t.mock.method(fs, 'openSync', function (...args) {
    const fd = Reflect.apply(open, fs, args);
    if (typeof args[0] === 'string' && args[0].startsWith(f.root) && args[1] === fs.constants.O_RDONLY) descriptors.push(fd);
    return fd;
  });
  const result = await attestRecoveryFiles(f.restore, { toolSizes: f.toolSizes, systemRoot: f.systemRoot });
  assert.equal(result.files.length, 6);
  assert.equal(result.files.find((file) => file.path === f.archive).sha256, f.data.bundle.database.sha256);
  assert.deepEqual(result.certifications, { descriptorReadback: true, windowsReparseAttributes: true, laterNativeReopenSafe: false,
    provenanceAuthenticated: false, ownershipOrAcl: false, liveDatabaseIdentity: false, executionAuthorized: false });
  assert.equal(Object.isFrozen(result.files[0]), true);
  assert.equal(descriptors.length, 6);
  for (const fd of descriptors) assert.throws(() => fs.fstatSync(fd), { code: 'EBADF' });
});

test('producer attestation reads only its two inert tool fixtures, never credentials or outputs', async (t) => {
  const f = ownedFixture(t);
  fs.rmSync(f.data.intent.artifactRoot, { recursive: true });
  const result = await attestRecoveryFiles(f.producer, { toolSizes: f.toolSizes, systemRoot: f.systemRoot });
  assert.equal(result.files.length, 2);
});

test('wrong content, size, missing file and hardlink aliases refuse', async (t) => {
  const f = ownedFixture(t); const options = { toolSizes: f.toolSizes, systemRoot: f.systemRoot };
  const original = fs.readFileSync(f.archive);
  fs.writeFileSync(f.archive, Buffer.alloc(original.length, 1));
  await assert.rejects(attestRecoveryFiles(f.restore, options), /RECOVERY_REFUSED/);
  fs.writeFileSync(f.archive, original);
  await assert.rejects(attestRecoveryFiles(f.restore, { ...options, toolSizes: { ...f.toolSizes, dump: 1 } }), /RECOVERY_REFUSED/);
  fs.linkSync(f.archive, path.join(f.root, 'hardlink'));
  await assert.rejects(attestRecoveryFiles(f.restore, options), /RECOVERY_REFUSED/);
  fs.unlinkSync(path.join(f.root, 'hardlink')); fs.unlinkSync(f.archive);
  await assert.rejects(attestRecoveryFiles(f.restore, options), /RECOVERY_REFUSED/);
});

test('an actual ancestor junction into a different owned directory refuses', async (t) => {
  const f = ownedFixture(t); const objects = path.join(f.data.intent.artifactRoot, 'objects');
  const moved = path.join(f.root, 'moved'); fs.renameSync(objects, moved); fs.symlinkSync(moved, objects, 'junction');
  await assert.rejects(attestRecoveryFiles(f.restore, { toolSizes: f.toolSizes, systemRoot: f.systemRoot }), /RECOVERY_REFUSED/);
});

test('an actual file symlink refuses before descriptor hashing', async (t) => {
  const f = ownedFixture(t); const target = `${f.archive}.target`; fs.renameSync(f.archive, target);
  try { fs.symlinkSync(target, f.archive, 'file'); }
  catch (error) { if (process.platform === 'win32' && error.code === 'EPERM') return t.skip('Windows denied synthetic file-symlink creation; actual junction and ReparsePoint controls run separately'); throw error; }
  await assert.rejects(attestRecoveryFiles(f.restore, { toolSizes: f.toolSizes, systemRoot: f.systemRoot }), /RECOVERY_REFUSED/);
});

test('mutation during descriptor readback fails even if file size stays unchanged', async (t) => {
  const f = ownedFixture(t); const original = fs.readSync; let mutated = false;
  t.mock.method(fs, 'readSync', function (...args) {
    if (!mutated) { mutated = true; const file = f.data.intent.tools.dump.path; fs.writeFileSync(file, Buffer.alloc(fs.statSync(file).size, 2)); }
    return Reflect.apply(original, fs, args);
  });
  await assert.rejects(attestRecoveryFiles(f.restore, { toolSizes: f.toolSizes, systemRoot: f.systemRoot }), /RECOVERY_REFUSED/);
  assert.equal(mutated, true);
});

test('same-byte path replacement after open fails the path/descriptor identity check', async (t) => {
  const f = ownedFixture(t); const original = fs.openSync; let replaced = false;
  t.mock.method(fs, 'openSync', function (...args) {
    const fd = Reflect.apply(original, fs, args);
    if (args[0] === f.archive && !replaced) {
      replaced = true; const bytes = fs.readFileSync(f.archive); fs.renameSync(f.archive, `${f.archive}.old`); fs.writeFileSync(f.archive, bytes);
    }
    return fd;
  });
  await assert.rejects(attestRecoveryFiles(f.restore, { toolSizes: f.toolSizes, systemRoot: f.systemRoot }), /RECOVERY_REFUSED/);
  assert.equal(replaced, true);
});

test('forged records, extra options, alternate shell paths and absent sizes refuse', async (t) => {
  const f = ownedFixture(t);
  await assert.rejects(attestRecoveryFiles(structuredClone(f.restore), { toolSizes: f.toolSizes, systemRoot: f.systemRoot }), /RECOVERY_REFUSED/);
  for (const options of [{ toolSizes: f.toolSizes }, { toolSizes: f.toolSizes, systemRoot: f.systemRoot, args: ['--clean'] },
    { toolSizes: {}, systemRoot: f.systemRoot }, { toolSizes: f.toolSizes, systemRoot: f.root }]) {
    await assert.rejects(attestRecoveryFiles(f.restore, options), /RECOVERY_REFUSED/);
  }
});
