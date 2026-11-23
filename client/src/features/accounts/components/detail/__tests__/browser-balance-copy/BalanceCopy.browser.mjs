import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

const fixture = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(fixture, '../../../../../../../..');
assert.equal(process.cwd().toLowerCase(), root.toLowerCase());
assert.equal(process.env.PFA_TEST_MODE, 'unit');
const output = path.join(root, '.local/r18-balance-copy', `browser-${randomUUID()}`);
await mkdir(output, { recursive: true });
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const result = { kind: 'actual-header-native-clipboard', root, actualApplication: false, database: false,
  data: 'synthetic authorized-export boundary; actual header/hook/menu and unmodified browser clipboard',
  startedAt: new Date().toISOString(), scenarios: [], errors: [], forbidden: [] };
let server, browser, timer;
try {
  timer = setTimeout(() => { result.timedOut = true; void Promise.allSettled([browser?.close(), server?.close()]); }, 90000);
  const sources = ['client/src/features/accounts/components/detail/AccountDetailHeader.tsx',
    'client/src/features/accounts/components/detail/useCopyBalanceHistory.ts', 'client/src/lib/operation-lifetime.ts',
    'client/src/components/ui/dropdown-menu.tsx',
    ...(await readdir(fixture)).map(name => path.relative(root, path.join(fixture, name)))];
  result.sources = await Promise.all(sources.map(async file => ({ path: file, sha256: await hash(path.join(root, file)) })));
  result.node = { version: process.version, path: process.execPath, sha256: await hash(process.execPath) };
  const inert = path.join(fixture, 'data.fixture.ts');
  server = await createServer({ configFile: false, envFile: false, root: fixture, publicDir: false, logLevel: 'error', plugins: [react()],
    resolve: { alias: [
      ...[/^@\/lib\/api$/, /^@\/hooks$/, /^@\/hooks\/use-toast$/].map(find => ({ find, replacement: inert })),
      { find: /^@\/components\/accounts$/, replacement: path.join(root, 'client/src/components/accounts/TimeRangeSelector.tsx') },
      { find: '@', replacement: path.join(root, 'client/src') }, { find: '@shared', replacement: path.join(root, 'shared') },
    ] }, server: { host: '127.0.0.1', port: 0, hmr: false, fs: { strict: true, allow: [root], deny: ['**/.env*', '**/.git/**'] } } });
  await server.listen();
  const address = server.httpServer.address(); assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`; result.origin = origin;
  const executable = process.env.PFA_COMPONENT_BROWSER_EXECUTABLE;
  assert.ok(executable && path.isAbsolute(executable));
  result.browserExecutable = { path: executable, sha256: await hash(executable) };
  browser = await chromium.launch({ executablePath: executable, headless: true });
  result.browserVersion = browser.version();
  const cdp = await browser.newBrowserCDPSession();
  result.browserPids = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.map(value => value.id);
  for (const scenario of ['native-write-readback', 'export-error-retry', 'pending-session-retirement']) {
    const record = { name: scenario, passed: false }; result.scenarios.push(record);
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], serviceWorkers: 'block' });
    try {
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin || /^\/api(?:\/|$)/.test(url.pathname)) { result.forbidden.push(url.href); return route.abort(); }
        return route.continue();
      });
      const page = await context.newPage(); page.setDefaultTimeout(7000);
      page.on('pageerror', error => result.errors.push(error.message));
      page.on('console', message => { if (['error', 'warning'].includes(message.type())) result.errors.push(message.text()); });
      await page.goto(origin, { waitUntil: 'networkidle' });
      const clickCopy = async () => {
        await page.getByRole('button', { name: 'Edit', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Copy balance history', exact: true }).click();
      };
      await page.evaluate(() => navigator.clipboard.writeText('synthetic-sentinel'));
      if (scenario === 'export-error-retry') {
        await page.evaluate(() => { window.copyFixture.state.fail = true; });
        await clickCopy();
        await page.getByLabel('Copy outcome').filter({ hasText: 'Copy failed' }).waitFor();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'synthetic-sentinel');
        await page.evaluate(() => { window.copyFixture.state.fail = false; });
      }
      if (scenario === 'pending-session-retirement') await page.evaluate(() => { window.copyFixture.state.hold = true; });
      await clickCopy();
      if (scenario === 'pending-session-retirement') {
        await page.waitForFunction(() => !!window.copyFixture.state.release);
        await page.getByRole('button', { name: 'Edit', exact: true }).click();
        assert.equal(await page.getByRole('menuitem', { name: 'Copy balance history', exact: true }).getAttribute('aria-disabled'), 'true');
        await page.evaluate(() => { window.copyFixture.retire(); window.copyFixture.state.release(); });
        await page.waitForFunction(() => document.querySelector('[role="menuitem"][aria-disabled="true"]') === null);
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'synthetic-sentinel');
        assert.equal(await page.getByLabel('Copy outcome').textContent(), '');
      } else {
        await page.getByLabel('Copy outcome').filter({ hasText: 'Balance history copied' }).waitFor();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'date,balance,currency\r\n2026-10-29,123.45,ZMW\r\n');
      }
      record.exports = await page.evaluate(() => window.copyFixture.state.exports);
      assert.equal(record.exports, scenario === 'export-error-retry' ? 2 : 1);
      record.passed = true;
    } finally { await context.close(); }
  }
  assert.deepEqual(result.errors, []); assert.deepEqual(result.forbidden, []); assert.notEqual(result.timedOut, true);
  result.passed = true;
} catch (error) { result.passed = false; result.failure = String(error?.stack ?? error); process.exitCode = 1; }
finally {
  clearTimeout(timer);
  result.cleanup = await Promise.allSettled([browser?.close(), server?.close()]);
  result.browserDisconnected = !browser?.isConnected(); result.serverClosed = !server?.httpServer?.listening;
  if (!result.browserDisconnected || !result.serverClosed || result.cleanup.some(value => value.status === 'rejected')) { result.passed = false; process.exitCode = 1; }
  result.endedAt = new Date().toISOString();
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ output, passed: result.passed, scenarios: result.scenarios, failure: result.failure, browserDisconnected: result.browserDisconnected, serverClosed: result.serverClosed }));
}
