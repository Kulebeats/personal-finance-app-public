import { seedLegacyCashCapture } from "../../../testing/fixtures/legacy-cash-capture";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import request from "supertest";
import type { NetWorthData } from "@shared/weekly-recap";
import { accountBalanceSnapshots, accounts, fxRates, grzTBills, holdings, households, userNotificationPreferences, netWorthSnapshots, pensionHoldings, securities, userDisplaySettings, users } from "@shared/schema";
import { db, pool } from "../../../db";
import { snapshotWorker } from "../../../jobs/snapshotWorker";
import { sendEmail } from "../../../services/emailService";
import { sendWeeklyRecapEmail } from "../weekly-recap.email.service";
import { weeklyRecapService } from "../weekly-recap.service";
import { householdRepository } from "../../../repositories/HouseholdRepository";
import * as captureFacts from "../../../jobs/snapshotProvenance";
import * as fxRepository from "../../../core/calculations/currency/fxRates";
import { portfolioValuationService } from "../../../services/PortfolioValuationService";
import { getPostgresError } from "../../../utils/postgresError";
import { a, actors, app, b, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

// Snapshot production, database reads, signed routes and digest rendering stay real.
vi.mock("../../../services/emailService", () => ({ sendEmail: vi.fn() }));
const smtp = vi.mocked(sendEmail);
const pensionId = randomUUID(), tbillId = randomUUID(), holdingId = randomUUID(), securityId = randomUUID(), fxId = randomUUID();
function day(offset: number) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}
let currentDate: string;
const previousDate = day(-8), from = day(-3), to = day(3);

async function captureToday() {
  expect(await snapshotWorker.processHousehold(a)).toBe(true);
}
async function cleanupSnapshots() {
  await db.delete(netWorthSnapshots).where(eq(netWorthSnapshots.householdId, a));
  await db.delete(accountBalanceSnapshots).where(inArray(accountBalanceSnapshots.accountId, [ids.sharedAccount, ids.privateAccount]));
  await db.delete(pensionHoldings).where(eq(pensionHoldings.id, pensionId));
  await db.delete(grzTBills).where(eq(grzTBills.id, tbillId));
  await db.delete(holdings).where(eq(holdings.id, holdingId));
  await db.delete(securities).where(eq(securities.id, securityId));
  await db.delete(fxRates).where(eq(fxRates.id, fxId));
}
function signedRecap(viewer: Role) {
  return request(app).get(`/api/weekly-recap?weekStart=${from}&weekEnd=${to}`)
    .set("Cookie", actors.get(viewer)!.cookie);
}
function assertHistoricalWorth(worth: Pick<NetWorthData, "current" | "previous" | "change" | "series">, owner: boolean) {
  expect(worth).toMatchObject(owner
    ? { current: 5211.12, previous: 4900, change: 311.12 }
    : { current: 988.89, previous: 900, change: 88.89 });
  expect(worth.series).toContainEqual(expect.objectContaining({ date: currentDate, value: owner ? 5211.12 : 988.89 }));
  if (!owner) {
    for (const secret of [5211.12, 4900, 4222.23, 4000, 1444.44, 8888.88]) {
      expect(Object.values(worth)).not.toContain(secret);
      expect(worth.series.map(point => point.value)).not.toContain(secret);
    }
  }
}

describe("weekly recap net worth projects persisted snapshot facts to its recipient", () => {
  beforeAll(async () => {
    await start();
    const clock = await db.execute(sql`SELECT (transaction_timestamp() AT TIME ZONE 'UTC')::date::text AS day`);
    currentDate = String(clock.rows[0].day);
    await db.insert(userNotificationPreferences).values(Array.from(actors.values(), actor => ({
      userId: actor.id, notificationType: "weekly_recap", emailEnabled: true,
    })));
  }, 20_000);
  beforeEach(async () => {
    await cleanupSnapshots();
    await reset();
    smtp.mockReset();
    smtp.mockResolvedValue(true);
    await db.update(households).set({ aiConsentGiven: true }).where(inArray(households.id, [a, b]));

    await seedLegacyCashCapture(a, previousDate, { accountId: ids.sharedAccount, balance: "900.00" },
      { accountId: ids.privateAccount, balance: "4000.00" });
    await db.update(accounts).set({ balance: "988.89" }).where(eq(accounts.id, ids.sharedAccount));
    await db.update(accounts).set({ balance: "4222.23" }).where(eq(accounts.id, ids.privateAccount));
    await captureToday();

    // Current account balances are intentionally different from both historical periods.
    await db.update(accounts).set({ balance: "1444.44" }).where(eq(accounts.id, ids.sharedAccount));
    await db.update(accounts).set({ balance: "8888.88" }).where(eq(accounts.id, ids.privateAccount));
  });
  afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await cleanupSnapshots(); });
  afterAll(async () => { await cleanupSnapshots(); await stop(); });

  it("preserves historical 0016 facts and persists current-day household and individual values through the worker", async () => {
    const aggregate = await db.select().from(netWorthSnapshots).where(eq(netWorthSnapshots.householdId, a)).orderBy(netWorthSnapshots.date);
    expect(aggregate).toHaveLength(2);
    expect(aggregate).toMatchObject([
      { date: previousDate, currency: "ZMW", netWorth: "4900.00", totalAssets: "4900.00", totalLiabilities: "0.00" },
      { date: currentDate, currency: "ZMW", netWorth: "5211.12", totalAssets: "5211.12", totalLiabilities: "0.00" },
    ]);
    expect(aggregate[1].accountBalances).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: ids.sharedAccount, balance: "988.89" }),
      expect.objectContaining({ accountId: ids.privateAccount, balance: "4222.23" }),
    ]));
    expect(aggregate[1].assetsByType).toMatchObject({ checking: "988.89", savings: "4222.23" });
    const accountFacts = await db.select().from(accountBalanceSnapshots)
      .where(inArray(accountBalanceSnapshots.accountId, [ids.sharedAccount, ids.privateAccount])).orderBy(accountBalanceSnapshots.date, accountBalanceSnapshots.accountId);
    expect(accountFacts).toHaveLength(4);
    expect(accountFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: ids.sharedAccount, date: previousDate, balance: "900.00" }),
      expect.objectContaining({ accountId: ids.privateAccount, date: previousDate, balance: "4000.00" }),
      expect.objectContaining({ accountId: ids.sharedAccount, date: currentDate, balance: "988.89" }),
      expect.objectContaining({ accountId: ids.privateAccount, date: currentDate, balance: "4222.23" }),
    ]));
  });

  it.each(["admin", "member", "view_only", "professional"] as const)("%s signed recap retains visible history without the owner's private worth", async viewer => {
    const response = await signedRecap(viewer).expect(200);
    assertHistoricalWorth(response.body.data.netWorth, false);
  });

  it("retains the owner's authorized historical account values instead of present balances", async () => {
    const response = await signedRecap("owner").expect(200);
    assertHistoricalWorth(response.body.data.netWorth, true);
  });

  it.each(["owner", "member"] as const)("%s mock-SMTP digest uses the recipient's valid dated worth", async viewer => {
    const [recipient] = await db.select({ email: users.email }).from(users).where(eq(users.id, actors.get(viewer)!.id));
    expect(await sendWeeklyRecapEmail(actors.get(viewer)!.id, a, recipient.email, from, to)).toBe("sent");
    expect(smtp).toHaveBeenCalledTimes(1);
    const message = smtp.mock.calls[0][0];
    expect(message.to).toBe(recipient.email);
    expect(message.html).toContain(viewer === "owner" ? "5,211.12" : "988.89");
    expect(message.html).toContain(viewer === "owner" ? "311.12" : "88.89");
    for (const presentValue of ["1,444.44", "8,888.88"]) expect(message.html).not.toContain(presentValue);
    if (viewer !== "owner") for (const secret of ["5,211.12", "4,900.00", "4,222.23", "4,000.00"]) expect(message.html).not.toContain(secret);
  });

  it.each(["previous", "current", "both"] as const)("represents missing %s history without current-balance or zero substitution", async missing => {
    const dates = missing === "both" ? [previousDate, currentDate] : [missing === "previous" ? previousDate : currentDate];
    await db.delete(netWorthSnapshots).where(and(eq(netWorthSnapshots.householdId, a), inArray(netWorthSnapshots.date, dates)));
    const response = await signedRecap("member").expect(200);
    expect(response.body.data.netWorth).toMatchObject({
      status: missing === "both" ? "unavailable" : "partial",
      current: missing === "previous" ? 988.89 : null,
      previous: missing === "current" ? 900 : null,
      change: null, changePercent: null, trend: null,
    });
    expect(response.body.data.recurring).toMatchObject({ count: 0, upcoming: [] });
    expect(response.body.data.spending).toBeDefined();
  });

  it("sends an honest unavailable worth section while retaining other digest sections", async () => {
    await db.delete(netWorthSnapshots).where(eq(netWorthSnapshots.householdId, a));
    const [recipient] = await db.select({ email: users.email }).from(users).where(eq(users.id, actors.get("member")!.id));
    expect(await sendWeeklyRecapEmail(actors.get("member")!.id, a, recipient.email, from, to)).toBe("sent");
    expect(smtp.mock.calls[0][0].html).toContain("Historical net worth is unavailable");
    expect(smtp.mock.calls[0][0].html).toContain("Spending");
    expect(smtp.mock.calls[0][0].html).not.toContain("1,444.44");
  });

  it.each(["deleted", "foreign", "missing"] as const)("applies the same live audience to both periods when the shared account is %s", async kind => {
    if (kind === "deleted") await db.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, ids.sharedAccount));
    else if (kind === "foreign") await db.update(accounts).set({ householdId: b }).where(eq(accounts.id, ids.sharedAccount));
    else await db.delete(accounts).where(eq(accounts.id, ids.sharedAccount));
    const response = await signedRecap("member").expect(200);
    expect(response.body.data.netWorth).toMatchObject({ status: "available", current: 0, previous: 0, change: 0, changePercent: null });
    const owner = await signedRecap("owner").expect(200);
    expect(owner.body.data.netWorth).toMatchObject({ current: 4222.23, previous: 4000, change: 222.23 });
  });

  it("does not treat an imported individual account rewrite as a new aggregate capture", async () => {
    await db.update(accountBalanceSnapshots).set({ balance: "999999.00" }).where(eq(accountBalanceSnapshots.accountId, ids.sharedAccount));
    const owner = await signedRecap("owner").expect(200);
    assertHistoricalWorth(owner.body.data.netWorth, true);
  });

  it.each(["pension", "holding", "T-bill"] as const)("does not infer investment absence from a zero-valued %s", async kind => {
    if (kind === "pension") {
      await db.insert(pensionHoldings).values({ id: pensionId, householdId: a, accountId: ids.privateAccount,
        providerName: "Private synthetic pension", pensionType: "private", currentBalance: "0.00" });
    } else if (kind === "holding") {
      await db.insert(securities).values({ id: securityId, symbol: "R04CAPTURE", name: "Private zero value holding", type: "stock", currency: "ZMW", currentPrice: "0.0000" });
      await db.insert(holdings).values({ id: holdingId, householdId: a, accountId: ids.privateAccount, securityId, quantity: "1.00000000", costBasis: "0.00" });
    } else {
      await db.insert(grzTBills).values({ id: tbillId, householdId: a, accountId: ids.privateAccount, tbillName: "Private synthetic zero", tenorDays: 91,
        faceValue: "0.00", purchasePrice: "0.00", purchaseDate: previousDate, maturityDate: day(91), status: "active" });
    }
    await db.update(accounts).set({ balance: "988.89" }).where(eq(accounts.id, ids.sharedAccount));
    await db.update(accounts).set({ balance: "4222.23" }).where(eq(accounts.id, ids.privateAccount));
    await captureToday();
    const response = await signedRecap("member").expect(200);
    expect(response.body.data.netWorth.current).toBeNull();
    expect(response.body.data.netWorth.previous).toBe(900);
    expect(response.body.data.netWorth.change).toBeNull();
  });

  it("omits excluded accounts from the replacement capture without claiming ownership of independent history", async () => {
    await db.update(accounts).set({ excludeFromNetWorth: true }).where(eq(accounts.id, ids.privateAccount));
    await captureToday();
    const rows = await db.select().from(accountBalanceSnapshots).where(and(eq(accountBalanceSnapshots.accountId, ids.privateAccount), eq(accountBalanceSnapshots.date, currentDate)));
    expect(rows).toHaveLength(1);
    const [capture] = await db.select().from(netWorthSnapshots).where(and(eq(netWorthSnapshots.householdId, a), eq(netWorthSnapshots.date, currentDate)));
    expect(capture.accountBalances).not.toEqual(expect.arrayContaining([expect.objectContaining({ accountId: ids.privateAccount })]));
  });

  it("does not leave a complete capture after an old SQL writer updates its aggregate", async () => {
    await db.execute(sql`insert into ${netWorthSnapshots} (household_id, date, total_assets, total_liabilities, net_worth, account_balances, currency)
      values (${a}, ${currentDate}, '5211.12', '0.00', '5211.12', '[]'::jsonb, 'ZMW')
      on conflict (household_id, date) do update set total_assets='12345.00', net_worth='12345.00'`);
    const invalidated = await db.execute(sql`select to_jsonb(s)->'provenance' as provenance from ${netWorthSnapshots} s where s.household_id=${a} and s.date=${currentDate}`);
    expect(invalidated.rows[0].provenance).toBeNull();
    const response = await signedRecap("owner").expect(200);
    expect(response.body.data.netWorth.current).toBeNull();
    expect(response.body.data.netWorth.change).toBeNull();
  });

  it("replaces the capture identity even when a same-day worker repeats unchanged amounts", async () => {
    const readId = async () => (await db.execute(sql`select to_jsonb(s)->'provenance'->>'captureId' as id from ${netWorthSnapshots} s where s.household_id=${a} and s.date=${currentDate}`)).rows[0].id;
    const before = await readId();
    await db.update(accounts).set({ balance: "988.89" }).where(eq(accounts.id, ids.sharedAccount));
    await db.update(accounts).set({ balance: "4222.23" }).where(eq(accounts.id, ids.privateAccount));
    await captureToday();
    const after = await readId();
    expect(typeof before).toBe("string");
    expect(typeof after).toBe("string");
    expect(after).not.toBe(before);
  });

  it("publishes only a coherent aggregate version while per-account persistence is blocked", async () => {
    const blocker = await pool.connect();
    let pending: Promise<void> | undefined;
    let waiting = false;
    let during: string | undefined;
    try {
      await db.update(accounts).set({ balance: "2222.00" }).where(eq(accounts.id, ids.sharedAccount));
      await db.update(accounts).set({ balance: "3333.00" }).where(eq(accounts.id, ids.privateAccount));
      await blocker.query("BEGIN");
      const { rows: [{ pid }] } = await blocker.query<{ pid: number }>("select pg_backend_pid() as pid");
      await blocker.query("update account_balance_snapshots set balance=balance where account_id=$1 and date=$2", [ids.sharedAccount, currentDate]);
      pending = captureToday();
      void pending.catch(() => undefined);
      for (let attempt = 0; attempt < 160 && !waiting; attempt++) {
        const { rows } = await pool.query<{ blocked: boolean }>("select exists(select 1 from pg_stat_activity where $1=any(pg_blocking_pids(pid))) as blocked", [pid]);
        waiting = rows[0].blocked;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 25));
      }
      const [visible] = await db.select().from(netWorthSnapshots).where(and(eq(netWorthSnapshots.householdId, a), eq(netWorthSnapshots.date, currentDate)));
      during = visible.netWorth;
      await blocker.query("COMMIT");
    } finally {
      try { await blocker.query("ROLLBACK"); } finally { blocker.release(); }
      if (pending) await pending;
    }
    expect(waiting).toBe(true);
    expect(during).toBe("5211.12");
    const [committed] = await db.select().from(netWorthSnapshots).where(and(eq(netWorthSnapshots.householdId, a), eq(netWorthSnapshots.date, currentDate)));
    expect(committed.netWorth).toBe("5555.00");
  });

  it("replaces currency together with the rest of an upserted capture", async () => {
    await db.insert(fxRates).values({ id: fxId, fromCurrency: "ZMW", toCurrency: "USD", rate: "1.5000", date: currentDate, source: "r04-synthetic-capture" });
    await db.update(households).set({ currency: "USD" }).where(eq(households.id, a));
    try {
      await captureToday();
      const [capture] = await db.select().from(netWorthSnapshots).where(and(eq(netWorthSnapshots.householdId, a), eq(netWorthSnapshots.date, currentDate)));
      expect(capture.currency).toBe("USD");
    } finally {
      await db.update(households).set({ currency: "ZMW" }).where(eq(households.id, a));
    }
  });

  it("labels digest worth with its captured currency rather than recipient preference", async () => {
    const userId = actors.get("owner")!.id;
    await db.insert(userDisplaySettings).values({ userId, currency: "USD" })
      .onConflictDoUpdate({ target: userDisplaySettings.userId, set: { currency: "USD" } });
    const [recipient] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
    try {
      expect(await sendWeeklyRecapEmail(userId, a, recipient.email, from, to)).toBe("sent");
      const html = smtp.mock.calls[0][0].html;
      expect(html).toContain("ZMW");
      expect(html).not.toContain("$5,211.12");
    } finally { await db.delete(userDisplaySettings).where(eq(userDisplaySettings.userId, userId)); }
  });

  it.each(["service", "signed", "history", "mail"] as const)("rechecks source privacy at %s publication without losing membership", async boundary => {
    await db.update(accounts).set({ isPrivate: false }).where(eq(accounts.id, ids.privateAccount));
    const findMember = householdRepository.findMember.bind(householdRepository);
    // The email path reads membership once before its single financial release query.
    const target = boundary === "service" ? 2 : boundary === "history" ? 18 : boundary === "signed" ? 4 : 1;
    let checks = 0;
    const guard = vi.spyOn(householdRepository, "findMember").mockImplementation(async (...args) => {
      if (++checks === target) await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, ids.privateAccount));
      return findMember(...args);
    });
    const userId = actors.get("member")!.id;
    if (boundary === "service") assertHistoricalWorth((await weeklyRecapService.getRecap(a, userId, from, to)).netWorth, false);
    else if (boundary === "signed") assertHistoricalWorth((await signedRecap("member").expect(200)).body.data.netWorth, false);
    else if (boundary === "history") {
      const response = await request(app).get("/api/weekly-recap/history").set("Cookie", actors.get("member")!.cookie).expect(200);
      const serialized = JSON.stringify(response.body.data.history);
      expect(serialized).not.toContain("5211.12");
      expect(serialized).not.toContain("4900");
      expect(serialized).toContain("988.89");
    } else {
      const [recipient] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
      expect(await sendWeeklyRecapEmail(userId, a, recipient.email, from, to)).toBe("sent");
      expect(smtp.mock.calls[0][0].html).toContain("988.89");
      expect(smtp.mock.calls[0][0].html).not.toContain("5,211.12");
    }
    expect(checks).toBeGreaterThanOrEqual(target);
    guard.mockRestore();
  });

  it.each([1, 2])("withdraws newly private worth before delivery grant query %i", async grantNumber => {
    await db.update(accounts).set({ isPrivate: false }).where(eq(accounts.id, ids.privateAccount));
    const query = Client.prototype.query;
    const privatize = vi.fn(() => db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, ids.privateAccount)));
    let queries = 0;
    const intercept = function (this: Client, ...args: unknown[]) {
      const command = args[0];
      const text = typeof command === "string" ? command : command && typeof command === "object" && "text" in command ? String(command.text) : "";
      if (!privatize.mock.calls.length && text.includes('"ai_consent_given"') && text.includes('"email_enabled"') && text.includes('"household_members"') && ++queries === grantNumber) {
        return Promise.resolve(privatize()).then(() => Reflect.apply(query, this, args));
      }
      return Reflect.apply(query, this, args);
    };
    vi.spyOn(Client.prototype, "query").mockImplementation(intercept as typeof Client.prototype.query);
    const userId = actors.get("member")!.id;
    const [recipient] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
    expect(await sendWeeklyRecapEmail(userId, a, recipient.email, from, to)).toBe("sent");
    expect(privatize).toHaveBeenCalledOnce();
    expect(smtp.mock.calls[0][0].html).toContain("988.89");
    expect(smtp.mock.calls[0][0].html).not.toContain("5,211.12");
  });

  it("keeps a valid absolute change from a captured zero without inventing its percentage", async () => {
    await seedLegacyCashCapture(a, previousDate, { accountId: ids.sharedAccount, balance: "0.00" },
      { accountId: ids.privateAccount, balance: "4000.00" });
    const response = await signedRecap("member").expect(200);
    expect(response.body.data.netWorth).toMatchObject({ status: "available", current: 988.89, previous: 0, change: 988.89, changePercent: null, trend: "up" });
  });

  it("preserves legacy JSON but marks unattested historical worth unavailable", async () => {
    await db.execute(sql`update ${netWorthSnapshots} set provenance=null where household_id=${a}`);
    const [legacy] = await db.select().from(netWorthSnapshots).where(eq(netWorthSnapshots.householdId, a));
    expect(Array.isArray(legacy.accountBalances)).toBe(true);
    const response = await signedRecap("owner").expect(200);
    expect(response.body.data.netWorth).toMatchObject({ status: "unavailable", current: null, previous: null });
    expect(response.body.data.spending).toBeDefined();
  });

  it("uses captured account kind and denomination after the live account changes", async () => {
    await db.update(accounts).set({ type: "credit", currency: "USD" }).where(eq(accounts.id, ids.sharedAccount));
    const response = await signedRecap("member").expect(200);
    assertHistoricalWorth(response.body.data.netWorth, false);
    expect(response.body.data.netWorth).toMatchObject({ currency: "ZMW", asOf: currentDate,
      currentMoney: { amount: "988.89", currency: "ZMW" }, previousMoney: { amount: "900.00", currency: "ZMW" } });
  });

  it("retries a stale capture transaction and bounds persistent serialization failure", async () => {
    const transaction = db.transaction.bind(db);
    const stale = Object.assign(new Error("synthetic snapshot serialization failure"), { code: "40001" });
    const attempt = vi.spyOn(db, "transaction").mockImplementation(transaction).mockRejectedValueOnce(stale);
    await captureToday();
    expect(attempt).toHaveBeenCalledTimes(2);
    attempt.mockReset().mockRejectedValue(stale);
    await expect(captureToday()).rejects.toMatchObject({ code: "40001" });
    expect(attempt).toHaveBeenCalledTimes(3);
    attempt.mockRestore();
  });

  it.each(["duplicate account", "wrong amount", "wrong kind", "unproven FX"] as const)("independently rejects complete-looking capture content with %s", async malformed => {
    const [row] = await db.select().from(netWorthSnapshots).where(and(eq(netWorthSnapshots.householdId, a), eq(netWorthSnapshots.date, currentDate)));
    const payload = row.provenance as { captureId: string; contributions: Array<{ accountId: string; baseAmount: string; kind: string; fx: string }> };
    const contributions = payload.contributions.map(item => ({ ...item }));
    if (malformed === "duplicate account") contributions[1].accountId = contributions[0].accountId;
    else if (malformed === "wrong amount") contributions[0].baseAmount = "999999.00";
    else if (malformed === "wrong kind") contributions[0].kind = "liability";
    else contributions[0].fx = "unproven";
    await db.update(netWorthSnapshots).set({ provenance: { ...payload, captureId: randomUUID(), contributions } }).where(eq(netWorthSnapshots.id, row.id));
    // This header is accepted by the DDL guard: the reader owns content proof.
    const [stored] = await db.select().from(netWorthSnapshots).where(eq(netWorthSnapshots.id, row.id));
    expect(stored.provenance).not.toBeNull();
    const response = await signedRecap("owner").expect(200);
    expect(response.body.data.netWorth).toMatchObject({ status: "partial", current: null, previous: 4900, change: null });
  });

  it("prevents an earlier input capture from overwriting a newer queued capture", async () => {
    const blocker = await pool.connect();
    const pending: Array<Promise<boolean>> = [];
    let earlierPid: number | undefined, queued = false;
    try {
      await db.update(accounts).set({ balance: "2222.00" }).where(eq(accounts.id, ids.sharedAccount));
      await db.update(accounts).set({ balance: "3333.00" }).where(eq(accounts.id, ids.privateAccount));
      await blocker.query("BEGIN");
      const { rows: [{ pid }] } = await blocker.query<{ pid: number }>("select pg_backend_pid() as pid");
      await blocker.query("update account_balance_snapshots set balance=balance where account_id=$1 and date=$2", [ids.sharedAccount, currentDate]);
      pending.push(snapshotWorker.processHousehold(a));
      void pending[0].catch(() => undefined);
      for (let attempt = 0; attempt < 160 && !earlierPid; attempt++) {
        const { rows } = await pool.query<{ pid: number }>("select pid from pg_stat_activity where $1=any(pg_blocking_pids(pid))", [pid]);
        earlierPid = rows[0]?.pid;
        if (!earlierPid) await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(earlierPid).toBeDefined();
      await db.update(accounts).set({ balance: "4444.00" }).where(eq(accounts.id, ids.sharedAccount));
      pending.push(snapshotWorker.processHousehold(a));
      void pending[1].catch(() => undefined);
      for (let attempt = 0; attempt < 160 && !queued; attempt++) {
        const { rows } = await pool.query<{ waiting: boolean }>("select exists(select 1 from pg_stat_activity where $1=any(pg_blocking_pids(pid)) and wait_event='advisory') as waiting", [earlierPid]);
        queued = rows[0].waiting;
        if (!queued) await new Promise(resolve => setTimeout(resolve, 25));
      }
      await blocker.query("COMMIT");
    } finally {
      try { await blocker.query("ROLLBACK"); } finally { blocker.release(); }
      try { await Promise.all(pending); } finally { vi.useRealTimers(); }
    }
    expect(queued).toBe(true);
    const [latest] = await db.select().from(netWorthSnapshots).where(and(eq(netWorthSnapshots.householdId, a), eq(netWorthSnapshots.date, currentDate)));
    expect(latest.netWorth).toBe("7777.00");
    expect(latest.accountBalances).toEqual(expect.arrayContaining([expect.objectContaining({ accountId: ids.sharedAccount, balance: "4444.00" })]));
  });

  it("preserves imported history and independent row fields through recapture and signed export", async () => {
    const ownerCookie = actors.get("owner")!.cookie;
    await db.update(accounts).set({ excludeFromNetWorth: true }).where(eq(accounts.id, ids.privateAccount));
    await request(app).post(`/api/accounts/${ids.privateAccount}/balance-history/import`).set("Cookie", ownerCookie)
      .send({ data: [{ date: currentDate, amount: "876.54" }] }).expect(200);
    const createdAt = new Date("2020-01-02T12:00:00Z");
    await db.update(accountBalanceSnapshots).set({ availableBalance: "55.55", createdAt })
      .where(and(inArray(accountBalanceSnapshots.accountId, [ids.privateAccount, ids.sharedAccount]), eq(accountBalanceSnapshots.date, currentDate)));
    const before = await db.select().from(accountBalanceSnapshots).where(eq(accountBalanceSnapshots.date, currentDate));
    await captureToday();
    const after = await db.select().from(accountBalanceSnapshots).where(eq(accountBalanceSnapshots.date, currentDate));
    for (const id of [ids.privateAccount, ids.sharedAccount]) {
      expect(after.find(row => row.accountId === id)).toMatchObject({ id: before.find(row => row.accountId === id)!.id, availableBalance: "55.55", createdAt });
    }
    expect(after.find(row => row.accountId === ids.privateAccount)?.balance).toBe("876.54");
    const history = await request(app).get(`/api/accounts/${ids.privateAccount}/balance-history?dateRange=all`).set("Cookie", ownerCookie).expect(200);
    expect(history.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ date: currentDate, balance: 876.54 })]));
    const exported = await request(app).get(`/api/accounts/${ids.privateAccount}/balance-history/export`).set("Cookie", ownerCookie).expect(200);
    expect(exported.text).toContain(`${currentDate},876.54`);
  });

  it("does not mix captured cash with a holding bought after the inventory read", async () => {
    // The real app startup initializes this service. getTestApp intentionally
    // omits startup jobs; an unset singleton would mask the mixed-value bug.
    fxRepository.setGlobalFXService(fxRepository.createFXRateService(fxRepository.createFXRateRepository(db, fxRates)));
    expect((await fxRepository.getLatestFxRates(["ZMW"], "ZMW", "00000000-0000-0000-0000-000000000000")).get("ZMW")).toBe(1);
    await db.update(accounts).set({ balance: "100.00" }).where(eq(accounts.id, ids.sharedAccount));
    await db.update(accounts).set({ balance: "0.00" }).where(eq(accounts.id, ids.privateAccount));
    const readInventory = captureFacts.readSnapshotInventory;
    vi.spyOn(captureFacts, "readSnapshotInventory").mockImplementationOnce(async (...args) => {
      const inventory = await readInventory(...args);
      expect(inventory.holdings).toBe(0);
      await db.transaction(async tx => {
        await tx.update(accounts).set({ balance: "0.00" }).where(eq(accounts.id, ids.sharedAccount));
        await tx.insert(securities).values({ id: securityId, symbol: "R04TRADE", name: "Synthetic concurrent holding", type: "stock", currency: "ZMW", currentPrice: "100.00" });
        await tx.insert(holdings).values({ id: holdingId, householdId: a, accountId: ids.sharedAccount, securityId, quantity: "1.00", costBasis: "100.00" });
      });
      return inventory;
    });
    await captureToday();
    const [captured] = await db.select().from(netWorthSnapshots).where(and(eq(netWorthSnapshots.householdId, a), eq(netWorthSnapshots.date, currentDate)));
    expect(captured.netWorth).toBe("100.00");
  });

  it.each(["holding", "T-bill", "pension"] as const)("shares the capture transaction with actual positive %s and FX inputs", async kind => {
    if (kind === "holding") {
      await db.insert(securities).values({ id: securityId, symbol: "R04POSITIVE", name: "Positive captured holding", type: "stock", currency: "ZMW", currentPrice: "12.34" });
      await db.insert(holdings).values({ id: holdingId, householdId: a, accountId: ids.privateAccount, securityId, quantity: "1.00", costBasis: "12.34" });
    } else if (kind === "T-bill") {
      await db.insert(grzTBills).values({ id: tbillId, householdId: a, accountId: ids.privateAccount, tbillName: "Positive captured T-bill", tenorDays: 91,
        faceValue: "12.34", purchasePrice: "12.34", purchaseDate: previousDate, maturityDate: day(91), status: "active" });
    } else await db.insert(pensionHoldings).values({ id: pensionId, householdId: a, accountId: ids.privateAccount, providerName: "Snapshot input context", pensionType: "private", currentBalance: "12.34" });
    const inventory = vi.spyOn(captureFacts, "readSnapshotInventory");
    const rates = vi.spyOn(fxRepository, "createFXRateRepository");
    const valuation = vi.spyOn(portfolioValuationService, kind === "holding" ? "getHouseholdInvestmentValue" : kind === "T-bill" ? "getTBillsValue" : "getPensionValue");
    await captureToday();
    const transaction = inventory.mock.calls[0][0];
    expect(rates.mock.calls[0][0]).toBe(transaction);
    expect(valuation).toHaveBeenCalled();
    expect(valuation.mock.calls[0]?.[2]?.database).toBe(transaction);
    const [captured] = await db.select().from(netWorthSnapshots).where(and(eq(netWorthSnapshots.householdId, a), eq(netWorthSnapshots.date, currentDate)));
    expect(captured.netWorth).toBe("10345.66");
    expect(captured.assetsByType).toMatchObject({ [kind === "holding" ? "investment_holdings" : kind === "T-bill" ? "investment_tbills" : "investment_pension"]: "12.34" });
    expect(captured.provenance).toMatchObject({ coverage: "unavailable", investmentInventory: { [kind === "holding" ? "holdings" : kind === "T-bill" ? "tbills" : "pensions"]: 1 } });
  });

  it("retains atomic missing-FX failure when no actual lookup rate exists", async () => {
    await db.update(accounts).set({ currency: "XTS" }).where(eq(accounts.id, ids.sharedAccount));
    const [before] = await db.select().from(netWorthSnapshots).where(and(eq(netWorthSnapshots.householdId, a), eq(netWorthSnapshots.date, currentDate)));
    await expect(captureToday()).rejects.toMatchObject({ code: "MISSING_FX_RATE" });
    const [after] = await db.select().from(netWorthSnapshots).where(eq(netWorthSnapshots.id, before.id));
    expect(after).toEqual(before);
  });

  it.each(["40001", "40P01"])("retries %s from the actual FX repository boundary", async code => {
    const createRepository = fxRepository.createFXRateRepository;
    const transaction = vi.spyOn(db, "transaction");
    let lookups = 0;
    vi.spyOn(fxRepository, "createFXRateRepository").mockImplementation((...args) => {
      const repository = createRepository(...args);
      return { ...repository, getLatestRates: async (...input) => {
        if (++lookups === 1) throw Object.assign(new Error("synthetic transient FX SQL failure"), { code });
        return repository.getLatestRates(...input);
      } };
    });
    await captureToday();
    expect(lookups).toBe(2);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("preserves a persistent FX serialization code and bounds repository-boundary retry", async () => {
    const createRepository = fxRepository.createFXRateRepository;
    const transaction = vi.spyOn(db, "transaction");
    let lookups = 0;
    vi.spyOn(fxRepository, "createFXRateRepository").mockImplementation((...args) => ({ ...createRepository(...args),
      getLatestRates: async () => { lookups++; throw Object.assign(new Error("synthetic persistent FX SQL failure"), { code: "40001" }); },
    }));
    await expect(captureToday()).rejects.toMatchObject({ code: "40001" });
    expect(lookups).toBe(3);
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it("retains the original PostgreSQL abort instead of disguising it as missing FX or 25P02", async () => {
    const readInventory = captureFacts.readSnapshotInventory;
    const createRepository = fxRepository.createFXRateRepository;
    let capturedTransaction: Parameters<typeof readInventory>[0] | undefined;
    vi.spyOn(captureFacts, "readSnapshotInventory").mockImplementation(async (...args) => {
      capturedTransaction = args[0];
      return readInventory(...args);
    });
    vi.spyOn(fxRepository, "createFXRateRepository").mockImplementation((...args) => ({ ...createRepository(...args),
      getLatestRates: async () => { await capturedTransaction!.execute(sql`select 1 / 0`); return new Map(); },
    }));
    const transaction = vi.spyOn(db, "transaction");
    const [before] = await db.select().from(netWorthSnapshots).where(and(eq(netWorthSnapshots.householdId, a), eq(netWorthSnapshots.date, currentDate)));
    const outcome = await captureToday().catch(error => error);
    expect(getPostgresError(outcome)?.code).toBe("22012");
    expect(transaction).toHaveBeenCalledTimes(1);
    const [after] = await db.select().from(netWorthSnapshots).where(eq(netWorthSnapshots.id, before.id));
    expect(after).toEqual(before);
  });

  it.each(["missing current", "different currency"] as const)("retains the dated previous MoneyDTO in signed data and mail with %s", async state => {
    try {
      if (state === "missing current") await db.delete(netWorthSnapshots).where(and(eq(netWorthSnapshots.householdId, a), eq(netWorthSnapshots.date, currentDate)));
      else {
        await db.update(households).set({ currency: "USD" }).where(eq(households.id, a));
        await db.update(accounts).set({ currency: "USD", balance: "100.00" }).where(eq(accounts.id, ids.sharedAccount));
        await db.update(accounts).set({ currency: "USD", balance: "200.00" }).where(eq(accounts.id, ids.privateAccount));
        await captureToday();
      }
      const response = await signedRecap("member").expect(200);
      expect(response.body.data.netWorth).toMatchObject({ status: "partial", current: state === "missing current" ? null : 100,
        previousMoney: { amount: "900.00", currency: "ZMW" }, previousAsOf: previousDate, change: null, changePercent: null });
      const [recipient] = await db.select({ email: users.email }).from(users).where(eq(users.id, actors.get("member")!.id));
      expect(await sendWeeklyRecapEmail(actors.get("member")!.id, a, recipient.email, from, to)).toBe("sent");
      const html = smtp.mock.calls[0][0].html;
      expect(html).toContain(`Previous snapshot ${previousDate}`);
      expect(html).toContain("ZMW");
      expect(html).toContain("900.00");
      expect(html).toContain("Comparison unavailable");
      if (state === "different currency") expect(html).toContain("USD");
    } finally { await db.update(households).set({ currency: "ZMW" }).where(eq(households.id, a)); }
  });
});
