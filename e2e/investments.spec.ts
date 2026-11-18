/**
 * Investments E2E Tests
 *
 * Exercises the investments feature as it is actually shipped
 * (client/src/pages/Investments.tsx + client/src/features/investments/**):
 * - The portfolio header, which always renders an "Investments" heading
 * - Either the empty state ("No Holdings Yet") or the populated tab set
 *   (Holdings / Performance / Allocation / Government (GRZ) / FX Impact /
 *   Tax Report / Pension / Recurring), whichever matches the current data
 * - The real "Add Investment Holding" dialog and its security-search step
 *
 * The previous version of this file asserted on fictional `data-testid`
 * attributes (`portfolio-value`, `holdings-table`, `allocation-chart`,
 * `security-result`, `fx-impact-panel`, `grz-bonds-table`, ...), a native
 * `<select>`-based add-holding form, and a route (`/investments/grz`) that
 * does not exist in the router - GRZ securities render as a tab on
 * `/investments`, not a sub-route. None of that matched the shipped UI.
 */

import { test, expect } from "@playwright/test";
import { login } from "./utils/login";

test.describe("Investments", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/investments");
    await expect(page).toHaveURL(/\/investments/);
  });

  test("shows the Investments heading and either holdings or the empty state", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Investments", level: 1 }),
    ).toBeVisible();

    const emptyState = page.getByRole("heading", { name: "No Holdings Yet" });
    const holdingsTab = page.getByRole("tab", { name: "Holdings" });

    const isEmpty = await emptyState.isVisible().catch(() => false);
    if (isEmpty) {
      await expect(
        page.getByRole("button", { name: /add your first holding/i }),
      ).toBeVisible();
    } else {
      await expect(holdingsTab).toBeVisible();
      await expect(page.getByRole("tab", { name: "Performance" })).toBeVisible();
      await expect(
        page.getByRole("tab", { name: "Government (GRZ)" }),
      ).toBeVisible();
    }
  });

  test("opens the real add-holding dialog with the security search step", async ({
    page,
  }) => {
    // The entry-point button depends on holdings state, and the page SWAPS
    // between the two while the holdings query is in flight:
    //
    //   Investments.tsx renders the empty state only on `!isLoading &&
    //   holdings.length === 0`, so DURING loading it falls through to the
    //   populated branch and shows PortfolioSummary's "Add Holding". When the
    //   query resolves to zero holdings it re-renders to the empty state and
    //   that button unmounts, replaced by "Add Your First Holding".
    //
    // The old `pickVisible` + click raced that swap: it resolved "Add Holding"
    // mid-load, then `click()` waited on a selector that no longer matched
    // anything and burned the full 60s test timeout. That is the intermittent
    // `investments.spec.ts:55` failure seen on main (2026-07-20, runs 14:52 and
    // 18:30) while passing on faster runs.
    //
    // There is no DOM marker distinguishing "loading" from "populated" — both
    // render the same tree — so there is nothing to wait on. Instead retry the
    // whole open-the-dialog step: if a click lands mid-swap (or the dialog
    // unmounts with its trigger), `toPass` re-resolves and tries again once the
    // page has settled. Both buttons are wrapped in the same `AddHoldingModal`,
    // so whichever wins opens the same dialog.
    const dialog = page.getByRole("dialog", {
      name: /add investment holding/i,
    });

    await expect(async () => {
      await page
        .getByRole("button", { name: /^add (your first )?holding$/i })
        .first()
        .click({ timeout: 5_000 });
      await expect(dialog).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });

    await expect(
      dialog.getByPlaceholder(/search securities/i),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: /add new security/i }),
    ).toBeVisible();
  });

  test("switches between investment tabs when holdings exist", async ({
    page,
  }) => {
    const holdingsTab = page.getByRole("tab", { name: "Holdings" });
    const hasHoldings = await holdingsTab.isVisible().catch(() => false);
    test.skip(
      !hasHoldings,
      "test household has no holdings yet; empty state is covered separately",
    );

    await page.getByRole("tab", { name: "Government (GRZ)" }).click();
    await expect(
      page.getByRole("tab", { name: "Government (GRZ)", selected: true }),
    ).toBeVisible();

    await page.getByRole("tab", { name: "Performance" }).click();
    await expect(
      page.getByRole("tab", { name: "Performance", selected: true }),
    ).toBeVisible();
  });
});
