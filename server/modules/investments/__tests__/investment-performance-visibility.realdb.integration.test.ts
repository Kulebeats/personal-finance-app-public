/**
 * C3-24: investment performance must follow the investment read visibility rule.
 *
 * A member sees Shared investment accounts and their own private ones, never
 * another member's private account and never a soft-deleted account. Balances
 * are summed exactly (0.10 + 0.20 is 0.3, not 0.30000000000000004). A cash
 * flow linked to another member's private receipt must not move the asking
 * member's return, or the percentage would reveal the hidden amount.
 * Real HTTP against real Postgres over both performance routes; no mocks.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../../../db";
import {
  accountBalanceSnapshots, accounts, auditLogs, householdMembers, households, investmentTransactions, transactions, users,
} from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";

type Member = "alice" | "bob";
type MemberLogins = Map<Member, { id: string; cookie: string }>;
interface PerformancePoint { date: string; value: number; twrIndex?: number; twrReturnPercent?: number }
interface AccountFields { isPrivate: boolean; ownerUserId: string | null; deletedAt?: Date }

const password = "SyntheticPerformance123!";
const FIRST_DAY = "2026-10-01";
const SECOND_DAY = "2026-10-02";
const ROUTES = ["/api/investments/performance", "/api/investments/analytics/performance"] as const;
let app: Awaited<ReturnType<typeof getTestApp>>;

async function seedHousehold(householdId: string, name: string): Promise<MemberLogins> {
  await db.insert(households).values({ id: householdId, name });
  const passwordHash = await hashPassword(password);
  const logins: MemberLogins = new Map();
  for (const member of ["alice", "bob"] as const) {
    const id = randomUUID();
    const email = `c3-24-${id}@example.invalid`;
    await db.insert(users).values({ id, email, username: `c3-24-${id}`, passwordHash, emailVerified: true });
    await db.insert(householdMembers).values({ householdId, userId: id, role: member === "alice" ? "owner" : "member" });
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    logins.set(member, { id, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") });
  }
  return logins;
}

async function seedInvestmentAccount(householdId: string, name: string, fields: AccountFields, balances: [string, string]) {
  const id = randomUUID();
  await db.insert(accounts).values({
    id, householdId, name, type: "investment", currency: "ZMW", initialBalance: "0", balance: balances[1], ...fields,
  });
  await db.insert(accountBalanceSnapshots).values([
    { accountId: id, date: FIRST_DAY, balance: balances[0] },
    { accountId: id, date: SECOND_DAY, balance: balances[1] },
  ]);
  return id;
}

async function removeHousehold(householdId: string, logins: MemberLogins) {
  await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
  await db.delete(investmentTransactions).where(eq(investmentTransactions.householdId, householdId));
  await db.delete(transactions).where(eq(transactions.householdId, householdId));
  const ids = (await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.householdId, householdId))).map(row => row.id);
  if (ids.length) await db.delete(accountBalanceSnapshots).where(inArray(accountBalanceSnapshots.accountId, ids));
  await db.delete(accounts).where(eq(accounts.householdId, householdId));
  await db.delete(households).where(eq(households.id, householdId));
  for (const { id } of logins.values()) {
    await db.delete(auditLogs).where(eq(auditLogs.userId, id));
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [id]);
    await db.delete(users).where(eq(users.id, id));
  }
}

async function readSeries(logins: MemberLogins, member: Member, route: (typeof ROUTES)[number]): Promise<PerformancePoint[]> {
  const response = await request(app).get(route).query({ timeframe: "ALL" }).set("Cookie", logins.get(member)!.cookie).expect(200);
  return Array.isArray(response.body) ? response.body : response.body.data;
}

beforeAll(async () => {
  app = await getTestApp();
});

describe("C3-24 investment performance visibility over real HTTP", () => {
  const householdId = randomUUID();
  let members: MemberLogins;

  beforeAll(async () => {
    members = await seedHousehold(householdId, "Synthetic performance household");
    await seedInvestmentAccount(householdId, "Shared brokerage", { isPrivate: false, ownerUserId: null }, ["0.10", "0.20"]);
    await seedInvestmentAccount(householdId, "Alice private brokerage", { isPrivate: true, ownerUserId: members.get("alice")!.id }, ["0.20", "0.40"]);
    await seedInvestmentAccount(householdId, "Bob private brokerage", { isPrivate: true, ownerUserId: members.get("bob")!.id }, ["5000.00", "7000.00"]);
    await seedInvestmentAccount(householdId, "Deleted shared brokerage", { isPrivate: false, ownerUserId: null, deletedAt: new Date() }, ["300000.00", "300000.00"]);
  }, 30000);

  afterAll(() => removeHousehold(householdId, members));

  it.each(ROUTES)("Alice's series on %s holds Shared plus her own account only, summed exactly", async route => {
    const series = await readSeries(members, "alice", route);
    expect(series.map(point => [point.date, point.value])).toEqual([[FIRST_DAY, 0.3], [SECOND_DAY, 0.6]]);
    expect(series[1].twrIndex).toBe(200);
  });

  it.each(ROUTES)("Bob's series on %s holds Shared plus his own account only", async route => {
    const series = await readSeries(members, "bob", route);
    expect(series.map(point => [point.date, point.value])).toEqual([[FIRST_DAY, 5000.1], [SECOND_DAY, 7000.2]]);
  });
});

describe("C3-24 a flow linked to another member's private receipt stays hidden", () => {
  const householdId = randomUUID();
  let members: MemberLogins;

  beforeAll(async () => {
    members = await seedHousehold(householdId, "Synthetic hidden-flow household");
    const bobId = members.get("bob")!.id;
    // Shared brokerage grows 100 -> 150; 50 of that is Bob's deposit, paid from
    // a private receipt on a Shared cash account that only Bob can see.
    const brokerageId = await seedInvestmentAccount(householdId, "Shared brokerage", { isPrivate: false, ownerUserId: null }, ["100.00", "150.00"]);
    const cashAccountId = randomUUID();
    await db.insert(accounts).values({ id: cashAccountId, householdId, name: "Shared cash", type: "checking", currency: "ZMW", initialBalance: "0", balance: "0" });
    const receiptId = randomUUID();
    await db.insert(transactions).values({
      id: receiptId, householdId, accountId: cashAccountId, type: "expense", currency: "ZMW", date: SECOND_DAY,
      amount: "50.00", name: "Bob private brokerage deposit", isPrivate: true, ownerUserId: bobId,
    });
    await db.insert(investmentTransactions).values({
      householdId, accountId: brokerageId, type: "transfer_in", amount: "50.00", currency: "ZMW",
      transactionDate: SECOND_DAY, linkedTransactionId: receiptId,
    });
  }, 30000);

  afterAll(() => removeHousehold(householdId, members));

  it.each(ROUTES)("Alice's return on %s is not shifted by Bob's hidden deposit", async route => {
    const series = await readSeries(members, "alice", route);
    expect(series.map(point => [point.date, point.value])).toEqual([[FIRST_DAY, 100], [SECOND_DAY, 150]]);
    // Counting the hidden 50 as a contribution would give 100 and reveal it.
    expect(series[1]).toMatchObject({ twrIndex: 150, twrReturnPercent: 50 });
  });

  it.each(ROUTES)("Bob, who owns the receipt, sees the deposit as a contribution on %s", async route => {
    const series = await readSeries(members, "bob", route);
    expect(series.map(point => [point.date, point.value])).toEqual([[FIRST_DAY, 100], [SECOND_DAY, 150]]);
    expect(series[1]).toMatchObject({ twrIndex: 100, twrReturnPercent: 0 });
  });
});
