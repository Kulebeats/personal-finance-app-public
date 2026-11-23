import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAN, target, childEnvironment, configuration, assertIdentity, probe, cleanup, nativeArgs, rehearse, dispatchOwnedStop, runtimePreflight, environmentForStage } from './pg-tls-contract.mjs';
import os from 'node:os';
// The Windows profile the custody fixtures live under, from the process token (os.userInfo),
// not USERPROFILE, which the fixed children override; a neutral placeholder off Windows.
const windowsProfile = process.platform === 'win32' ? os.userInfo().homedir : 'C:\\Users\\example';

const runtime = () => ({ platform: 'win32', version: 'v24.22.0', arch: 'arm64',
  executable: `${windowsProfile}\\AppData\\Local\\capital-r00-runtime\\node-v24.22.0-win-arm64\\node.exe`, args: [],
  systemRoot: 'C:\\Windows', hasNodeOptions: false, hasNodePath: false });
test('allocation is the independently amended physical path with unchanged run/database/port', () => {
  assert.equal(PLAN.root, `${windowsProfile}\\AppData\\Local\\Packages\\OpenAI.Codex_2p2nqsd0c76g0\\LocalCache\\Local\\capital-r19-pg-tls\\r19pgtls20261015a1`);
  assert.equal(PLAN.root.length, 119);
  assert.equal(PLAN.target.runId, 'r19pgtls20261015a1'); assert.equal(PLAN.target.port, 55461);
  assert.equal(PLAN.target.database, 'pfa_completion_r19_tls_r19pgtls20261015a1_test');
});
test('runtime preflight accepts only case variants of exact Windows root', () => {
  for (const systemRoot of ['C:\\Windows', 'C:\\WINDOWS', 'c:\\windows', 'c:\\wInDoWs']) {
    assert.doesNotThrow(() => runtimePreflight({ ...runtime(), systemRoot }));
  }
  for (const systemRoot of ['D:\\Windows', 'C:\\Windows\\', 'C:/Windows', 'C:\\Windows-old', 'C:\\Windows\\..\\Windows',
    '\\\\?\\C:\\Windows', ' C:\\Windows', 'C:\\Windows\n', 'C:\\Windows\0', undefined]) {
    assert.throws(() => runtimePreflight({ ...runtime(), systemRoot }), /COMPONENT_REFUSED/);
  }
});
test('runtime preflight preserves exact Node, arguments and ambient preload refusals', () => {
  for (const changes of [{ platform: 'linux' }, { version: 'v24.21.0' }, { arch: 'x64' }, { executable: 'C:\\other\\node.exe' },
    { args: ['--import=other'] }, { args: undefined }, { hasNodeOptions: true }, { hasNodePath: true }, { unexpected: true }]) {
    assert.throws(() => runtimePreflight({ ...runtime(), ...changes }), /COMPONENT_REFUSED/);
  }
});

test('actual production resolver loads with selected Node type stripping and retains verified configured host', async () => {
  const { resolveDatabaseConnection } = await import('../../server/dbSsl.ts');
  const connection = resolveDatabaseConnection({ NODE_ENV: 'production', DATABASE_URL:
    `postgresql://${PLAN.probeRole}:synthetic@127.0.0.1:55461/${PLAN.target.database}` });
  assert.equal(connection.host, PLAN.target.host); assert.equal(connection.port, PLAN.target.port);
  assert.equal(connection.ssl.rejectUnauthorized, true); assert.equal(typeof connection.ssl.checkServerIdentity, 'function');
  assert.equal(connection.connectionString, undefined);
});

test('only the allocated numeric endpoint/database/run may reach component transport', () => {
  assert.equal(target({ ...PLAN.target }), PLAN.target);
  for (const change of [{ host: 'localhost' }, { port: 55432 }, { port: 5432 }, { port: 0 },
    { database: 'finance_app' }, { runId: 'different' }, { url: 'postgres://x@127.0.0.1/x' },
    { host: '127.0.0.1.example' }, { password: 'secret' }]) {
    assert.throws(() => target({ ...PLAN.target, ...change }), /COMPONENT_REFUSED/);
  }
  assert.ok(Object.isFrozen(PLAN) && Object.isFrozen(PLAN.target) && Object.isFrozen(PLAN.tools));
});

test('child environment has no ambient routing, preloads, provider secrets or profiles', () => {
  const env = childEnvironment('C:\\Windows', 'C:\\owned\\temp', 'C:\\owned\\openssl.cnf');
  assert.deepEqual(Object.keys(env).sort(), ['LANG', 'LC_ALL', 'OPENSSL_CONF', 'SystemRoot', 'TEMP', 'TMP', 'TZ'].sort());
  assert.equal(env.OPENSSL_CONF, 'C:\\owned\\openssl.cnf');
  assert.equal(env.PGHOST, undefined); assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.PATH, undefined);
});

test('preallocation children cannot materialize the future run root, including DACL setup', () => {
  const directories = new Set([`${windowsProfile}\\AppData\\Local\\Temp`]);
  const materialize = (directory) => { while (directory.includes('\\')) { directories.add(directory); directory = directory.slice(0, directory.lastIndexOf('\\')); } };
  const child = (env) => materialize(env.TEMP); // Simulate Windows/native startup ensuring its TEMP exists.
  const preallocation = environmentForStage('preallocation');
  assert.deepEqual(Object.keys(preallocation).sort(), ['SystemRoot', 'TEMP', 'TMP', 'TZ', 'LANG', 'LC_ALL'].sort());
  assert.equal(preallocation.TMP, preallocation.TEMP);
  for (const stage of ['metadata', 'port', 'tool-versions']) { child(preallocation); assert.equal(directories.has(PLAN.root), false, stage); }
  assert.equal(preallocation.OPENSSL_CONF, undefined);
  assert.equal(directories.has(PLAN.root), false); directories.add(PLAN.root); // create-only allocation still succeeds.
  child(preallocation); assert.equal(directories.has(`${PLAN.root}\\private`), false, 'DACL child cannot precreate private subtree');
  materialize(`${PLAN.root}\\private\\temp`); // Only after restricted-root/owned-config preparation.
  const owned = environmentForStage('private'); child(owned);
  assert.equal(owned.TEMP, `${PLAN.root}\\private\\temp`);
  assert.equal(owned.OPENSSL_CONF, `${PLAN.root}\\private\\openssl.cnf`);
  for (const directory of [...directories]) if (directory.startsWith(`${PLAN.root}\\private`)) directories.delete(directory);
  child(environmentForStage('preallocation')); // Evidence/metadata after private cleanup cannot recreate private TEMP.
  assert.equal(directories.has(`${PLAN.root}\\private`), false);
  assert.throws(() => environmentForStage('ambient'), /COMPONENT_REFUSED/);
});

test('generated configuration is TLS-only, exact roles and target, with SQL logging off', () => {
  const { config, hba } = configuration('ip');
  assert.match(config, /listen_addresses = '127\.0\.0\.1'/);
  assert.match(config, /port = 55461/); assert.match(config, /ssl = on/);
  assert.match(config, /log_min_error_statement = 'panic'/); assert.match(config, /log_statement = 'none'/);
  assert.match(hba, /^hostnossl all all 127\.0\.0\.1\/32 reject/m);
  assert.match(hba, /hostssl postgres pfa_r19_tls_owner 127\.0\.0\.1\/32 scram-sha-256/);
  assert.match(hba, new RegExp(`hostssl ${PLAN.target.database} pfa_r19_tls_probe 127\\.0\\.0\\.1/32 scram-sha-256`));
  assert.doesNotMatch(hba, /trust|md5/); assert.throws(() => configuration('../other'), /COMPONENT_REFUSED/);
});

const good = () => ({ database: PLAN.target.database, role: PLAN.probeRole, host: '127.0.0.1', port: 55461,
  marker: PLAN.marker, server_version: '180006', ssl: true, tls_version: 'TLSv1.3', cipher: 'TLS_AES_256_GCM_SHA384', bits: 256 });
const socket = () => ({ authorized: true, getPeerCertificate: () => ({ raw: Buffer.from('synthetic leaf') }) });

test('same-client identity must match every bound value before callback', () => {
  assert.doesNotThrow(() => assertIdentity([good()], socket(), PLAN.target.database, PLAN.probeRole, PLAN.marker));
  for (const change of [{ database: 'postgres' }, { role: 'postgres' }, { host: '::1' }, { port: 55432 },
    { marker: 'foreign' }, { server_version: '160006' }, { ssl: false }, { tls_version: 'TLSv1' }, { bits: 64 }]) {
    assert.throws(() => assertIdentity([{ ...good(), ...change }], socket(), PLAN.target.database, PLAN.probeRole, PLAN.marker));
  }
  assert.throws(() => assertIdentity([good()], { ...socket(), authorized: false }, PLAN.target.database, PLAN.probeRole, PLAN.marker));
  assert.throws(() => assertIdentity([], socket(), PLAN.target.database, PLAN.probeRole, PLAN.marker));
});

function fakeClient({ rows = [good()], error, connectSucceeds = true } = {}) {
  const events = [];
  return { events, connection: { stream: socket() }, on() {},
    async connect() { events.push('connect'); if (!connectSucceeds) throw error; },
    async query() { events.push('query'); return { rows }; },
    async end() { events.push('end'); },
  };
}
test('positive probe gates callback on actual identity query; failure never releases callback', async () => {
  let called = 0; const c = fakeClient();
  await probe(c, 'positive', { afterVerified: () => { called++; } });
  assert.equal(called, 1); assert.deepEqual(c.events, ['connect', 'query', 'end']);
  const bad = fakeClient({ rows: [{ ...good(), marker: 'foreign' }] });
  await assert.rejects(probe(bad, 'positive', { afterVerified: () => { called++; } }), /COMPONENT_REFUSED/);
  assert.equal(called, 1); assert.equal(bad.events.at(-1), 'end');
});
for (const [kind, code] of [['wrong-ca', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'], ['wrong-host', 'ERR_TLS_CERT_ALTNAME_INVALID'], ['plaintext', '28000']]) {
  test(`${kind} negative must fail connect with its expected classification and run zero queries`, async () => {
    let called = false;
    const c = fakeClient({ connectSucceeds: false, error: { code, message: 'RAW_SECRET_SENTINEL' } });
    assert.deepEqual(await probe(c, kind, { afterVerified: () => { called = true; } }), { outcome: 'rejected', code, queries: 0 });
    assert.deepEqual(c.events, ['connect', 'end']); assert.equal(called, false);
    const unexpectedSuccess = fakeClient();
    await assert.rejects(probe(unexpectedSuccess, kind), /COMPONENT_REFUSED/);
    assert.deepEqual(unexpectedSuccess.events, ['connect', 'end']);
    await assert.rejects(probe(fakeClient({ connectSucceeds: false, error: { code: 'ECONNREFUSED' } }), kind), /COMPONENT_REFUSED/);
  });
}

test('cleanup cannot delete a live, unbound or unverified cluster and has strict ordering', async () => {
  const calls = []; const operations = { assertOwned: async () => calls.push('owned'), stop: async () => calls.push('stop'),
    exited: async () => calls.push('exit'), portGone: async () => calls.push('port'), remove: async () => calls.push('remove') };
  await cleanup(operations); assert.deepEqual(calls, ['owned', 'stop', 'exit', 'port', 'owned', 'remove']);
  for (const phase of ['assertOwned', 'stop', 'exited', 'portGone']) {
    let removed = false;
    await assert.rejects(cleanup({ ...operations, [phase]: async () => { throw new Error('refused'); }, remove: async () => { removed = true; } }));
    assert.equal(removed, false);
  }
});

test('native command plans cannot adopt a cluster/service, shell flags or arbitrary endpoint', () => {
  assert.deepEqual(nativeArgs('start'), ['-D', `${PLAN.root}\\pgdata`, '-c', `config_file=${PLAN.root}\\component.conf`]);
  assert.deepEqual(nativeArgs('stop'), ['-D', `${PLAN.root}\\pgdata`, '-m', 'fast', '-w', '-t', '10', 'stop']);
  assert.ok(nativeArgs('init').includes('scram-sha-256'));
  assert.throws(() => nativeArgs('register'), /COMPONENT_REFUSED/);
});
test('fake lifecycle orders all tool checks before writes and final recovery positive before cleanup', async () => {
  const calls = [];
  const ops = Object.fromEntries(['preflight', 'allocate', 'certificates', 'initialize', 'bootstrap', 'finish']
    .map((name) => [name, async () => { calls.push(name); }]));
  ops.start = async (leaf) => calls.push(`start:${leaf}`);
  ops.stop = async () => calls.push('stop'); ops.probe = async (kind) => calls.push(`probe:${kind}`);
  await rehearse(ops);
  assert.deepEqual(calls, ['preflight', 'allocate', 'certificates', 'initialize', 'start:ip', 'bootstrap', 'probe:positive',
    'probe:wrong-ca', 'probe:plaintext', 'stop', 'start:localhost', 'probe:wrong-host', 'stop', 'start:ip', 'probe:positive', 'finish']);
  calls.length = 0;
  await assert.rejects(rehearse({ ...ops, preflight: async () => { throw new Error('bad tool'); } }));
  assert.deepEqual(calls, []);
  await assert.rejects(rehearse({ ...ops, probe: async () => { throw new Error('bad identity'); } }));
  assert.equal(calls.at(-1), 'finish');
});

test('fresh exact listener identity gates each native stop dispatch', async () => {
  const expected = { address: '127.0.0.1', port: 55461, pid: 321 };
  let dispatches = 0; const order = [];
  const operations = { listeners: async () => { order.push('fresh-listener'); return [expected]; },
    dispatch: async () => { order.push('dispatch'); dispatches++; } };
  await dispatchOwnedStop(321, operations);
  assert.deepEqual(order, ['fresh-listener', 'dispatch']); assert.equal(dispatches, 1);
  for (const rows of [[], [expected, expected], [{ ...expected, pid: 999 }], [{ ...expected, address: '0.0.0.0' }],
    [{ ...expected, address: '::1' }], [{ ...expected, port: 55432 }], [{ address: '127.0.0.1', pid: 321 }]]) {
    await assert.rejects(dispatchOwnedStop(321, { ...operations, listeners: async () => rows }), /COMPONENT_REFUSED/);
    assert.equal(dispatches, 1, 'unsafe listener cannot dispatch stop');
  }
  await assert.rejects(dispatchOwnedStop(321, { ...operations, listeners: async () => { throw new Error('metadata unavailable'); } }));
  assert.equal(dispatches, 1);
});
