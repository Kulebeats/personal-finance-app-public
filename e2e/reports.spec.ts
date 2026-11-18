/**
 * Reports E2E Tests
 *
 * Exercises the reports feature as it is actually shipped
 * (client/src/pages/Reports.tsx + client/src/features/reports/**):
 * - The annual dashboard, which is the default (and only registered)
 *   `/reports` route - there are no `/reports/annual`, `/reports/spending`,
 *   `/reports/cashflow`, `/reports/net-worth`, etc. sub-routes; those tabs
 *   are client-side state on a single page (see client/src/App.tsx, which
 *   only registers `/reports`)
 * - Switching tabs (Spending, Net Worth) and seeing the real summary cards
 * - The Customize and Export dropdown menus
 * - The Export History panel toggle
 *
 * The previous version of this file asserted on fictional `data-testid`
 * attributes (`annual-income`, `spending-chart`, `cashflow-chart`, ...) and
 * navigated to routes that return the 404 page. None of that matched the
 * shipped UI or router.
 *
 * First-time households see a "Welcome to Your Reports Dashboard" widget
 * onboarding modal on load; `dismissOnboardingIfPresent` clears it the same
 * way a real user would ("Skip for Now") before each test proceeds.
 *
 * NOT gated in `test:e2e:smoke` (package.json) yet. The rewritten assertions
 * pass locally, but the very first `/reports` navigation in this dev
 * environment is a genuine cold-start outlier: the annual dashboard is the
 * heaviest bundle in the app (recharts + every widget), and on an unwarmed
 * Vite dev server + a heavily-reused shared dev DB, that first paint has
 * taken anywhere from ~10s to well over 90s across repeated runs, which is
 * not safe to gate on. The `beforeAll` warm-up pass below (best-effort,
 * failure ignored) and the `dismissOnboardingIfPresent` fix meaningfully
 * reduced the failure rate (was 6/6 failing before either fix; now typically
 * 5/6 or 6/6 passing), but "loads the Annual Dashboard tab by default" still
 * intermittently times out waiting on that first paint. Re-time this in CI
 * (a fresh, non-shared DB) before adding it to the gate - if CI's first load
 * is consistently fast, it likely just needs its own generous first-load
 * timeout the way transactions.spec.ts already does; if it is still slow
 * there, that is a real performance finding about the annual dashboard, not
 * a test problem.
 */

import { test, expect, type Page } from "@playwright/test";
import { login } from "./utils/login";

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const onboardingDialog = page.getByRole("dialog", {
    name: /welcome to your reports dashboard/i,
  });
  // The onboarding modal (shown once per household, until "Skip for Now" or
  // "Save & Continue" is chosen) opens asynchronously after the
  // widget-preferences query resolves - it is not present on first paint.
  // An instant `isVisible()` check right after navigation reliably misses
  // it, which leaves the modal open and its overlay silently blocks every
  // later click in the test (each failing only after the full actionability
  // timeout). Wait for it with a real timeout instead, and treat "it never
  // appeared" as the normal case for a household that already completed
  // onboarding in an earlier test run.
  try {
    await onboardingDialog.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    return;
  }
  await onboardingDialog.getByRole("button", { name: /skip for now/i }).click();
  await expect(onboardingDialog).not.toBeVisible();
}

test.describe("Reports", () => {
  // The Reports/Annual Dashboard bundle (recharts + every widget) is by far
  // the heaviest page in the app, and Vite's dev server transforms modules
  // on demand: the *first* request for this chunk graph can take well over
  // a minute, independent of anything under test. `--workers=1` runs every
  // test in this file in one worker/process, so paying that cold-start cost
  // once here (generous, best-effort, failure ignored) means the timed
  // tests below - each still using a real, honest timeout - hit an already
  // -warmed dev server instead of flaking on a cold one.
  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(150_000);
    const page = await browser.newPage();
    try {
      await login(page);
      await page.goto("/reports");
      await page
        .getByRole("heading", { name: "Reports", level: 1 })
        .waitFor({ state: "visible", timeout: 120_000 })
        .catch(() => {});
    } finally {
      await page.close();
    }
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/reports");
    await expect(page).toHaveURL(/\/reports/);
    // Generous even after the warm-up above: this is still a real, data-heavy
    // first paint per test (fresh browser context per test = no client cache).
    await expect(
      page.getByRole("heading", { name: "Reports", level: 1 }),
    ).toBeVisible({ timeout: 30_000 });
    await dismissOnboardingIfPresent(page);
  });

  test("loads the Annual Dashboard tab by default", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Reports", level: 1 }),
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: /annual dashboard report tab/i }),
    ).toHaveAttribute("aria-current", "page");

    // Real content rendered only by AnnualDashboard.
    await expect(
      page.getByRole("heading", { name: "Overview" }),
    ).toBeVisible();
  });

  test("switches to the Spending tab and shows the summary cards", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /^spending report tab/i }).click();

    await expect(
      page.getByRole("button", { name: /^spending report tab/i }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Total Income")).toBeVisible();
    await expect(page.getByText("Total Expenses")).toBeVisible();
    await expect(page.getByText("Savings Rate")).toBeVisible();
  });

  test("switches to the Net Worth tab and shows the summary cards", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /net worth report tab/i }).click();

    await expect(
      page.getByRole("button", { name: /net worth report tab/i }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Total Income")).toBeVisible();
    await expect(page.getByText("Total Net Income")).toBeVisible();
  });

  test("opens the Export options menu", async ({ page }) => {
    await page.getByRole("button", { name: "Export report options" }).click();

    await expect(
      page.getByRole("menuitem", { name: /export current view/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: /view export history/i }),
    ).toBeVisible();
  });

  test("toggles the export history panel", async ({ page }) => {
    await page.getByRole("button", { name: "Export report options" }).click();
    await page.getByRole("menuitem", { name: /view export history/i }).click();

    await expect(
      page.getByRole("heading", { name: "Export history" }),
    ).toBeVisible();
  });

  test("opens the Customize menu and shows year/period settings", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: "Customize report settings" })
      .click();

    await expect(page.getByText("View Settings")).toBeVisible();
    await expect(page.getByText("Year:")).toBeVisible();
    await expect(page.getByText("Period:")).toBeVisible();
  });
});
