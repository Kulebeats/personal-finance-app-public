/**
 * R18 control inventory (NEW-37, AH-13 remainder; FINAL_COMPLETION_SPEC.md R18:
 * "a control inventory test that every primary-page control has an observable
 * result").
 *
 * On each of the eight primary pages (Dashboard, Accounts, Transactions,
 * Budget, Goals, Investments, Reports, Settings) every primary control, meaning
 * the page's own header, toolbar and tab actions (not per-row controls and not
 * the app shell), is clicked and must produce something observable:
 * - a named dialog, menu, listbox or panel opens;
 * - the URL changes;
 * - its state attribute flips (aria-selected, aria-current, aria-checked,
 *   aria-pressed) or its name or the page heading changes.
 * A control the page offers with no result is a failure, so a removed dead
 * control is asserted absent.
 *
 * Desktop width (chromium project). The household gets one account and one
 * expense through SQL; nothing here writes financial data. Export buttons are
 * left out: their result is a file download, not something on the page. axe-
 * core is not part of this spec (it needs a package download).
 */
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "./protected-test";
import { createCompletionFixture, type CompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { signInAs } from "./utils/fixture-session";

const DESKTOP = { width: 1280, height: 800 };
const PAGE_READY_MS = 30_000;

interface Control { name: string; check: (page: Page) => Promise<void> }
interface PrimaryPage { path: string; ready: (page: Page) => Promise<void>; controls: Control[] }

async function householdWithAnExpense(): Promise<CompletionFixture> {
  const fixture = await createCompletionFixture();
  const accountId = randomUUID();
  await withFixtureClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(`INSERT INTO accounts (id, household_id, name, type, balance, currency, is_private)
        VALUES ($1, $2, 'Synthetic inventory account', 'checking', 500, 'ZMW', false)`, [accountId, fixture.householdId]);
      await client.query(`INSERT INTO transactions (household_id, account_id, category_id, owner_user_id, name, amount, currency, type, date)
        VALUES ($1, $2, $3, $4, 'Synthetic inventory expense', 25.00, 'ZMW', 'expense', current_date)`,
      [fixture.householdId, accountId, fixture.expenseCategoryId, fixture.userId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  });
  return fixture;
}

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** Clicks `name` and expects the dialog `dialogName` to open, then closes it with Escape. */
function opensDialog(name: string, dialogName: string): Control {
  return { name, check: async (page) => {
    await button(page, name).click();
    const dialog = page.getByRole("dialog", { name: dialogName, exact: true });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  } };
}

/** Clicks `name` and expects a menu holding `item` to open, then closes it. */
function opensMenu(name: string, item: string): Control {
  return { name, check: async (page) => {
    await button(page, name).click();
    await expect(page.getByRole("menu").getByRole("menuitem", { name: item, exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  } };
}

/** Clicks the `role` control `name` and expects `attribute` on it to become `value`. */
function selects(role: "tab" | "button" | "radio", name: string, attribute: string, value = "true"): Control {
  return { name, check: async (page) => {
    const control = page.getByRole(role, { name, exact: true });
    await expect(control).not.toHaveAttribute(attribute, value);
    await control.click();
    await expect(control).toHaveAttribute(attribute, value);
  } };
}

/** Clicks the icon toggle `name` and expects its accessible name to become `after`. */
function renames(name: string, after: string): Control {
  return { name, check: async (page) => {
    await button(page, name).click();
    await expect(button(page, after)).toBeVisible();
    await expect(button(page, name)).toHaveCount(0);
  } };
}

/** Clicks `name` and expects the page's h1 to change from what it was. */
function changesHeading(name: string, matches?: RegExp): Control {
  return { name, check: async (page) => {
    const heading = page.getByRole("heading", { level: 1 });
    const before = (await heading.textContent())?.trim() ?? "";
    await button(page, name).click();
    await expect(heading).not.toHaveText(before);
    if (matches) await expect(heading).toHaveText(matches);
  } };
}

const INVESTMENT_TABS = ["Performance", "Allocation", "Government (GRZ)", "FX Impact", "Tax Report", "Pension", "Recurring", "Holdings"];
const REPORT_TABS = ["Cash Flow", "Spending", "Merchants", "Income", "Net Worth", "Savings", "Annual Dashboard"];
const SETTINGS_SECTIONS: [label: string, slug: string][] = [
  ["Display", "display"], ["Notifications", "notifications"], ["Security", "security"], ["Household", "household"],
  ["Members", "members"], ["Preferences", "preferences"], ["Organization", "organization"], ["Merchants", "merchants"],
  ["Weekly Recap", "weekly-recap"], ["Profile", "profile"],
];

const PRIMARY_PAGES: PrimaryPage[] = [
  { path: "/", ready: async (page) => {
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible({ timeout: PAGE_READY_MS });
    // Customize waits for the widget layout to load.
    await expect(button(page, "Customize")).toBeEnabled({ timeout: PAGE_READY_MS });
  }, controls: [
    opensDialog("Add Account", "Add Account"),
    opensDialog("Customize", "Customize dashboard"),
  ] },
  { path: "/accounts", ready: async (page) => {
    await expect(button(page, "Add a new account")).toBeVisible({ timeout: PAGE_READY_MS });
  }, controls: [
    opensDialog("Add a new account", "Add Account"),
    selects("radio", "Percent", "aria-checked"),
    { name: "Filter accounts by owner", check: async (page) => {
      await page.getByRole("combobox", { name: "Filter accounts by owner", exact: true }).click();
      const options = page.getByRole("listbox");
      await expect(options.getByRole("option", { name: "Shared Only", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(options).toHaveCount(0);
    } },
  ] },
  { path: "/transactions", ready: async (page) => {
    await expect(page.getByRole("heading", { name: "Transactions", level: 1 })).toBeVisible({ timeout: PAGE_READY_MS });
  }, controls: [
    opensDialog("Add Transaction", "Add Transaction"),
    { name: "Filters", check: async (page) => {
      await page.getByRole("button", { name: /^Filters/ }).click();
      await expect(page.getByRole("tablist", { name: "Filter categories", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("tablist", { name: "Filter categories", exact: true })).toHaveCount(0);
    } },
    { name: "Import", check: async (page) => {
      await button(page, "Import").click();
      const upload = page.getByRole("heading", { name: "Upload your transactions file" });
      await expect(upload).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(upload).toBeHidden();
    } },
    renames("Group transactions by date", "Switch to flat list view"),
    renames("Hide summary panel", "Show summary panel"),
  ] },
  { path: "/budget", ready: async (page) => {
    await expect(button(page, "Settings")).toBeVisible({ timeout: PAGE_READY_MS });
  }, controls: [
    opensDialog("Settings", "Budget Settings"),
    selects("button", "View income tab", "aria-current", "page"),
    changesHeading("Previous month"),
    changesHeading("Next month"),
    changesHeading("Yearly", /^\d{4}$/),
    changesHeading("Monthly", /^[A-Z][a-z]+ \d{4}$/),
  ] },
  { path: "/goals", ready: async (page) => {
    await expect(page.getByRole("tab", { name: "Save Up", exact: true })).toBeVisible({ timeout: PAGE_READY_MS });
  }, controls: [
    opensDialog("New Goal", "Create a goal"),
    selects("tab", "Pay Down", "aria-selected"),
    opensDialog("Create goal transfer", "Transfer / Contribute"),
    opensDialog("Goal accounts", "Edit goal accounts"),
  ] },
  { path: "/investments", ready: async (page) => {
    await expect(page.getByRole("heading", { name: "Investments", level: 1 })).toBeVisible({ timeout: PAGE_READY_MS });
  }, controls: [
    opensDialog("Add Holding", "Add Investment Holding"),
    { name: "no dead Filter button", check: async (page) => {
      await expect(button(page, "Filter")).toHaveCount(0);
    } },
    ...INVESTMENT_TABS.map((tab) => selects("tab", tab, "aria-selected")),
    // Last: it refetches the portfolio in USD.
    selects("button", "USD", "aria-pressed"),
  ] },
  { path: "/reports", ready: async (page) => {
    // A new household's one-time widget setup is modal; skip it first.
    const onboarding = page.getByRole("dialog", { name: /welcome to your reports dashboard/i });
    await expect(onboarding).toBeVisible({ timeout: PAGE_READY_MS * 2 });
    await onboarding.getByRole("button", { name: /skip for now/i }).click();
    await expect(onboarding).toBeHidden();
    await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
  }, controls: [
    opensMenu("Customize report settings", "Edit Dashboard Widgets"),
    opensMenu("Export report options", "Export Current View"),
    ...REPORT_TABS.map((tab) => selects("button", `${tab} report tab`, "aria-current", "page")),
  ] },
  { path: "/settings", ready: async (page) => {
    await expect(button(page, "Navigate to Profile settings")).toBeVisible({ timeout: PAGE_READY_MS });
  }, controls: SETTINGS_SECTIONS.map(([label, slug]) => ({ name: `Navigate to ${label} settings`, check: async (page) => {
    const nav = button(page, `Navigate to ${label} settings`);
    await nav.click();
    await expect(page).toHaveURL(new RegExp(`/settings/${slug}$`));
    await expect(nav).toHaveAttribute("aria-current", "page");
  } })) },
];

test.describe("R18 control inventory on the primary pages", () => {
  for (const primary of PRIMARY_PAGES) {
    test(`every primary control on ${primary.path} has an observable result`, async ({ page }, testInfo) => {
      testInfo.setTimeout(180_000);
      await page.setViewportSize(DESKTOP);
      await signInAs(page, await householdWithAnExpense());
      await page.goto(primary.path);
      await primary.ready(page);
      for (const control of primary.controls) {
        await test.step(`${primary.path}: ${control.name}`, () => control.check(page));
      }
    });
  }
});
