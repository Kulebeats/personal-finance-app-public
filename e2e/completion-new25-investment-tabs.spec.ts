import { test, expect } from "./protected-test";
import { createCompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { signInAs } from "./utils/fixture-session";

/**
 * NEW-25: a household with no equity holding can still reach the GRZ, tax and
 * pension tabs, and the Reports Income link lands on the tax tab, not the 404 page.
 * The completion fixture is a fresh household with no holdings of any kind.
 */
test("the GRZ, tax and pension tabs open for a household with no holdings", async ({ page }) => {
  const fixture = await createCompletionFixture();
  await signInAs(page, fixture);

  await page.goto("/investments");
  await expect(page.getByRole("heading", { name: "No Holdings Yet", exact: true })).toBeVisible();

  const panels = [
    { tab: "Government (GRZ)", content: page.getByText("GRZ value held (ZMW)", { exact: true }) },
    { tab: "Tax Report", content: page.getByRole("heading", { name: /Investment Tax\s+Report/ }) },
    { tab: "Pension", content: page.getByText(/Total Pension\s+Assets/) },
  ];
  for (const { tab, content } of panels) {
    const trigger = page.getByRole("tab", { name: tab, exact: true });
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-selected", "true");
    await expect(content).toBeVisible();
    await expect(page.getByRole("heading", { name: "No Holdings Yet", exact: true })).toBeHidden();
  }
});

test("the Reports income link opens the investments tax tab", async ({ page }) => {
  const fixture = await createCompletionFixture();
  await signInAs(page, fixture);

  await page.goto("/reports");
  // A new household gets the one-time reports onboarding dialog. It is modal, so the
  // report tabs behind it are out of the accessibility tree until it closes.
  const onboarding = page.getByRole("dialog", { name: "Welcome to Your Reports Dashboard", exact: true });
  await expect(onboarding).toBeVisible();
  await onboarding.getByRole("button", { name: "Skip for Now", exact: true }).click();
  await expect(onboarding).toBeHidden();

  await page.getByRole("button", { name: "Income report tab", exact: true }).click();
  await page.getByRole("link", { name: "Investment Tax Reports", exact: true }).click();

  await expect(page).toHaveURL(/\/investments\?tab=tax$/);
  await expect(page.getByRole("tab", { name: "Tax Report", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: /Investment Tax\s+Report/ })).toBeVisible();
  await expect(page.getByText(/page not found/i)).toHaveCount(0);
});
