import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { componentServerConfig } from './browser-config.mjs';
import { checkGeometry } from './navigation-checks.mjs';
import { checkFocusScenarios, checkNavigationDuringExit } from './navigation-focus.mjs';

// Parent executes through run-protected-tests.mjs unit tsx. Only this fixture is
// served: no normal app entry, .env, session, application server, API or database.
const fixtureRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(fixtureRoot, '../../../../../..');
assert.equal(process.cwd().toLowerCase(), root.toLowerCase());
assert.equal(process.env.PFA_TEST_MODE, 'unit');
const output = path.join(root, '.local/r18-app-navigation', `browser-${randomUUID()}`);
await mkdir(output, { recursive: false });
let server, browser, timer;
const exitRouteOnly = process.argv.includes('--exit-route-only');
const result = { kind: 'application-navigation-component-browser', actualApplication: false, database: false,
  scenarioSelection: exitRouteOnly ? 'exit-route-only' : 'complete',
  actualBrowserZoom: false, actualPhone: false, actualShell: true, actualTopBarControls: true,
  actualSettingsLayout: true, actualSheet: true, effectfulData: 'inert hooks and API; no app session or financial data',
  startedAt: new Date().toISOString(), scenarios: [], focus: [], errors: [], forbiddenRequests: [] };
try {
  timer = setTimeout(() => { void browser?.close(); void server?.close(); }, 180000);
  server = await createServer(componentServerConfig(root, fixtureRoot));
  await server.listen();
  const address = server.httpServer.address(); assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`; result.origin = origin;
  const executable = process.env.PFA_COMPONENT_BROWSER_EXECUTABLE || chromium.executablePath();
  result.browserExecutable = { path: executable, size: (await stat(executable)).size,
    sha256: createHash('sha256').update(await readFile(executable)).digest('hex') };
  browser = await chromium.launch({ headless: true, executablePath: executable }); result.browserVersion = browser.version();
  const cdp = await browser.newBrowserCDPSession();
  result.browserPids = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.map(value => value.id);

  const withPage = async ({ width = 375, height = 640, search = '' }, check) => {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    try {
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin || url.pathname.startsWith('/api/')) {
          result.forbiddenRequests.push(url.href); return route.abort();
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(7000);
      page.on('pageerror', error => result.errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()); });
      await page.goto(`${origin}/transactions${search}`, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: '/transactions page', exact: true }).waitFor();
      await check(page);
    } catch (error) {
      for (const [index, page] of context.pages().entries()) {
        const basename = `failure-${result.scenarios.length}-${result.focus.length}-${index}`;
        await page.screenshot({ path: path.join(output, `${basename}.png`), fullPage: true }).catch(() => {});
        await writeFile(path.join(output, `${basename}.html`), await page.content()).catch(() => {});
        const focus = await page.evaluate(() => {
          const element = document.activeElement;
          return { pathname: location.pathname, viewport: { width: innerWidth, height: innerHeight },
            activeElement: element?.outerHTML ?? null, bodyStyle: document.body.getAttribute('style'),
            dialogStates: Array.from(document.querySelectorAll('[role="dialog"]')).map(dialog => ({
              state: dialog.getAttribute('data-state'), display: getComputedStyle(dialog).display,
            })) };
        }).catch(error => ({ diagnosticError: String(error) }));
        await writeFile(path.join(output, `${basename}-focus.json`), JSON.stringify(focus, null, 2));
      }
      throw error;
    } finally { await context.close(); }
  };

  for (const scenario of exitRouteOnly ? [] : [
    ...[320, 360, 375, 390, 767, 768, 1280].map(width => ({ name: `width-${width}`, width, height: 640 })),
    { name: 'short-height', width: 375, height: 320 },
  ]) {
    await withPage(scenario, async page => result.scenarios.push(await checkGeometry(page, scenario, output)));
  }
  if (!exitRouteOnly) await checkFocusScenarios(withPage, result);
  await checkNavigationDuringExit(withPage, result);
  assert.deepEqual(result.errors, [], 'fixture produced browser errors');
  assert.deepEqual(result.forbiddenRequests, [], 'fixture attempted forbidden network requests');
  result.passed = true;
} catch (error) {
  result.passed = false; result.failure = String(error?.stack ?? error); throw error;
} finally {
  clearTimeout(timer);
  await browser?.close(); await server?.close();
  result.browserDisconnected = !browser?.isConnected(); result.endedAt = new Date().toISOString();
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ output, passed: result.passed, geometry: result.scenarios.length,
    focus: result.focus.length, browserDisconnected: result.browserDisconnected }));
}
