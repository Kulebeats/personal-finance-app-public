import { randomUUID } from "node:crypto";
import { test, expect } from "./protected-test";
import { createCompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { loadTestTarget } from "../server/testing/test-target.mjs";
import { readBack, submitStep, type SubmitStep } from "./utils/submit";
import { testWithMutants } from "./utils/mutants";
import { responseValue, storedValue } from "./utils/observe";

/**
 * The two openings' writes (QA-01: mutation-checked by scripts/e2e-mutation-check.mjs).
 * The ZMW opening's corrupt mutant saves one share more; no other field is
 * bound to the quantity, so the server accepts it and only the read-back sees it.
 */
const OPEN_ZMW: SubmitStep = { name: "zmw-opening", method: "POST", path: "/api/investments/holdings", corruptField: "quantity" };
const OPEN_USD: SubmitStep = { name: "usd-opening", method: "POST", path: "/api/investments/holdings" };

testWithMutants("switches actual holding and portfolio values between ZMW and USD without changing financial records", { corrupt: [OPEN_ZMW] }, async (page) => {
  const ownedOrigin = loadTestTarget().server?.origin;
  if (!ownedOrigin) throw new Error("Currency journey requires the marked owned browser origin");
  const fixture = await createCompletionFixture(), date = "2026-01-20";
  const zmw = { id: randomUUID(), symbol: "Z" + randomUUID().slice(0, 8), name: "Synthetic R12 ZMW " + randomUUID().slice(0, 8) };
  const usd = { id: randomUUID(), symbol: "U" + randomUUID().slice(0, 8), name: "Synthetic R12 USD " + randomUUID().slice(0, 8) };
  const quoteIds = [randomUUID(), randomUUID()];
  await withFixtureClient(async client => {
    await client.query("BEGIN");
    try {
      await client.query(`insert into securities(id,symbol,name,type,currency,current_price)
        values($1,$2,$3,'stock','ZMW',10),($4,$5,$6,'stock','USD',10)`, [zmw.id, zmw.symbol, zmw.name, usd.id, usd.symbol, usd.name]);
      // Owned synthetic reference quotes exercise the real FX repository.
      // These current display rates attest no historical cost or dated return.
      await client.query(`insert into fx_rates(id,from_currency,to_currency,rate,date,source)
        values($1,'USD','ZMW',20,current_date,'synthetic_browser_r12_unit'),
              ($2,'ZMW','USD',0.05,current_date,'synthetic_browser_r12_unit')`, quoteIds);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  });
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(fixture.email);
  await page.getByPlaceholder(/enter your password/i).fill(fixture.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/accounts");
  await page.getByRole("button", { name: /add account/i }).click();
  const accountDialog = page.getByRole("dialog");
  await accountDialog.getByRole("button", { name: /^Investment BOZ Bonds, Stocks$/ }).click();
  await accountDialog.getByLabel("Account Name", { exact: true }).fill("R12 currency custody");
  await accountDialog.locator("#balance").fill("125");
  const [accountResponse] = await Promise.all([
    page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).origin === ownedOrigin
      && new URL(response.url()).pathname === "/api/accounts"),
    accountDialog.getByRole("button", { name: "Save Account", exact: true }).click(),
  ]);
  expect(accountResponse.status()).toBe(201);
  const accountId = (await accountResponse.json()).data.id as string;
  await page.goto("/investments");
  await expect(page.getByRole("heading", { name: "No Holdings Yet" })).toBeVisible();

  async function opening(step: SubmitStep, security: typeof zmw, currency: "ZMW" | "USD", quantity: string, first: boolean) {
    await page.getByRole("button", { name: first ? "Add Your First Holding" : "Add Holding", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder(/Search securities/).fill(security.name);
    await dialog.getByRole("button").filter({ hasText: security.name }).click();
    await dialog.getByLabel("Quantity", { exact: false }).fill(quantity);
    await dialog.getByLabel(`Purchase Price (${currency})`, { exact: false }).fill("8");
    await dialog.getByLabel("Purchase Date", { exact: true }).fill(date);
    const response = await submitStep(page, step, () => dialog.getByRole("button", { name: "Add Holding", exact: true }).click());
    expect(new URL(response.url()).origin).toBe(ownedOrigin);
    expect(response.status()).toBe(201);
    const holding = (await response.json()).data as { id: string; quantity: unknown };
    // Before any value painted from the quantity (row value, header total).
    await readBack(step, quantity, {
      created: async () => responseValue(holding.quantity, "quantity"),
      db: () => storedValue("select quantity::text as value from holdings where id=$1 and household_id=$2", [holding.id, fixture.householdId]),
    });
    expect(response.request().postDataJSON()).toMatchObject({ accountId, securityId: security.id, expectedCurrency: currency,
      quantity, costBasis: first ? "80.00" : "8.00", acquiredDate: date });
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("row").filter({ hasText: security.name })).toHaveCount(1);
    return holding.id;
  }
  const zmwHolding = await opening(OPEN_ZMW, zmw, "ZMW", "10", true), usdHolding = await opening(OPEN_USD, usd, "USD", "1", false);
  const holdingIds = [zmwHolding, usdHolding];
  const header = page.getByRole("heading", { name: "Investments", exact: true }).locator("..");
  const table = page.getByRole("table");
  const zmwRow = table.getByRole("row").filter({ hasText: zmw.name }), usdRow = table.getByRole("row").filter({ hasText: usd.name });
  // Check the column contract before addressing cells with duplicate money text.
  await expect(table.getByRole("columnheader").nth(2)).toHaveText("Price");
  await expect(table.getByRole("columnheader").nth(4)).toHaveText("Value");
  const zmwPrice = zmwRow.getByRole("cell").nth(2), usdPrice = usdRow.getByRole("cell").nth(2);
  const zmwValue = zmwRow.getByRole("cell").nth(4), usdValue = usdRow.getByRole("cell").nth(4);
  await expect(header.getByText("K300.00", { exact: true })).toBeVisible();
  await expect(zmwValue).toHaveText("K100.00"); await expect(usdValue).toHaveText("K200.00");

  async function financialState(knownPurchaseIds: readonly string[] = []) {
    return withFixtureClient(async client => {
      const home = [fixture.householdId];
      const accounts = (await client.query("select * from accounts where household_id=$1 order by id", home)).rows;
      const holdings = (await client.query("select * from holdings where household_id=$1 order by id", home)).rows;
      const purchases = (await client.query("select * from investment_transactions where household_id=$1 order by id", home)).rows;
      const lots = (await client.query("select * from tax_lots where household_id=$1 order by id", home)).rows;
      const disposals = (await client.query("select * from tax_lot_disposals where household_id=$1 order by id", home)).rows;
      const cash = (await client.query("select * from transactions where household_id=$1 order by id", home)).rows;
      const receipts = (await client.query("select * from investment_opening_operation_receipts where household_id=$1 order by operation_id", home)).rows;
      const purchaseIds = Array.from(new Set(knownPurchaseIds.concat(purchases.map(row => row.id))));
      const audits = (await client.query(`select * from audit_logs where (entity_type in ('account','holding','investment_transaction')
        and (user_id=$4 or household_id=$5)) or (entity_type='account' and entity_id=$1)
        or (entity_type='holding' and entity_id=any($2::uuid[]))
        or (entity_type='investment_transaction' and entity_id=any($3::uuid[])) order by id`,
      [accountId, holdingIds, purchaseIds, fixture.userId, fixture.householdId])).rows;
      return { accounts, holdings, purchases, lots, disposals, cash, receipts, audits };
    });
  }
  const before = await financialState(), purchaseIds = before.purchases.map(row => row.id as string);
  expect(before.accounts).toHaveLength(1); expect(before.accounts[0]).toMatchObject({ id: accountId, balance: "125.00" });
  expect(before.holdings).toHaveLength(2);
  expect(before.holdings).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: zmwHolding, account_id: accountId, security_id: zmw.id, quantity: "10.00000000", cost_basis: "80.00" }),
    expect.objectContaining({ id: usdHolding, account_id: accountId, security_id: usd.id, quantity: "1.00000000", cost_basis: "8.00", cost_basis_zmw: null, acquisition_fx_rate: null }),
  ]));
  expect(before.purchases).toHaveLength(2); expect(before.lots).toHaveLength(2); expect(before.receipts).toHaveLength(2);
  expect(before.cash).toEqual([]); expect(before.disposals).toEqual([]);
  for (const [holdingId, currency, quantity, nativeCost] of [[zmwHolding, "ZMW", "10.00000000", "80.00"], [usdHolding, "USD", "1.00000000", "8.00"]]) {
    const purchase = before.purchases.find(row => row.holding_id === holdingId)!, lot = before.lots.find(row => row.holding_id === holdingId)!;
    expect(purchase).toMatchObject({ type: "buy", account_id: accountId, currency, quantity, amount: nativeCost, linked_transaction_id: null });
    expect(lot).toMatchObject({ transaction_id: purchase.id, quantity, remaining_quantity: quantity, cost_basis: nativeCost });
    const receipt = before.receipts.find(row => row.holding_id === holdingId)!;
    expect(receipt).toMatchObject({ household_id: fixture.householdId, actor_user_id: fixture.userId, currency,
      creation_snapshot: { purchaseId: purchase.id, lotId: lot.id, holding: { id: holdingId } } });
  }
  const openingAudits = before.audits.filter(row => row.entity_type === "holding" || row.entity_type === "investment_transaction");
  expect(openingAudits).toHaveLength(4);
  for (const audit of openingAudits) expect(audit).toMatchObject({ action: "CREATE", user_id: fixture.userId, household_id: null });

  const [holdingsResponse, summaryResponse] = await Promise.all([
    page.waitForResponse(response => {
      const url = new URL(response.url());
      return response.request().method() === "GET" && url.origin === ownedOrigin && url.pathname === "/api/investments/holdings"
        && (url.searchParams.get("currency") || url.searchParams.get("baseCurrency")) === "USD";
    }),
    page.waitForResponse(response => {
      const url = new URL(response.url());
      return response.request().method() === "GET" && url.origin === ownedOrigin && url.pathname === "/api/investments/portfolio/summary"
        && (url.searchParams.get("currency") || url.searchParams.get("baseCurrency")) === "USD";
    }),
    page.getByRole("button", { name: "USD", exact: true }).click(),
  ]);
  expect(holdingsResponse.status()).toBe(200); expect(summaryResponse.status()).toBe(200);
  const listed = await holdingsResponse.json(), summary = await summaryResponse.json();
  expect(listed).toMatchObject({ success: true, meta: { baseCurrency: "USD" } });
  expect(listed.data).toHaveLength(2);
  expect(listed.data).toEqual(expect.arrayContaining([
    // Amounts are MoneyDto in the selected base currency (NEW-35 class).
    expect.objectContaining({ id: zmwHolding, currentValue: { amount: "5.00", currency: "USD" }, security: expect.objectContaining({ currency: "ZMW" }) }),
    expect.objectContaining({ id: usdHolding, currentValue: { amount: "10.00", currency: "USD" }, security: expect.objectContaining({ currency: "USD" }) }),
  ]));
  expect(summary).toMatchObject({ success: true, meta: { baseCurrency: "USD" }, data: { totalValue: { amount: "15.00", currency: "USD" }, holdingsCount: 2 } });
  await expect(header.getByText("$15.00", { exact: true })).toBeVisible();
  await expect(zmwValue).toHaveText("$5.00"); await expect(usdValue).toHaveText("$10.00");
  await expect(zmwPrice).toHaveText("K10.00"); await expect(usdPrice).toHaveText("$10.00");
  for (const wrongUnit of ["$100.00", "$200.00", "$300.00"]) {
    await expect(header.getByText(wrongUnit, { exact: true })).toHaveCount(0);
    await expect(zmwValue).not.toHaveText(wrongUnit); await expect(usdValue).not.toHaveText(wrongUnit);
  }
  expect(await financialState(purchaseIds)).toEqual(before);
  await page.getByRole("button", { name: "ZMW", exact: true }).click();
  await expect(header.getByText("K300.00", { exact: true })).toBeVisible();
  await expect(zmwValue).toHaveText("K100.00"); await expect(usdValue).toHaveText("K200.00");
  await expect(zmwPrice).toHaveText("K10.00"); await expect(usdPrice).toHaveText("$10.00");
  expect(await financialState(purchaseIds)).toEqual(before);
});
