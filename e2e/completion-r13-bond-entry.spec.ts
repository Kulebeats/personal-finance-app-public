import { test, expect, type Page } from "./protected-test";
import { createCompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { randomUUID } from "node:crypto";
import { readBack, submitStep, type SubmitStep } from "./utils/submit";
import { testWithMutants } from "./utils/mutants";
import { storedValue } from "./utils/observe";

/**
 * The Add Government Bond form's write (QA-01: mutation-checked by
 * scripts/e2e-mutation-check.mjs). Its corrupt mutant buys at 951: still a
 * positive two-decimal price, so the server accepts it.
 */
const CREATE_BOND: SubmitStep = { name: "grz-bond", method: "POST", path: "/api/grz/bonds", corruptField: "purchasePrice" };

async function openInvestments(page: Page, fixture: Awaited<ReturnType<typeof createCompletionFixture>>) {
  await page.goto("/login"); await page.getByLabel(/email/i).fill(fixture.email);
  await page.getByPlaceholder(/enter your password/i).fill(fixture.password);
  await page.getByRole("button", { name: /sign in/i }).click(); await expect(page).toHaveURL("/"); await page.goto("/investments");
  await expect(page.getByRole("heading", { name: "No Holdings Yet" })).toBeVisible();
}

for (const mode of ["existing", "new"] as const) {
  test(`recovers committed principal in ${mode} cash mode after losing the server response`, async ({ page }) => {
    const fixture = await createCompletionFixture(), date = new Date().toISOString().slice(0, 10);
    const maturityDate = new Date(Date.parse(date) - 86_400_000).toISOString().slice(0, 10);
    const accountName = "Principal cash", isin = "ZM0000000001", purchaseDate = "2025-01-02";
    await openInvestments(page, fixture);
    await page.goto("/accounts"); await page.getByRole("button", { name: /add account/i }).click();
    const account = page.getByRole("dialog");
    await account.getByRole("button", { name: /^Cash Physical Cash$/ }).click();
    await account.getByLabel("Account Name", { exact: true }).fill(accountName); await account.locator("#balance").fill("125");
    const accountSaved = page.waitForResponse(r => new URL(r.url()).pathname === "/api/accounts" && r.request().method() === "POST");
    await account.getByRole("button", { name: "Save Account", exact: true }).click();
    const accountResponse = await accountSaved; expect(accountResponse.status()).toBe(201);
    const accountId = (await accountResponse.json()).data.id;
    let receiptId: string | undefined;
    if (mode === "existing") {
      await page.goto("/transactions"); await page.getByRole("button", { name: "Add Transaction", exact: true }).click();
      const ordinary = page.getByRole("dialog", { name: "Add Transaction", exact: true });
      await ordinary.getByRole("button", { name: "CREDIT (Income)", exact: true }).click();
      await ordinary.getByLabel("Date", { exact: true }).click();
      const receiptDay = page.locator(`[role="gridcell"][data-day="${date}"]`);
      await expect(receiptDay).toBeVisible();
      if ((await receiptDay.getAttribute("aria-selected")) !== "true") await receiptDay.getByRole("button").click();
      await page.keyboard.press("Escape");
      await ordinary.getByPlaceholder("0.00", { exact: true }).fill("990");
      await ordinary.getByRole("combobox", { name: "Account", exact: true }).click();
      await page.getByRole("option", { name: accountName, exact: true }).click();
      await ordinary.getByRole("combobox", { name: "Category", exact: true }).click();
      await page.getByRole("option", { name: "Golden Income", exact: true }).click();
      const saved = page.waitForResponse(r => new URL(r.url()).pathname === "/api/transactions" && r.request().method() === "POST");
      await ordinary.getByRole("button", { name: "Add Transaction", exact: true }).click();
      const r = await saved; expect(r.status()).toBe(201);
      const ordinaryReceipt = (await r.json()).data;
      expect(ordinaryReceipt.date).toBe(date);
      receiptId = ordinaryReceipt.id;
    }
    const csrf = (await (await page.request.get("/api/csrf-token")).json()).csrfToken;
    const headers = { "x-csrf-token": csrf, "x-capital-subject": fixture.userId, "x-capital-household": fixture.householdId };
    async function record(path: string, data: object) {
      const response = await page.request.post(path, { headers, data });
      expect(response.status(), path).toBe(201); return (await response.json()).data;
    }
    const bond = await record("/api/grz/bonds", { bondName: "Principal recovery issue", isin, accountId, tenorYears: 5,
      faceValue: "1000", purchasePrice: "950", couponRate: "0.08", purchaseDate, firstCouponDate: maturityDate, maturityDate });
    await record(`/api/grz/bonds/${bond.id}/principal-basis`, { operationId: randomUUID(), acquisitionDate: purchaseDate,
      sourceDate: date, isin, currency: "ZMW", purchaseCashAmount: "950.00", principalCost: "900.00", purchasedInterest: "50.00",
      acquisitionFees: "0.00", sourceKind: "custodian_statement", sourceReference: "Synthetic acquisition receipt" });
    const mark = await record(`/api/grz/bonds/${bond.id}/valuations`, { operationId: randomUUID(), valuationDate: maturityDate, sourceDate: maturityDate,
      isin, currency: "ZMW", nominalAmount: "1000.00", sourceKind: "custodian_statement", sourceReference: "Synthetic ex-coupon receipt",
      quoteBasis: "clean", quoteUnits: "holding_amount", quotedAmount: "970.00", accruedInterest: "0.00" });
    const schedule = await page.request.get("/api/grz/bonds", { headers });
    expect(schedule.status()).toBe(200);
    const issuedBond = (await schedule.json()).data.find((item: { id: string }) => item.id === bond.id);
    const coupons = issuedBond.payments.filter((item: { paymentType: string }) => item.paymentType === "coupon");
    expect(coupons).toHaveLength(1);
    const coupon = await page.request.post(`/api/grz/payments/${coupons[0].id}/pay`, { headers, data: { accountId, date } });
    expect(coupon.status()).toBe(200);
    await page.goto("/investments"); await page.getByRole("tab", { name: "Government (GRZ)" }).click();
    await page.getByRole("button", { name: "Schedule" }).click(); await page.getByRole("button", { name: "Record principal" }).click();
    await page.getByLabel("Receiving account").selectOption(accountId); await page.getByLabel("Receipt date").fill(date);
    await page.getByLabel("Cash received (ZMW)").fill("990.00"); await page.getByLabel("Redemption fees (ZMW)").fill("10.00");
    await page.getByLabel("Cash entry").selectOption(mode);
    if (receiptId) await page.getByLabel("Matching income receipt").selectOption(receiptId);
    const payRoute = "**/api/grz/payments/*/pay";
    let committed: { operationId: string; cashTransactionId: string } | undefined;
    await page.route(payRoute, async route => {
      const response = await route.fetch();
      if (response.status() === 200) committed = (await response.json()).data.settlement;
      await route.abort("failed");
    }, { times: 1 });
    await page.getByRole("button", { name: "Confirm principal repayment" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /fetch|network/i })).toBeVisible();
    expect(committed?.cashTransactionId).toBeTruthy(); if (receiptId) expect(committed?.cashTransactionId).toBe(receiptId);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Retry original receipt" })).toBeHidden();
    const scheduleDialog = page.getByRole("dialog", { name: /payment schedule/i });
    await scheduleDialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(scheduleDialog).toBeHidden();
    await page.getByRole("button", { name: "Schedule" }).click();
    await page.getByRole("button", { name: "Review principal receipt" }).click();
    const replay = page.waitForResponse(r => r.url().endsWith("/pay") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Retry original receipt" }).click();
    const response = await replay; expect(response.status()).toBe(200); expect((await response.json()).data.settlement).toEqual(committed);
    await page.reload(); await page.getByRole("tab", { name: "Government (GRZ)" }).click();
    await expect(page.getByText("matured", { exact: true })).toBeVisible();
    const persisted = await withFixtureClient(async client => (await client.query(`select a.balance::text,
      (select count(*)::int from transactions t where t.account_id=a.id and t.type='asset_settlement') as receipts,
      (select count(*)::int from grz_bond_payments p join transactions t on t.id=p.income_transaction_id
        where p.id=$4 and p.bond_id=$2 and p.gross_amount=40 and p.withholding_tax=6 and p.net_amount=34
        and t.account_id=a.id and t.amount=34 and t.type='income' and t.date=$5) as coupons,
      (select count(*)::int from grz_principal_settlements e where e.bond_id=$2 and e.status='confirmed'
        and e.receipt_date=$5 and e.valuation_id=$6 and e.valuation->>'asOfDate'=$7
        and e.valuation->>'amount'='970.00' and e.valuation->>'settlementValueDifference'='20.00') as settlements,
      (select count(*)::int from investment_transactions i where i.account_id=a.id and i.type='maturity') as postings
      from accounts a where a.id=$1 and a.household_id=$3`, [accountId, bond.id, fixture.householdId, coupons[0].id, date, mark.id, maturityDate])).rows);
    expect(persisted).toEqual([{ balance: "1149.00", receipts: 1, coupons: 1, settlements: 1, postings: 1 }]);
  });
}
function cashState(householdId: string) {
  return withFixtureClient(async client => (await client.query(`select
    (select count(*)::int from accounts where household_id=$1) as accounts,
    (select count(*)::int from holdings where household_id=$1) as holdings,
    (select count(*)::int from transactions where household_id=$1) as cash,
    (select count(*)::int from investment_transactions where household_id=$1) as investments`, [householdId])).rows[0]);
}

test.describe("GRZ civil dates and denomination in a western timezone", () => {
test.use({ timezoneId: "America/Los_Angeles" });
testWithMutants("an empty-equity user records an accountless reopened950/face1000 bond through Investments and reloads its real issue schedule", { corrupt: [CREATE_BOND] }, async (page) => {
  const fixture = await createCompletionFixture();
  await withFixtureClient(async client => { await client.query("update user_display_settings set currency='USD' where user_id=$1", [fixture.userId]); });
  await openInvestments(page, fixture);
  const preference = page.waitForResponse(response => new URL(response.url()).pathname === "/api/settings/display" && response.status() === 200);
  await page.reload();
  expect((await (await preference).json()).data.settings.currency).toBe("USD");
  expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe("America/Los_Angeles");
  const before = await cashState(fixture.householdId); expect(before).toEqual({ accounts: 0, holdings: 0, cash: 0, investments: 0 });
  await page.getByRole("tab", { name: "Government (GRZ)" }).click();
  await page.getByRole("button", { name: "Add Security" }).click(); await page.getByRole("menuitem", { name: "Government Bond", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add Government Bond" });
  await dialog.getByLabel("Bond Name", { exact: true }).fill("Synthetic reopened GRZ");
  await dialog.getByLabel("ISIN (Optional)").fill("ZM0000000001");
  await dialog.getByLabel("Face Value (ZMW)").fill("1000"); await dialog.getByLabel("Purchase Price (ZMW)").fill("950");
  await dialog.getByLabel("Purchase Date", { exact: true }).fill("2026-03-12");
  await dialog.getByLabel("First coupon date you are entitled to").fill("2026-05-10");
  await dialog.getByLabel("Maturity Date", { exact: true }).fill("2029-05-10"); await dialog.getByLabel("Coupon Rate (%)").fill("18.99");
  const created = await submitStep(page, CREATE_BOND, () => dialog.getByRole("button", { name: "Add Bond", exact: true }).click());
  expect(created.status()).toBe(201);
  const result = await created.json(); const bondId = result.data.id;
  // The coupon schedule is drawn from face value, so a wrong price paints the same rows: read it back.
  await readBack(CREATE_BOND, "950", {
    db: () => storedValue("select purchase_price::text as value from grz_bonds where id=$1 and household_id=$2", [bondId, fixture.householdId]),
  });
  expect(created.request().headers()["x-capital-subject"]).toBe(fixture.userId);
  expect(created.request().headers()["x-capital-household"]).toBe(fixture.householdId);
  expect(created.request().postDataJSON()).toMatchObject({ purchasePrice: "950", faceValue: "1000", couponRate: "0.1899", firstCouponDate: "2026-05-10" });
  expect(created.request().postDataJSON()).not.toHaveProperty("accountId");
  await expect(dialog).toBeHidden(); await expect(page.getByRole("cell", { name: /Synthetic reopened GRZ/ })).toBeVisible();
  await expect(page.getByText("GRZ value held (ZMW)", { exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Face Value (ZMW)" })).toBeVisible();
  await page.reload(); await expect(page.getByRole("heading", { name: "No Holdings Yet" })).toBeVisible();
  await page.getByRole("tab", { name: "Government (GRZ)" }).click(); await expect(page.getByRole("cell", { name: /Synthetic reopened GRZ/ })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Synthetic reopened GRZ" })).toContainText("May 10, 2029");
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  const schedule = page.getByRole("dialog", { name: "Payment Schedule: Synthetic reopened GRZ" }); await expect(schedule).toBeVisible();
  await expect(schedule.getByRole("row").filter({ hasText: "coupon" })).toHaveCount(7);
  await expect(schedule.getByRole("row").filter({ hasText: "principal" })).toHaveCount(1);
  await expect(schedule.getByText(/94\.95/)).toHaveCount(7);
  await expect(schedule.getByText("May 10, 2026", { exact: true })).toBeVisible(); await expect(schedule.getByText(/K94\.95/)).toHaveCount(7);
  await expect(schedule.getByRole("columnheader", { name: "Gross (ZMW)" })).toBeVisible(); await expect(schedule.getByText(/\$/)).toHaveCount(0);
  const saved = await withFixtureClient(async client => {
    const holding = (await client.query("select account_id,purchase_price::text,face_value::text,coupon_rate::text,first_coupon_date::text from grz_bonds where id=$1 and household_id=$2", [bondId, fixture.householdId])).rows;
    const payments = (await client.query("select payment_date::text,payment_type,gross_amount::text,status from grz_bond_payments where bond_id=$1 order by payment_date,payment_type", [bondId])).rows;
    const count = (await client.query("select count(*)::int as count from grz_bonds where household_id=$1", [fixture.householdId])).rows[0].count;
    return { holding, payments, count };
  });
  expect(saved.count).toBe(1); expect(saved.holding).toEqual([{ account_id: null, purchase_price: "950.00", face_value: "1000.00", coupon_rate: "0.1899", first_coupon_date: "2026-05-10" }]);
  expect(saved.payments.filter(row => row.payment_type === "coupon").map(row => row.payment_date)).toEqual([
    "2026-05-10", "2026-11-10", "2027-05-10", "2027-11-10", "2028-05-10", "2028-11-10", "2029-05-10"]);
  expect(saved.payments).toContainEqual({ payment_date: "2029-05-10", payment_type: "principal", gross_amount: "1000.00", status: "scheduled" });
  expect(saved.payments.every(row => row.status === "scheduled")).toBe(true); expect(await cashState(fixture.householdId)).toEqual(before);
});
});

test("an empty investment user reaches real tax and pension tabs without adding an equity", async ({ page }) => {
  const fixture = await createCompletionFixture(); await openInvestments(page, fixture);
  await page.getByRole("tab", { name: "Tax Report", exact: true }).click(); await expect(page.getByRole("heading", { name: "Investment Tax Report" })).toBeVisible();
  await page.getByRole("tab", { name: "Pension", exact: true }).click(); await expect(page.getByText("Your Pensions", { exact: true })).toBeVisible();
  expect(await cashState(fixture.householdId)).toEqual({ accounts: 0, holdings: 0, cash: 0, investments: 0 });
});

test("a signed user explicitly links an already-owned bond to a visible custody account without a purchase cash posting", async ({ page }) => {
  const fixture = await createCompletionFixture(); await openInvestments(page, fixture); await page.goto("/accounts");
  await page.getByRole("button", { name: /add account/i }).click(); const account = page.getByRole("dialog");
  await account.getByRole("button", { name: /^Investment BOZ Bonds, Stocks$/ }).click();
  await account.getByLabel("Account Name", { exact: true }).fill("Synthetic ZMW custody"); await account.locator("#balance").fill("125");
  const [createdAccount] = await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === "/api/accounts" && response.request().method() === "POST"),
    account.getByRole("button", { name: "Save Account", exact: true }).click()]);
  expect(createdAccount.status()).toBe(201); const accountId = (await createdAccount.json()).data.id;
  await page.goto("/investments"); await expect(page.getByRole("heading", { name: "No Holdings Yet" })).toBeVisible();
  const before = await cashState(fixture.householdId);
  await page.getByRole("tab", { name: "Government (GRZ)" }).click(); await page.getByRole("button", { name: "Add Security" }).click();
  await page.getByRole("menuitem", { name: "Government Bond", exact: true }).click(); const dialog = page.getByRole("dialog", { name: "Add Government Bond" });
  await dialog.getByLabel("Bond Name", { exact: true }).fill("Synthetic custody-linked GRZ");
  await dialog.getByLabel("ISIN (Optional)").fill("ZM0000000001"); await dialog.getByLabel("Face Value (ZMW)").fill("1000");
  await dialog.getByLabel("Purchase Price (ZMW)").fill("950"); await dialog.getByLabel("Purchase Date", { exact: true }).fill("2026-03-12");
  await dialog.getByLabel("First coupon date you are entitled to").fill("2026-05-10"); await dialog.getByLabel("Maturity Date", { exact: true }).fill("2029-05-10");
  await dialog.getByLabel("Coupon Rate (%)").fill("18.99"); await dialog.getByRole("combobox", { name: "Custody account (optional)" }).click();
  await page.getByRole("option", { name: "Synthetic ZMW custody (ZMW)", exact: true }).click();
  await expect(dialog.getByText(/does not deduct the purchase price/i)).toBeVisible();
  const [createdBond] = await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === "/api/grz/bonds" && response.request().method() === "POST"),
    dialog.getByRole("button", { name: "Add Bond", exact: true }).click()]);
  expect(createdBond.status()).toBe(201); expect(createdBond.request().postDataJSON()).toMatchObject({ accountId, purchasePrice: "950", faceValue: "1000" });
  const bondId = (await createdBond.json()).data.id;
  const rows = await withFixtureClient(async client => (await client.query(`select b.account_id,b.purchase_price::text,b.face_value::text,a.balance::text
    from grz_bonds b join accounts a on a.id=b.account_id where b.id=$1 and b.household_id=$2`, [bondId, fixture.householdId])).rows);
  expect(rows).toEqual([{ account_id: accountId, purchase_price: "950.00", face_value: "1000.00", balance: "125.00" }]);
  expect(await cashState(fixture.householdId)).toEqual(before);
});
