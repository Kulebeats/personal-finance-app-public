import assert from 'node:assert/strict';
import { closed, drawer, focusOn, open, trigger } from './navigation-checks.mjs';

const desktopLink = (page, name = 'Transactions') => page.getByRole('navigation', { name: 'Application navigation' }).getByRole('link', { name, exact: true });
const preference = page => page.locator('[data-fixture-preference]').evaluate(element => ({
  collapsed: element.getAttribute('data-collapsed'), toggles: element.getAttribute('data-toggle-count'),
}));
const retainExitAnimation = page => page.addStyleTag({ content: '@keyframes fixture-close { from { opacity: 1; } to { opacity: 0; } } [role="dialog"][data-state="closed"] { animation: fixture-close 500ms linear !important; }' });

export async function checkNavigationDuringExit(withPage, result) {
  for (const dismissal of ['Escape', 'Close', 'same-route selection']) {
    await withPage({ search: '?delayed=1' }, async page => {
      await retainExitAnimation(page); await open(page);
      if (dismissal === 'Escape') await page.keyboard.press('Escape');
      else if (dismissal === 'Close') await drawer(page).getByRole('button', { name: /^Close$/ }).click();
      else await drawer(page).getByRole('link', { name: 'Transactions', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.getAttribute('data-state') === 'closed');
      await page.evaluate(() => window.r18Fixture.navigate('/accounts'));
      await page.getByRole('status').filter({ hasText: 'Loading destination' }).waitFor();
      await page.waitForFunction(() => !document.querySelector('[role="dialog"]') &&
        getComputedStyle(document.body).overflow !== 'hidden' && getComputedStyle(document.body).pointerEvents !== 'none');
      await page.evaluate(() => window.r18Fixture.resolveDestination());
      await page.locator('[data-fixture-route="/accounts"]').waitFor();
      await focusOn(page.getByRole('main'));
      result.focus.push(`cold lazy external navigation during ${dismissal} exit releases portal and focuses destination`);
    });
  }
}

export async function checkFocusScenarios(withPage, result) {
  await withPage({}, async page => {
    const initial = await preference(page);
    const mount = await page.locator('[data-fixture-route]').getAttribute('data-fixture-mount');
    await open(page);
    await drawer(page).getByRole('link', { name: 'Transactions', exact: true }).focus();
    await page.keyboard.press('Enter'); await closed(page); await focusOn(trigger(page));
    assert.equal(await page.locator('[data-fixture-route]').getAttribute('data-fixture-mount'), mount, 'same-route navigation remounted page');
    await open(page); await drawer(page).getByRole('link', { name: 'Accounts', exact: true }).click();
    await closed(page); await page.locator('[data-fixture-route="/accounts"]').waitFor();
    assert.notEqual(await page.locator('[data-fixture-route]').getAttribute('data-fixture-mount'), mount, 'cross-route fixture did not remount');
    await focusOn(page.getByRole('main'));
    assert.deepEqual(await preference(page), initial, 'mobile actions changed desktop preference');
    await open(page); await page.evaluate(() => window.r18Fixture.navigate('/goals'));
    await closed(page); await page.locator('[data-fixture-route="/goals"]').waitFor();
    await focusOn(page.getByRole('main'));
    result.focus.push('same-route Enter; cross-route remount; independent route change; destination main; unchanged preference');
  });

  for (const collapsed of [false, true]) {
    await withPage({ width: 1280, search: collapsed ? '?collapsed=1' : '' }, async page => {
      const before = await preference(page);
      const rail = page.locator('aside').filter({ has: page.getByRole('navigation', { name: 'Application navigation' }) });
      const initialWidth = (await rail.boundingBox()).width;
      assert.equal(initialWidth, collapsed ? 64 : 256);
      await page.setViewportSize({ width: 375, height: 640 });
      await open(page); await page.keyboard.press('Escape'); await closed(page); await focusOn(trigger(page));
      await page.setViewportSize({ width: 1280, height: 640 });
      await focusOn(desktopLink(page));
      assert.deepEqual(await preference(page), before);
      assert.equal((await rail.boundingBox()).width, initialWidth);
      result.focus.push(`desktop preference survives mobile open/close: collapsed=${collapsed}`);
    });
  }

  await withPage({}, async page => {
    await open(page); await page.setViewportSize({ width: 768, height: 640 });
    await closed(page); await focusOn(desktopLink(page));
    await page.setViewportSize({ width: 767, height: 640 }); await focusOn(trigger(page));
    await page.setViewportSize({ width: 768, height: 640 }); await focusOn(desktopLink(page));
    await page.getByRole('button', { name: 'Main action', exact: true }).focus();
    await page.setViewportSize({ width: 375, height: 640 });
    await focusOn(page.getByRole('button', { name: 'Main action', exact: true }));
    await page.setViewportSize({ width: 768, height: 640 });
    await focusOn(page.getByRole('button', { name: 'Main action', exact: true }));
    result.focus.push('open breakpoint closure; closed rail/trigger focus transfer; main focus preserved');
  });

  for (const initialWidth of [375, 1280]) {
    await withPage({ width: initialWidth }, async page => {
      await (initialWidth < 768 ? trigger(page) : desktopLink(page)).focus();
      await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); });
      await focusOn(page.locator('body'));
      await page.setViewportSize({ width: initialWidth < 768 ? 1280 : 375, height: 640 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await focusOn(page.locator('body'));
      result.focus.push(`intentional body focus is preserved across breakpoint from ${initialWidth}px`);
    });
  }

  await withPage({}, async page => {
    await retainExitAnimation(page); await open(page);
    await page.setViewportSize({ width: 768, height: 640 });
    await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.getAttribute('data-state') === 'closed');
    await page.setViewportSize({ width: 375, height: 640 });
    await closed(page); await focusOn(trigger(page));
    result.focus.push('open mobile-desktop-mobile reversal rechecks breakpoint at close');
  });

  for (const dismissal of ['Escape', 'Close', 'same-route selection']) {
    await withPage({}, async page => {
      await retainExitAnimation(page); await open(page);
      if (dismissal === 'Escape') await page.keyboard.press('Escape');
      else if (dismissal === 'Close') await drawer(page).getByRole('button', { name: /^Close$/ }).click();
      else await drawer(page).getByRole('link', { name: 'Transactions', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.getAttribute('data-state') === 'closed');
      await page.setViewportSize({ width: 768, height: 640 });
      await closed(page); await focusOn(desktopLink(page));
      assert.equal(await trigger(page).isVisible(), false);
      result.focus.push(`dismissal then desktop during exit: ${dismissal}`);
    });
  }

  for (const navigation of ['selection', 'external']) for (const intentionalFocus of [false, true]) {
    await withPage({ search: `?delayed=1&focusChild=${Number(intentionalFocus)}` }, async page => {
      await open(page);
      if (navigation === 'selection') await drawer(page).getByRole('link', { name: 'Accounts', exact: true }).click();
      else await page.evaluate(() => window.r18Fixture.navigate('/accounts'));
      await page.getByRole('status').filter({ hasText: 'Loading destination' }).waitFor();
      // Keep the lazy import unresolved until the real Sheet exit has finished.
      // A hidden suspended source portal must not keep its trap/lock or hide loading.
      await page.waitForFunction(() => !document.querySelector('[role="dialog"]') &&
        getComputedStyle(document.body).overflow !== 'hidden' && getComputedStyle(document.body).pointerEvents !== 'none');
      assert.equal(await page.getByRole('main').count(), 0);
      assert.equal(await page.getByRole('status').evaluate(element => Boolean(element.closest('[aria-hidden="true"]'))), false);
      await page.evaluate(() => window.r18Fixture.resolveDestination());
      await page.locator('[data-fixture-route="/accounts"]').waitFor();
      await focusOn(intentionalFocus ? page.getByRole('button', { name: 'Main action', exact: true }) : page.getByRole('main'));
      result.focus.push(`delayed lazy route releases source modal and preserves destination focus: ${navigation}, child=${intentionalFocus}`);
    });
  }

  await withPage({ search: '?delayed=1' }, async page => {
    await open(page); await drawer(page).getByRole('link', { name: 'Accounts', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Loading destination' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    await page.goBack();
    await page.getByRole('heading', { name: '/transactions page', exact: true }).waitFor();
    const action = page.getByRole('button', { name: 'Main action', exact: true });
    await action.focus();
    await page.evaluate(async () => {
      window.r18Fixture.resolveDestination();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await focusOn(action);
    assert.equal(new URL(page.url()).pathname, '/transactions');
    assert.equal(await drawer(page).count(), 0);
    result.focus.push('browser Back cancels delayed destination handoff and preserves current main action');
  });

  await withPage({}, async page => {
    await page.getByRole('button', { name: 'Main action', exact: true }).focus();
    await page.evaluate(() => window.r18Fixture.navigate('/goals'));
    await page.locator('[data-fixture-route="/goals"]').waitFor();
    assert.equal(await page.getByRole('main').evaluate(element => element === document.activeElement), false, 'unrelated navigation stole focus into main');
    result.focus.push('unrelated remount has no pending navigation focus request');
  });

  await withPage({}, async page => {
    await open(page); await drawer(page).getByRole('link', { name: 'Settings', exact: true }).click();
    await closed(page); await page.getByRole('heading', { name: 'Profile settings form' }).waitFor();
    await focusOn(page.getByRole('main'));
    const innerTrigger = page.getByRole('button', { name: 'Open settings menu' });
    await innerTrigger.click();
    const settings = page.getByRole('dialog', { name: 'Settings navigation' }); await settings.waitFor();
    assert.equal(await page.getByRole('dialog').count(), 1);
    await settings.getByRole('button', { name: 'Navigate to Display settings' }).click();
    await settings.waitFor({ state: 'hidden' }); await focusOn(innerTrigger);
    await page.getByRole('heading', { name: 'Display settings form' }).waitFor();
    await open(page); assert.equal(await page.getByRole('dialog').count(), 1);
    await page.keyboard.press('Escape'); await closed(page); await focusOn(trigger(page));
    await innerTrigger.click(); await settings.waitFor();
    await page.keyboard.press('Escape'); await settings.waitFor({ state: 'hidden' }); await focusOn(innerTrigger);
    await page.getByRole('heading', { name: 'Display settings form' }).waitFor();
    assert.equal(await page.getByRole('main').count(), 1);
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow === 'hidden'), false);
    result.focus.push('sequential outer and inner Settings drawers; one modal; independent focus return and section state');
  });
}
