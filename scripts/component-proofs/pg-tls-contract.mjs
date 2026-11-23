import { createHash } from 'node:crypto';
import os from 'node:os';
// The Windows profile the custody fixtures live under, from the process token (os.userInfo),
// not USERPROFILE, which the fixed children override; a neutral placeholder off Windows.
const windowsProfile = process.platform === 'win32' ? os.userInfo().homedir : 'C:\\Users\\example';
const freeze = (value) => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const refuse = () => { throw new Error('PG_TLS_COMPONENT_REFUSED'); };
export const check = (condition) => { if (!condition) refuse(); };
export const PLAN = freeze({
  target: { runId: 'r19pgtls20261015a1', host: '127.0.0.1', port: 55461,
    database: 'pfa_completion_r19_tls_r19pgtls20261015a1_test' },
  root: `${windowsProfile}\\AppData\\Local\\Packages\\OpenAI.Codex_2p2nqsd0c76g0\\LocalCache\\Local\\capital-r19-pg-tls\\r19pgtls20261015a1`,
  ownerRole: 'pfa_r19_tls_owner', probeRole: 'pfa_r19_tls_probe',
  marker: 'pfa-synthetic-test:v1:r19pgtls20261015a1:pfa_completion_r19_tls_r19pgtls20261015a1_test',
  tools: {
    postgres: { path: 'C:\\Program Files\\PostgreSQL\\18\\bin\\postgres.exe', version: '18.6', sha256: '14817df435104dcfe05ad8343fda200930abf778553ab60154bd285aea6833e1' },
    initdb: { path: 'C:\\Program Files\\PostgreSQL\\18\\bin\\initdb.exe', version: '18.6', sha256: 'e2b30e9d223f05ca0dc1219798d805bbdb8ab4bd29ab59c70956bf7f41219e57' },
    control: { path: 'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_ctl.exe', version: '18.6', sha256: '3cdb444b7067d824d8c6b2626aaf8688163ef0b001734c1a8a6502cdccde23bb' },
    openssl: { path: 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', version: '3.5.7', sha256: '78340fb01dea2df5caab73dcf28833b31329226a4c9e02f717f1d399592265b9' },
  },
});
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** Exact runtime identity, with no environment reads or path resolution. */
export function runtimePreflight(value) {
  const keys = ['platform', 'version', 'arch', 'executable', 'args', 'systemRoot', 'hasNodeOptions', 'hasNodePath'];
  check(value && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === keys.length);
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); check(descriptor && 'value' in descriptor); }
  check(value.platform === 'win32' && value.version === 'v24.22.0' && value.arch === 'arm64' &&
    typeof value.executable === 'string' && value.executable.toLowerCase() ===
      `${windowsProfile}\\appdata\\local\\capital-r00-runtime\\node-v24.22.0-win-arm64\\node.exe`.toLowerCase() &&
    Array.isArray(value.args) && value.args.length === 0 && value.hasNodeOptions === false && value.hasNodePath === false &&
    typeof value.systemRoot === 'string' && value.systemRoot.toLowerCase() === 'c:\\windows');
}
export function target(value) {
  check(value && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === 4);
  for (const [key, expected] of Object.entries(PLAN.target)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    check(descriptor && 'value' in descriptor && descriptor.value === expected);
  }
  return PLAN.target;
}
export function childEnvironment(systemRoot, temporary, opensslConfig) {
  for (const value of [systemRoot, temporary, opensslConfig]) check(typeof value === 'string' && /^[A-Z]:\\/.test(value) && !/[\r\n\x00]/.test(value));
  return { SystemRoot: systemRoot, TEMP: temporary, TMP: temporary, TZ: 'UTC', LANG: 'C', LC_ALL: 'C', OPENSSL_CONF: opensslConfig };
}
export const PREALLOCATION_TEMP = `${windowsProfile}\\AppData\\Local\\Temp`;
export function environmentForStage(stage) {
  check(['preallocation', 'private'].includes(stage));
  if (stage === 'preallocation') return { SystemRoot: 'C:\\Windows', TEMP: PREALLOCATION_TEMP, TMP: PREALLOCATION_TEMP,
    TZ: 'UTC', LANG: 'C', LC_ALL: 'C' };
  return childEnvironment('C:\\Windows', `${PLAN.root}\\private\\temp`, `${PLAN.root}\\private\\openssl.cnf`);
}
export function configuration(leaf) {
  check(['ip', 'localhost'].includes(leaf));
  const root = PLAN.root.replaceAll('\\', '/');
  return {
    config: `hba_file = '${root}/component.hba'\nlisten_addresses = '127.0.0.1'\nport = 55461\nunix_socket_directories = ''\nmax_connections = 8\nshared_buffers = '16MB'\nssl = on\nssl_cert_file = '${root}/public/${leaf}.pem'\nssl_key_file = '${root}/private/leaf.key'\nssl_min_protocol_version = 'TLSv1.2'\nssl_passphrase_command = ''\nshared_preload_libraries = ''\nlocal_preload_libraries = ''\nsession_preload_libraries = ''\narchive_mode = off\nlogging_collector = off\nlog_statement = 'none'\nlog_min_error_statement = 'panic'\nlog_parameter_max_length = 0\nlog_parameter_max_length_on_error = 0\nlog_connections = ''\nlog_disconnections = off\nauthentication_timeout = '3s'\nstatement_timeout = '1500ms'\nlock_timeout = '1000ms'\npassword_encryption = 'scram-sha-256'\n`,
    hba: `hostnossl all all 127.0.0.1/32 reject\nhostssl postgres ${PLAN.ownerRole} 127.0.0.1/32 scram-sha-256\nhostssl ${PLAN.target.database} ${PLAN.probeRole} 127.0.0.1/32 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::0/0 reject\n`,
  };
}
export const IDENTITY_SQL = `SELECT current_database() AS database, current_user AS role,
  host(inet_server_addr()) AS host, inet_server_port() AS port,
  shobj_description(d.oid, 'pg_database') AS marker, current_setting('server_version_num') AS server_version,
  s.ssl, s.version AS tls_version, s.cipher, s.bits
  FROM pg_database d JOIN pg_stat_ssl s ON s.pid = pg_backend_pid() WHERE d.datname = current_database()`;
export function assertIdentity(rows, stream, database, role, marker) {
  check(rows.length === 1); const row = rows[0];
  check(row.database === database && row.role === role && row.host === PLAN.target.host && +row.port === PLAN.target.port &&
    row.server_version === '180006' && row.ssl === true && ['TLSv1.2', 'TLSv1.3'].includes(row.tls_version) &&
    typeof row.cipher === 'string' && row.cipher.length > 0 && row.bits >= 128 && stream?.authorized === true);
  if (marker !== undefined) check(row.marker === marker);
}
const negativeCodes = { 'wrong-ca': ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'],
  'wrong-host': ['ERR_TLS_CERT_ALTNAME_INVALID'], plaintext: ['28000'] };
async function clientDeadline(client, operation) {
  let timer;
  try { return await Promise.race([operation(), new Promise((_, reject) => {
    timer = setTimeout(() => { client.connection?.stream?.destroy?.(); reject(new Error('PG_TLS_COMPONENT_REFUSED')); }, 2000);
  })]); } finally { clearTimeout(timer); }
}
/** Only positive connections may query. Raw server/Error payloads never escape. */
export async function probe(client, kind, { afterVerified, database = PLAN.target.database, role = PLAN.probeRole,
  marker = PLAN.marker, peerSha256 } = {}) {
  check(kind === 'positive' || Object.hasOwn(negativeCodes, kind));
  client.on('error', () => {});
  try {
    try { await clientDeadline(client, () => client.connect()); }
    catch (error) {
      check(kind !== 'positive' && negativeCodes[kind].includes(error?.code));
      return { outcome: 'rejected', code: error.code, queries: 0 };
    }
    check(kind === 'positive');
    const { rows } = await clientDeadline(client, () => client.query(IDENTITY_SQL));
    check(marker !== null || database === 'postgres' && role === PLAN.ownerRole);
    assertIdentity(rows, client.connection?.stream, database, role, marker === null ? undefined : marker);
    if (peerSha256) check(hash(client.connection.stream.getPeerCertificate().raw) === peerSha256);
    await afterVerified?.(client);
    return { outcome: 'verified', queries: 1, tls: rows[0].tls_version };
  } catch { refuse(); }
  finally {
    let timer;
    try { await Promise.race([client.end(), new Promise((_, reject) => {
      timer = setTimeout(() => { client.connection?.stream?.destroy?.(); reject(new Error('PG_TLS_COMPONENT_REFUSED')); }, 2000);
    })]); } catch { refuse(); } finally { clearTimeout(timer); }
  }
}
/** The second ownership check is path/process-record custody, not a live PID requirement. */
export async function cleanup(operations) {
  await operations.assertOwned(); await operations.stop(); await operations.exited();
  await operations.portGone(); await operations.assertOwned(); await operations.remove();
}
export function assertOwnedListener(rows, pid) {
  check(Number.isSafeInteger(pid) && pid > 0 && Array.isArray(rows) && rows.length === 1);
  check(rows[0]?.address === PLAN.target.host && rows[0].port === PLAN.target.port && rows[0].pid === pid);
}
export async function dispatchOwnedStop(pid, operations) {
  assertOwnedListener(await operations.listeners(), pid);
  return operations.dispatch();
}
export function nativeArgs(kind) {
  if (kind === 'init') return ['--pgdata', `${PLAN.root}\\pgdata`, '--username', PLAN.ownerRole,
    '--auth-host', 'scram-sha-256', '--auth-local', 'scram-sha-256', '--encoding', 'UTF8', '--no-locale',
    '--pwfile', `${PLAN.root}\\private\\init-password`];
  if (kind === 'start') return ['-D', `${PLAN.root}\\pgdata`, '-c', `config_file=${PLAN.root}\\component.conf`];
  if (kind === 'stop') return ['-D', `${PLAN.root}\\pgdata`, '-m', 'fast', '-w', '-t', '10', 'stop'];
  refuse();
}
/** DI operations are a test seam; the CLI supplies only its fixed private runtime. */
export async function rehearse(operations) {
  await operations.preflight();
  try {
    await operations.allocate(); await operations.certificates(); await operations.initialize();
    await operations.start('ip'); await operations.bootstrap();
    await operations.probe('positive'); await operations.probe('wrong-ca'); await operations.probe('plaintext');
    await operations.stop(); await operations.start('localhost'); await operations.probe('wrong-host');
    await operations.stop(); await operations.start('ip'); await operations.probe('positive');
  } finally { await operations.finish(); }
}
