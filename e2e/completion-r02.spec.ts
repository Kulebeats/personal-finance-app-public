import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "./protected-test";
import { createCompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { readBack, submitForData, type SubmitStep } from "./utils/submit";
import { testWithMutants } from "./utils/mutants";
import { responseValue, storedValue } from "./utils/observe";

/** Onboarding's household create; its corrupt mutant stores a different name (QA-01, scripts/e2e-mutation-check.mjs). */
const CREATE_HOUSEHOLD: SubmitStep = { name: "household", method: "POST", path: "/api/household", corruptField: "name" };

function recordApiRequests(page: Page) {
  const paths: string[] = [];
  page.on("request", request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/")) paths.push(pathname);
  });
  return paths;
}

const bootstrapPaths = new Set(["/api/auth/session", "/api/csrf-token"]);
const personalEntryPaths = new Set([...bootstrapPaths, "/api/auth/login", "/api/auth/me", "/api/settings/display"]);

test("public recovery entry starts no protected data queries", async ({ page }) => {
  const requests = recordApiRequests(page);
  for (const path of ["/login", "/forgot-password", "/verify-email"]) {
    await page.goto(path);
    if (path === "/login") await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    if (path === "/forgot-password") await expect(page.getByRole("button", { name: "Send reset link", exact: true })).toBeVisible();
    if (path === "/verify-email") await expect(page.getByText("No verification token provided", { exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(requests.filter(url => !url.startsWith("/api/auth/") && url !== "/api/csrf-token")).toEqual([]);
  }
});

test("actual registration stays restricted on a direct financial URL", async ({ page }) => {
  const suffix = randomUUID();
  // Real route/session creation; no direct email_verified update or stored-hash token.
  const registration = await page.request.post("/api/auth/register", { data: {
    username: `r02-${suffix.slice(0, 8)}`, email: `r02-${suffix}@example.invalid`,
    password: `Synthetic!9-${suffix}`, fullName: "Synthetic pending R02",
  } });
  expect(registration.status()).toBe(201);
  const requests = recordApiRequests(page);
  await page.goto("/accounts");
  await expect(page.getByRole("heading", { name: "Verify your email", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(requests.filter(path => !bootstrapPaths.has(path))).toEqual([]);
  const denied = await page.request.get("/api/accounts");
  expect(denied.status()).toBe(403);
  expect((await denied.json()).error.code).toBe("EMAIL_VERIFICATION_REQUIRED");
  const status = await page.request.get("/api/auth/session");
  expect((await status.json()).data.state).toBe("verification_pending");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  expect((await (await page.request.get("/api/auth/session")).json()).data).toEqual({ state: "anonymous" });
});

testWithMutants("verified household-free entry creates a household before financial mounting", { corrupt: [CREATE_HOUSEHOLD] }, async (page) => {
  const fixture = await createCompletionFixture();
  // This independently verified synthetic control exercises onboarding, not mail verification.
  await withFixtureClient(client => client.query(
    "DELETE FROM household_members WHERE user_id=$1 AND household_id=$2", [fixture.userId, fixture.householdId]));
  const requests = recordApiRequests(page);
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(fixture.email);
  await page.getByPlaceholder(/enter your password/i).fill(fixture.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: /create your household/i })).toBeVisible();
  await page.goto("/accounts");
  await expect(page.getByRole("heading", { name: /create your household/i })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(requests.filter(path => !personalEntryPaths.has(path))).toEqual([]);
  const status = await page.request.get("/api/auth/session");
  expect((await status.json()).data.state).toBe("verified_without_household");
  const householdName = `Synthetic R02 ${randomUUID().slice(0, 8)}`;
  await page.getByLabel("Household Name", { exact: true }).fill(householdName);
  const accounts = page.waitForResponse(response => new URL(response.url()).pathname === "/api/accounts" && response.request().method() === "GET");
  const created = await submitForData<{ household: { id: string; name: unknown } }>(page, CREATE_HOUSEHOLD,
    () => page.getByRole("button", { name: "Create Household", exact: true }).click());
  await readBack(CREATE_HOUSEHOLD, householdName, {
    created: async () => responseValue(created.household.name, "name"),
    db: () => storedValue("SELECT name AS value FROM households WHERE id=$1", [created.household.id]),
  });
  await expect(page.getByRole("button", { name: "Add a new account", exact: true })).toBeVisible();
  expect((await accounts).status()).toBe(200);
  const ready = (await (await page.request.get("/api/auth/session")).json()).data;
  expect(ready.state).toBe("ready");
  expect(ready.subject.id).toBe(fixture.userId);
  expect(ready.household.id).not.toBe(fixture.householdId);
  expect(ready.household.id).toBe(created.household.id);
});

test("an old account form cannot submit under a replacement login cookie", async ({ page }) => {
  const first = await createCompletionFixture();
  const replacement = await createCompletionFixture();
  const name = `R02 obsolete form ${randomUUID()}`;
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(first.email);
  await page.getByPlaceholder(/enter your password/i).fill(first.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add a new account", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Cash Physical Cash$/ }).click();
  await dialog.getByLabel("Account Name", { exact: true }).fill(name);
  await dialog.locator("#balance").fill("0");

  // Change the real shared cookie without a page navigation or storage signal.
  const login = await page.request.post("/api/auth/login", { data: {
    email: replacement.email, password: replacement.password,
  } });
  expect(login.status()).toBe(200);
  expect((await (await page.request.get("/api/auth/session")).json()).data.subject.id).toBe(replacement.userId);
  await expect(dialog.getByLabel("Account Name", { exact: true })).toHaveValue(name);

  const submission = page.waitForResponse(response => new URL(response.url()).pathname === "/api/accounts" && response.request().method() === "POST");
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/session" && response.request().method() === "GET");
  const replacementAccounts = page.waitForResponse(response => new URL(response.url()).pathname === "/api/accounts" && response.request().method() === "GET" && response.request().headers()["x-capital-subject"] === replacement.userId);
  await dialog.getByRole("button", { name: "Save Account", exact: true }).click();
  const denied = await submission;
  expect(denied.request().headers()["x-capital-subject"]).toBe(first.userId);
  expect(denied.request().headers()["x-capital-household"]).toBe(first.householdId);
  expect(denied.status()).toBe(409);
  expect((await denied.json()).error.code).toBe("SESSION_CONTEXT_CHANGED");
  expect((await (await refreshed).json()).data.subject.id).toBe(replacement.userId);
  const replacementRead = await replacementAccounts;
  expect(replacementRead.status()).toBe(200);
  expect(replacementRead.request().headers()["x-capital-household"]).toBe(replacement.householdId);
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Add a new account", exact: true })).toBeVisible();
  const persisted = await withFixtureClient(client => client.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM accounts WHERE name=$1 AND household_id=ANY($2::uuid[])",
    [name, [first.householdId, replacement.householdId]],
  ));
  expect(persisted.rows[0].count).toBe(0);
});
