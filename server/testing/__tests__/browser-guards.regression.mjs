import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const guard = new URL('../network-guard.mjs', import.meta.url).href;
test('browser controller permits only the explicit manifest HTTP endpoint', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import net from 'node:net';
    import { installNetworkGuard } from ${JSON.stringify(guard)};
    const calls = [];
    net.Socket.prototype.connect = function (...args) { calls.push(args); return this; };
    const target = { host: '127.0.0.1', port: 55432, server: { origin: 'http://127.0.0.1:5127' } };
    installNetworkGuard({ target, browserOrigin: target.server.origin });
    net.connect({ host: '127.0.0.1', port: 5127 });
    assert.equal(calls.length, 1);
    assert.throws(() => net.connect({ host: '127.0.0.1', port: 5128 }), /TEST NETWORK DENIED/);
    assert.throws(() => net.connect({ host: '::1', port: 5127 }), /TEST NETWORK DENIED/);
    assert.throws(() => net.connect({ host: 'provider.example.invalid', port: 443 }), /TEST NETWORK DENIED/);
    assert.equal(calls.length, 1);
  `], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
});

test('every ordinary browser spec imports the protected worker fixture', () => {
  const directory = new URL('../../../e2e/', import.meta.url);
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.spec.ts'))) {
    const source = readFileSync(new URL(file, directory), 'utf8');
    assert.match(source, /from ["']\.\/protected-test["']/, file);
    assert.doesNotMatch(source, /import \{[^}]*\btest\b[^}]*\} from ["']@playwright\/test["']/, file);
  }
});
