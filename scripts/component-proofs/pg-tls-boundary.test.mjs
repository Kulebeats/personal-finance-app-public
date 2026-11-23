import test from 'node:test';
import assert from 'node:assert/strict';
import { installBoundary } from './pg-tls-boundary.mjs';

function fixtures() {
  class Socket { connect(...args) { this.args = args; return this; } }
  class Server { listen() { throw new Error('original listener must not run'); } }
  const net = { Socket, Server }; const tls = { connect: () => ({ tls: true }) };
  const dns = { lookup: () => {}, promises: { lookup: () => {} } };
  const http = { request: () => {}, get: () => {} }, https = { ...http }, globals = { fetch() {} };
  const boundary = installBoundary({ net, tls, dns, http, https, globals, sync() {} });
  return { net, tls, dns, http, https, globals, boundary };
}
test('fake transport accepts only exact numeric allocated socket and connected TLS upgrade', () => {
  const f = fixtures(), s = new f.net.Socket();
  s.connect(55461, '127.0.0.1'); Object.assign(s, { remoteAddress: '127.0.0.1', remotePort: 55461 });
  assert.deepEqual(f.tls.connect({ socket: s, ca: 'synthetic', rejectUnauthorized: true, checkServerIdentity() {} }), { tls: true });
  assert.deepEqual(f.boundary.report(), { connections: 1, tlsUpgrades: 1, denied: 0, dns: 0 });
  f.boundary.restore(); assert.deepEqual(s.connect(5432, 'localhost').args, [5432, 'localhost']);
});
test('foreign, ambiguous, unowned, verification-off and DNS dispatch fail before original transport', () => {
  const f = fixtures();
  for (const options of [{ host: 'localhost', port: 55461 }, { host: '127.0.0.1', port: 55432 },
    { host: '127.0.0.1', port: 55461, lookup() {} }, { path: 'pipe' }, { host: 'example.com', port: 443 }]) {
    const s = new f.net.Socket(); assert.throws(() => s.connect(options), /COMPONENT_REFUSED/); assert.equal(s.args, undefined);
  }
  assert.throws(() => f.tls.connect({ socket: { remoteAddress: '127.0.0.1', remotePort: 55461 }, rejectUnauthorized: true }), /COMPONENT_REFUSED/);
  const s = new f.net.Socket(); s.connect(55461, '127.0.0.1'); Object.assign(s, { remoteAddress: '127.0.0.1', remotePort: 55461 });
  assert.throws(() => f.tls.connect({ socket: s, rejectUnauthorized: false }), /COMPONENT_REFUSED/);
  assert.throws(() => f.dns.lookup('foreign'), /COMPONENT_REFUSED/);
  assert.throws(() => f.dns.promises.lookup('foreign'), /COMPONENT_REFUSED/);
  assert.throws(() => f.http.request('foreign'), /COMPONENT_REFUSED/);
  assert.throws(() => f.https.get('foreign'), /COMPONENT_REFUSED/);
  assert.throws(() => f.globals.fetch('foreign'), /COMPONENT_REFUSED/);
  assert.throws(() => new f.net.Server().listen(0), /COMPONENT_REFUSED/);
  assert.equal(f.boundary.report().dns, 2); assert.equal(f.boundary.report().denied, 13);
  f.boundary.restore();
});
