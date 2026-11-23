import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const guard = new URL('../network-guard.mjs', import.meta.url).href;
test('listener permission binds numeric address and port before dispatch', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import net from 'node:net';
    import { installNetworkGuard } from ${JSON.stringify(guard)};
    const dispatched = [];
    net.Socket.prototype.connect = function (...args) { dispatched.push(args); return this; };
    installNetworkGuard();
    async function owned(options) {
      const server = net.createServer();
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options, resolve); });
      return server;
    }
    const ipv6 = await owned({ port: 0, host: '::1', ipv6Only: true });
    try {
      const port = ipv6.address().port;
      assert.throws(() => net.connect({ host: '127.0.0.1', port }), /TEST NETWORK DENIED/);
      assert.equal(dispatched.length, 0);
      net.connect({ host: '::1', port });
      assert.equal(dispatched.length, 1);
      net.connect({ host: 'localhost', port });
      const forwarded = dispatched[1][0];
      assert.equal((Array.isArray(forwarded) ? forwarded[0] : forwarded).host, '::1');
      assert.throws(() => net.connect({ host: 'localhost', port, lookup() {} }), /TEST NETWORK DENIED/);
      assert.equal(dispatched.length, 2);
    } finally { await new Promise((resolve) => ipv6.close(resolve)); }
    const wildcard = await owned({ port: 0, host: '::', ipv6Only: true });
    try {
      const port = wildcard.address().port;
      assert.throws(() => net.connect({ host: '127.0.0.1', port }), /TEST NETWORK DENIED/);
      net.connect({ host: '::1', port });
    } finally { await new Promise((resolve) => wildcard.close(resolve)); }
    const automatic = await owned({ port: 0 });
    try {
      net.connect({ host: '127.0.0.1', port: automatic.address().port });
      const forwarded = dispatched.at(-1)[0];
      assert.equal((Array.isArray(forwarded) ? forwarded[0] : forwarded).host,
        automatic.address().family === 'IPv6' ? '::1' : '127.0.0.1');
    }
    finally { await new Promise((resolve) => automatic.close(resolve)); }
  `], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
});
