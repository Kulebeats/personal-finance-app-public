import test from 'node:test';
import assert from 'node:assert/strict';

const api = await import('./runtime-installed-data.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./runtime-installed-data.mjs', import.meta.url).href) return {};
  throw error;
});
const root = 'C:\\Synthetic\\stage';
const prefix = 'node_modules/fast-geoip/data/';
function fixture() {
  assert.equal(typeof api.createInstalledDataAccess, 'function');
  const files = new Map([['index.json', Buffer.from('[0]')], ['i0.json', Buffer.from('[0]')], ['0.json', Buffer.from('[[0,0]]')],
    ['locations.json', Buffer.from('[' + ' '.repeat(111) + ']')]].map(([name, bytes]) => [prefix + name, bytes]));
  let reads = 0; let heldClosed = 0; let alive = true;
  const boundary = api.createInstalledDataAccess(root, Array.from(files.keys()), name => { reads++; assert.equal(alive, true); return Buffer.from(files.get(name)); });
  return { files, boundary, fs: boundary.fs, reads: () => reads, heldClosed: () => heldClosed, end: () => { alive = false; boundary.close(); } };
}
const callback = invoke => new Promise((resolve, reject) => invoke((error, ...args) => error ? reject(error) : resolve(args)));
test('callback data reads deliver copies and observe the real finite namespace', async () => {
  const f = fixture(); const name = `${root}\\node_modules\\fast-geoip\\data\\index.json`;
  const [bytes] = await callback(cb => f.fs.readFile(name, cb)); assert.equal(bytes.toString(), '[0]'); bytes[0] = 0;
  const [again] = await callback(cb => f.fs.readFile(name, cb)); assert.equal(again.toString(), '[0]');
  assert.equal(f.reads(), 2); assert.deepEqual(f.boundary.events(), { wholeReads: 2, rangeReads: 0, opened: 0, closed: 0, active: 0 });
  f.end();
});
test('real GeoIP open/read/close shape uses independent virtual handles', async () => {
  const f = fixture(); const name = `${root}\\node_modules\\fast-geoip\\data\\locations.json`;
  const [one] = await callback(cb => f.fs.open(name, 'r', cb)); const [two] = await callback(cb => f.fs.open(name, 'r', cb));
  assert.notEqual(one, two); const bytes = Buffer.alloc(111);
  const [count, result] = await callback(cb => f.fs.read(one, bytes, 0, 111, 1, cb));
  assert.equal(count, 111); assert.equal(result, bytes);
  await callback(cb => f.fs.close(one, cb)); assert.equal(f.heldClosed(), 0);
  await callback(cb => f.fs.read(two, bytes, 0, 111, 1, cb)); await callback(cb => f.fs.close(two, cb));
  assert.deepEqual(f.boundary.events(), { wholeReads: 0, rangeReads: 2, opened: 2, closed: 2, active: 0 }); f.end();
});
for (const name of ['INDEX.json', '../data/index.json', 'missing.json', 'extra.js']) test(`unknown or aliased data ${name} poisons acceptance`, async () => {
  const f = fixture(); await assert.rejects(callback(cb => f.fs.readFile(`${root}\\node_modules\\fast-geoip\\data\\${name}`, cb)), /INSTALLED_LOADING_REFUSED:DATA_PATH/);
  assert.throws(() => f.boundary.assertHealthy(), /INSTALLED_LOADING_REFUSED:TAINTED/); assert.equal(f.boundary.violation(), 'DATA_PATH'); assert.equal(f.reads(), 0); f.end();
});
test('range length, offset, buffer and descriptor violations are bounded and taint', async () => {
  for (const mutate of [args => { args[3] = 112; }, args => { args[4] = 0; }, args => { args[0] = 12; }, args => { args[1] = Buffer.alloc(1); }]) {
    const f = fixture(); const [fd] = await callback(cb => f.fs.open(`${root}\\node_modules\\fast-geoip\\data\\locations.json`, 'r', cb));
    const args = [fd, Buffer.alloc(111), 0, 111, 1]; mutate(args);
    await assert.rejects(callback(cb => f.fs.read(...args, cb)), /INSTALLED_LOADING_REFUSED:DATA_RANGE/);
    assert.throws(() => f.boundary.assertHealthy(), /TAINTED/); f.end();
  }
});
test('closing or reusing virtual handles cannot close or expose retained descriptors', async () => {
  const f = fixture(); const [fd] = await callback(cb => f.fs.open(`${root}\\node_modules\\fast-geoip\\data\\locations.json`, 'r', cb));
  await callback(cb => f.fs.close(fd, cb)); await assert.rejects(callback(cb => f.fs.close(fd, cb)), /DATA_HANDLE/);
  assert.equal(f.heldClosed(), 0); assert.throws(() => f.boundary.assertHealthy(), /TAINTED/); f.end();
});
test('write open, unsupported data APIs and closed lifetime refuse', async () => {
  const f = fixture(); await assert.rejects(callback(cb => f.fs.open(`${root}\\node_modules\\fast-geoip\\data\\locations.json`, 'w', cb)), /DATA_OPEN/);
  assert.throws(() => f.fs.readFileSync('ignored'), /DATA_API/); f.end();
  await assert.rejects(callback(cb => f.fs.readFile(`${root}\\node_modules\\fast-geoip\\data\\index.json`, cb)), /CLOSED/);
});
