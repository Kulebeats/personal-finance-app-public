import test from 'node:test';
import assert from 'node:assert/strict';
import { runFile, bridge, bounded, inspect } from './pg-tls-native.mjs';
import { PLAN, childEnvironment, environmentForStage, PREALLOCATION_TEMP } from './pg-tls-contract.mjs';

test('fake native dispatch has argv/env separation, hidden window, no shell and bounded output/time', async () => {
  let captured, input;
  const env = childEnvironment('C:\\Windows', 'C:\\owned\\temp', 'C:\\owned\\config');
  const executor = (exe, args, options, callback) => {
    captured = { exe, args, options }; queueMicrotask(() => callback(null, 'synthetic output'));
    return { stdin: { on() {}, end(value) { input = value; } } };
  };
  assert.equal(await runFile(PLAN.tools.initdb.path, ['--version'], env, { executor, input: 'synthetic JSON' }), 'synthetic output');
  assert.deepEqual(captured.args, ['--version']); assert.equal(captured.options.env, env);
  assert.equal(captured.options.shell, false); assert.equal(captured.options.windowsHide, true);
  assert.equal(captured.options.timeout, 10000); assert.equal(captured.options.maxBuffer, 128 * 1024);
  assert.equal(input, 'synthetic JSON');
  assert.throws(() => runFile('synthetic', [], undefined, { executor }), /COMPONENT_REFUSED/);
  await assert.rejects(runFile('synthetic', [], env, { executor(exe, args, options, callback) {
    queueMicrotask(() => callback(new Error('RAW_SECRET_SQL_SENTINEL'), 'RAW_SECRET_SQL_SENTINEL'));
    return { stdin: { on() {}, end() {} } };
  } }), (error) => error.message === 'PG_TLS_COMPONENT_REFUSED');
});
test('fixed Windows bridge passes only JSON stdin and restricts only allocated root', async () => {
  const calls = [];
  const transport = async (...args) => { calls.push(args); return '[]'; };
  await bridge('port', {}, undefined, transport);
  assert.equal(calls[0][0], 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(calls[0][1].slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']);
  assert.deepEqual(JSON.parse(calls[0][3].input), { action: 'port' });
  assert.equal(calls[0][3].timeout, 5000);
  assert.ok(calls[0][1][4].includes(PLAN.root));
  assert.match(calls[0][1][4], /SetAccessRuleProtection\(\$true, \$false\)/);
  assert.match(calls[0][1][4], /Get-Process -Id \$v.pid/);
  await bridge('identity', {}, 123, transport);
  assert.deepEqual(JSON.parse(calls[1][3].input), { action: 'identity', pid: 123 });
  for (const [action, pid] of [['identity', '123;Write-Host x'], ['identity', 0], ['other', 123]]) {
    await assert.rejects(bridge(action, {}, pid, transport), /COMPONENT_REFUSED/);
  }
  assert.equal(calls.length, 2);
  await assert.rejects(bridge('port', {}, undefined, async () => 'not JSON'), /COMPONENT_REFUSED/);
});
test('bounded waits refuse a stalled owned operation and retain no long timer after settlement', async () => {
  assert.equal(await bounded(Promise.resolve('done'), 20), 'done');
  await assert.rejects(bounded(new Promise(() => {}), 10), /COMPONENT_REFUSED/);
});
test('importing actual component entry is inert and exposes no execution function', async () => {
  const before = process.env; // Compare object identity without reading credential values.
  const module = await import('./native-pg-tls.mjs');
  assert.deepEqual(Object.keys(module), []); assert.equal(process.env, before);
});

test('full Node ancestry is inspected before first metadata child; explicit preallocation env has no future paths', async () => {
  const visited = [];
  const filesystem = { lstatSync(file) { visited.push(file); return { isDirectory: () => true, isFile: () => false,
    isSymbolicLink: () => false, dev: 1n, ino: BigInt(file.length), birthtimeNs: 2n }; }, realpathSync: { native: (file) => file } };
  const env = environmentForStage('preallocation'); let dispatched = 0;
  const metadata = async (action, actualEnv, paths) => {
    dispatched++; assert.equal(action, 'metadata'); assert.equal(actualEnv, env);
    assert.equal(env.TEMP, PREALLOCATION_TEMP); assert.doesNotMatch(JSON.stringify(env), /capital-r19-pg-tls/);
    assert.equal(paths[0], 'C:\\'); assert.equal(paths.at(-1), PREALLOCATION_TEMP);
    for (const file of paths) assert.ok(visited.includes(file), 'all ancestors observed before child dispatch');
    return paths.map((file) => ({ path: file, attributes: 16, directory: true }));
  };
  await inspect([PREALLOCATION_TEMP], env, filesystem, metadata); assert.equal(dispatched, 1);
  await assert.rejects(inspect([PREALLOCATION_TEMP], env, { ...filesystem,
    lstatSync: () => ({ isSymbolicLink: () => true }) }, metadata), /COMPONENT_REFUSED/);
  assert.equal(dispatched, 1, 'Node ancestry refusal precedes child');
  await assert.rejects(inspect([PREALLOCATION_TEMP], env, filesystem, async (action, actualEnv, paths) =>
    paths.map((file) => ({ path: file, attributes: 0x400, directory: true }))), /COMPONENT_REFUSED/);
});
