import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { accounts, fxRates, householdMembers, households, users } from "@shared/schema";
import { hashPassword } from "../../auth";
import { db, pool } from "../../db";
import { getTestApp } from "../../__tests__/fixtures";
import { analyticsCache } from "../../services/AnalyticsCache";
import { calendarClock } from "../../services/householdCalendarToday";

// NEW-02: financial ratios and debt analysis convert every account balance to
// the household base currency through the household-aware FX path, exclude
// another member's private accounts, and refuse with a 422 when a visible
// account has no rate - never a sum of mixed currencies, never a rate of 1.
// Reports default to scope=mine for a member and refuse them scope=household,
// so the household view an owner or admin reads is where another member's
// private account leaked; a member reads only their own accounts.
// NOK and DKK are used by no other suite, so no shared rate row can leak in.
const FOREIGN = "NOK";
const UNRATED = "DKK";
const BASE = "ZMW";
const DAY_MS = 86_400_000;
const utcDay = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);
const RANGE = { from: utcDay(-30), to: utcDay(0) };
const password = "SyntheticNew02Ratios123!";

type ActorName = "owner" | "member" | "other";
type AccountType = (typeof accounts.$inferInsert)["type"];
interface Actor { id: string; cookie: string }

const householdId = randomUUID();
const actors = new Map<ActorName, Actor>();
const names = {
  baseCash: "NEW02 ZMW checking", foreignSavings: "NEW02 NOK savings",
  baseCard: "NEW02 ZMW credit card", foreignLoan: "NEW02 NOK loan",
  privateCash: "NEW02 private ZMW checking", privateCard: "NEW02 private NOK credit",
};
let app: Awaited<ReturnType<typeof getTestApp>>;

function as(name: ActorName, path: string, extra: Record<string, string> = {}) {
  const actor = actors.get(name)!;
  return request(app).get(path).query({ ...RANGE, ...extra })
    .set("Cookie", actor.cookie)
    .set("X-Capital-Subject", actor.id)
    .set("X-Capital-Household", householdId);
}

async function seedActor(name: ActorName, role: "owner" | "member", passwordHash: string) {
  const id = randomUUID();
  const email = `new02-ratios-${id}@example.invalid`;
  await db.insert(users).values({
    id, email, username: `new02-ratios-${id}`, passwordHash, emailVerified: true, timezone: "Africa/Lusaka",
  });
  await db.insert(householdMembers).values({ householdId, userId: id, role });
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  actors.set(name, { id, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") });
}

function account(name: string, type: AccountType, currency: string, balance: string, owner: ActorName, isPrivate = false) {
  return {
    householdId, name, type, currency, initialBalance: balance, balance, isPrivate,
    ownerUserId: actors.get(owner)!.id,
  };
}

async function resetMoney() {
  await db.delete(accounts).where(eq(accounts.householdId, householdId));
  await db.delete(fxRates).where(inArray(fxRates.fromCurrency, [FOREIGN, UNRATED]));
  await db.insert(accounts).values([
    account(names.baseCash, "checking", BASE, "1000.00", "owner"),
    account(names.foreignSavings, "savings", FOREIGN, "75.00", "owner"),
    account(names.baseCard, "credit", BASE, "500.00", "owner"),
    account(names.foreignLoan, "loan", FOREIGN, "10.00", "owner"),
    account(names.privateCash, "checking", BASE, "9000.00", "other", true),
    account(names.privateCard, "credit", FOREIGN, "40.00", "other", true),
  ]);
  // The latest rate on or before today applies; a future-dated row must not.
  await db.insert(fxRates).values([
    { id: randomUUID(), fromCurrency: FOREIGN, toCurrency: BASE, rate: "26.5000", date: utcDay(-1), source: "synthetic_new02" },
    { id: randomUUID(), fromCurrency: FOREIGN, toCurrency: BASE, rate: "99.0000", date: utcDay(30), source: "synthetic_new02" },
  ]);
  await analyticsCache.invalidateHousehold(householdId);
}

const zmw = (amount: string) => ({ amount, currency: BASE });

describe("NEW-02 ratios and debt analysis convert visible balances only", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values({ id: householdId, name: "Synthetic NEW02", currency: BASE });
    const passwordHash = await hashPassword(password);
    await seedActor("owner", "owner", passwordHash);
    await seedActor("member", "member", passwordHash);
    await seedActor("other", "member", passwordHash);
  }, 30_000);

  beforeEach(resetMoney);

  afterAll(async () => {
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db.delete(fxRates).where(inArray(fxRates.fromCurrency, [FOREIGN, UNRATED]));
    await db.delete(households).where(eq(households.id, householdId));
    for (const actor of actors.values()) {
      await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [actor.id]);
      await db.delete(users).where(eq(users.id, actor.id));
    }
  });

  it.each(["/api/reports/ratios", "/api/reports/financial-ratios"])(
    "%s converts each visible balance at the latest rate on or before today", async path => {
      const { ratios } = (await as("owner", path).expect(200)).body.data;
      // 1000.00 ZMW + 75.00 NOK x 26.50 = 2987.50; 500.00 ZMW + 10.00 NOK x 26.50 = 765.00.
      expect(ratios.liquidityRatio.liquidAssets).toEqual(zmw("2987.50"));
      expect(ratios.liquidityRatio.currentLiabilities).toEqual(zmw("765.00"));
      expect(ratios.emergencyFund.liquidAssets).toEqual(zmw("2987.50"));
      expect(ratios.burnRate.liquidAssets).toEqual(zmw("2987.50"));
      expect(ratios.liquidityRatio.value).toBe(3.91);
    });

  it("values both ratios and debt on the household's new day before UTC midnight", async () => {
    const clock = vi.spyOn(calendarClock, "now").mockReturnValue(new Date(`${utcDay(0)}T22:15:00Z`));
    try {
      await db.update(households).set({ timeZone: "Africa/Lusaka" }).where(eq(households.id, householdId));
      await db.insert(fxRates).values({
        fromCurrency: FOREIGN, toCurrency: BASE, rate: "30.0000", date: utcDay(1), source: "synthetic_new02",
      });

      const { ratios } = (await as("owner", "/api/reports/ratios").expect(200)).body.data;
      expect.soft(ratios.liquidityRatio.liquidAssets).toEqual(zmw("3250.00"));
      expect.soft(ratios.liquidityRatio.currentLiabilities).toEqual(zmw("800.00"));
      const debt = (await as("owner", "/api/reports/debt").expect(200)).body.data;
      expect.soft(debt.totalDebt).toEqual(zmw("800.00"));
    } finally {
      clock.mockRestore();
      await db.update(households).set({ timeZone: null }).where(eq(households.id, householdId));
    }
  });

  it("returns the recoverable calendar error on both ratios and debt", async () => {
    await db.update(households).set({ timeZone: "Invalid/Stored_Policy" }).where(eq(households.id, householdId));
    try {
      for (const path of ["/api/reports/ratios", "/api/reports/debt"]) {
        const result = await as("owner", path);
        expect.soft(result.status).toBe(422);
        expect.soft(result.body.error?.code).toBe("HOUSEHOLD_CALENDAR_UNAVAILABLE");
      }
    } finally {
      await db.update(households).set({ timeZone: null }).where(eq(households.id, householdId));
    }
  });

  it("converts debt analysis and orders the largest converted debt first", async () => {
    const debt = (await as("owner", "/api/reports/debt").expect(200)).body.data;
    expect(debt.totalDebt).toEqual(zmw("765.00"));
    expect(debt.debtByType).toEqual(expect.arrayContaining([
      { type: "credit", balance: zmw("500.00"), accounts: 1 },
      { type: "loan", balance: zmw("265.00"), accounts: 1 },
    ]));
    expect(debt.debtByType).toHaveLength(2);
    expect(debt.topDebtAccounts.map((a: { name: string; balance: unknown }) => [a.name, a.balance])).toEqual([
      [names.baseCard, zmw("500.00")],
      [names.foreignLoan, zmw("265.00")],
    ]);
  });

  // NEW-23: zero is not positive. A paid-off liability owes nothing, so it is
  // no debt account: it adds no debt type, account count or top-debt row.
  it("leaves a paid-off liability out of debt analysis", async () => {
    await db.insert(accounts).values(account("NEW02 paid-off mortgage", "mortgage", BASE, "0.00", "owner"));
    const debt = (await as("owner", "/api/reports/debt").expect(200)).body.data;
    expect(debt.totalDebt).toEqual(zmw("765.00"));
    expect(debt.debtByType.map((row: { type: string }) => row.type).sort()).toEqual(["credit", "loan"]);
    expect(debt.topDebtAccounts.map((a: { name: string }) => a.name)).toEqual([names.baseCard, names.foreignLoan]);
  });

  it("keeps a member's private accounts out of the owner's household view; their holder still sees them", async () => {
    const ownerDebt = await as("owner", "/api/reports/debt").expect(200);
    expect(JSON.stringify(ownerDebt.body)).not.toContain(names.privateCard);
    const owner = (await as("owner", "/api/reports/ratios").expect(200)).body.data.ratios;
    expect(owner.liquidityRatio.liquidAssets).toEqual(zmw("2987.50"));

    // The holder's own scope: 9000.00 ZMW, and 40.00 NOK x 26.50 = 1060.00.
    const other = (await as("other", "/api/reports/ratios").expect(200)).body.data.ratios;
    expect(other.liquidityRatio.liquidAssets).toEqual(zmw("9000.00"));
    expect(other.liquidityRatio.currentLiabilities).toEqual(zmw("1060.00"));
    const otherDebt = (await as("other", "/api/reports/debt").expect(200)).body.data;
    expect(otherDebt.totalDebt).toEqual(zmw("1060.00"));
    expect(otherDebt.topDebtAccounts).toEqual([
      expect.objectContaining({ name: names.privateCard, balance: zmw("1060.00") }),
    ]);
    // A member never gets the household view in which others' accounts appear.
    await as("member", "/api/reports/ratios", { scope: "household" }).expect(403);
  });

  it("answers a visible account with no rate with a 422 naming the pair, never a rate of 1", async () => {
    await db.delete(fxRates).where(eq(fxRates.fromCurrency, FOREIGN));
    await analyticsCache.invalidateHousehold(householdId);
    for (const path of ["/api/reports/ratios", "/api/reports/financial-ratios", "/api/reports/debt"]) {
      const refused = await as("owner", path).expect(422);
      expect(refused.body.error).toMatchObject({ code: "MISSING_FX_RATE", details: { from: FOREIGN, to: BASE } });
    }
  });

  it("does not refuse, or disclose, over an unrated currency held only in a member's private account", async () => {
    await db.insert(accounts).values(account("NEW02 private DKK savings", "savings", UNRATED, "5.00", "other", true));
    await analyticsCache.invalidateHousehold(householdId);
    const owner = await as("owner", "/api/reports/ratios").expect(200);
    expect(owner.body.data.ratios.liquidityRatio.liquidAssets).toEqual(zmw("2987.50"));
    expect(JSON.stringify(owner.body)).not.toContain(UNRATED);
    const other = await as("other", "/api/reports/ratios").expect(422);
    expect(other.body.error).toMatchObject({ code: "MISSING_FX_RATE", details: { from: UNRATED, to: BASE } });
  });
});
