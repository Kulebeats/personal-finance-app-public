// Standalone owned TLS/browser fixture: no application, DB, provider or OS trust mutation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { X509Certificate, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright';
import { prepareTestEnvironment } from './test-target.mjs';

assert.equal(process.argv[2], '--run-owned-proof', 'Explicit owned proof invocation required');
assert.equal(process.version, 'v24.22.0', 'Use the reviewed campaign runtime');
assert.equal(path.resolve(process.env.PLAYWRIGHT_BROWSERS_PATH ?? ''),
  path.resolve(import.meta.dirname, '../../.local/r20-browser-runtime'), 'Use the explicitly installed campaign browser runtime');
const childEnv = { ...process.env, PFA_TEST_MODE: 'unit' };
prepareTestEnvironment(childEnv);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pfa-r20-browser-trust-'));
const openssl = process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl';
const run = (...args) => execFileSync(openssl, args, { cwd: directory, stdio: 'ignore', timeout: 10000, env: childEnv });
const read = name => fs.readFileSync(path.join(directory, name), 'utf8');
const sockets = new Set();
const profiles = [];
const servers = [];
let context;
let allowedConnects = 0;
let deniedProxyRequests = 0;
let browserVersion;

async function listen(server) {
  servers.push(server);
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server.address().port;
}

try {
  for (const name of ['ca', 'other']) {
    run('req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
      '-keyout', `${name}.key`, '-out', `${name}.pem`, '-days', '2', '-subj', `/CN=Capital-Synthetic-${name}`,
      '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
  }
  run('req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
    '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=Capital-Synthetic-Leaf');
  for (const [name, san] of [['leaf', 'IP:127.0.0.1'], ['wrong-host', 'DNS:wrong-fixture.invalid']]) {
    fs.writeFileSync(path.join(directory, `${name}.ext`), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=${san}\n`, { flag: 'wx' });
    run('x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial',
      '-out', `${name}.pem`, '-days', '2', '-extfile', `${name}.ext`);
  }
  const responseText = `owned-tls-${path.basename(directory)}`;
  const endpoint = https.createServer({ key: read('leaf.key'), cert: read('leaf.pem') }, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
    res.end(responseText);
  });
  endpoint.on('tlsClientError', () => {});
  const tlsPort = await listen(endpoint);
  const allowedAuthority = `127.0.0.1:${tlsPort}`;
  let forbiddenSinkHits = 0;
  const forbiddenPort = await listen(http.createServer((_req, res) => { forbiddenSinkHits++; res.end('forbidden'); }));
  let forbiddenProxyDenials = 0;
  const proxy = http.createServer((req, res) => {
    deniedProxyRequests++;
    if (req.url === `http://127.0.0.1:${forbiddenPort}/`) forbiddenProxyDenials++;
    res.writeHead(403); res.end();
  });
  proxy.on('connect', (req, downstream, head) => {
    if (req.url !== allowedAuthority) { deniedProxyRequests++; downstream.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    allowedConnects++;
    const upstream = net.connect({ host: '127.0.0.1', port: tlsPort });
    sockets.add(upstream);
    upstream.on('error', () => downstream.destroy());
    upstream.once('close', () => sockets.delete(upstream));
    downstream.on('error', () => upstream.destroy());
    downstream.once('close', () => upstream.destroy());
    upstream.once('connect', () => {
      downstream.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      downstream.pipe(upstream).pipe(downstream);
    });
  });
  const proxyPort = await listen(proxy);
  const options = {
    channel: 'chromium', headless: true, ignoreHTTPSErrors: false, env: childEnv,
    proxy: { server: `http://127.0.0.1:${proxyPort}`, bypass: '<-loopback>' },
    args: ['--disable-quic', '--disable-background-networking', '--disable-component-update', '--disable-sync',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
  };
  async function launch(profile) {
    context = await chromium.launchPersistentContext(profile, options);
    browserVersion = context.browser().version();
    assert.equal(browserVersion, '145.0.7632.6', 'Review certificate DB contract before changing Chromium version');
    return context.pages()[0];
  }
  async function createProfile(name, caName) {
    const profile = path.join(directory, name);
    fs.mkdirSync(profile);
    profiles.push(profile);
    const page = await launch(profile);
    await page.goto('chrome://certificate-manager');
    await context.close(); context = undefined;
    const databasePath = path.join(profile, 'Default', 'ServerCertificate');
    assert.ok(fs.existsSync(databasePath), 'Chromium must create its own profile-local certificate database');
    const database = new DatabaseSync(databasePath);
    try {
      assert.deepEqual(database.prepare("SELECT key, value FROM meta WHERE key IN ('last_compatible_version', 'version') ORDER BY key").all().map(row => ({ ...row })),
        [{ key: 'last_compatible_version', value: '1' }, { key: 'version', value: '1' }]);
      assert.deepEqual(database.prepare('PRAGMA table_info(certificates)').all().map(row => row.name),
        ['sha256hash_hex', 'der_cert', 'trust_settings']);
      assert.equal(database.prepare('SELECT count(*) AS count FROM certificates').get().count, 0);
      if (caName) {
        const der = new X509Certificate(read(caName)).raw;
        // Chromium 145 CertificateMetadata { trust { trust_type: TRUSTED(3) } }.
        // Wire fields verified from its matching source proto; no leaf/validation bypass.
        database.prepare('INSERT INTO certificates(sha256hash_hex, der_cert, trust_settings) VALUES (?, ?, ?)')
          .run(createHash('sha256').update(der).digest('hex'), der, Buffer.from([0x0a, 0x02, 0x08, 0x03]));
      }
    } finally { database.close(); }
    return profile;
  }
  async function navigate(profile, expectedError) {
    const page = await launch(profile);
    try {
      if (expectedError) {
        await assert.rejects(page.goto(`https://${allowedAuthority}`, { timeout: 10000 }), expectedError);
      } else {
        const response = await page.goto(`https://${allowedAuthority}`, { timeout: 10000 });
        assert.equal(response.status(), 200);
        assert.equal(await page.locator('body').innerText(), responseText);
        assert.equal((await response.securityDetails()).issuer, 'Capital-Synthetic-ca');
      }
    } finally { await context.close(); context = undefined; }
  }
  const untrusted = await createProfile('untrusted');
  const deniedPage = await launch(untrusted);
  await assert.rejects(deniedPage.goto(`http://127.0.0.1:${forbiddenPort}`, { timeout: 10000 }), /ERR_HTTP_RESPONSE_CODE_FAILURE/);
  assert.equal(forbiddenProxyDenials, 1);
  assert.equal(forbiddenSinkHits, 0, 'Loopback must not bypass the owned proxy');
  await context.close(); context = undefined;
  await navigate(untrusted, /ERR_CERT_AUTHORITY_INVALID/);
  const trusted = await createProfile('trusted', 'ca.pem');
  await navigate(trusted);
  const wrongCA = await createProfile('wrong-ca', 'other.pem');
  await navigate(wrongCA, /ERR_CERT_AUTHORITY_INVALID/);
  endpoint.setSecureContext({ key: read('leaf.key'), cert: read('wrong-host.pem') });
  await navigate(trusted, /ERR_CERT_COMMON_NAME_INVALID/);
  endpoint.setSecureContext({ key: read('leaf.key'), cert: read('leaf.pem') });
  await navigate(untrusted, /ERR_CERT_AUTHORITY_INVALID/);
  assert.ok(allowedConnects >= 5, 'Native browser requests must reach the owned CONNECT proxy');
  console.log(JSON.stringify({ browserVersion, trustedNativeNavigation: true, untrustedRejected: true,
    wrongCARejected: true, wrongHostnameRejected: true, independentProfileStillUntrusted: true,
    ignoreHTTPSErrors: false, certificateIgnoreFlags: false, osTrustMutation: false,
    allowedConnects, deniedProxyRequests, forbiddenProxyDenials, forbiddenSinkHits, profileCount: profiles.length }));
} finally {
  if (context) await context.close();
  for (const socket of sockets) socket.destroy();
  for (const server of servers.reverse()) if (server.listening) await new Promise(resolve => server.close(resolve));
  const resolved = fs.realpathSync(directory);
  const temporaryRoot = fs.realpathSync(os.tmpdir()) + path.sep;
  assert.ok(resolved.startsWith(temporaryRoot) && path.basename(resolved).startsWith('pfa-r20-browser-trust-'));
  fs.rmSync(resolved, { recursive: true, force: true });
}
