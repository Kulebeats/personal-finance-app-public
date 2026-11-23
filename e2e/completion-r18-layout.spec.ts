/**
 * R18 layout and control inventory (UX-02, NEW-37 labelling, UX misc).
 *
 * Phone (375 x 812, project `phone`, tag @phone-only), on Dashboard, Transactions,
 * the Add Transaction dialog, Accounts, Budget, Reports and Settings:
 * - the page never scrolls sideways (`scrollWidth <= innerWidth`);
 * - no visible control is clipped past the screen edge (the app shell hides
 *   overflow, so scrollWidth alone would miss a cut-off button);
 * - every visible control is at least 44 x 44 px;
 * - every visible control has an accessible name.
 *
 * Desktop (1280 px, project `chromium`): Reports and its tabs never scroll
 * sideways (UX misc), and the same control-name inventory holds.
 *
 * The household is populated through SQL with an account, an expense and a
 * transfer pair, so the populated layouts are measured, not just empty states.
 */
import { randomUUID } from "node:crypto";
import type { Locator } from "@playwright/test";
import { test, expect, type Page } from "./protected-test";
import { createCompletionFixture, type CompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { signInAs } from "./utils/fixture-session";

const MIN_TARGET_PX = 44;

/** Each page's own "ready" control; not every page's h1 is its name (Budget's is the period). */
const PHONE_PAGES: { path: string; ready: (page: Page) => Locator }[] = [
  { path: "/", ready: (page) => page.getByRole("heading", { name: "Dashboard", level: 1 }) },
  { path: "/transactions", ready: (page) => page.getByRole("heading", { name: "Transactions", level: 1 }) },
  { path: "/accounts", ready: (page) => page.getByRole("button", { name: "Add a new account", exact: true }) },
  { path: "/budget", ready: (page) => page.getByRole("button", { name: "Budget", exact: true }) },
  { path: "/reports", ready: (page) => page.getByRole("heading", { name: "Reports", level: 1 }) },
  { path: "/settings", ready: (page) => page.getByRole("button", { name: /settings menu/i }) },
];

interface ControlProblem { kind: "clipped" | "small" | "unnamed"; control: string; box: string }
interface Geometry { scrollWidth: number; innerWidth: number; shellOverflow: number; problems: ControlProblem[] }

async function populatedHousehold(): Promise<CompletionFixture> {
  const fixture = await createCompletionFixture();
  const main = randomUUID(), savings = randomUUID(), out = randomUUID(), into = randomUUID();
  await withFixtureClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(`INSERT INTO accounts (id, household_id, name, type, balance, currency, is_private) VALUES
        ($1, $3, 'Everyday account with a long name', 'checking', 900, 'ZMW', false),
        ($2, $3, 'Savings', 'savings', 100, 'ZMW', false)`, [main, savings, fixture.householdId]);
      await client.query(`INSERT INTO transactions (household_id, account_id, category_id, owner_user_id, name, amount, currency, type, date)
        VALUES ($1, $2, $3, $4, 'Synthetic groceries at a long merchant name', 64.25, 'ZMW', 'expense', current_date)`,
      [fixture.householdId, main, fixture.expenseCategoryId, fixture.userId]);
      await client.query(`INSERT INTO transactions (id, household_id, account_id, owner_user_id, name, amount, currency, type, date,
          transfer_account_id, transfer_transaction_id, is_transfer_in) VALUES
        ($1, $3, $4, $6, 'Move to savings', 50, 'ZMW', 'transfer', current_date, $5, $2, false),
        ($2, $3, $5, $6, 'Move to savings', 50, 'ZMW', 'transfer', current_date, $4, $1, true)`,
      [out, into, fixture.householdId, main, savings, fixture.userId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  });
  return fixture;
}

/** A new household's one-time widget setup dialog. It is modal: until it closes the page behind it is out of the accessibility tree. */
async function skipReportsOnboarding(page: Page, timeout?: number) {
  const onboarding = page.getByRole("dialog", { name: /welcome to your reports dashboard/i });
  await expect(onboarding).toBeVisible({ timeout });
  await onboarding.getByRole("button", { name: /skip for now/i }).click();
  await expect(onboarding).toBeHidden();
}

/** Waits for an opening dialog's zoom and fade to finish: mid-animation it is scaled down, so every box measures small. */
async function settled(dialog: Locator) {
  await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)));
}

/** Measures the page in the browser; `scope` limits the inventory to one dialog. */
function measure(page: Page, options: { checkTargets: boolean; scope?: string }): Promise<Geometry> {
  return page.evaluate(({ checkTargets, scope, minTarget }) => {
    const root: ParentNode = (scope && document.querySelector(scope)) || document;
    const selector = "button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=combobox], [role=tab], [role=switch], [role=checkbox], [role=menuitem], [role=radio]";
    const problems: { kind: "clipped" | "small" | "unnamed"; control: string; box: string }[] = [];
    const describe = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40)}"`;
    // The app shell's vertical scroller ([data-main-scroll]) also scrolls sideways
    // when content is too wide, so it never excuses a clipped control. Only a
    // component's own sideways scroller (a tab strip, a wide table) does.
    const mainScroller = document.querySelector("[data-main-scroll]");
    const isInSideScroller = (el: Element) => {
      for (let node = el.parentElement; node && node !== mainScroller && node !== document.body; node = node.parentElement) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") return true;
      }
      return false;
    };
    const nameOf = (el: Element) => {
      const labelledBy = el.getAttribute("aria-labelledby");
      const byIds = labelledBy ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ") : "";
      const labels = "labels" in el ? Array.from((el as HTMLInputElement).labels ?? []).map((label) => label.textContent ?? "").join(" ") : "";
      const images = Array.from(el.querySelectorAll("img[alt]")).map((img) => img.getAttribute("alt") ?? "").join(" ");
      return [el.getAttribute("aria-label"), byIds, labels, el.textContent, el.getAttribute("title"), images,
        (el as HTMLInputElement).placeholder].join(" ").trim();
    };
    for (const el of Array.from(root.querySelectorAll(selector))) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width === 0 || rect.height === 0 || style.visibility === "hidden" || el.closest("[aria-hidden=true], [inert]")) continue;
      // Visually hidden until focused (sr-only, e.g. "Skip to main content"): not a target anyone can see or tap.
      if (style.clip === "rect(0px, 0px, 0px, 0px)" || style.clipPath === "inset(50%)") continue;
      const box = `${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
      if ((rect.right > window.innerWidth + 1 || rect.left < -1) && !isInSideScroller(el)) problems.push({ kind: "clipped", control: describe(el), box });
      if (checkTargets && (rect.width < minTarget || rect.height < minTarget)) problems.push({ kind: "small", control: describe(el), box });
      if (!nameOf(el)) problems.push({ kind: "unnamed", control: describe(el), box });
    }
    const shellOverflow = mainScroller ? mainScroller.scrollWidth - mainScroller.clientWidth : 0;
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, shellOverflow, problems };
  }, { ...options, minTarget: MIN_TARGET_PX });
}

function expectClean(where: string, geometry: Geometry) {
  expect.soft(geometry.scrollWidth, `${where}: page scrolls sideways`).toBeLessThanOrEqual(geometry.innerWidth);
  expect.soft(geometry.shellOverflow, `${where}: content area scrolls sideways`).toBeLessThanOrEqual(0);
  expect.soft(geometry.problems, `${where}: control problems`).toEqual([]);
}

test.describe("R18 phone layout at 375 px @phone-only", () => {
  test("primary pages fit, controls are reachable, large enough and named", async ({ page }, testInfo) => {
    testInfo.setTimeout(240_000);
    await signInAs(page, await populatedHousehold());
    for (const { path, ready } of PHONE_PAGES) {
      await page.goto(path);
      if (path === "/reports") await skipReportsOnboarding(page, 30_000);
      await expect(ready(page)).toBeVisible({ timeout: 30_000 });
      await page.waitForLoadState("networkidle");
      expectClean(path, await measure(page, { checkTargets: true }));
    }
  });

  test("the Add Transaction dialog fits and its controls are named", async ({ page }) => {
    await signInAs(page, await populatedHousehold());
    await page.goto("/transactions");
    await page.getByRole("button", { name: "Add Transaction", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add Transaction", exact: true });
    await expect(dialog).toBeVisible();
    await settled(dialog);
    expectClean("Add Transaction dialog", await measure(page, { checkTargets: true, scope: "[role=dialog]" }));
  });

  test("the navigation drawer covers the content and every link fits", async ({ page }) => {
    await signInAs(page, await populatedHousehold());
    await page.getByRole("button", { name: "Open application navigation" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await settled(page.getByRole("dialog"));
    expectClean("navigation drawer", await measure(page, { checkTargets: true, scope: "[role=dialog]" }));
  });
});

test.describe("R18 desktop reports width at 1280 px", () => {
  test("Reports and its tabs never scroll sideways; every control is named", async ({ page }, testInfo) => {
    testInfo.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await signInAs(page, await populatedHousehold());
    await page.goto("/reports");
    await skipReportsOnboarding(page, 60_000);
    await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
    const tabs = page.getByRole("button", { name: / report tab/i });
    const count = await tabs.count();
    expect(count).toBeGreaterThan(1);
    for (let index = 0; index < count; index += 1) {
      const tab = tabs.nth(index);
      const label = (await tab.getAttribute("aria-label")) ?? `tab ${index}`;
      await tab.click();
      await page.waitForLoadState("networkidle");
      expectClean(`Reports > ${label}`, await measure(page, { checkTargets: false }));
    }
  });
});
