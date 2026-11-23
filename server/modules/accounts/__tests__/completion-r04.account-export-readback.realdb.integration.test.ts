import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import request from "supertest";
import { Client } from "pg";
import { accountBalanceSnapshots, accounts, grzBonds, grzTBills, holdings, householdMembers, pensionHoldings, securities } from "@shared/schema";
import { db } from "../../../db";
import { accountService } from "../accounts.service";
import { createFXRateRepository, createFXRateService, setGlobalFXService } from "../../../core/calculations/currency/fxRates";
import { fxRates } from "@shared/schema";
import { a, actors, app, b, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const memberAccount = randomUUID(), securityId = randomUUID();
const holdingIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const extraIds = [randomUUID(), randomUUID(), randomUUID()];
const oldDate = "2020-06-15";
function day(offset: number) { const date = new Date(); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); }
const recentDate = day(-1), futureDate = day(7);
const summaryExpected = { owner: 5464.45, admin: 1020, member: 1064.44, view_only: 1020, professional: 1020 };
function get(path: string, viewer: Role | "outsider" = "member") {
  return request(app).get(`/api/accounts${path}`).set("Cookie", actors.get(viewer)!.cookie);
}
async function clearOwnRows() {
  await db.delete(grzTBills).where(inArray(grzTBills.id, extraIds));
  await db.delete(grzBonds).where(inArray(grzBonds.id, extraIds));
  await db.delete(pensionHoldings).where(inArray(pensionHoldings.id, extraIds));
  await db.delete(holdings).where(inArray(holdings.id, holdingIds));
  await db.delete(securities).where(eq(securities.id, securityId));
  await db.delete(accounts).where(eq(accounts.id, memberAccount));
}
function csvSummaryNetWorth(csv: string) {
  const row = csv.split(/\r?\n/).find(line => line.startsWith("Net Worth,"));
  expect(row).toBeDefined();
  return row!.split(",").at(-1);
}
/** Gate the actual old-row SQL, independent of which repository helper issues it. */
function beforeSnapshotRead(change: () => Promise<unknown>, table: "account_balance_snapshots" | "holdings" = "account_balance_snapshots") {
  const query = Client.prototype.query;
  const gate = vi.fn(change);
  let changed = false;
  const intercepted = function (this: Client, ...args: unknown[]) {
    const command = args[0];
    const text = typeof command === "string" ? command : command && typeof command === "object" && "text" in command ? String(command.text) : "";
    if (!changed && /^\s*(?:select|with)\b/i.test(text) && new RegExp(`(?:from|join)\\s+"${table}"`, "i").test(text)) {
      changed = true;
      return gate().then(() => Reflect.apply(query, this, args));
    }
    return Reflect.apply(query, this, args);
  };
  vi.spyOn(Client.prototype, "query").mockImplementation(intercepted as typeof Client.prototype.query);
  return gate;
}
async function instrument(kind: "T-bill" | "pension" | "bond", id: string, accountId: string | null, amount: string) {
  if (kind === "pension") return db.insert(pensionHoldings).values({ id, householdId: a, accountId, providerName: "Synthetic scoped pension", pensionType: "private", currentBalance: amount });
  const common = { id, householdId: a, accountId, faceValue: amount, purchasePrice: amount, purchaseDate: oldDate, maturityDate: day(91), status: "active" as const };
  if (kind === "T-bill") return db.insert(grzTBills).values({ ...common, tbillName: "Synthetic scoped bill", tenorDays: 91 });
  return db.insert(grzBonds).values({ ...common, bondName: "Synthetic scoped bond", tenorYears: 2, couponRate: "0.10" });
}

describe("R04 account summaries and balance exports retain their signed reader", () => {
  beforeAll(async () => {
    await start();
    // getTestApp omits startup jobs. Initialize the actual FX repository/service,
    // so an unset singleton cannot mask household-wide investment disclosure.
    setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates)));
  }, 20_000);
  beforeEach(async () => {
    await clearOwnRows();
    await reset();
    await db.insert(accounts).values({ id: memberAccount, householdId: a, name: "MEMBER_PRIVATE_ACCOUNT",
      type: "investment", currency: "ZMW", balance: "0.00", isPrivate: true, ownerUserId: actors.get("member")!.id });
    await db.insert(securities).values({ id: securityId, symbol: "R04EXPORT", name: "Synthetic readback security", type: "stock", currency: "ZMW", currentPrice: "1.00" });
    await db.insert(holdings).values([
      { id: holdingIds[0], householdId: a, accountId: ids.sharedAccount, quantity: "31.11", costBasis: "31.11" },
      { id: holdingIds[1], householdId: a, accountId: ids.privateAccount, quantity: "222.22", costBasis: "222.22" },
      { id: holdingIds[2], householdId: a, accountId: memberAccount, quantity: "44.44", costBasis: "44.44" },
      { id: holdingIds[3], householdId: b, accountId: ids.foreignAccount, quantity: "366.66", costBasis: "366.66" },
    ].map(row => ({ ...row, securityId })));
    await db.insert(accountBalanceSnapshots).values([
      { accountId: ids.sharedAccount, date: oldDate, balance: "123.45" },
      { accountId: ids.sharedAccount, date: recentDate, balance: "456.78" },
      { accountId: ids.sharedAccount, date: "1990-01-01", balance: "19.99" },
      { accountId: ids.sharedAccount, date: futureDate, balance: "6543.21" },
      { accountId: ids.privateAccount, date: oldDate, balance: "8777.77" },
      { accountId: memberAccount, date: oldDate, balance: "2888.88" },
    ]);
  });
  afterEach(async () => { vi.restoreAllMocks(); await clearOwnRows(); });
  afterAll(async () => { await clearOwnRows(); await stop(); });

  it.each(["owner", "admin", "member", "view_only", "professional"] as const)("%s summary includes public and own holdings without another member's private interests", async viewer => {
    const response = await get("/summary", viewer).expect(200);
    expect(response.body.data).toMatchObject({ totalAssets: summaryExpected[viewer], totalLiabilities: 0, netWorth: summaryExpected[viewer], currency: "ZMW" });
  });

  it.each(["owner", "admin", "member"] as const)("%s summary CSV agrees with their authorized summary, including valid holdings", async viewer => {
    const response = await get("/summary/export", viewer).expect(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(csvSummaryNetWorth(response.text)).toBe(String(summaryExpected[viewer]));
    expect(response.text).toContain("A5 SHARED");
    expect(response.text.includes("A5 PRIVATE")).toBe(viewer === "owner");
    expect(response.text.includes("MEMBER_PRIVATE_ACCOUNT")).toBe(viewer === "member");
  });

  it("preserves the ordinary service caller's own and public investment summary", async () => {
    expect(await accountService.getNetWorthSummary(a, actors.get("member")!.id))
      .toMatchObject({ netWorth: 1064.44, totalAssets: 1064.44, currency: "ZMW" });
    expect(csvSummaryNetWorth(await accountService.exportSummary(a, actors.get("member")!.id))).toBe("1064.44");
  });

  it("retains a legitimate foreign household holding only for that household's signed reader", async () => {
    const response = await get("/summary", "outsider").expect(200);
    expect(response.body.data).toMatchObject({ netWorth: 366.66, totalAssets: 366.66 });
  });

  it.each(["view_only", "professional"] as const)("%s may read visible historical values but cannot download household exports", async viewer => {
    const visible = await get(`/${ids.sharedAccount}/balance-history?dateRange=all`, viewer).expect(200);
    expect(visible.body.data).toEqual([{ date: oldDate, balance: 123.45 }, { date: recentDate, balance: 456.78 }]);
    await get("/summary/export", viewer).expect(403);
    await get(`/${ids.sharedAccount}/balance-history/export`, viewer).expect(403);
  });

  it.each(["owner", "admin", "member"] as const)("%s balance CSV preserves actual old rows and the existing all-history date bounds", async viewer => {
    const response = await get(`/${ids.sharedAccount}/balance-history/export`, viewer).expect(200);
    expect(response.text).toContain(`${oldDate},123.45`);
    expect(response.text).toContain(`${recentDate},456.78`);
    expect(response.text).not.toMatch(/19\.99|6543\.21|988\.89/);
    const ownPrivate = viewer === "owner" ? ids.privateAccount : viewer === "member" ? memberAccount : undefined;
    if (ownPrivate) expect((await get(`/${ownPrivate}/balance-history/export`, viewer).expect(200)).text)
      .toContain(viewer === "owner" ? `${oldDate},8777.77` : `${oldDate},2888.88`);
  });

  it("retains ordinary direct history/export callers with the same dated visible facts", async () => {
    const userId = actors.get("member")!.id;
    expect(await accountService.getBalanceHistory(ids.sharedAccount, a, userId, "all"))
      .toEqual([{ date: oldDate, balance: 123.45 }, { date: recentDate, balance: 456.78 }]);
    expect(await accountService.getBalanceHistory(ids.sharedAccount, a, userId, "1m"))
      .toEqual([{ date: recentDate, balance: 456.78 }]);
    expect(await accountService.exportBalanceHistory(ids.sharedAccount, a, userId)).toContain(`${oldDate},123.45`);
  });

  it("returns the same 404 for initially hidden and missing account history exports", async () => {
    const hidden = await get(`/${ids.privateAccount}/balance-history/export`).expect(404);
    const missing = await get(`/${randomUUID()}/balance-history/export`).expect(404);
    expect({ code: hidden.body.error.code, message: hidden.body.error.message })
      .toEqual({ code: missing.body.error.code, message: missing.body.error.message });
    expect(JSON.stringify(hidden.body)).not.toMatch(/8777\.77|4222\.23/);
  });

  it.each(["private", "foreign", "deleted", "missing"] as const)("does not export preflight-authorized old rows when their account becomes %s", async state => {
    const gate = beforeSnapshotRead(async () => {
      if (state === "private") return db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, ids.sharedAccount));
      if (state === "foreign") return db.update(accounts).set({ householdId: b }).where(eq(accounts.id, ids.sharedAccount));
      if (state === "deleted") return db.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, ids.sharedAccount));
      return db.delete(accounts).where(eq(accounts.id, ids.sharedAccount));
    });
    const response = await get(`/${ids.sharedAccount}/balance-history/export`).expect(404);
    expect(gate).toHaveBeenCalledOnce();
    expect(JSON.stringify(response.body)).not.toMatch(/123\.45|456\.78|988\.89/);
    expect(response.headers["content-type"]).not.toContain("text/csv");
  });

  it.each(["removed", "view_only", "professional"] as const)("rechecks the export grant after preflight when the member is %s", async state => {
    const gate = beforeSnapshotRead(async () => state === "removed"
      ? db.delete(householdMembers).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("member")!.id)))
      : db.update(householdMembers).set({ role: state }).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("member")!.id))));
    const response = await get(`/${ids.sharedAccount}/balance-history/export`).expect(403);
    expect(gate).toHaveBeenCalledOnce();
    expect(JSON.stringify(response.body)).not.toMatch(/123\.45|456\.78/);
  });

  it.each(["removed", "view_only"] as const)("ordinary export caller rejects a %s live grant at snapshot readback", async state => {
    const userId = actors.get("member")!.id;
    const gate = beforeSnapshotRead(async () => state === "removed"
      ? db.delete(householdMembers).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, userId)))
      : db.update(householdMembers).set({ role: state }).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, userId))));
    await expect(accountService.exportBalanceHistory(ids.sharedAccount, a, userId)).rejects.toMatchObject({ statusCode: 403 });
    expect(gate).toHaveBeenCalledOnce();
  });

  it.each(["T-bill", "pension"] as const)("retains public and own positive %s values while excluding peer-private interests", async kind => {
    await instrument(kind, extraIds[0], ids.sharedAccount, "12.34");
    await instrument(kind, extraIds[1], ids.privateAccount, "56.78");
    await instrument(kind, extraIds[2], memberAccount, "22.22");
    for (const [viewer, expected] of [["owner", 5533.57], ["member", 1099], ["admin", 1032.34]] as const) {
      expect((await get("/summary", viewer).expect(200)).body.data.netWorth).toBe(expected);
      expect(csvSummaryNetWorth((await get("/summary/export", viewer).expect(200)).text)).toBe(String(expected));
    }
  });

  it.each(["private holding", "private T-bill", "private pension", "unattributed T-bill", "unattributed pension", "unattributed bond"] as const)("makes an absent and %s source indistinguishable to an unauthorized recipient", async source => {
    const before = await get("/summary").expect(200);
    const csvBefore = await get("/summary/export").expect(200);
    if (source === "private holding") {
      await db.insert(holdings).values({ id: extraIds[0], householdId: a, accountId: ids.privateAccount, securityId, quantity: "9000.00", costBasis: "9000.00" });
    } else await instrument(source.includes("T-bill") ? "T-bill" : source.includes("pension") ? "pension" : "bond",
      extraIds[0], source.startsWith("private") ? ids.privateAccount : null, "9000.00");
    const after = await get("/summary").expect(200);
    const csvAfter = await get("/summary/export").expect(200);
    expect(after.body.data).toEqual(before.body.data);
    expect(csvAfter.text).toBe(csvBefore.text);
  });

  it("labels account-linked scope consistently without claiming a complete household total", async () => {
    const response = await get("/summary").expect(200);
    expect(response.body.data).toMatchObject({ scope: "visible_account_linked", complete: false });
    expect((await get("/summary/export").expect(200)).text).toContain("Visible account-linked wealth");
  });

  it("uses an explicit missing-data outcome for a provably visible bond without an authoritative current valuation", async () => {
    await instrument("bond", extraIds[0], ids.sharedAccount, "123.45");
    for (const path of ["/summary", "/summary/export"]) {
      const response = await get(path).expect(422);
      expect(response.body.error.code).toBe("FINANCIAL_DATA_UNAVAILABLE");
      expect(JSON.stringify(response.body)).not.toMatch(/123\.45|Synthetic scoped bond/);
      expect(response.body.data).toBeUndefined();
    }
  });

  it("keeps a private bond indistinguishable from its absence", async () => {
    const before = await get("/summary").expect(200);
    await instrument("bond", extraIds[0], ids.privateAccount, "123.45");
    expect((await get("/summary").expect(200)).body.data).toEqual(before.body.data);
  });

  it("does not mix cash read before a purchase with a holding read after it", async () => {
    await db.delete(holdings).where(inArray(holdings.id, holdingIds));
    await db.update(accounts).set({ balance: "0.00" }).where(eq(accounts.id, ids.privateAccount));
    await db.update(accounts).set({ balance: "100.00" }).where(eq(accounts.id, ids.sharedAccount));
    const gate = beforeSnapshotRead(async () => db.transaction(async tx => {
      await tx.update(accounts).set({ balance: "0.00" }).where(eq(accounts.id, ids.sharedAccount));
      await tx.insert(holdings).values({ id: holdingIds[0], householdId: a, accountId: ids.sharedAccount, securityId, quantity: "100.00", costBasis: "100.00" });
    }), "holdings");
    const response = await get("/summary").expect(200);
    expect(gate).toHaveBeenCalledOnce();
    expect(response.body.data.netWorth).toBe(100);
  });

  it("does not rebuild otherwise unchanged financial values for an unrelated account note", async () => {
    const transactions = vi.spyOn(db, "transaction");
    const publication = vi.spyOn(db, "execute");
    const gate = beforeSnapshotRead(async () => db.update(accounts).set({ notes: "Synthetic unrelated note" }).where(eq(accounts.id, ids.sharedAccount)), "holdings");
    const response = await get("/summary").expect(200);
    expect(gate).toHaveBeenCalledOnce();
    expect(response.body.data.netWorth).toBe(1064.44);
    expect(transactions).toHaveBeenCalledOnce();
    const checks = publication.mock.calls.map(([statement]) => typeof statement === "string" ? statement : new PgDialect().sqlToQuery(statement.getSQL()).sql)
      .filter(text => ['"household_members"', '"accounts"', '"holdings"', '"provider_fx_quotes"'].every(table => text.includes(table)));
    expect(checks).toHaveLength(1); // One fresh grant/audience/financial statement, no note-driven rebuild.
  });

  it("reads a full dated balance history once together with its grant and account", async () => {
    const original = Client.prototype.query;
    let reads = 0;
    const observed = function(this: Client, ...args: unknown[]) {
      const command = args[0];
      const text = typeof command === "string" ? command : command && typeof command === "object" && "text" in command ? String(command.text) : "";
      if (/^\s*(?:select|with)\b/i.test(text) && /(?:from|join)\s+"account_balance_snapshots"/i.test(text)) reads++;
      return Reflect.apply(original, this, args);
    };
    vi.spyOn(Client.prototype, "query").mockImplementation(observed as typeof Client.prototype.query);
    const response = await get(`/${ids.sharedAccount}/balance-history/export`).expect(200);
    expect(response.text).toContain(`${oldDate},123.45`);
    expect(reads).toBe(1);
  });
});
