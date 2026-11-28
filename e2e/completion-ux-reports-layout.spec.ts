/**
 * UX misc: the Reports page fits a 1280px-wide desktop window. No tab may make
 * the page scroll sideways: a chart, table or card wider than the content
 * column pushes the whole layout past the viewport.
 *
 * UX-02 (R18.1): the same holds on a phone at 320, 360, 375, 390 and 768 px.
 *
 * Matched by the completion config's pattern (completion-*.spec.ts), so it
 * runs in the CI e2e gate: 1280 px on the chromium project, and the
 * `@phone-only` widths on the phone project.
 */
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "./protected-test";
import { createCompletionFixture, type CompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { signInAs } from "./utils/fixture-session";

const DESKTOP = { width: 1280, height: 800 };
/** R18.1 phone widths (FINAL_COMPLETION_SPEC.md, R18); the phone project's height. */
const PHONE_WIDTHS = [320, 360, 375, 390, 768] as const;
const PHONE_HEIGHT_PX = 812;
/** Subpixel rounding can leave scrollWidth one pixel over; anything more is real overflow. */
const ROUNDING_PX = 1;
const FIRST_LOAD_MS = 60_000;
const TABS = ["Annual Dashboard", "Cash Flow", "Spending", "Merchants", "Income", "Net Worth", "Savings"];

/** A household with an account, an expense and an income this month, so the charts have data. */
async function householdWithActivity(): Promise<CompletionFixture> {
  const fixture = await createCompletionFixture();
  const accountId = randomUUID();
  await withFixtureClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query("INSERT INTO accounts (id, household_id, name, type, balance, currency, is_private) VALUES ($1, $2, 'Synthetic reports account', 'checking', 1000, 'ZMW', false)",
        [accountId, fixture.householdId]);
      await client.query(`INSERT INTO transactions (household_id, account_id, category_id, owner_user_id, name, amount, currency, type, date)
        VALUES ($1, $2, $3, $4, 'Synthetic groceries', 120.00, 'ZMW', 'expense', current_date)`,
      [fixture.householdId, accountId, fixture.expenseCategoryId, fixture.userId]);
      await client.query(`INSERT INTO transactions (household_id, account_id, owner_user_id, name, amount, currency, type, date)
        VALUES ($1, $2, $3, 'Synthetic salary', 900.00, 'ZMW', 'income', current_date)`,
      [fixture.householdId, accountId, fixture.userId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  });
  return fixture;
}

interface Overflow { hasShell: boolean; pagePx: number; shellPx: number; widest: string }

/**
 * How far the page, and the app shell's content scroller, are wider than they
 * show, plus the widest element sticking out (for the failure message). The
 * shell root hides overflow, so `document.scrollWidth` alone never exceeds the
 * window: content that is too wide scrolls inside `[data-main-scroll]` instead.
 */
function horizontalOverflow(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const shell = document.querySelector<HTMLElement>("[data-main-scroll]");
    const edge = shell ? shell.getBoundingClientRect().right : root.clientWidth;
    let widest = "";
    let right = edge;
    for (const element of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const box = element.getBoundingClientRect();
      if (box.right > right) {
        right = box.right;
        widest = `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}.${element.className}`.slice(0, 160);
      }
    }
    return {
      hasShell: shell !== null,
      pagePx: root.scrollWidth - root.clientWidth,
      shellPx: shell ? shell.scrollWidth - shell.clientWidth : 0,
      widest,
    };
  });
}

/** Opens Reports for a new household at `viewport` and checks that no tab scrolls sideways. */
async function checkEveryTab(page: Page, viewport: { width: number; height: number }) {
  // The annual dashboard is the heaviest bundle; its first paint can be slow on a cold server.
  test.setTimeout(FIRST_LOAD_MS * 2);
  await page.setViewportSize(viewport);
  await signInAs(page, await householdWithActivity());
  await page.goto("/reports");
  // A new household has not finished widget setup, so the one-time onboarding dialog opens. It is
  // modal: until it closes the page behind it is hidden from the accessibility tree, heading included.
  const onboarding = page.getByRole("dialog", { name: /welcome to your reports dashboard/i });
  await expect(onboarding).toBeVisible({ timeout: FIRST_LOAD_MS });
  await onboarding.getByRole("button", { name: /skip for now/i }).click();
  await expect(onboarding).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
  expect(await page.evaluate(() => window.innerWidth), "the viewport is the width under test").toBe(viewport.width);

  for (const label of TABS) {
    const tab = page.getByRole("button", { name: `${label} report tab`, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-current", "page");
    await page.waitForLoadState("networkidle");
    const { hasShell, pagePx, shellPx, widest } = await horizontalOverflow(page);
    // Without the shell marker the content check below would pass vacuously.
    expect(hasShell, "the app shell's content scroller [data-main-scroll] is on the page").toBe(true);
    const where = `${viewport.width}px ${label}`;
    expect.soft(pagePx, `${where}: the page is ${pagePx}px wider than the window (widest: ${widest})`)
      .toBeLessThanOrEqual(ROUNDING_PX);
    expect.soft(shellPx, `${where}: the content area scrolls ${shellPx}px sideways (widest: ${widest})`)
      .toBeLessThanOrEqual(ROUNDING_PX);
  }
}

test("every Reports tab fits a 1280px window without scrolling sideways", async ({ page }) => {
  await checkEveryTab(page, DESKTOP);
});

// UX-02 / R18.1: the same check on the phone project (touch, mobile user agent) at every phone width.
for (const width of PHONE_WIDTHS) {
  test(`every Reports tab fits a ${width}px phone screen without scrolling sideways @phone-only`, async ({ page }) => {
    await checkEveryTab(page, { width, height: PHONE_HEIGHT_PX });
  });
}
