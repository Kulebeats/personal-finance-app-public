// Standalone component rehearsal, never imported by application or ordinary test setup.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, X509Certificate } from 'node:crypto';
import { PLAN, check, hash, configuration, nativeArgs, probe, cleanup, rehearse, dispatchOwnedStop, runtimePreflight, environmentForStage, PREALLOCATION_TEMP } from './pg-tls-contract.mjs';
import { installBoundary } from './pg-tls-boundary.mjs';
import { bridge, inspect, verifyTools, runFile, launch, waitListening, ownedProcess, bounded, removeDescendant } from './pg-tls-native.mjs';

const join = (...parts) => path.join(PLAN.root, ...parts);
const readPublic = (name) => fs.readFileSync(join('public', name), 'utf8');

async function runComponent() {
  runtimePreflight({ platform: process.platform, version: process.version, arch: process.arch, executable: process.execPath,
    args: process.execArgv, systemRoot: process.env.SystemRoot,
    hasNodeOptions: Object.hasOwn(process.env, 'NODE_OPTIONS'), hasNodePath: Object.hasOwn(process.env, 'NODE_PATH') });
  // No ambient pg/provider/profile values are read by subsequently imported packages.
  let env = environmentForStage('preallocation'); process.env = env;
  const report = { component: 'native-postgresql-tls', runId: PLAN.target.runId, target: PLAN.target,
    node: process.version, arch: process.arch, status: 'failed', outcomes: [], tools: {}, certificates: {},
    certifications: { applicationLaunch: false, fullProductionProfile: false, runtimeDependencyIdentity: false,
      globalEgressEnforced: false, hostedOrReleaseTls: false }, cleanup: { stopped: false, listenerGone: false, privateRemoved: false, dataRemoved: false } };
  let allocated = false, initialized = false, initializationUncertain = false, rootIdentity, handle, boundary, Client, resolver;
  let ownerPassword, probePassword; let leaf = 'ip';
  async function assertRoot() {
    const rows = await inspect([PLAN.root], env);
    check(rows.at(-1).id === rootIdentity);
  }
  async function write(relative, text) {
    await assertRoot(); check(!relative.includes('..') && !path.isAbsolute(relative));
    fs.writeFileSync(join(relative), text, { flag: 'wx', mode: 0o600 }); await inspect([join(relative)], env);
  }
  async function stop() {
    await assertRoot(); await ownedProcess(handle, env);
    await dispatchOwnedStop(handle.child.pid, {
      listeners: () => bridge('port', env),
      dispatch: () => runFile(PLAN.tools.control.path, nativeArgs('stop'), env, { timeout: 15000 }),
    });
    const exit = await bounded(handle.closed, 3000); check(exit.code === 0 && !exit.signal);
    report.cleanup.stopped = true;
    const listeners = await bridge('port', env); check(listeners.length === 0); report.cleanup.listenerGone = true;
  }
  function connection(database, role, password, ca) {
    const config = resolver({ NODE_ENV: 'production', DATABASE_URL:
      `postgresql://${role}:${password}@127.0.0.1:55461/${database}`, DATABASE_SSL_CA_CERT: ca });
    check(!config.connectionString && config.host === PLAN.target.host && config.port === PLAN.target.port &&
      config.database === database && config.user === role && config.ssl.rejectUnauthorized === true && typeof config.ssl.checkServerIdentity === 'function');
    return { ...config, application_name: 'pfa-r19-native-tls-component', connectionTimeoutMillis: 1500,
      query_timeout: 1500, statement_timeout: 1500, lock_timeout: 1000 };
  }
  const operations = {
    async preflight() {
      check(!fs.existsSync(PLAN.root));
      check((await inspect([PREALLOCATION_TEMP], env)).at(-1).directory); // Node ancestry before first metadata child, then full Windows reparse check.
      await inspect([path.dirname(path.dirname(PLAN.root))], env);
      if (fs.existsSync(path.dirname(PLAN.root))) await inspect([path.dirname(PLAN.root)], env);
      check((await bridge('port', env)).length === 0);
      await verifyTools(env); // All native binary hash/version checks precede any fixture write.
      report.tools = PLAN.tools;
    },
    async allocate() {
      const parent = path.dirname(PLAN.root); if (!fs.existsSync(parent)) fs.mkdirSync(parent);
      await inspect([parent], env); fs.mkdirSync(PLAN.root); allocated = true;
      rootIdentity = (await inspect([PLAN.root], env)).at(-1).id;
      check((await bridge('restrict', env)).restricted === true); // Only this new root's DACL changes.
      for (const directory of ['private', 'public', 'evidence']) fs.mkdirSync(join(directory));
      fs.mkdirSync(join('private', 'temp')); await assertRoot();
      await write('private/openssl.cnf', '[req]\ndistinguished_name=dn\n[dn]\n');
      await inspect([join('private', 'temp'), join('private', 'openssl.cnf')], env);
      env = environmentForStage('private'); process.env = env; // DACL, directories and config already exist.
      ownerPassword = randomBytes(32).toString('hex'); probePassword = randomBytes(32).toString('hex');
      await write('private/init-password', `${ownerPassword}\n`);
      const config = configuration('ip'); await write('component.conf', config.config); await write('component.hba', config.hba);
    },
    async certificates() {
      const openssl = async (...args) => { await assertRoot(); await runFile(PLAN.tools.openssl.path, args, env, { cwd: PLAN.root }); };
      for (const [name, subject] of [['ca', 'R19-owned-synthetic-CA'], ['wrong-ca', 'R19-owned-unrelated-CA']]) {
        await openssl('req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', `private/${name}.key`,
          '-out', `public/${name}.pem`, '-days', '2', '-subj', `/CN=${subject}`, '-addext', 'basicConstraints=critical,CA:TRUE');
      }
      await openssl('req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', 'private/leaf.key',
        '-out', 'public/leaf.csr', '-subj', '/CN=component.invalid');
      for (const [name, san, serial] of [['ip', 'IP:127.0.0.1', '1'], ['localhost', 'DNS:localhost', '2']]) {
        await write(`public/${name}.ext`, `basicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\nsubjectAltName=${san}\n`);
        await openssl('x509', '-req', '-in', 'public/leaf.csr', '-CA', 'public/ca.pem', '-CAkey', 'private/ca.key', '-set_serial', serial,
          '-out', `public/${name}.pem`, '-days', '2', '-extfile', `public/${name}.ext`);
      }
      const files = ['ca', 'wrong-ca', 'ip', 'localhost'];
      await inspect(files.map((name) => join('public', `${name}.pem`)).concat(['ca', 'wrong-ca', 'leaf'].map((name) => join('private', `${name}.key`))), env);
      for (const name of files) {
        const certificate = new X509Certificate(readPublic(`${name}.pem`));
        check(certificate.ca === ['ca', 'wrong-ca'].includes(name));
        report.certificates[name] = { fileSha256: hash(readPublic(`${name}.pem`)), derSha256: hash(certificate.raw) };
      }
    },
    async initialize() {
      await assertRoot(); initializationUncertain = true;
      await runFile(PLAN.tools.initdb.path, nativeArgs('init'), env, { timeout: 45000 });
      initialized = true; initializationUncertain = false;
      boundary = installBoundary();
      ({ default: { Client } } = await import('pg'));
      ({ resolveDatabaseConnection: resolver } = await import('../../server/dbSsl.ts'));
    },
    async start(selectedLeaf) {
      await assertRoot(); check(['ip', 'localhost'].includes(selectedLeaf));
      check(!handle || handle.status().exit?.code === 0);
      check((await bridge('port', env)).length === 0); leaf = selectedLeaf;
      const args = nativeArgs('start');
      if (leaf === 'localhost') args.push('-c', `ssl_cert_file=${join('public', 'localhost.pem')}`);
      handle = launch(args, env); report.cleanup.stopped = false; report.cleanup.listenerGone = false;
      await waitListening(handle, env);
    },
    async bootstrap() {
      const client = new Client(connection('postgres', PLAN.ownerRole, ownerPassword, readPublic('ca.pem')));
      await probe(client, 'positive', { database: 'postgres', role: PLAN.ownerRole, marker: null,
        peerSha256: report.certificates.ip.derSha256,
        async afterVerified(verified) {
          const { rows } = await verified.query("SELECT current_setting('data_directory') AS directory, system_identifier::text FROM pg_control_system()");
          check(rows.length === 1 && path.normalize(rows[0].directory).toLowerCase() === join('pgdata').toLowerCase() && /^\d{10,20}$/.test(rows[0].system_identifier));
          report.systemIdentifier = rows[0].system_identifier;
          check(/^[a-f0-9]{64}$/.test(probePassword));
          // Fixed identifiers and generated hex only; no caller SQL or secret payload logging.
          await verified.query(`CREATE ROLE ${PLAN.probeRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${probePassword}'`);
          await verified.query(`CREATE DATABASE ${PLAN.target.database} OWNER ${PLAN.probeRole} TEMPLATE template0`);
          await verified.query(`COMMENT ON DATABASE ${PLAN.target.database} IS '${PLAN.marker}'`);
          report.bootstrap = { verifiedBeforeDdl: true, fixtureDdl: 3, applicationSchema: false };
        } });
    },
    async probe(kind) {
      await assertRoot(); await ownedProcess(handle, env);
      const config = connection(PLAN.target.database, PLAN.probeRole, probePassword, readPublic(kind === 'wrong-ca' ? 'wrong-ca.pem' : 'ca.pem'));
      if (kind === 'plaintext') config.ssl = false; // Intentional negative of native HBA, never production resolver behavior.
      const result = await probe(new Client(config), kind, { peerSha256: report.certificates[leaf].derSha256 });
      report.outcomes.push({ phase: leaf, kind, ...result });
    }, stop,
    async finish() {
      if (!allocated) return;
      check(initialized && !initializationUncertain); // Native init failure retains evidence/root; never erase uncertain children.
      check(handle && !handle.status().spawnError);
      await cleanup({ assertOwned: assertRoot, stop: async () => { if (!handle.status().exit) await stop(); else check(handle.status().exit.code === 0); },
        exited: async () => { const exit = await bounded(handle.closed, 3000); check(exit.code === 0); report.cleanup.stopped = true; },
        portGone: async () => { check((await bridge('port', env)).length === 0); report.cleanup.listenerGone = true; },
        remove: async () => { await removeDescendant('pgdata', env); report.cleanup.dataRemoved = true; await removeDescendant('private', env); report.cleanup.privateRemoved = true; } });
    },
  };
  const labeled = Object.fromEntries(Object.entries(operations).map(([label, operation]) => [label, async (...args) => {
    try { return await operation(...args); } catch { (report.failedStages ??= []).push(label); throw new Error('PG_TLS_COMPONENT_REFUSED'); }
  }]));
  try {
    await rehearse(labeled); const transport = boundary.report();
    check(report.outcomes.length === 5 && transport.connections === 6 && transport.tlsUpgrades === 5 && transport.denied === 0 && transport.dns === 0);
    report.status = 'passed';
  }
  catch { report.status = 'failed'; }
  finally {
    if (boundary) { report.nodeTransport = boundary.report(); boundary.restore(); } ownerPassword = undefined; probePassword = undefined;
    env = environmentForStage('preallocation'); process.env = env; // Final metadata/evidence must not recreate removed private TEMP.
  }
  if (allocated) {
    try { await assertRoot(); fs.writeFileSync(join('evidence', 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' }); }
    catch { report.status = 'failed'; }
  }
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    check(process.argv.length === 4 && process.argv[2] === '--execute-owned-component' && process.argv[3] === PLAN.target.runId);
    const report = await runComponent(); console.log(JSON.stringify(report)); process.exitCode = report.status === 'passed' ? 0 : 1;
  } catch { console.log(JSON.stringify({ component: 'native-postgresql-tls', status: 'refused' })); process.exitCode = 1; }
}
