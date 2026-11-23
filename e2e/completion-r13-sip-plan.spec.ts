import { randomUUID } from "node:crypto";
import type { Locator, Response } from "@playwright/test";
import { test, expect, type Page } from "./protected-test";
import { createCompletionFixture, type CompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { loadTestTarget } from "../server/testing/test-target.mjs";

// Run with the completion config and line reporter. Step-retaining reporters can
// record credential entry even when trace, screenshots and video are disabled.
test.use({ trace: "off", screenshot: "off", video: "off" });

const recurringPath = "/api/investments/recurring";
const initialDate = "2099-03-31";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function choose(page: Page, form: Locator, label: string, option: string) {
  await form.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function expectSigned(response: Response, fixture: CompletionFixture, status = 200) {
  expect(response.status()).toBe(status);
  const request = response.request();
  expect(await request.headerValue("x-capital-subject")).toBe(fixture.userId);
  expect(await request.headerValue("x-capital-household")).toBe(fixture.householdId);
  if (request.method() !== "GET") {
    expect(Boolean(await request.headerValue("x-csrf-token"))).toBe(true);
  }
}

async function financialState(householdId: string) {
  return withFixtureClient(async client => {
    const accounts = (await client.query(
      "select id, currency, balance::text, initial_balance::text from accounts where household_id=$1 order by id",
      [householdId],
    )).rows;
    const { rows: [effects] } = await client.query(`select
      (select count(*)::int from transactions where household_id=$1) as cash,
      (select count(*)::int from holdings where household_id=$1) as holdings,
      (select count(*)::int from investment_transactions where household_id=$1) as investment_activity,
      (select count(*)::int from tax_lots where household_id=$1) as lots,
      (select count(*)::int from recurring_execution_log l join recurring_investments p
        on p.id=l.recurring_investment_id where p.household_id=$1) as executions`, [householdId]);
    return { accounts, effects };
  });
}

async function lifecycleState(fixture: CompletionFixture, planId: string) {
  return withFixtureClient(async client => {
    const home = [fixture.householdId];
    const plans = (await client.query(`select id, account_id, security_id, type, frequency, amount::text, currency,
      next_execution_date::text, is_active, authorization_revision, current_authorization_id
      from recurring_investments where household_id=$1 order by id`, home)).rows;
    const grants = (await client.query(`select id, plan_id, author_user_id, revision, authorization_contract_version,
      authorization_kind, account_id, security_id, amount::text, currency, frequency, initial_execution_date::text,
      authorized_terms_digest from investment_plan_authorizations where household_id=$1 order by revision, id`, home)).rows;
    const operations = (await client.query(`select operation_id, actor_user_id, action, request_version, expected_revision,
      plan_id, authorization_id from investment_plan_operations where household_id=$1 order by expected_revision, operation_id`, home)).rows;
    const audits = (await client.query(`select user_id, household_id, action, entity_type, entity_id, details
      from audit_logs where entity_type in ('recurring_investment','investment_plan_authorization')
      and (user_id=$2 or household_id=$1 or entity_id=$3 or entity_id in
        (select id from investment_plan_authorizations where household_id=$1))`,
    [fixture.householdId, fixture.userId, planId])).rows;
    return { plans, grants, operations, audits };
  });
}

test("records a native USD SIP under ZMW display, confirms its signed terms and reloads it inactive", async ({ page }) => {
  const ownedOrigin = loadTestTarget().server?.origin;
  if (!ownedOrigin) throw new Error("SIP journey requires the marked owned browser origin");
  const fixture = await createCompletionFixture();
  const securityId = randomUUID();
  const symbol = "SIP" + securityId.slice(0, 8);
  const instrument = "Synthetic USD SIP " + securityId.slice(0, 8);
  const custody = "Synthetic SIP custody";
  await withFixtureClient(async client => {
    await client.query("insert into securities(id,symbol,name,type,currency,current_price) values($1,$2,$3,'stock','USD',2)",
      [securityId, symbol, instrument]);
  });

  const observe = (method: string, path: string) => page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === ownedOrigin && url.pathname === path && response.request().method() === method;
  });

  await page.goto("/login");
  try {
    await page.getByLabel(/email/i).fill(fixture.email);
    await page.getByPlaceholder(/enter your password/i).fill(fixture.password);
  } catch {
    throw new Error("Could not enter the synthetic sign-in credentials.");
  }
  const [login] = await Promise.all([
    observe("POST", "/api/auth/login"),
    page.getByRole("button", { name: /sign in/i }).click(),
  ]);
  expect(login.status()).toBe(200);
  await expect(page).toHaveURL("/");
  const cookies = await page.context().cookies(ownedOrigin);
  expect(cookies.some(cookie => cookie.name === "connect.sid" && cookie.httpOnly)).toBe(true);

  await page.goto("/accounts");
  await page.getByRole("button", { name: /add account/i }).click();
  const account = page.getByRole("dialog");
  await account.getByRole("button", { name: /^Investment BOZ Bonds, Stocks$/ }).click();
  await account.getByLabel("Account Name", { exact: true }).fill(custody);
  await account.locator("#balance").fill("125");
  const [savedAccount] = await Promise.all([
    observe("POST", "/api/accounts"),
    account.getByRole("button", { name: "Save Account", exact: true }).click(),
  ]);
  await expectSigned(savedAccount, fixture, 201);
  const { data: { id: accountId } } = await savedAccount.json() as { data: { id: string } };
  const before = await financialState(fixture.householdId);
  expect(before).toEqual({
    accounts: [{ id: accountId, currency: "ZMW", balance: "125.00", initial_balance: "125.00" }],
    effects: { cash: 0, holdings: 0, investment_activity: 0, lots: 0, executions: 0 },
  });

  const [portfolio] = await Promise.all([
    observe("GET", "/api/investments/portfolio/summary"),
    page.goto("/investments"),
  ]);
  await expect(page).toHaveURL("/investments");
  await expectSigned(portfolio, fixture);
  expect(new URL(portfolio.url()).searchParams.get("baseCurrency")).toBe("ZMW");
  expect(await portfolio.json()).toMatchObject({ success: true, meta: { baseCurrency: "ZMW" } });
  const recurringTab = page.getByRole("tab", { name: "Recurring", exact: true });
  await recurringTab.click();
  const panel = page.getByRole("tabpanel", { name: "Recurring", exact: true });
  await expect(panel.getByRole("heading", { name: "No recurring plans", exact: true })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Record-only investment plans", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Record plan", exact: true }).click();

  const setup = page.getByRole("dialog", { name: "Setup Recurring Investment", exact: true });
  await choose(page, setup, "Custody account", `${custody} (ZMW)`);
  await choose(page, setup, "Instrument", `${symbol} - ${instrument}`);
  await setup.getByLabel("Amount (USD)", { exact: true }).fill("37.4");
  await setup.getByLabel("Initial date", { exact: true }).fill(initialDate);
  const terms = { type: "sip", accountId, securityId, amount: "37.40", currency: "USD", frequency: "monthly" };
  const [created] = await Promise.all([
    observe("POST", recurringPath),
    setup.getByRole("button", { name: "Confirm Setup", exact: true }).click(),
  ]);
  await expectSigned(created, fixture);
  const createBody = created.request().postDataJSON();
  expect(createBody).toEqual({ ...terms, nextExecutionDate: initialDate, operationId: expect.stringMatching(uuid) });
  const createEnvelope = await created.json();
  const plan = {
    ...terms, id: expect.stringMatching(uuid), householdId: fixture.householdId,
    nextExecutionDate: initialDate, authorizationInitialExecutionDate: initialDate,
  };
  expect(createEnvelope).toMatchObject({ success: true, data: {
    ...plan, isActive: true, authorizationStatus: "authorization_recorded", authorizationRevision: 1,
    permittedActions: ["authorize", "deactivate"],
  } });
  const planId: string = createEnvelope.data.id;
  await expect(setup).toBeHidden();
  expect(await financialState(fixture.householdId)).toEqual(before);

  const detailsButton = panel.getByRole("button", { name: "Details", exact: true });
  await detailsButton.click();
  const details = page.getByRole("dialog", { name: "Recurring plan details", exact: true });
  await expect(details.getByText("Authorization recorded", { exact: true })).toBeVisible();
  await expect(details.getByText(custody, { exact: true })).toBeVisible();
  await expect(details.getByText(instrument, { exact: true })).toBeVisible();
  await expect(details.getByText("USD 37.40", { exact: true })).toBeVisible();
  await expect(details.getByText("monthly", { exact: true })).toBeVisible();
  await expect(details.locator("dt:text-is('Initial authorization date') + dd")).toHaveText(initialDate);
  await expect(details.locator("dt:text-is('Next scheduled date') + dd")).toHaveText(initialDate);

  const planPath = `${recurringPath}/${planId}`;
  const [confirmed] = await Promise.all([
    observe("POST", `${planPath}/authorize`),
    details.getByRole("button", { name: "Confirm authorization", exact: true }).click(),
  ]);
  await expectSigned(confirmed, fixture);
  const confirmBody = confirmed.request().postDataJSON();
  expect(confirmBody).toEqual({ ...terms, expectedRevision: 1, initialExecutionDate: initialDate, operationId: expect.stringMatching(uuid) });
  expect(confirmBody.operationId).not.toBe(createBody.operationId);
  expect(await confirmed.json()).toMatchObject({ success: true, data: {
    ...plan, id: planId, isActive: true, authorizationStatus: "authorization_recorded", authorizationRevision: 2,
  } });
  expect(await financialState(fixture.householdId)).toEqual(before);

  const [deactivated] = await Promise.all([
    observe("DELETE", planPath),
    details.getByRole("button", { name: "Deactivate plan", exact: true }).click(),
  ]);
  await expectSigned(deactivated, fixture);
  expect(new URL(deactivated.url()).search).toBe("");
  expect(deactivated.request().postData()).toBeNull();
  expect(await deactivated.json()).toEqual({ success: true, message: "Plan deactivated" });
  await expect(details.getByText("Inactive", { exact: true })).toBeVisible();

  await page.reload();
  const [reloaded] = await Promise.all([observe("GET", recurringPath), recurringTab.click()]);
  await expectSigned(reloaded, fixture);
  expect(await reloaded.json()).toMatchObject({ success: true, data: [{
    ...plan, id: planId, isActive: false, authorizationStatus: "inactive", authorizationRevision: 2,
  }] });
  await expect(panel.getByText("Inactive", { exact: true })).toBeVisible();
  await detailsButton.click();
  await expect(details.getByText("Inactive", { exact: true })).toBeVisible();
  await expect(details.getByRole("button", { name: "Deactivate plan", exact: true })).toHaveCount(0);
  expect(await financialState(fixture.householdId)).toEqual(before);

  const stored = await lifecycleState(fixture, planId);
  const storedTerms = {
    account_id: accountId, security_id: securityId, amount: terms.amount, currency: terms.currency, frequency: terms.frequency,
  };
  const grant = {
    ...storedTerms, plan_id: planId, author_user_id: fixture.userId, authorization_contract_version: 1,
    authorization_kind: "record_only_sip", initial_execution_date: initialDate, authorized_terms_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
  };
  expect(stored.grants).toEqual([
    { ...grant, id: expect.stringMatching(uuid), revision: 1 },
    { ...grant, id: expect.stringMatching(uuid), revision: 2 },
  ]);
  const [createdGrant, confirmedGrant] = stored.grants;
  expect(stored.plans).toEqual([{
    ...storedTerms, id: planId, type: "sip", next_execution_date: initialDate,
    is_active: false, authorization_revision: 2, current_authorization_id: confirmedGrant.id,
  }]);
  const receipt = { actor_user_id: fixture.userId, request_version: 1, plan_id: planId };
  expect(stored.operations).toEqual([
    { ...receipt, operation_id: createBody.operationId, action: "create", expected_revision: 0, authorization_id: createdGrant.id },
    { ...receipt, operation_id: confirmBody.operationId, action: "reconfirm", expected_revision: 1, authorization_id: confirmedGrant.id },
  ]);
  const auditActor = { user_id: fixture.userId, household_id: null };
  expect(stored.audits).toHaveLength(3);
  expect(stored.audits).toEqual(expect.arrayContaining([
    ...stored.grants.map(row => ({
      ...auditActor, entity_type: "investment_plan_authorization", entity_id: row.id, action: "CREATE",
      details: { authorizationEvent: "sip_grant_v1", contractVersion: 1 },
    })),
    { ...auditActor, entity_type: "recurring_investment", entity_id: planId, action: "UPDATE",
      details: { authorizationEvent: "plan_deactivated_v1" } },
  ]));
});
