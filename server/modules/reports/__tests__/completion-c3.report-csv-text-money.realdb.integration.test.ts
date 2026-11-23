import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  accounts, budgets, categories, categoryGroups, dataExports, fxRates,
  householdMembers, households, merchants, transactions, transactionSplits, users,
} from "@shared/schema";
import { db, pool } from "../../../db";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { createFXRateRepository, createFXRateService, setGlobalFXService } from "../../../core/calculations";

type Currency = "ZMW" | "USD";
type Tenant = { userId: string; householdId: string; email: string; currency: Currency; cookie: string;
  exports: Set<string>; sessionIds: Set<string> };
type CsvRow = Record<string, string>;
type ReportType = "transactions" | "spending" | "cashflow" | "budget" | "networth";
const tenants: Tenant[] = [];
const password = "SyntheticC3CsvText123!";
const first = "2026-10-01", last = "2026-10-31", day = "2026-10-15";
let app: Awaited<ReturnType<typeof getTestApp>>;
let passwordHash: string;

// Literal expectations pin core/csv.ts's existing six-prefix contract. These
// inert strings are parsed as text only; no spreadsheet or formula is executed.
const textCases = [
  { raw: "=CSV_CANARY", expected: "'=CSV_CANARY", amount: "1.00", balance: "99.00" },
  { raw: "+CSV_CANARY", expected: "'+CSV_CANARY", amount: "2.00", balance: "98.00" },
  { raw: "-CSV_CANARY", expected: "'-CSV_CANARY", amount: "3.00", balance: "97.00" },
  { raw: "@CSV_CANARY", expected: "'@CSV_CANARY", amount: "4.00", balance: "96.00" },
  { raw: "\tCSV_CANARY", expected: "'\tCSV_CANARY", amount: "5.00", balance: "95.00" },
  { raw: "\rCSV_CANARY", expected: "'\rCSV_CANARY", amount: "6.00", balance: "94.00" },
  { raw: "Comma, Control", expected: "Comma, Control", amount: "7.00", balance: "93.00" },
  { raw: 'Quote "Control"', expected: 'Quote "Control"', amount: "8.00", balance: "92.00" },
  { raw: "Line\nControl", expected: "Line\nControl", amount: "9.00", balance: "91.00" },
  { raw: "", expected: "", amount: "10.00", balance: "90.00" },
  // Spreadsheets skip leading whitespace: a space or tab before a prefix is still a formula.
  { raw: " =CSV_CANARY", expected: "' =CSV_CANARY", amount: "11.00", balance: "89.00" },
  { raw: " +CSV_CANARY", expected: "' +CSV_CANARY", amount: "12.00", balance: "88.00" },
  { raw: " -CSV_CANARY", expected: "' -CSV_CANARY", amount: "13.00", balance: "87.00" },
  { raw: " @CSV_CANARY", expected: "' @CSV_CANARY", amount: "14.00", balance: "86.00" },
  { raw: " \tCSV_CANARY", expected: " \tCSV_CANARY", amount: "15.00", balance: "85.00" }, // no formula character after whitespace
  { raw: " \rCSV_CANARY", expected: " \rCSV_CANARY", amount: "16.00", balance: "84.00" }, // no formula character after whitespace
  { raw: "\t=CSV_CANARY", expected: "'\t=CSV_CANARY", amount: "17.00", balance: "83.00" },
  { raw: "\t+CSV_CANARY", expected: "'\t+CSV_CANARY", amount: "18.00", balance: "82.00" },
  { raw: "\t-CSV_CANARY", expected: "'\t-CSV_CANARY", amount: "19.00", balance: "81.00" },
  { raw: "\t@CSV_CANARY", expected: "'\t@CSV_CANARY", amount: "20.00", balance: "80.00" },
  { raw: "\t\tCSV_CANARY", expected: "'\t\tCSV_CANARY", amount: "21.00", balance: "79.00" },
  { raw: "\t\rCSV_CANARY", expected: "'\t\rCSV_CANARY", amount: "22.00", balance: "78.00" },
] as const;

const signed = (tenant: Tenant, call: request.Test) => call.set("Cookie", tenant.cookie);
async function newTenant(currency: Currency = "ZMW") {
  const userId = randomUUID();
  const tenant: Tenant = { userId, householdId: randomUUID(), email: `c3-csv-${userId}@example.invalid`,
    currency, cookie: "", exports: new Set<string>(), sessionIds: new Set<string>() };
  tenants.push(tenant); // Track identity/email before the first write or assertion.
  await db.insert(households).values({ id: tenant.householdId, name: "Synthetic CSV contract", currency });
  await db.insert(users).values({ id: userId, email: tenant.email, username: `c3-csv-${userId}`,
    passwordHash, emailVerified: true, timezone: "Africa/Lusaka" });
  await db.insert(householdMembers).values({ householdId: tenant.householdId, userId, role: "member" });
  const login = await request(app).post("/api/auth/login").send({ email: tenant.email, password });
  tenant.cookie = (login.headers["set-cookie"] as unknown as string[] | undefined)?.join("; ") ?? "";
  const encodedSid = tenant.cookie.match(/(?:^|;\s*)connect\.sid=([^;]+)/)?.[1];
  if (encodedSid) {
    const signedSid = decodeURIComponent(encodedSid);
    if (signedSid.startsWith("s:")) tenant.sessionIds.add(signedSid.slice(2).split(".")[0]);
  }
  expect(login.status).toBe(200);
  expect(login.body.data.user).toMatchObject({ id: userId, emailVerified: true });
  expect(decodeURIComponent(tenant.cookie.split(";")[0])).toMatch(/^connect\.sid=s:/);
  return tenant;
}

async function newAccount(tenant: Tenant, name: string, initialBalance = "100.00") {
  const id = randomUUID();
  await db.insert(accounts).values({ id, householdId: tenant.householdId, ownerUserId: tenant.userId,
    name, type: "checking", currency: tenant.currency, initialBalance, balance: initialBalance, isPrivate: true });
  return id;
}

async function newCategory(tenant: Tenant, name: string) {
  const groupId = randomUUID(), categoryId = randomUUID();
  await db.insert(categoryGroups).values({ id: groupId, householdId: tenant.householdId, name,
    type: "expenses", budgetMode: "by_category", displayOrder: 0 });
  await db.insert(categories).values({ id: categoryId, householdId: tenant.householdId, groupId,
    name, includeInBudget: true, displayOrder: 0 });
  return { groupId, categoryId };
}

async function postExpense(tenant: Tenant, accountId: string, amount: string,
  options: { categoryId?: string; merchantId?: string; name?: string; notes?: string } = {}) {
  const response = await signed(tenant, request(app).post("/api/transactions")).send({
    accountId, date: day, type: "expense", amount: { amount, currency: tenant.currency },
    idempotencyKey: randomUUID(), isPrivate: true, ...options, name: options.name ?? "Controlled Expense",
  });
  const id: unknown = response.body.data?.id; // Capture the native ID before assertions.
  expect(response.status).toBe(201);
  if (typeof id !== "string") throw new Error("Native transaction response omitted its ID");
  const [stored] = await db.select().from(transactions).where(eq(transactions.id, id));
  expect(stored).toMatchObject({ householdId: tenant.householdId, ownerUserId: tenant.userId, accountId,
    amount, currency: tenant.currency, type: "expense", date: day, postingMode: "posted",
    postedBalanceDelta: `-${amount}`, isPending: false, deletedAt: null });
  return stored;
}

async function createExport(tenant: Tenant, reportType: ReportType, count: number) {
  const response = await signed(tenant, request(app).post("/api/reports/exports")).send({
    reportType, format: "csv", startDate: first, endDate: last, scope: "mine", interval: "month",
    includePending: false, includeTransfers: false, includeForecast: false,
    ...(reportType === "spending" ? { groupBy: "merchant" } : {}),
    ...(reportType === "transactions" ? { sort: "amount_asc" } : {}),
  });
  const id: unknown = response.body.data?.id;
  if (typeof id === "string") tenant.exports.add(id);
  expect(response.status).toBe(200);
  if (typeof id !== "string") throw new Error("Native export response omitted its ID");
  const [stored] = await db.select().from(dataExports).where(eq(dataExports.id, id));
  expect(stored).toMatchObject({ userId: tenant.userId, householdId: tenant.householdId,
    exportType: reportType, fileFormat: "csv", status: "completed", recordCount: count,
    dateRangeStart: first, dateRangeEnd: last, fileUrl: `/api/reports/exports/${id}?download=true`,
    parameters: { scope: "mine", reportType } });
  return id;
}

async function csv(tenant: Tenant, id: string, header: string) {
  const response = await signed(tenant, request(app).get(`/api/reports/exports/${id}?download=true`));
  expect(response.status).toBe(200);
  expect(response.headers["content-type"]).toContain("text/csv");
  expect(response.headers["content-disposition"]).toContain("attachment;");
  expect(response.text.split("\n")[0]).toBe(header);
  // The current serializer emits LF records. Pin the delimiter so a literal CR
  // test cell cannot become an inferred record delimiter in the test parser.
  return parse(response.text, { columns: true, skip_empty_lines: true, record_delimiter: "\n" }) as CsvRow[];
}

async function textSources(tenant: Tenant) {
  for (const item of textCases) {
    const name = item.raw || "Blank Label Control", accountName = item.raw || "Blank Account";
    // Explicit stored-label fixtures preserve TAB/CR, independently of any
    // authoring normalization. The financial posting/export callers stay native.
    const accountId = await newAccount(tenant, accountName);
    const { groupId, categoryId } = await newCategory(tenant, name);
    const merchantId = randomUUID();
    await db.insert(merchants).values({ id: merchantId, householdId: tenant.householdId, name });
    const stored = await postExpense(tenant, accountId, item.amount, { categoryId, merchantId, name, notes: item.raw });
    expect(stored).toMatchObject({ name, notes: item.raw, categoryId, merchantId });
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    const [category] = await db.select().from(categories).where(eq(categories.id, categoryId));
    const [group] = await db.select().from(categoryGroups).where(eq(categoryGroups.id, groupId));
    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, merchantId));
    expect(account).toMatchObject({ name: accountName, balance: item.balance, currency: tenant.currency });
    expect(category.name).toBe(name);
    expect(group.name).toBe(name);
    expect(merchant.name).toBe(name);
  }
}

beforeAll(async () => {
  app = await getTestApp();
  passwordHash = await hashPassword(password);
  setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates), {
    cacheTtlSeconds: 300, baseCurrency: "ZMW", fallbackDays: 30,
  }));
});

afterAll(async () => {
  const errors: unknown[] = [];
  for (const tenant of tenants) {
    try {
      const resolved = await pool.query<{ id: string }>("SELECT id FROM users WHERE id=$1 OR email=$2", [tenant.userId, tenant.email]);
      const actorIds = [...new Set<string>([tenant.userId, ...resolved.rows.map(row => row.id)])];
      const owned = await pool.query<{ id: string }>("SELECT id FROM data_exports WHERE household_id=$1 AND user_id=ANY($2::uuid[])", [tenant.householdId, actorIds]);
      for (const { id } of owned.rows) tenant.exports.add(id);
      if (tenant.exports.size) await pool.query("DELETE FROM data_exports WHERE household_id=$1 AND user_id=ANY($2::uuid[]) AND id=ANY($3::uuid[])",
        [tenant.householdId, actorIds, [...tenant.exports]]);
      await pool.query("DELETE FROM outbox_events WHERE household_id=$1 OR payload->>'userId'=ANY($2::text[]) OR lower(payload->>'recipient')=$3",
        [tenant.householdId, actorIds, tenant.email]);
      await pool.query("DELETE FROM security_audit_logs WHERE user_id=ANY($1::uuid[]) OR target_user_id=ANY($1::uuid[])", [actorIds]);
      await pool.query('DELETE FROM "session" WHERE sid=ANY($2::text[]) OR sess->>\'userId\'=ANY($1::text[]) OR sess->>\'mfaPendingUserId\'=ANY($1::text[])',
        [actorIds, [...tenant.sessionIds]]);
      await pool.query("DELETE FROM user_login_history WHERE user_id=ANY($1::uuid[])", [actorIds]);
      await pool.query("DELETE FROM user_sessions WHERE user_id=ANY($1::uuid[])", [actorIds]);
      await pool.query("DELETE FROM audit_logs WHERE household_id=$1 OR user_id=ANY($2::uuid[])", [tenant.householdId, actorIds]);
      // Exact generated household cascades remove the accounts, postings/intents,
      // labels and budgets. Report CSV stays in memory; no disk files are made.
      await pool.query("DELETE FROM households WHERE id=$1", [tenant.householdId]);
      await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [actorIds]);
    } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, "Synthetic CSV fixture cleanup failed");
});

describe("C3-14 signed CSV text neutralization and raw money representation", () => {
  it("neutralizes six prefixes and preserves benign transaction CSV text columns", async () => {
    const tenant = await newTenant();
    await textSources(tenant);
    const id = await createExport(tenant, "transactions", textCases.length);
    const rows = await csv(tenant, id, "date,name,merchant,category,account,type,amount,currency,amountBase,baseCurrency,isPending,notes,transactionId,splitId");
    expect(rows).toHaveLength(textCases.length);
    console.info(JSON.stringify({ csvTextMoney: { family: "transactions-text", rows } }));
    for (const [index, item] of textCases.entries()) {
      const row = rows[index], label = item.raw ? item.expected : "Blank Label Control";
      expect(row).toMatchObject({ date: day, type: "expense", currency: "ZMW", baseCurrency: "ZMW" });
      // Exact fixed two-decimal text: a scale-losing serializer must fail here.
      expect(row.amount).toBe(item.amount);
      expect(row.amountBase).toBe(item.amount);
      for (const column of ["name", "merchant", "category"] as const) expect.soft(row[column], `${index}:${column}`).toBe(label);
      expect.soft(row.account, `${index}:account`).toBe(item.raw ? item.expected : "Blank Account");
      expect.soft(row.notes, `${index}:notes`).toBe(item.expected);
    }
  }, 30_000);

  it.each(["normal", "legacy-null"] as const)("neutralizes six prefixes and preserves benign %s spending labels", async mode => {
    const tenant = await newTenant();
    await textSources(tenant);
    const id = await createExport(tenant, "spending", textCases.length);
    if (mode === "legacy-null") {
      await db.update(dataExports).set({ parameters: null }).where(and(
        eq(dataExports.id, id), eq(dataExports.householdId, tenant.householdId), eq(dataExports.userId, tenant.userId),
      ));
      const detail = await signed(tenant, request(app).get(`/api/reports/exports/${id}`));
      expect(detail.status).toBe(200);
      expect(detail.body.data).toMatchObject({ id, userId: tenant.userId, householdId: tenant.householdId, parameters: null });
    }
    const rows = await csv(tenant, id, "groupBy,label,amount,currency,percent");
    expect(rows).toHaveLength(textCases.length);
    console.info(JSON.stringify({ csvTextMoney: { family: `${mode}-spending-text`, rows } }));
    for (const item of textCases) {
      const matching = rows.filter(row => row.amount === item.amount);
      expect(matching).toHaveLength(1);
      expect(matching[0]).toMatchObject({ groupBy: mode === "normal" ? "merchant" : "categoryGroup", currency: "ZMW" });
      expect.soft(matching[0].label, item.raw || "blank-note control").toBe(item.raw ? item.expected : "Blank Label Control");
    }
  }, 30_000);

  it("keeps legitimate expense and negative cashflow cells numeric", async () => {
    const tenant = await newTenant();
    const accountId = await newAccount(tenant, "Controlled Cash");
    await postExpense(tenant, accountId, "12.50");
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    expect(account.balance).toBe("87.50");
    const json = await signed(tenant, request(app).get("/api/reports/cashflow")).query({ from: first, to: last, scope: "mine", interval: "month", includePending: false });
    expect(json.status).toBe(200);
    expect(json.body.data.series).toMatchObject([{ income: { amount: "0.00", currency: "ZMW" },
      expenses: { amount: "12.50", currency: "ZMW" }, savings: { amount: "-12.50", currency: "ZMW" }, debt: { amount: "0.00", currency: "ZMW" } }]);
    const transactionId = await createExport(tenant, "transactions", 1);
    const [expense] = await csv(tenant, transactionId, "date,name,merchant,category,account,type,amount,currency,amountBase,baseCurrency,isPending,notes,transactionId,splitId");
    expect(expense.type).toBe("expense");
    expect(expense.amount).toBe("12.50");
    expect(expense.amountBase).toBe("12.50");
    const cashflowId = await createExport(tenant, "cashflow", 1);
    const [cashflow] = await csv(tenant, cashflowId, "periodStart,periodEnd,income,expenses,savings,debt,savingsRate,currency,dataType");
    expect(cashflow).toMatchObject({ currency: "ZMW", dataType: "actual" });
    expect(cashflow.savings).toBe("-12.50");
    expect(cashflow.expenses).toBe("12.50");
    expect(cashflow.income).toBe("0.00");
    expect(cashflow.debt).toBe("0.00");
  });

  // NEW-14: a split purchase exports one row per split; each row names its parent transaction and its split.
  it("links each split row to its parent transaction and split in the transactions CSV", async () => {
    const tenant = await newTenant();
    const accountId = await newAccount(tenant, "Split Cash");
    const groceries = await newCategory(tenant, "Split Groceries"), dining = await newCategory(tenant, "Split Dining");
    const plain = await postExpense(tenant, accountId, "5.00");
    const response = await signed(tenant, request(app).post("/api/transactions")).send({
      accountId, date: day, type: "expense", name: "Split Purchase", amount: { amount: "30.00", currency: tenant.currency },
      idempotencyKey: randomUUID(), isPrivate: true, splits: [
        { amount: { amount: "20.00", currency: tenant.currency }, categoryId: groceries.categoryId },
        { amount: { amount: "10.00", currency: tenant.currency }, categoryId: dining.categoryId },
      ],
    });
    expect(response.status).toBe(201);
    const parentId: string = response.body.data.id;
    const splits = await db.select().from(transactionSplits).where(eq(transactionSplits.transactionId, parentId));
    const splitOf = (amount: string) => splits.find(split => split.amount === amount)!.id;
    expect(splits).toHaveLength(2);
    const id = await createExport(tenant, "transactions", 3);
    const rows = await csv(tenant, id, "date,name,merchant,category,account,type,amount,currency,amountBase,baseCurrency,isPending,notes,transactionId,splitId");
    expect(rows.map(row => [row.amount, row.category, row.transactionId, row.splitId])).toEqual([
      ["5.00", "", plain.id, ""],
      ["10.00", "Split Dining", parentId, splitOf("10.00")],
      ["20.00", "Split Groceries", parentId, splitOf("20.00")],
    ]);
  });

  it.each(["ZMW", "USD"] as const)("preserves raw fixed-two %s budget CSV money from native DTOs", async currency => {
    const tenant = await newTenant(currency);
    const accountId = await newAccount(tenant, "Budget Cash", "200.00");
    const { categoryId } = await newCategory(tenant, "Controlled Groceries");
    const created = await signed(tenant, request(app).post("/api/budgets")).send({ name: "Controlled Groceries", categoryId,
      amount: { amount: "100.00", currency }, period: "monthly" });
    const budgetId: unknown = created.body.data?.id;
    expect(created.status).toBe(201);
    if (typeof budgetId !== "string") throw new Error("Native budget response omitted its ID");
    const [budget] = await db.select().from(budgets).where(eq(budgets.id, budgetId));
    expect(budget).toMatchObject({ householdId: tenant.householdId, categoryId, amount: "100.00", currency });
    await postExpense(tenant, accountId, "125.50", { categoryId });
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    expect(account.balance).toBe("74.50");
    const json = await signed(tenant, request(app).get("/api/reports/cashflow/budget")).query({ from: first, to: last, scope: "mine", interval: "month" });
    expect(json.status).toBe(200);
    expect(json.body.data.comparison).toMatchObject([{ categoryId, budgeted: { amount: "100.00", currency },
      actual: { amount: "125.50", currency }, variance: { amount: "-25.50", currency } }]);
    const id = await createExport(tenant, "budget", 1);
    const rows = await csv(tenant, id, "period,category,budgeted,actual,variance,variancePercent,status,currency");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ category: "Controlled Groceries", currency });
    console.info(JSON.stringify({ csvTextMoney: { family: "budget-raw-money", currency, row: rows[0] } }));
    expect.soft(rows[0].budgeted).toBe("100.00");
    expect.soft(rows[0].actual).toBe("125.50");
    expect.soft(rows[0].variance).toBe("-25.50");
  });

  it.each(["ZMW", "USD"] as const)("preserves raw fixed-two %s net-worth CSV money from native DTOs", async currency => {
    const tenant = await newTenant(currency);
    const accountId = await newAccount(tenant, "Net Worth Cash", "200.00");
    await postExpense(tenant, accountId, "25.50");
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    expect(account).toMatchObject({ householdId: tenant.householdId, ownerUserId: tenant.userId, currency, balance: "174.50" });
    const json = await signed(tenant, request(app).get("/api/reports/net-worth")).query({ from: first, to: last, scope: "mine", interval: "month" });
    expect(json.status).toBe(200);
    expect(json.body.data.latest).toMatchObject({ netWorth: { amount: "174.50", currency },
      assets: { amount: "174.50", currency }, liabilities: { amount: "0.00", currency } });
    expect(json.body.data.series).toMatchObject([{ id: "Net Worth", data: [{ y: { amount: "174.50", currency } }] }]);
    const id = await createExport(tenant, "networth", 1);
    const rows = await csv(tenant, id, "date,netWorth,assets,liabilities,currency");
    expect(rows).toHaveLength(1);
    expect(rows[0].currency).toBe(currency);
    // This current-balance fallback does not establish historical coverage or a
    // completeness policy for its other CSV columns. Record them without an oracle.
    console.info(JSON.stringify({ csvTextMoney: { family: "networth-raw-money", currency, row: rows[0] } }));
    expect(rows[0].netWorth).toBe("174.50");
  });
});
