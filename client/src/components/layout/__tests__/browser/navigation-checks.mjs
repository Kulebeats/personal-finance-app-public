import assert from 'node:assert/strict';

export const links = [
  ['Dashboard', '/'], ['Accounts', '/accounts'], ['Transactions', '/transactions'],
  ['Receipts', '/receipts'], ['Cash Flow', '/cash-flow'], ['Reports', '/reports'],
  ['Budget', '/budget'], ['Recurring', '/recurring'], ['Goals', '/goals'],
  ['Investments', '/investments'], ['Advice', '/advice'], ['Settings', '/profile'],
  ['Profile: Ada Lovelace', '/profile'],
];
export const trigger = page => page.getByRole('button', { name: 'Open application navigation' });
export const drawer = page => page.getByRole('dialog', { name: 'Application navigation' });
export async function focusOn(locator) {
  await locator.waitFor({ state: 'visible' });
  const handle = await locator.elementHandle();
  await locator.page().waitForFunction(element => document.activeElement === element, handle);
}
export async function closed(page) { await drawer(page).waitFor({ state: 'hidden' }); }
export async function open(page) {
  await trigger(page).click();
  await drawer(page).waitFor();
  await page.waitForFunction(() => {
    const modal = document.querySelector('[role="dialog"]');
    const box = modal?.getBoundingClientRect();
    return box && box.x >= 0 && box.right <= innerWidth + 1;
  });
  return drawer(page);
}
export async function visibleKeyboardFocus(page, modal) {
  assert.equal(await modal.evaluate(element => element.contains(document.activeElement)), true, 'focus escaped modal');
  const focus = await page.evaluate(() => {
    const active = document.activeElement, box = active.getBoundingClientRect(), style = getComputedStyle(active);
    const center = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { name: active.getAttribute('aria-label') || active.textContent.trim(),
      x: box.x, y: box.y, width: box.width, height: box.height,
      inView: box.x >= -1 && box.y >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1,
      unobscured: center === active || active.contains(center),
      painted: active.matches(':focus-visible') && ((style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none') };
  });
  assert.ok(focus.inView && focus.unobscured && focus.width > 0 && focus.height > 0, `focused control clipped: ${JSON.stringify(focus)}`);
  assert.ok(focus.painted, `keyboard focus has no visible indicator: ${focus.name}`);
  return focus.name;
}

export async function checkGeometry(page, scenario, output) {
  await page.getByRole('heading', { name: '/transactions page', exact: true }).waitFor();
  assert.equal(await page.getByRole('main').count(), 1);
  const geometry = await page.evaluate(() => {
    const main = document.querySelector('main').getBoundingClientRect();
    return { viewport: innerWidth, scroll: document.documentElement.scrollWidth,
      main: { x: main.x, width: main.width, right: main.right } };
  });
  assert.ok(geometry.scroll <= scenario.width + 1, `${scenario.name}: horizontal page clipping`);
  assert.ok(geometry.main.right <= scenario.width + 1, `${scenario.name}: main extends beyond viewport`);
  assert.ok(geometry.main.width >= (scenario.width < 768 ? scenario.width - 1 : scenario.width - 257), `${scenario.name}: rail consumes mobile main width`);
  const headerButtons = await page.locator('header button').evaluateAll(elements => elements
    .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden')
    .map(element => { const box = element.getBoundingClientRect(); return { label: element.getAttribute('aria-label') || element.textContent.trim(), x: box.x, right: box.right, y: box.y, bottom: box.bottom }; })
    .sort((a, b) => a.x - b.x));
  for (let i = 0; i < headerButtons.length; i++) {
    assert.ok(headerButtons[i].x >= -1 && headerButtons[i].right <= scenario.width + 1, `${scenario.name}: clipped header control ${headerButtons[i].label}`);
    for (let j = 0; j < i; j++) {
      const other = headerButtons[j], current = headerButtons[i];
      const sharesRow = current.y < other.bottom - 1 && current.bottom > other.y + 1;
      if (sharesRow) assert.ok(current.x >= other.right - 1, `${scenario.name}: overlapping header controls`);
    }
  }
  if (scenario.width >= 768) {
    assert.equal(await trigger(page).isVisible(), false);
    const navigation = page.getByRole('navigation', { name: 'Application navigation' });
    assert.equal(await navigation.isVisible(), true);
    for (const [name, href] of links.slice(0, -1)) assert.equal(await navigation.getByRole('link', { name, exact: true }).getAttribute('href'), href);
    assert.equal(await page.locator('aside').getByRole('link', { name: 'Profile: Ada Lovelace' }).getAttribute('href'), '/profile');
    return { ...scenario, geometry, headerButtons, desktop: true };
  }

  const triggerBox = await trigger(page).boundingBox();
  assert.ok(triggerBox.width >= 44 && triggerBox.height >= 44, `${scenario.name}: mobile trigger is smaller than44px`);
  await trigger(page).focus(); await page.keyboard.press('Enter');
  const modal = drawer(page); await modal.waitFor();
  await page.waitForFunction(() => document.querySelector('[role="dialog"]').getBoundingClientRect().x >= 0);
  const bounds = await modal.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= scenario.width + 1 && bounds.y + bounds.height <= scenario.height + 1, `${scenario.name}: drawer exceeds viewport`);
  const dimensions = await modal.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth }));
  assert.ok(dimensions.scroll <= dimensions.client + 1, `${scenario.name}: drawer horizontal clipping`);
  assert.equal(await modal.getAttribute('aria-modal'), 'true');
  assert.ok(await modal.getAttribute('aria-describedby'), 'drawer lacks description');
  assert.equal(await modal.getByRole('button', { name: /collapse|expand sidebar/i }).count(), 0);
  assert.equal(await modal.getByRole('link').count(), links.length);
  for (const [name, href] of links) {
    const link = modal.getByRole('link', { name, exact: true });
    assert.equal(await link.getAttribute('href'), href);
    assert.equal(await link.evaluate(element => element.tagName === 'A' && !element.querySelector('button,[role="button"],[tabindex]')), true);
  }
  assert.equal(await modal.getByRole('link', { name: 'Transactions', exact: true }).getAttribute('aria-current'), 'page');
  assert.equal(await modal.locator('a[aria-current="page"]').count(), 1);

  const backgroundScroll = () => page.locator('main').evaluate(main => Array.from(main.querySelectorAll('*'))
    .filter(element => ['auto', 'scroll'].includes(getComputedStyle(element).overflowY))
    .map(element => element.scrollTop));
  const beforeScroll = await backgroundScroll();
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow), 'hidden', 'body scroll is not locked');
  await page.mouse.move(scenario.width - 2, scenario.height - 2); await page.mouse.wheel(0, 500);
  assert.deepEqual(await backgroundScroll(), beforeScroll, 'background main scrolled while modal was open');
  await modal.getByRole('button', { name: /^Close$/ }).focus();
  const visited = [];
  for (let index = 0; index < links.length + 1; index++) {
    await page.keyboard.press('Tab'); visited.push(await visibleKeyboardFocus(page, modal));
  }
  for (const [name] of links) assert.ok(visited.includes(name), `${scenario.name}: keyboard cannot reach ${name}`);
  for (let index = 0; index < links.length + 1; index++) {
    await page.keyboard.press('Shift+Tab'); await visibleKeyboardFocus(page, modal);
  }
  if (scenario.width === 320 || scenario.height === 320) await page.screenshot({ path: `${output}/${scenario.name}-drawer.png` });
  await page.keyboard.press('Escape'); await closed(page); await focusOn(trigger(page));
  await open(page); await modal.getByRole('button', { name: /^Close$/ }).click();
  await closed(page); await focusOn(trigger(page));
  await open(page); await page.mouse.click(scenario.width - 2, scenario.height - 2);
  await closed(page); await focusOn(trigger(page));
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow === 'hidden'), false, 'body remains locked after close');
  return { ...scenario, geometry, headerButtons, triggerBox, drawer: bounds, dimensions, keyboardVisited: visited,
    escapeReturn: true, closeReturn: true, outsideReturn: true, scrollLock: true };
}
