import { randomUUID } from "node:crypto";
import request from "supertest";
import type { Express } from "express";
import { eq, inArray, or, sql } from "drizzle-orm";
import {
  accounts,
  auditLogs,
  holdings,
  householdMembers,
  households,
  investmentTransactions,
  outboxEvents,
  recurringExecutionLog,
  recurringInvestments,
  securities,
  securityAuditLogs,
  securityPrices,
  taxLotDisposals,
  taxLots,
  transactions,
  users,
} from "@shared/schema";
import { db, pool } from "../../db";
import { createTestUser } from "../../__tests__/fixtures";

export const password = "SyntheticC306Prices123!";
export type Actor = "home" | "other";
export type OtherRole = "owner" | "admin" | "member";

export function createPriceFixture() {
  const homeHouseholdId = randomUUID();
  const otherHouseholdId = randomUUID();
  return {
    homeHouseholdId,
    otherHouseholdId,
    home: { ...createTestUser(), householdId: homeHouseholdId, cookie: "" },
    other: { ...createTestUser(), householdId: otherHouseholdId, cookie: "" },
    homeAccountId: randomUUID(),
    otherAccountId: randomUUID(),
    referenceSecurityId: randomUUID(),
    symbols: new Set<string>(),
    today: new Date().toISOString().slice(0, 10),
  };
}

export type PriceFixture = ReturnType<typeof createPriceFixture>;

export function metadata(fixture: PriceFixture) {
  const symbol = `C306${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  fixture.symbols.add(symbol);
  return { symbol, name: "Synthetic C3-06 reference instrument", type: "stock", currency: "ZMW" };
}

export function signed(app: Express, fixture: PriceFixture, actor: Actor,
  method: "get" | "post" | "put", path: string) {
  return request(app)[method](path)
    .set("Cookie", fixture[actor].cookie)
    .set("X-Capital-Subject", fixture[actor].id)
    .set("X-Capital-Household", fixture[actor].householdId);
}

export async function seedPriceFixture(fixture: PriceFixture, app: Express, passwordHash: string) {
  await db.insert(households).values([
    { id: fixture.homeHouseholdId, name: "Synthetic C3-06 home", currency: "ZMW" },
    { id: fixture.otherHouseholdId, name: "Synthetic C3-06 other", currency: "ZMW" },
  ]);
  for (const label of ["home", "other"] as const) {
    const actor = fixture[label];
    await db.insert(users).values({
      id: actor.id,
      email: actor.email,
      username: actor.username,
      passwordHash,
      emailVerified: true,
      timezone: "Africa/Lusaka",
    });
    await db.insert(householdMembers).values({
      householdId: actor.householdId,
      userId: actor.id,
      role: label === "home" ? "owner" : "member",
    });
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: actor.email, password })
      .expect(200);
    actor.cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }
  await db.insert(accounts).values([
    {
      id: fixture.homeAccountId,
      householdId: fixture.homeHouseholdId,
      name: "C3-06 home investment custody",
      type: "investment",
      currency: "ZMW",
      initialBalance: "100.00",
      balance: "100.00",
      isPrivate: false,
      ownerUserId: fixture.home.id,
    },
    {
      id: fixture.otherAccountId,
      householdId: fixture.otherHouseholdId,
      name: "C3-06 other investment custody",
      type: "investment",
      currency: "ZMW",
      initialBalance: "200.00",
      balance: "200.00",
      isPrivate: false,
      ownerUserId: fixture.other.id,
    },
  ]);
  await db.insert(securities).values({
    id: fixture.referenceSecurityId,
    ...metadata(fixture),
    type: "stock",
    currentPrice: "2.00",
    lastPriceUpdate: new Date(),
  });
}

export async function setOtherRole(fixture: PriceFixture, role: OtherRole) {
  await db.update(householdMembers).set({ role }).where(eq(householdMembers.userId, fixture.other.id));
}

export async function createSignedPlan(app: Express, fixture: PriceFixture,
  securityId: string = fixture.referenceSecurityId) {
  const declaration = {
    operationId: randomUUID(),
    accountId: fixture.homeAccountId,
    securityId,
    type: "sip",
    frequency: "monthly",
    amount: "10.00",
    currency: "ZMW",
    nextExecutionDate: fixture.today,
  };
  const response = await signed(app, fixture, "home", "post", "/api/investments/recurring")
    .send(declaration)
    .expect(200);
  const [plan] = await db.select().from(recurringInvestments)
    .where(eq(recurringInvestments.id, response.body.data.id));
  if (!plan) throw new Error("Signed fixture did not persist its plan");
  const grants = await pool.query(`select * from investment_plan_authorizations
    where plan_id=$1 and household_id=$2`, [plan.id, fixture.homeHouseholdId]);
  if (grants.rows.length !== 1 || grants.rows[0].author_user_id !== fixture.home.id) {
    throw new Error("Signed fixture did not persist its real actor's standing grant");
  }
  return plan;
}

export async function financialSnapshot(fixture: PriceFixture) {
  const householdIds = [fixture.homeHouseholdId, fixture.otherHouseholdId];
  const actorIds = [fixture.home.id, fixture.other.id];
  const plans = await db.select().from(recurringInvestments)
    .where(inArray(recurringInvestments.householdId, householdIds)).orderBy(recurringInvestments.id);
  return {
    accounts: await db.select().from(accounts).where(inArray(accounts.householdId, householdIds)).orderBy(accounts.id),
    holdings: await db.select().from(holdings).where(inArray(holdings.householdId, householdIds)).orderBy(holdings.id),
    purchases: await db.select().from(investmentTransactions)
      .where(inArray(investmentTransactions.householdId, householdIds)).orderBy(investmentTransactions.id),
    lots: await db.select().from(taxLots).where(inArray(taxLots.householdId, householdIds)).orderBy(taxLots.id),
    disposals: await db.select().from(taxLotDisposals)
      .where(inArray(taxLotDisposals.householdId, householdIds)).orderBy(taxLotDisposals.id),
    cash: await db.select().from(transactions).where(inArray(transactions.householdId, householdIds)).orderBy(transactions.id),
    planEconomics: plans.map(plan => ({
      id: plan.id,
      householdId: plan.householdId,
      accountId: plan.accountId,
      securityId: plan.securityId,
      amount: plan.amount,
      currency: plan.currency,
      frequency: plan.frequency,
    })),
    proofs: (await pool.query(`select * from investment_purchase_authorization_proofs
      where author_user_id=any($1::uuid[]) order by purchase_id`, [actorIds])).rows,
    reservations: (await pool.query(`select r.* from investment_sip_purchase_reservations r
      join investment_plan_authorizations a on a.id=r.authorization_id
      where a.household_id=any($1::uuid[]) order by r.purchase_id`, [householdIds])).rows,
    successLogs: await db.select().from(recurringExecutionLog)
      .where(inArray(recurringExecutionLog.recurringInvestmentId, plans.map(plan => plan.id)))
      .orderBy(recurringExecutionLog.id).then(rows => rows.filter(row => row.status === "success")),
    purchaseAudits: await db.select().from(auditLogs)
      .where(or(inArray(auditLogs.householdId, householdIds), inArray(auditLogs.userId, actorIds)))
      .orderBy(auditLogs.id).then(rows => rows.filter(row => row.entityType === "investment_transaction")),
  };
}

export async function cleanPriceFixture(fixture: PriceFixture) {
  const householdIds = [fixture.homeHouseholdId, fixture.otherHouseholdId];
  const actorIds = [fixture.home.id, fixture.other.id];
  const ownedSecurities = await db.select({ id: securities.id }).from(securities)
    .where(inArray(securities.symbol, Array.from(fixture.symbols)));
  await db.delete(auditLogs).where(or(
    inArray(auditLogs.householdId, householdIds),
    inArray(auditLogs.userId, actorIds),
    inArray(auditLogs.entityId, ownedSecurities.map(row => row.id)),
  ));
  // Reuse the established guarded SIP cleanup order. No grant/proof is forged
  // or altered, no trigger is bypassed, and no actor is marked erased.
  await db.delete(recurringInvestments).where(inArray(recurringInvestments.householdId, householdIds));
  await db.delete(taxLotDisposals).where(inArray(taxLotDisposals.householdId, householdIds));
  await db.delete(taxLots).where(inArray(taxLots.householdId, householdIds));
  await db.delete(investmentTransactions).where(inArray(investmentTransactions.householdId, householdIds));
  await db.delete(holdings).where(inArray(holdings.householdId, householdIds));
  await db.delete(securities).where(inArray(securities.id, ownedSecurities.map(row => row.id)));
  await db.delete(securityAuditLogs).where(or(
    inArray(securityAuditLogs.userId, actorIds),
    inArray(securityAuditLogs.targetUserId, actorIds),
  ));
  await db.delete(outboxEvents).where(or(
    inArray(outboxEvents.householdId, householdIds),
    inArray(sql<string>`${outboxEvents.payload}->>'userId'`, actorIds),
  ));
  await db.delete(households).where(inArray(households.id, householdIds));
  await pool.query('delete from "session" where sess->>\'userId\'=any($1::text[])', [actorIds]);
  await db.delete(users).where(inArray(users.id, actorIds));
}

export async function globalPriceState(fixture: PriceFixture) {
  const instruments = await db.select().from(securities)
    .where(inArray(securities.symbol, Array.from(fixture.symbols))).orderBy(securities.id);
  return {
    instruments,
    prices: await db.select().from(securityPrices)
      .where(inArray(securityPrices.securityId, instruments.map(row => row.id))).orderBy(securityPrices.id),
  };
}
