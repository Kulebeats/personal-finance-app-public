import assert from 'node:assert/strict';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { chromium } from 'playwright';

// Run through run-protected-tests.mjs unit tsx. This serves only this component
// fixture, with no ordinary Vite/app entry, environment file, server or DB import.
const fixtureRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(fixtureRoot, '../../../../../..');
assert.equal(process.cwd().toLowerCase(), root.toLowerCase());
assert.equal(process.env.PFA_TEST_MODE, 'unit');
const output = path.join(root, '.local/r18-settings-oct29', `browser-${randomUUID()}`);
await mkdir(output, { recursive: false });
let server, browser, context, timer;
const result = { kind: 'settings-layout-component-browser', actualApplication: false, database: false,
  actualBrowserZoom: false, zoomScope: '160px/DPR2 and384px/DPR2 layout proxies only; actual200%browser zoom remains pending',
  startedAt: new Date().toISOString(), scenarios: [], errors: [], forbiddenRequests: [] };
try {
  timer = setTimeout(() => { void context?.close(); void browser?.close(); void server?.close(); }, 120000);
  server = await createServer({ configFile: false, envFile: false, root: fixtureRoot, publicDir: false,
    plugins: [react(), tailwindcss()], logLevel: 'error',
    resolve: { alias: [
      { find: '@/components/Layout', replacement: path.join(fixtureRoot, 'Layout.fixture.tsx') },
      { find: '@/lib/api', replacement: path.join(fixtureRoot, 'api.fixture.ts') },
      { find: '@', replacement: path.join(root, 'client/src') },
    ] },
    server: { host: '127.0.0.1', port: 0, hmr: false, fs: { strict: true, allow: [root], deny: ['**/.env*', '**/.git/**'] } },
  });
  await server.listen();
  const address = server.httpServer.address(); assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`; result.origin = origin;
  const executable = chromium.executablePath(), executableBytes = await readFile(executable);
  result.browserExecutable = { path: executable, size: (await stat(executable)).size, sha256: createHash('sha256').update(executableBytes).digest('hex') };
  browser = await chromium.launch({ headless: true }); result.browserVersion = browser.version();
  const cdp = await browser.newBrowserCDPSession();
  result.browserPids = (await cdp.send('SystemInfo.getProcessInfo')).processInfo.map(value => value.id);
  for (const scenario of [
    ...[320, 360, 375, 390, 768].map(width => ({ name: `width-${width}`, width, height: 640, scale: 1 })),
    { name: 'short-height', width: 375, height: 320, scale: 1 },
    { name: '200%-proxy-320', width: 160, height: 320, scale: 2 },
    { name: '200%-proxy-768', width: 384, height: 320, scale: 2 },
  ]) {
    context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height }, deviceScaleFactor: scenario.scale, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || url.pathname.startsWith('/api/')) { result.forbiddenRequests.push(url.href); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => result.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()); });
    await page.goto(`${origin}/fixture.html`); await page.waitForLoadState('networkidle');
    const trigger = page.getByRole('button', { name: 'Open settings menu' });
    await page.getByRole('heading', { name: 'Profile settings form' }).waitFor();
    assert.equal(await page.getByRole('main').count(), 1);
    const pageWidth = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(pageWidth.scroll <= pageWidth.viewport + 1, `${scenario.name}: page horizontal clipping`);
    if (scenario.width >= 768) {
      assert.equal(await trigger.isVisible(), false);
      await page.getByRole('navigation', { name: 'Settings navigation' }).waitFor();
      result.scenarios.push({ ...scenario, pageWidth, desktop: true });
    } else {
      const triggerBox = await trigger.boundingBox(), headerBox = await page.locator('[data-fixture-header]').boundingBox();
      assert.ok(triggerBox && headerBox && triggerBox.y >= headerBox.y + headerBox.height, `${scenario.name}: trigger overlaps app header`);
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: 'Settings navigation' }); await dialog.waitFor();
      await page.waitForFunction(width => {
        const element = document.querySelector('[role="dialog"]');
        if (!element) return false;
        const box = element.getBoundingClientRect();
        return box.x >= 0 && box.right <= width + 1;
      }, scenario.width);
      const box = await dialog.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= scenario.width + 1, `${scenario.name}: drawer exceeds viewport`);
      const widths = await dialog.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth }));
      assert.ok(widths.scroll <= widths.client + 1, `${scenario.name}: drawer horizontal clipping`);
      assert.equal(await dialog.getByRole('button', { name: /^Navigate to .* settings$/ }).count(), 10);
      assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
      const visited = [];
      for (let index = 0; index < 12; index++) {
        await page.keyboard.press('Tab');
        visited.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim()));
        assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
      }
      assert.ok(visited.includes('Navigate to Weekly Recap settings') && visited.includes('Logout'), `${scenario.name}: keyboard cannot reach final controls`);
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Open settings menu');
      await trigger.click();
      await dialog.getByRole('button', { name: 'Navigate to Display settings' }).click(); await dialog.waitFor({ state: 'hidden' });
      await page.getByRole('heading', { name: 'Display settings form' }).waitFor();
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Open settings menu');
      result.scenarios.push({ ...scenario, pageWidth, drawer: box, drawerWidths: widths, keyboardVisited: visited });
      if (scenario.name === 'width-320') await page.screenshot({ path: path.join(output, '320-selection.png') });
    }
    await context.close(); context = undefined;
  }
  context = await browser.newContext({ viewport: { width: 375, height: 640 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage(); await page.goto(`${origin}/fixture.html`); await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Open settings menu' }).click(); await page.setViewportSize({ width: 768, height: 640 });
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const desktopActive = page.getByRole('navigation', { name: 'Settings navigation' }).getByRole('button', { name: 'Navigate to Profile settings' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Navigate to Profile settings');
  result.breakpointFocus = true;
  await page.setViewportSize({ width: 375, height: 640 });
  const rapidPage = await context.newPage(); await rapidPage.goto(`${origin}/fixture.html`); await rapidPage.waitForLoadState('networkidle');
  await rapidPage.addStyleTag({ content: '[role="dialog"][data-state="closed"] { animation-duration: 600ms !important; }' });
  await rapidPage.getByRole('button', { name: 'Open settings menu' }).click();
  await rapidPage.getByRole('dialog').waitFor();
  await rapidPage.setViewportSize({ width: 768, height: 640 });
  await rapidPage.waitForFunction(() => document.querySelector('[role="dialog"]')?.getAttribute('data-state') === 'closed');
  await rapidPage.setViewportSize({ width: 375, height: 640 });
  await rapidPage.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Open settings menu');
  assert.equal(await rapidPage.getByRole('button', { name: 'Open settings menu' }).isVisible(), true);
  result.rapidBreakpointFocus = true;
  result.dismissThenDesktopFocus = [];
  for (const dismissal of ['Escape', 'selection', 'Close']) {
    const dismissPage = await context.newPage(); await dismissPage.goto(`${origin}/fixture.html`); await dismissPage.waitForLoadState('networkidle');
    await dismissPage.addStyleTag({ content: '[role="dialog"][data-state="closed"] { animation-duration: 600ms !important; }' });
    await dismissPage.getByRole('button', { name: 'Open settings menu' }).click();
    const closingDialog = dismissPage.getByRole('dialog'); await closingDialog.waitFor();
    if (dismissal === 'Escape') await dismissPage.keyboard.press('Escape');
    else if (dismissal === 'selection') await closingDialog.getByRole('button', { name: 'Navigate to Display settings' }).click();
    else await closingDialog.getByRole('button', { name: /^Close$/ }).click();
    await dismissPage.waitForFunction(() => document.querySelector('[role="dialog"]')?.getAttribute('data-state') === 'closed');
    await dismissPage.setViewportSize({ width: 768, height: 640 });
    const activeLabel = dismissal === 'selection' ? 'Navigate to Display settings' : 'Navigate to Profile settings';
    await dismissPage.waitForFunction(label => document.activeElement?.getAttribute('aria-label') === label, activeLabel);
    assert.equal(await dismissPage.getByRole('button', { name: 'Open settings menu' }).isVisible(), false);
    result.dismissThenDesktopFocus.push(dismissal);
    await dismissPage.close();
  }
  assert.deepEqual(result.errors, []); assert.deepEqual(result.forbiddenRequests, []);
  result.passed = true;
} catch (error) {
  result.passed = false; result.failure = String(error?.stack ?? error); throw error;
} finally {
  clearTimeout(timer);
  await context?.close(); await browser?.close(); await server?.close();
  result.browserDisconnected = !browser?.isConnected(); result.endedAt = new Date().toISOString();
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ output, passed: result.passed, scenarios: result.scenarios.length, browserDisconnected: result.browserDisconnected }));
}
