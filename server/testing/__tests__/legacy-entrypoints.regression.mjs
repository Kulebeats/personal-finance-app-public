import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const guard = new URL('../network-guard.mjs', import.meta.url).href;
const preload = `data:text/javascript,${encodeURIComponent(`import { installNetworkGuard } from ${JSON.stringify(guard)}; installNetworkGuard();`)}`;
const legacy = [
  'test-db.ts', 'scripts/tools/test-db.ts', 'scripts/test-db-connection.ts',
  'scripts/tools/test-db-conn.ts', 'scripts/create-test-user.ts',
  'scripts/tools/create-test-user-local.ts', 'server/test-debug.js',
  'server/test-session.js', 'server/test-rollover.ts', 'scripts/verify-audit-fixes.ts',
];

for (const entrypoint of legacy) {
  test(`${entrypoint} refuses direct execution before ambient database access`, () => {
    const env = { ...process.env, DATABASE_URL: 'postgresql://synthetic:fixture-sentinel@127.0.0.1:1/pfa_disabled',
      DOTENV_CONFIG_PATH: fileURLToPath(new URL('../fixtures/empty.env', import.meta.url)) };
    delete env.PFA_TEST_MODE;
    delete env.TEST_TARGET_MANIFEST;
    delete env.TEST_DATABASE_URL;
    const result = spawnSync(process.execPath, ['--import', preload, '--import', 'tsx', entrypoint], {
      cwd: root, env, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DEPRECATED UNSAFE TEST ENTRYPOINT/);
    assert.doesNotMatch(result.stdout + result.stderr, /fixture-sentinel/);
  });
}

test('protected replacement refuses absent mode without exposing credentials', () => {
  const env = { ...process.env, DATABASE_URL: 'fixture-sentinel' };
  delete env.PFA_TEST_MODE;
  const result = spawnSync(process.execPath, ['scripts/protected-test-tool.mjs', 'diagnose'], {
    cwd: root, env, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /REFUSING TEST TARGET/);
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-sentinel/);
});

test('protected replacement refuses unit mode before any database connection', () => {
  const result = spawnSync(process.execPath, ['scripts/protected-test-tool.mjs', 'fixture'], {
    cwd: root, env: { ...process.env, PFA_TEST_MODE: 'unit' }, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /require database mode/);
});

test('Windows API probe is deprecated without invoking curl', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../../../scripts/windows/test-api.bat', import.meta.url), 'utf8');
  assert.match(source, /DEPRECATED UNSAFE TEST ENTRYPOINT/);
  assert.doesNotMatch(source, /\bcurl\b|localhost:5000|cookies\.txt/i);
  assert.match(source, /exit \/b 1/i);
});
