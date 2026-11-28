import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { Request, Response } from "@playwright/test";
import { test, expect, type Page } from "./protected-test";
import { createCompletionFixture, type CompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { readBack, submitStep, type SubmitStep } from "./utils/submit";
import { testWithMutants } from "./utils/mutants";
import { responseValue, storedValue } from "./utils/observe";

/** The Shared account's create write; its corrupt mutant stores a different name (QA-01, scripts/e2e-mutation-check.mjs). */
const CREATE_SHARED_ACCOUNT: SubmitStep = { name: "shared-account", method: "POST", path: "/api/accounts", corruptField: "name" };

const preferencePath = "/api/settings/user-preferences";
const accountFramePath = "/api/accounts/net-worth/history";
type AccountFilter = "all" | "mine" | "shared";

function responseFor(page: Page, path: string, method: string) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === path && response.request().method() === method;
  });
}

function accountFrameFor(page: Page, fixture: CompletionFixture, filter: AccountFilter) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    const ownerMatches = filter === "all" ? !url.searchParams.has("ownerUserId")
      : url.searchParams.get("ownerUserId") === (filter === "mine" ? fixture.userId : "shared");
    return url.pathname === accountFramePath && response.request().method() === "GET" &&
      url.searchParams.get("includeAccounts") === "true" && url.searchParams.get("scope") === "user" && ownerMatches;
  });
}

async function frameAccounts(response: Response, fixture: CompletionFixture, filter: AccountFilter) {
  expect(response.status()).toBe(200);
  const url = new URL(response.url());
  expect(url.pathname).toBe(accountFramePath);
  expect(response.request().method()).toBe("GET");
  expect(url.searchParams.get("includeAccounts")).toBe("true");
  expect(url.searchParams.get("scope")).toBe("user");
  expect(url.searchParams.getAll("ownerUserId")).toEqual(filter === "all" ? [] : [filter === "mine" ? fixture.userId : "shared"]);
  expect(response.request().headers()["x-capital-subject"]).toBe(fixture.userId);
  expect(response.request().headers()["x-capital-household"]).toBe(fixture.householdId);
  const body = await response.json();
  expect(body.success).toBe(true);
  expect(body.data.accounts).toEqual(expect.any(Array));
  return body.data.accounts;
}

async function assertLegacyAccountLists(page: Page, fixture: CompletionFixture, id: string, name: string) {
  // This signed compatibility read is separate from the UI's history-frame subscription.
  for (const owner of ["all", fixture.userId, "shared"]) {
    const response = await page.request.get(`/api/accounts?ownerUserId=${encodeURIComponent(owner)}`, { headers: {
      "x-capital-subject": fixture.userId, "x-capital-household": fixture.householdId,
    } });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(owner === fixture.userId ? [] : [expect.objectContaining({
      id, householdId: fixture.householdId, name, ownerUserId: null, isPrivate: false,
    })]);
  }
}

async function signIn(page: Page, fixture: CompletionFixture, attempt: string) {
  const started = Date.now();
  const pending = new Map<Request, { path: string; atMs: number; status?: number }>();
  const events: { atMs: number; kind: string; path?: string; status?: number }[] = [];
  const pathFor = (url: string) => new URL(url).pathname.slice(0, 240);
  const record = (kind: string, path?: string, status?: number) => {
    if (events.length < 100) events.push({ atMs: Date.now() - started, kind, path, status });
  };
  const onRequest = (request: Request) => {
    if (request.resourceType() !== "script") return;
    const path = pathFor(request.url());
    if (pending.size < 120) pending.set(request, { path, atMs: Date.now() - started });
    record("script-start", path);
  };
  const onFinished = (request: Request) => {
    if (request.resourceType() === "script") record("script-finished", pathFor(request.url()));
    pending.delete(request);
  };
  const onFailed = (request: Request) => { record("request-failed", pathFor(request.url())); pending.delete(request); };
  const onResponse = (response: Response) => {
    const script = pending.get(response.request());
    if (script) script.status = response.status();
    if (response.status() >= 400) record("http-error", pathFor(response.url()), response.status());
  };
  const onPageError = () => record("page-error");
  page.on("request", onRequest); page.on("requestfinished", onFinished);
  page.on("requestfailed", onFailed); page.on("response", onResponse); page.on("pageerror", onPageError);
  let documentStatus: number | null = null;
  let ready = false;
  try {
    documentStatus = (await page.goto("/login"))?.status() ?? null;
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible({ timeout: 30_000 });
    ready = true;
  } finally {
    // Only paths/status/timing are captured, and capture stops before credentials.
    page.off("request", onRequest); page.off("requestfinished", onFinished);
    page.off("requestfailed", onFailed); page.off("response", onResponse); page.off("pageerror", onPageError);
    const path = test.info().outputPath(`shared-owner-login-render-${attempt}.json`);
    await writeFile(path, JSON.stringify({ phase: "before credentials", ready, documentStatus,
      elapsedMs: Date.now() - started, events, pendingScripts: Array.from(pending.values()),
    }, null, 2), "utf8");
    await test.info().attach(`shared-owner-login-render-${attempt}`, { contentType: "application/json", path });
  }
  await page.getByLabel(/email/i).fill(fixture.email);
  await page.getByPlaceholder(/enter your password/i).fill(fixture.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/");
  const session = await page.request.get("/api/auth/session");
  expect(session.status()).toBe(200);
  expect((await session.json()).data).toMatchObject({
    state: "ready", subject: { id: fixture.userId }, household: { id: fixture.householdId },
  });
}

async function selectFilter(page: Page, fixture: CompletionFixture, filter: "mine" | "shared") {
  const picker = page.getByRole("combobox", { name: "Filter accounts by owner", exact: true });
  await picker.click();
  const saved = responseFor(page, preferencePath, "PUT");
  const listed = accountFrameFor(page, fixture, filter);
  await page.getByRole("option", { name: filter === "mine" ? /My Accounts$/ : "Shared Only", exact: true }).click();
  const acknowledgment = await saved;
  expect(acknowledgment.status()).toBe(200);
  expect(acknowledgment.request().postDataJSON()).toEqual({ defaultAccountFilter: filter });
  expect((await acknowledgment.json()).data.preferences).toMatchObject({ userId: fixture.userId, defaultAccountFilter: filter });
  const response = await listed;
  const accounts = await frameAccounts(response, fixture, filter);
  await expect(picker).toContainText(filter === "mine" ? "My Accounts" : "Shared Only");
  return accounts;
}

async function assertFreshSharedList(page: Page, fixture: CompletionFixture, id: string, name: string, reload: boolean) {
  const failures: string[] = [];
  const onFailed = (request: Request) => {
    const path = new URL(request.url()).pathname;
    if (request.resourceType() === "script" && path.startsWith("/assets/") && failures.length < 16) {
      const reason = request.failure()?.errorText.match(/net::ERR_[A-Z_]+/)?.[0] ?? "request failure";
      failures.push(`script ${path} ${reason}`);
    }
  };
  const onError = (message: import("@playwright/test").ConsoleMessage) => {
    const text = message.text();
    if (text.startsWith("Route error in Accounts:") && failures.length < 16) {
      const kind = text.match(/Minified React error #\d+|Failed to fetch dynamically imported module|Loading chunk|is not a function|Cannot read properties of (?:undefined|null)/i);
      failures.push(`Accounts render: ${kind?.[0] ?? "unclassified exception"}`);
    }
  };
  page.on("requestfailed", onFailed);
  page.on("console", onError);
  const [preferenceResponse, response] = await Promise.all([
    responseFor(page, preferencePath, "GET"),
    accountFrameFor(page, fixture, "shared"),
    reload ? page.reload() : page.goto("/accounts"),
  ]).finally(async () => {
    page.off("requestfailed", onFailed);
    page.off("console", onError);
    if (failures.length) await test.info().attach("shared-owner-navigation-failures", {
      contentType: "application/json", body: JSON.stringify({ reload, failures }),
    });
  });
  expect(preferenceResponse.status()).toBe(200);
  expect((await preferenceResponse.json()).data.preferences).toMatchObject({ userId: fixture.userId, defaultAccountFilter: "shared" });
  expect(await frameAccounts(response, fixture, "shared")).toEqual([expect.objectContaining({
    id, householdId: fixture.householdId, name, ownerUserId: null, isPrivate: false,
  })]);
  await expect(page.getByRole("combobox", { name: "Filter accounts by owner", exact: true })).toContainText("Shared Only");
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expect(page.getByTestId("accounts-filtered-empty-state")).toHaveCount(0);
}

// Local Shared-ownership consumer proof, separate from full R04 and financial posting acceptance.
testWithMutants("Shared account creation retains null ownership through SQL, filters, reload and fresh login", { corrupt: [CREATE_SHARED_ACCOUNT] }, async (page) => {
  const testInfo = test.info();
  const fixture = await createCompletionFixture();
  await signIn(page, fixture, "initial");
  const initial = accountFrameFor(page, fixture, "all");
  await page.goto("/accounts");
  const initialResponse = await initial;
  expect(await frameAccounts(initialResponse, fixture, "all")).toEqual([]);
  await expect(page.getByRole("combobox", { name: "Filter accounts by owner", exact: true })).toContainText("All Accounts");
  const name = `R04 shared cash ${randomUUID().slice(0, 8)}`;
  await page.getByRole("button", { name: "Add a new account", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Cash Physical Cash$/ }).click();
  await dialog.getByLabel("Account Name", { exact: true }).fill(name);
  await dialog.locator("#balance").fill("0");
  await dialog.getByRole("combobox").click();
  await page.getByRole("option", { name: "Shared (Household)", exact: true }).click();
  const createResponse = await submitStep(page, CREATE_SHARED_ACCOUNT,
    () => dialog.getByRole("button", { name: "Save Account", exact: true }).click());
  const requestBody = createResponse.request().postDataJSON();
  const body = await createResponse.json();
  const observationPath = testInfo.outputPath("shared-account-create-observation.json");
  // Preserve the causal request/response distinction even when this regression is RED.
  await writeFile(observationPath, JSON.stringify({ status: createResponse.status(),
    requestHasOwner: Object.prototype.hasOwnProperty.call(requestBody, "ownerUserId"),
    requestOwner: requestBody.ownerUserId, responseOwner: body.data?.ownerUserId,
    accountId: body.data?.id, householdId: body.data?.householdId,
  }, null, 2), "utf8");
  await testInfo.attach("shared-account-create-observation", { path: observationPath, contentType: "application/json" });
  // The stored name, before the request, row and filter checks below, which a wrong name would also fail.
  await readBack(CREATE_SHARED_ACCOUNT, name, {
    created: async () => responseValue(body.data?.name, "name"),
    db: () => storedValue("SELECT name AS value FROM accounts WHERE id=$1 AND household_id=$2", [body.data?.id, fixture.householdId]),
  });
  expect(createResponse.status()).toBe(201);
  expect(requestBody).toMatchObject({ name, type: "cash", ownerUserId: null, initialBalance: "0.00" });
  expect(createResponse.request().headers()["x-capital-subject"]).toBe(fixture.userId);
  expect(createResponse.request().headers()["x-capital-household"]).toBe(fixture.householdId);
  expect(body.success).toBe(true);
  expect(body.data).toMatchObject({ name, householdId: fixture.householdId, type: "cash", ownerUserId: null,
    isPrivate: false, isHidden: false, isArchived: false });
  expect(body.data.id).toMatch(/^[0-9a-f-]{36}$/i);
  const id = body.data.id as string;
  const persisted = await withFixtureClient(client => client.query(`SELECT id, household_id, name,
    owner_user_id, is_private, type, initial_balance::text, balance::text, deleted_at
    FROM accounts WHERE id=$1`, [id]));
  expect(persisted.rows).toEqual([{ id, household_id: fixture.householdId, name, owner_user_id: null,
    is_private: false, type: "cash", initial_balance: "0.00", balance: "0.00", deleted_at: null }]);
  await expect(dialog.getByText("Account Created", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await test.step("signed legacy account GET retains All, Mine and Shared compatibility", async () => {
    await assertLegacyAccountLists(page, fixture, id, name);
  });

  expect(await selectFilter(page, fixture, "mine")).toEqual([]);
  await expect(page.getByTestId("accounts-filtered-empty-state")).toContainText("No accounts match this filter");
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  expect(await selectFilter(page, fixture, "shared")).toEqual([expect.objectContaining({ id, ownerUserId: null, name })]);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  const preferenceRow = await withFixtureClient(client => client.query(`SELECT user_id,
    default_account_filter FROM user_preferences WHERE user_id=$1`, [fixture.userId]));
  expect(preferenceRow.rows).toEqual([{ user_id: fixture.userId, default_account_filter: "shared" }]);
  await assertFreshSharedList(page, fixture, id, name, true);

  expect((await page.request.post("/api/auth/logout")).status()).toBe(200);
  expect((await (await page.request.get("/api/auth/session")).json()).data).toEqual({ state: "anonymous" });
  await signIn(page, fixture, "fresh-session");
  await assertFreshSharedList(page, fixture, id, name, false);
  const screenshotPath = testInfo.outputPath("shared-account-after-fresh-login.png");
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach("shared-account-after-fresh-login", { path: screenshotPath, contentType: "image/png" });
});

test("account detail downloads only the requesting household owner's visible CSV rows", async ({ page }, testInfo) => {
  const fixture = await createCompletionFixture();
  const peerId = randomUUID();
  const accountId = randomUUID();
  await withFixtureClient(async client => {
    await client.query("BEGIN");
    try {
      await client.query(`INSERT INTO users (id, username, email, password_hash, email_verified)
        SELECT $1, $2, $3, password_hash, true FROM users WHERE id = $4`,
        [peerId, peerId, `peer-${peerId}@example.invalid`, fixture.userId]);
      await client.query("INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'member')",
        [fixture.householdId, peerId]);
      await client.query("INSERT INTO accounts (id, household_id, name, type, currency, is_private) VALUES ($1,$2,'CSV shared account','checking','ZMW',false)",
        [accountId, fixture.householdId]);
      await client.query(`INSERT INTO transactions (household_id, account_id, date, name, amount, type, currency, is_private, owner_user_id)
        VALUES ($1,$2,CURRENT_DATE,'Shared groceries',10,'expense','ZMW',false,NULL),
               ($1,$2,CURRENT_DATE,'My private purchase',20,'expense','ZMW',true,$3),
               ($1,$2,CURRENT_DATE,'Peers private purchase',30,'expense','ZMW',true,$4)`,
        [fixture.householdId, accountId, fixture.userId, peerId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
  await signIn(page, fixture, "csv");
  await page.goto(`/accounts/${accountId}`);
  await expect(page.getByRole("heading", { name: "CSV shared account" })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const [download, response] = await Promise.all([
    page.waitForEvent("download"),
    responseFor(page, `/api/accounts/${accountId}/transactions/export`, "GET"),
    page.getByRole("menuitem", { name: "Download transactions" }).click(),
  ]);
  expect(response.status()).toBe(200);
  expect(download.suggestedFilename()).toBe("transactions.csv");
  const path = testInfo.outputPath("transactions.csv");
  await download.saveAs(path);
  const csv = await readFile(path, "utf8");
  expect(csv).toContain("Shared groceries");
  expect(csv).toContain("My private purchase");
  expect(csv).not.toContain("Peers private purchase");
  expect(csv.trimEnd().split(/\r?\n/)).toHaveLength(3);
});
