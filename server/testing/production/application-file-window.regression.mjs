import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import * as fileWindow from './application-file-window.mjs';
import { openApplicationFileWindow, finishApplicationFileWindow, closeApplicationFileWindow } from './application-file-window.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stable = value => Array.isArray(value) ? '['+value.map(stable).join(',')+']' : value && typeof value === 'object'
  ? '{'+Object.keys(value).sort().map(key => JSON.stringify(key)+':'+stable(value[key])).join(',')+'}' : JSON.stringify(value);
const json = value => stable(value)+'\n';
const file = name => ({ path: name, sizeBytes: fs.statSync(name).size, sha256: hash(fs.readFileSync(name)), kind: 'data' });
const metadataPath = fs.realpathSync.native(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
const metadataExecutable = file(metadataPath); delete metadataExecutable.kind;
const metadataStat = fs.lstatSync(metadataPath, { bigint: true });
Object.assign(metadataExecutable, { dev: String(metadataStat.dev), ino: String(metadataStat.ino) });
const systemRoot = fs.realpathSync.native(process.env.SystemRoot);
const base = fs.realpathSync.native(path.resolve('.local/r20-file-observation'));
function fixture() {
  const root = fs.mkdtempSync(path.join(base, 'fixture-'));
  const selected = path.join(root, 'selected.mjs');
  fs.writeFileSync(selected, "throw new Error('SELECTED_MODULE_MUST_NOT_RUN');\n");
  const request = { kind: 'application-file-window', version: 1, approvedRoots: [root], files: [file(selected)],
    directories: [{ path: root, entries: [{ name: 'selected.mjs', kind: 'file' }] }],
    absent: [{ path: path.join(root, 'missing.json'), parent: root }], systemRoot, metadataExecutable: { ...metadataExecutable }, deadlineMs: 60000 };
  return { root, selected, request };
}
const open = request => { const text = json(request); return openApplicationFileWindow(text, hash(text)); };
const remove = root => { assert.ok(path.resolve(root).startsWith(base+path.sep)); fs.rmSync(root, { recursive: true, force: true }); };

test('measures pinned bytes and listings without evaluating selected code', async () => {
  const f = fixture(); let record;
  try {
    record = await open(f.request);
    assert.equal(Object.isFrozen(record), true);
    await assert.rejects(finishApplicationFileWindow({ ...record }), /APPLICATION_FILE_WINDOW_REFUSED/);
    const result = await finishApplicationFileWindow(record);
    assert.equal(result.filesChecked, 1);
    assert.equal(result.certifications.custodyHeld, false);
    assert.equal(result.certifications.executionAuthorized, false);
    await assert.rejects(finishApplicationFileWindow(record), /APPLICATION_FILE_WINDOW_REFUSED/);
  } finally { if (record) closeApplicationFileWindow(record); remove(f.root); }
});

test('refuses pin drift before opening a measurement window', async () => {
  const f = fixture();
  try {
    const text = json(f.request);
    await assert.rejects(openApplicationFileWindow(text, hash('changed')), /APPLICATION_FILE_WINDOW_REFUSED/);
    f.request.files[0].sha256 = hash('wrong');
    await assert.rejects(open(f.request), /APPLICATION_FILE_WINDOW_REFUSED/);
  } finally { remove(f.root); }
});

test('detects changed file bytes and closes handles on refusal', async () => {
  const f = fixture(); let record;
  const originalClose = fs.closeSync; let closes = 0;
  try {
    record = await open(f.request);
    fs.writeFileSync(f.selected, 'changed');
    fs.closeSync = function(fd) { closes++; return originalClose.call(fs, fd); };
    await assert.rejects(finishApplicationFileWindow(record), /APPLICATION_FILE_WINDOW_REFUSED/);
    assert.equal(closes, 2); // selected file plus separately pinned OS metadata tool.
  } finally { fs.closeSync = originalClose; if (record) closeApplicationFileWindow(record); remove(f.root); }
});

test('detects identical-byte file replacement by physical identity', async () => {
  const f = fixture(); let record;
  try {
    record = await open(f.request);
    const original = fs.readFileSync(f.selected);
    fs.renameSync(f.selected, path.join(f.root, 'old.mjs'));
    fs.writeFileSync(f.selected, original);
    await assert.rejects(finishApplicationFileWindow(record), /APPLICATION_FILE_WINDOW_REFUSED/);
  } finally { if (record) closeApplicationFileWindow(record); remove(f.root); }
});

test('detects new shadowing lookup entries and changed absences', async () => {
  const f = fixture(); let record;
  try {
    record = await open(f.request);
    fs.writeFileSync(path.join(f.root, 'missing.json'), '{}');
    await assert.rejects(finishApplicationFileWindow(record), /APPLICATION_FILE_WINDOW_REFUSED/);
  } finally { if (record) closeApplicationFileWindow(record); remove(f.root); }
});

test('rejects hardlinked selected files while retaining the fixed OS-tool exception', async () => {
  const f = fixture();
  try {
    fs.linkSync(f.selected, path.join(f.root, 'alias.mjs'));
    f.request.directories[0].entries.push({ name: 'alias.mjs', kind: 'file' });
    await assert.rejects(open(f.request), /APPLICATION_FILE_WINDOW_REFUSED/);
  } finally { remove(f.root); }
});

test('cancellation is idempotent and prevents later completion', async () => {
  const f = fixture(); let record;
  try {
    record = await open(f.request);
    closeApplicationFileWindow(record); closeApplicationFileWindow(record);
    await assert.rejects(finishApplicationFileWindow(record), /APPLICATION_FILE_WINDOW_REFUSED/);
  } finally { if (record) closeApplicationFileWindow(record); remove(f.root); }
});

test('deadline expiry refuses and cleans up an incomplete opening', async () => {
  const f = fixture(); const originalClose = fs.closeSync; let closes = 0;
  try {
    f.request.deadlineMs = 1;
    fs.closeSync = function(fd) { closes++; return originalClose.call(fs, fd); };
    await assert.rejects(open(f.request), /APPLICATION_FILE_WINDOW_REFUSED/);
    assert.ok(closes <= 2);
  } finally { fs.closeSync = originalClose; remove(f.root); }
});

test('a successful opening automatically closes descriptors when its deadline expires', async () => {
  const f = fixture(); const originalClose = fs.closeSync; let record, closes = 0;
  try {
    f.request.deadlineMs = 5000;
    record = await open(f.request);
    fs.closeSync = function(fd) { closes++; return originalClose.call(fs, fd); };
    await new Promise(resolve => setTimeout(resolve, 5100));
    assert.equal(closes, 2);
    await assert.rejects(finishApplicationFileWindow(record), /APPLICATION_FILE_WINDOW_REFUSED/);
  } finally { fs.closeSync = originalClose; if (record) closeApplicationFileWindow(record); remove(f.root); }
});

test('a cleanup failure refuses success and still attempts every retained close', async () => {
  const f = fixture(); const originalClose = fs.closeSync; let record, closes = 0;
  try {
    record = await open(f.request);
    fs.closeSync = function(fd) { closes++; originalClose.call(fs, fd); if (closes === 1) throw new Error('injected-close-failure'); };
    await assert.rejects(finishApplicationFileWindow(record), /APPLICATION_FILE_WINDOW_REFUSED/);
    assert.equal(closes, 2);
    assert.throws(() => closeApplicationFileWindow(record), /APPLICATION_FILE_WINDOW_REFUSED/);
  } finally { fs.closeSync = originalClose; remove(f.root); }
});

test('opening deadline releases retained handles while metadata collection is pending', async () => {
  const f = fixture(); const originalClose = fs.closeSync; let closes = 0, result;
  try {
    f.request.deadlineMs = 50;
    fs.closeSync = function(fd) { closes++; return originalClose.call(fs, fd); };
    const opening = open(f.request).then(record => ({ record }), error => ({ error }));
    await new Promise(resolve => setTimeout(resolve, 200));
    const earlyCloses = closes;
    result = await opening;
    assert.equal(earlyCloses, 2);
    assert.match(result.error?.message ?? '', /APPLICATION_FILE_WINDOW_REFUSED/);
  } finally { fs.closeSync = originalClose; if (result?.record) closeApplicationFileWindow(result.record); remove(f.root); }
});

test('final descriptor reads cannot hide replacement of a selected parent directory', async () => {
  const f = fixture(); const oldRoot = f.root+'-old'; const originalRead = fs.readSync;
  const bytes = fs.readFileSync(f.selected); const ino = fs.statSync(f.selected, { bigint: true }).ino;
  let record, reads = 0;
  try {
    record = await open(f.request);
    fs.readSync = function(fd, ...args) {
      const selected = fs.fstatSync(fd, { bigint: true }).ino === ino;
      const result = originalRead.call(fs, fd, ...args);
      if (selected && ++reads === 2) {
        fs.renameSync(f.root, oldRoot); fs.mkdirSync(f.root); fs.writeFileSync(f.selected, bytes);
      }
      return result;
    };
    await assert.rejects(finishApplicationFileWindow(record), /APPLICATION_FILE_WINDOW_REFUSED/);
    assert.equal(reads, 2);
  } finally { fs.readSync = originalRead; if (record) closeApplicationFileWindow(record); remove(f.root); if (fs.existsSync(oldRoot)) remove(oldRoot); }
});

test('explicit close cancels metadata work during completion and consumes the window', async () => {
  const f = fixture(); let record;
  try {
    record = await open(f.request);
    const finishing = finishApplicationFileWindow(record);
    closeApplicationFileWindow(record);
    await assert.rejects(finishing, /APPLICATION_FILE_WINDOW_REFUSED/);
    await assert.rejects(finishApplicationFileWindow(record), /APPLICATION_FILE_WINDOW_REFUSED/);
  } finally { if (record) closeApplicationFileWindow(record); remove(f.root); }
});

test('refuses substituted metadata executable identity despite matching bytes', async () => {
  const f = fixture();
  try {
    f.request.metadataExecutable.ino = '1';
    await assert.rejects(open(f.request), /APPLICATION_FILE_WINDOW_REFUSED/);
  } finally { remove(f.root); }
});

test('retained window exposes pinned identities and supports checks without consuming it', async () => {
  const f = fixture(); let record;
  try {
    record = await open(f.request);
    assert.equal(typeof fileWindow.inspectApplicationFileWindow, 'function', 'a genuine retained window must expose immutable identities');
    const first = fileWindow.inspectApplicationFileWindow(record);
    const physical = fs.statSync(f.selected, { bigint: true });
    assert.deepEqual(first.fileIdentities.find(row => row.path === f.selected), { path: f.selected, dev: String(physical.dev), ino: String(physical.ino) });
    assert.equal(first.requestSha256, record.requestSha256);
    assert.ok(first.remainingMs > 0 && first.remainingMs <= 60000);
    assert.equal(Object.isFrozen(first.fileIdentities), true);
    assert.equal('descriptors' in first, false);
    assert.throws(() => fileWindow.inspectApplicationFileWindow({ ...record }), /APPLICATION_FILE_WINDOW_REFUSED/);
    await fileWindow.checkApplicationFileWindow(record);
    assert.deepEqual(fileWindow.inspectApplicationFileWindow(record).fileIdentities, first.fileIdentities);
    const final = await finishApplicationFileWindow(record);
    assert.deepEqual(final.fileIdentities, first.fileIdentities);
    assert.throws(() => fileWindow.inspectApplicationFileWindow(record), /APPLICATION_FILE_WINDOW_REFUSED/);
  } finally { if (record) closeApplicationFileWindow(record); remove(f.root); }
});

test('nonconsuming check refuses drift, closes retained handles and never permits later inspection', async () => {
  const f = fixture(); let record;
  try {
    record = await open(f.request);
    assert.equal(typeof fileWindow.checkApplicationFileWindow, 'function');
    fs.writeFileSync(f.selected, 'replaced');
    await assert.rejects(fileWindow.checkApplicationFileWindow(record), /APPLICATION_FILE_WINDOW_REFUSED/);
    assert.throws(() => fileWindow.inspectApplicationFileWindow(record), /APPLICATION_FILE_WINDOW_REFUSED/);
    await assert.rejects(finishApplicationFileWindow(record), /APPLICATION_FILE_WINDOW_REFUSED/);
  } finally { if (record) closeApplicationFileWindow(record); remove(f.root); }
});
