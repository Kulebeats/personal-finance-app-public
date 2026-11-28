import { test, expect, type Page } from "./protected-test";
import type { Locator } from "@playwright/test";
import { createCompletionFixture, type CompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { readBack, submitStep, type SubmitStep } from "./utils/submit";
import { testWithMutants } from "./utils/mutants";
import { escapeRegExp, responseValue, storedValue } from "./utils/observe";
import { moneyValue, sameValue } from "./utils/money-value";

const name = "Synthetic acquired evidence issue", custody = "Synthetic evidence custody", isin = "ZM0000000001";
const acquisitionDate = "2026-03-12", roundingPolicy = "round_total_and_clean_residual_to_accrued";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASIS_REFERENCE = "Synthetic acquisition statement 950 = 900 + 25.10 + 24.90";

/**
 * The journey's writes (QA-01: mutation-checked by scripts/e2e-mutation-check.mjs).
 * The bond's corrupt mutant buys at 951 (still a positive two-decimal price).
 * The basis amounts must sum to the purchase cash, so a single changed amount is
 * refused; its mutant instead changes the free-text source reference (500 chars max).
 */
const CREATE_BOND: SubmitStep = { name: "grz-bond", method: "POST", path: "/api/grz/bonds", corruptField: "purchasePrice" };
const RECORD_BASIS: SubmitStep = { name: "acquisition-evidence", method: "POST", path: /^\/api\/grz\/bonds\/[^/]+\/principal-basis$/, corruptField: "sourceReference" };
const RECORD_MARK: SubmitStep = { name: "market-evidence", method: "POST", path: /^\/api\/grz\/bonds\/[^/]+\/valuations$/ };

async function choose(page: Page, form: Locator, label: string, option: string) {
  await form.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function investments(page: Page) {
  await page.getByRole("navigation", { name: "Application navigation", exact: true }).getByRole("link", { name: "Investments", exact: true }).click();
  await expect(page).toHaveURL("/investments"); await page.getByRole("tab", { name: "Government (GRZ)" }).click();
}
async function saveEvidence(page: Page, fixture: CompletionFixture, bondId: string, kind: "acquisition" | "market", reference: string) {
  const step = kind === "acquisition" ? RECORD_BASIS : RECORD_MARK;
  const form = page.getByRole("dialog", { name: `Record ${kind} evidence`, exact: true });
  const recorded = await submitStep(page, step, () => form.getByRole("button", { name: `Record ${kind} evidence`, exact: true }).click());
  expect(new URL(recorded.url()).pathname).toBe(`/api/grz/bonds/${bondId}/${kind === "acquisition" ? "principal-basis" : "valuations"}`);
  expect(recorded.status()).toBe(201);
  const envelope = await recorded.json();
  // Before anything compares the response with the request it answered.
  await readBack(step, reference, {
    created: async () => responseValue(envelope.data?.sourceReference, "sourceReference"),
    db: () => storedValue(`select source_reference as value from ${kind === "acquisition" ? "grz_bond_principal_basis" : "grz_bond_valuations"}
      where id=$1 and household_id=$2 and bond_id=$3`, [envelope.data?.id, fixture.householdId, bondId]),
  });
  const submitted = recorded.request().postDataJSON();
  expect(recorded.request().headers()).toMatchObject({ "x-capital-subject": fixture.userId, "x-capital-household": fixture.householdId });
  expect(submitted.operationId).toMatch(uuid);
  expect(envelope.success).toBe(true);
  expect(envelope.data).toMatchObject({ operationId: submitted.operationId, bondId, authority: "member_recorded", isin, currency: "ZMW",
    sourceDate: submitted.sourceDate, sourceKind: submitted.sourceKind, sourceReference: submitted.sourceReference,
    policyVersion: kind === "acquisition" ? "grz_member_recorded_principal_basis_v1" : "grz_member_recorded_market_v1" });
  await expect(form.getByRole("status")).toHaveText(kind === "acquisition" ? "Acquisition evidence recorded." : "Market evidence recorded.");
  await form.getByRole("button", { name: "Close evidence", exact: true }).click();
  await expect(form).toBeHidden();
  return { submitted, data: envelope.data };
}
/**
 * A number field of a JSON body exactly as the server wrote it. The accounts
 * summary sends money as JSON numbers, so its amounts are read as these raw
 * tokens and compared as decimal text, never parsed into floats (a float sum
 * such as 1120.1000000000001 then shows as a mismatch). Exactly one occurrence.
 */
function rawNumber(json: string, field: string): string {
  const tokens = [...json.matchAll(new RegExp(`"${escapeRegExp(field)}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)(?=\\s*[,}])`, "g"))];
  if (tokens.length !== 1) throw new Error(`expected one plain number for ${field}, found ${tokens.length} in ${json}`);
  return tokens[0][1];
}
async function wealth(page: Page, fixture: CompletionFixture, date: string, amount: string, displayed: RegExp) {
  if (new URL(page.url()).pathname === "/accounts") await page.reload();
  else await page.getByRole("navigation", { name: "Application navigation", exact: true }).getByRole("link", { name: "Accounts", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: displayed })).toBeVisible();
  const summary = await page.request.get("/api/accounts/summary", { headers: { "x-capital-subject": fixture.userId, "x-capital-household": fixture.householdId } });
  expect(summary.status()).toBe(200);
  const json = await summary.text();
  expect(JSON.parse(json).data).toMatchObject({ currency: "ZMW", valuationDate: date });
  const expected = { totalAssets: amount, totalLiabilities: "0.00", netWorth: amount };
  for (const [field, want] of Object.entries(expected)) {
    const sent = moneyValue(rawNumber(json, field), "ZMW");
    expect(sameValue(sent, moneyValue(want, "ZMW")), `${field}: sent ${sent}, expected ${want} ZMW`).toBe(true);
  }
}
async function cashState(householdId: string) {
  return withFixtureClient(async client => ({
    accounts: (await client.query("select id,balance::text,initial_balance::text from accounts where household_id=$1 order by id", [householdId])).rows,
    cash: (await client.query("select id,type,amount::text,currency from transactions where household_id=$1 order by id", [householdId])).rows,
    activity: (await client.query("select id,type,amount::text,currency from investment_transactions where household_id=$1 order by id", [householdId])).rows,
    settlements: (await client.query("select operation_id from grz_principal_settlements where household_id=$1", [householdId])).rows,
    schedule: (await client.query(`select p.id,p.payment_date::text,p.payment_type,p.status,p.gross_amount::text,p.net_amount::text,
      p.income_transaction_id,p.investment_transaction_id from grz_bond_payments p join grz_bonds b on b.id=p.bond_id where b.household_id=$1 order by p.id`, [householdId])).rows,
  }));
}

testWithMutants("an acquired bond records explicit basis and two same-day market forms, survives reload, and changes wealth without posting cash", { corrupt: [CREATE_BOND, RECORD_BASIS] }, async (page) => {
  const fixture = await createCompletionFixture();
  const date = await withFixtureClient(async client => (await client.query<{ date: string }>("select to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD') as date")).rows[0].date);
  await page.goto("/login"); await page.getByLabel(/email/i).fill(fixture.email);
  await page.getByPlaceholder(/enter your password/i).fill(fixture.password);
  await page.getByRole("button", { name: /sign in/i }).click(); await expect(page).toHaveURL("/");
  await page.goto("/accounts"); await page.getByRole("button", { name: /add account/i }).click();
  const account = page.getByRole("dialog"); await account.getByRole("button", { name: /^Investment BOZ Bonds, Stocks$/ }).click();
  await account.getByLabel("Account Name", { exact: true }).fill(custody); await account.locator("#balance").fill("125");
  const accountSaved = page.waitForResponse(row => new URL(row.url()).pathname === "/api/accounts" && row.request().method() === "POST");
  await account.getByRole("button", { name: "Save Account", exact: true }).click();
  const accountResponse = await accountSaved; expect(accountResponse.status()).toBe(201); const accountId = (await accountResponse.json()).data.id;
  // Warm the same ordinary account view before adding any market evidence.
  await wealth(page, fixture, date, "125.00", /ZMW\s+125\.00/);
  await investments(page);
  await page.getByRole("button", { name: "Add Security", exact: true }).click();
  await page.getByRole("menuitem", { name: "Government Bond", exact: true }).click();
  const bondForm = page.getByRole("dialog", { name: "Add Government Bond", exact: true });
  await bondForm.getByLabel("Bond Name", { exact: true }).fill(name); await bondForm.getByLabel("ISIN (Optional)").fill(isin);
  await bondForm.getByLabel("Face Value (ZMW)").fill("1000"); await bondForm.getByLabel("Purchase Price (ZMW)").fill("950");
  await bondForm.getByLabel("Purchase Date", { exact: true }).fill(acquisitionDate);
  await bondForm.getByLabel("First coupon date you are entitled to").fill("2026-05-10");
  await bondForm.getByLabel("Maturity Date", { exact: true }).fill("2029-05-10"); await bondForm.getByLabel("Coupon Rate (%)").fill("18.99");
  await choose(page, bondForm, "Custody account (optional)", `${custody} (ZMW)`);
  const bondResponse = await submitStep(page, CREATE_BOND, () => bondForm.getByRole("button", { name: "Add Bond", exact: true }).click());
  expect(bondResponse.status()).toBe(201); const bondId = (await bondResponse.json()).data.id;
  // Before the acquisition form, which pre-fills its purchase cash from this price.
  await readBack(CREATE_BOND, "950", {
    db: () => storedValue("select purchase_price::text as value from grz_bonds where id=$1 and household_id=$2", [bondId, fixture.householdId]),
  });
  await expect(bondForm).toBeHidden(); const before = await cashState(fixture.householdId);
  expect(before.accounts).toEqual([{ id: accountId, balance: "125.00", initial_balance: "125.00" }]);
  expect(before.cash).toEqual([]); expect(before.activity).toEqual([]); expect(before.settlements).toEqual([]);

  await page.getByRole("button", { name: `Record acquisition evidence for ${name}`, exact: true }).click();
  const basis = page.getByRole("dialog", { name: "Record acquisition evidence", exact: true });
  await expect(basis.getByLabel("ISIN", { exact: true })).toHaveValue(isin);
  await expect(basis.getByLabel("Nominal principal (ZMW)")).toHaveValue("1000.00");
  await expect(basis.getByLabel("Purchase cash (ZMW)")).toHaveValue("950.00");
  for (const field of ["Principal cost (ZMW)", "Purchased interest (ZMW)", "Acquisition fees (ZMW)"]) await expect(basis.getByLabel(field)).toHaveValue("");
  await choose(page, basis, "Source type", "Custodian statement");
  await basis.getByLabel("Source date", { exact: true }).fill(date); await basis.getByLabel("Source reference").fill(BASIS_REFERENCE);
  await basis.getByLabel("Principal cost (ZMW)").fill("900"); await basis.getByLabel("Purchased interest (ZMW)").fill("25.10");
  await basis.getByLabel("Acquisition fees (ZMW)").fill("24.90");
  const acquisition = await saveEvidence(page, fixture, bondId, "acquisition", BASIS_REFERENCE);
  expect(acquisition.submitted).toMatchObject({ acquisitionDate, purchaseCashAmount: "950.00", principalCost: "900.00", purchasedInterest: "25.10", acquisitionFees: "24.90" });
  expect(acquisition.submitted).not.toHaveProperty("nominalAmount");
  const unvalued = await page.request.get("/api/accounts/summary", { headers: {
    "x-capital-subject": fixture.userId, "x-capital-household": fixture.householdId,
  } });
  expect(unvalued.status()).toBe(422);
  expect((await unvalued.json()).error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");

  await page.getByRole("button", { name: `Record market evidence for ${name}`, exact: true }).click();
  const clean = page.getByRole("dialog", { name: "Record market evidence", exact: true });
  await choose(page, clean, "Source type", "Same-issue quote"); await clean.getByLabel("Market evidence date").fill(date);
  const cleanReference = "Synthetic same-issue clean quote";
  await clean.getByLabel("Source reference").fill(cleanReference);
  await choose(page, clean, "Price basis", "Clean price"); await choose(page, clean, "Quote units", "Per ZMW 100 nominal");
  await clean.getByLabel("Quoted amount (ZMW)").fill("97"); await clean.getByLabel("Accrued interest in the same units (ZMW)").fill("2.51");
  const first = await saveEvidence(page, fixture, bondId, "market", cleanReference);
  expect(first.submitted).toMatchObject({ valuationDate: date, sourceDate: date, nominalAmount: "1000.00", quoteBasis: "clean", quoteUnits: "per_100_nominal", quotedAmount: "97", accruedInterest: "2.51" });
  expect(first.data).toMatchObject({ roundingPolicy, dirtyValue: { amount: "995.10", currency: "ZMW" }, cleanValue: { amount: "970.00", currency: "ZMW" }, accruedInterest: { amount: "25.10", currency: "ZMW" } });
  await wealth(page, fixture, date, "1120.10", /ZMW\s+1,120\.10/);

  await investments(page);
  await page.getByRole("button", { name: `Record market evidence for ${name}`, exact: true }).click();
  const dirty = page.getByRole("dialog", { name: "Record market evidence", exact: true });
  await choose(page, dirty, "Source type", "Same-issue trade"); await dirty.getByLabel("Market evidence date").fill(date);
  const dirtyReference = "Synthetic later same-day dirty trade with explicit accrued";
  await dirty.getByLabel("Source reference").fill(dirtyReference);
  await choose(page, dirty, "Price basis", "Dirty price"); await choose(page, dirty, "Quote units", "Whole holding");
  await expect(dirty.getByRole("checkbox", { name: "Accrued breakdown unavailable" })).not.toBeChecked();
  await dirty.getByLabel("Quoted amount (ZMW)").fill("993.8916"); await dirty.getByLabel("Accrued interest in the same units (ZMW)").fill("25.1366");
  const second = await saveEvidence(page, fixture, bondId, "market", dirtyReference);
  expect(second.submitted.operationId).not.toBe(first.submitted.operationId);
  expect(second.data).toMatchObject({ roundingPolicy, dirtyValue: { amount: "993.89", currency: "ZMW" }, cleanValue: { amount: "968.76", currency: "ZMW" }, accruedInterest: { amount: "25.13", currency: "ZMW" } });
  // Both marks have the same civil date. Only the later admitted mark belongs
  // in current wealth; neither face, acquisition cost nor both marks is added.
  await wealth(page, fixture, date, "1118.89", /ZMW\s+1,118\.89/);
  await page.reload(); await expect(page.getByRole("heading", { level: 1, name: /ZMW\s+1,118\.89/ })).toBeVisible();
  expect(await cashState(fixture.householdId)).toEqual(before);
  const persisted = await withFixtureClient(async client => ({
    basis: (await client.query(`select id::text,account_id::text,operation_id::text,recorded_by::text,authority,isin,currency,acquisition_date::text,source_date::text,source_kind,source_reference,nominal_amount::text,purchase_cash_amount::text,
      principal_cost::text,purchased_interest::text,acquisition_fees::text,policy_version from grz_bond_principal_basis where household_id=$1 and bond_id=$2`, [fixture.householdId, bondId])).rows,
    marks: (await client.query(`select id::text,operation_id::text,recorded_by::text,authority,valuation_date::text,source_date::text,
      source_kind,source_reference,isin,currency,nominal_amount::text,quote_basis,quote_units,quoted_amount::text,accrued_quote::text,dirty_value::text,clean_value::text,accrued_value::text,policy_version
      from grz_bond_valuations where household_id=$1 and bond_id=$2 order by sequence`, [fixture.householdId, bondId])).rows,
    holding: (await client.query("select status,purchase_price::text,face_value::text from grz_bonds where household_id=$1 and id=$2", [fixture.householdId, bondId])).rows,
  }));
  expect(persisted.basis).toEqual([{ id: acquisition.data.id, account_id: accountId, operation_id: acquisition.submitted.operationId, recorded_by: fixture.userId, authority: "member_recorded", isin, currency: "ZMW",
    acquisition_date: acquisitionDate, source_date: date, source_kind: "custodian_statement", source_reference: acquisition.submitted.sourceReference, nominal_amount: "1000.00",
    purchase_cash_amount: "950.00", principal_cost: "900.00", purchased_interest: "25.10", acquisition_fees: "24.90", policy_version: "grz_member_recorded_principal_basis_v1" }]);
  expect(persisted.marks).toEqual([
    expect.objectContaining({ id: first.data.id, operation_id: first.submitted.operationId, recorded_by: fixture.userId, authority: "member_recorded", valuation_date: date, source_date: date,
      source_kind: "same_issue_quote", source_reference: first.submitted.sourceReference, isin, currency: "ZMW", nominal_amount: "1000.00", quote_basis: "clean", quote_units: "per_100_nominal", quoted_amount: "97.00000000", accrued_quote: "2.51000000", dirty_value: "995.10", clean_value: "970.00", accrued_value: "25.10", policy_version: "grz_member_recorded_market_v1" }),
    expect.objectContaining({ id: second.data.id, operation_id: second.submitted.operationId, recorded_by: fixture.userId, authority: "member_recorded", valuation_date: date, source_date: date,
      source_kind: "same_issue_trade", source_reference: second.submitted.sourceReference, isin, currency: "ZMW", nominal_amount: "1000.00", quote_basis: "dirty", quote_units: "holding_amount", quoted_amount: "993.89160000", accrued_quote: "25.13660000", dirty_value: "993.89", clean_value: "968.76", accrued_value: "25.13", policy_version: "grz_member_recorded_market_v1" }),
  ]);
  expect(persisted.holding).toEqual([{ status: "active", purchase_price: "950.00", face_value: "1000.00" }]);
});
