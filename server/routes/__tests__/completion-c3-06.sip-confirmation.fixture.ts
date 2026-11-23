import { randomUUID } from "node:crypto";
import request from "supertest";
import type { Express } from "express";
import { eq, inArray, or, sql } from "drizzle-orm";
import {
  accounts, auditLogs, householdMembers, investmentTransactions, outboxEvents,
  recurringInvestments, securityAuditLogs, users,
} from "@shared/schema";
import { db, pool } from "../../db";
import { postCronDoor } from "../../__tests__/cron-door-fixture";
import { createTestUser } from "../../__tests__/fixtures";
import {
  cleanPriceFixture, createPriceFixture, createSignedPlan, financialSnapshot,
  password, seedPriceFixture, signed,
} from "./completion-c3-06.price-confirmation.fixture";

// TEST-ONLY / UNRUN. No product contract import, fabricated SID/grant/proof,
// trigger bypass or schema mutation supplies any successful confirmation.
export type ConfirmationActor = "home" | "peer" | "other";
export interface FillInput {
  executionDate: string;
  quantity: string;
  price: string;
  fees: string;
}
export interface ConfirmationInput {
  operationId: string;
  expectedRevision: number;
  finalStatement: true;
  outcome: "filled" | "partially_filled" | "unfilled";
  brokerReference?: string;
  fills: FillInput[];
}

export function createConfirmationFixture() {
  const fixture = createPriceFixture();
  return {
    ...fixture,
    peer: { ...createTestUser(), householdId: fixture.homeHouseholdId, cookie: "" },
  };
}
export type ConfirmationFixture = ReturnType<typeof createConfirmationFixture>;
export type CreatedPlan = Awaited<ReturnType<typeof createSignedPlan>>;
export const plansPath = "/api/investments/recurring";

export function occurrencesPath(planId: string) {
  return `${plansPath}/${planId}/occurrences`;
}
export function confirmationPath(planId: string, scheduledDate: string) {
  return `${occurrencesPath(planId)}/${scheduledDate}/confirm`;
}
export function signedConfirmation(app: Express, fixture: ConfirmationFixture, actor: ConfirmationActor,
  method: "get" | "post" | "delete", path: string) {
  const identity = fixture[actor];
  return request(app)[method](path).set("Cookie", identity.cookie)
    .set("X-Capital-Subject", identity.id).set("X-Capital-Household", identity.householdId);
}

export async function seedConfirmationFixture(fixture: ConfirmationFixture, app: Express, passwordHash: string) {
  await seedPriceFixture(fixture, app, passwordHash);
  await db.insert(users).values({
    id: fixture.peer.id, email: fixture.peer.email, username: fixture.peer.username,
    passwordHash, emailVerified: true, timezone: "Africa/Lusaka",
  });
  await db.insert(householdMembers).values({
    householdId: fixture.homeHouseholdId, userId: fixture.peer.id, role: "member",
  });
  const response = await request(app).post("/api/auth/login")
    .send({ email: fixture.peer.email, password }).expect(200);
  fixture.peer.cookie = (response.headers["set-cookie"] as unknown as string[]).join("; ");
}

export function plannedSnapshot(fixture: ConfirmationFixture) {
  return {
    accountId: fixture.homeAccountId,
    securityId: fixture.referenceSecurityId,
    amount: "10.00",
    currency: "ZMW",
    authorizedFrequency: "monthly",
    authorizedInitialDate: fixture.today,
  };
}

export function previousDate(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

export function confirmationInput(fixture: ConfirmationFixture): ConfirmationInput {
  return {
    operationId: randomUUID(), expectedRevision: 0, finalStatement: true, outcome: "filled",
    fills: [
      { executionDate: previousDate(fixture.today), quantity: "2.00000000", price: "2.3450", fees: "0.11" },
      { executionDate: fixture.today, quantity: "1.50000000", price: "3.1000", fees: "0.22" },
    ],
  };
}

export async function tick(app: Express) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("Protected runner must provide its synthetic cron secret");
  const response = await postCronDoor(app, "investment-automation", secret);
  if (response.status !== 200) throw new Error(`investment-automation door answered ${response.status}: ${JSON.stringify(response.body)}`);
  return response;
}

/** The recurring-purchase job's journal summary from a door response. */
export function purchaseSummary(response: { body: { jobs: readonly { name: string; summary?: Record<string, unknown> }[] } }) {
  return response.body.jobs.find((job) => job.name === "investments.recurring-purchase")?.summary;
}

export async function configureConfirmationCalendar(app: Express, fixture: ConfirmationFixture, timeZone = "Africa/Lusaka") {
  return request(app).put("/api/investments/calendar").set("Cookie", fixture.home.cookie)
    .set("X-Capital-Subject", fixture.home.id).set("X-Capital-Household", fixture.homeHouseholdId)
    .send({ timeZone }).expect(200);
}

export async function createPendingOccurrence(app: Express, fixture: ConfirmationFixture, configureCalendar = true) {
  if (configureCalendar) await configureConfirmationCalendar(app, fixture);
  const plan = await createSignedPlan(app, fixture);
  await tick(app);
  const listed = await signed(app, fixture, "home", "get", occurrencesPath(plan.id)).expect(200);
  return { plan, listed };
}

type Row = Record<string, unknown>;
const operationalQueries = {
  fences: {
    table: "investment_sip_occurrence_fences",
    query: `select f.* from investment_sip_occurrence_fences f join recurring_investments p on p.id=f.plan_id
      where p.household_id=any($1::uuid[]) order by f.plan_id,f.original_due_date`,
  },
  occurrences: {
    table: "investment_sip_occurrences",
    query: `select * from investment_sip_occurrences where household_id=any($1::uuid[])
      order by plan_id,original_due_date`,
  },
  confirmations: {
    table: "investment_sip_confirmations",
    query: `select * from investment_sip_confirmations where household_id=any($1::uuid[])
      order by id`,
  },
  fills: {
    table: "investment_sip_confirmed_fills",
    query: `select f.* from investment_sip_confirmed_fills f
      join investment_sip_confirmations c on c.id=f.confirmation_id
      where c.household_id=any($1::uuid[]) order by f.confirmation_id,f.fill_index`,
  },
} as const;

async function operationalRows(key: keyof typeof operationalQueries, householdIds: string[]): Promise<Row[]> {
  const source = operationalQueries[key];
  // Baseline source has no additive schema. Missing tables are represented
  // only for before/after snapshots; endpoint assertions must still fail.
  const present = await pool.query<{ name: string | null }>("select to_regclass($1)::text as name", [`public.${source.table}`]);
  return present.rows[0].name ? (await pool.query<Row>(source.query, [householdIds])).rows : [];
}

export async function confirmationSnapshot(fixture: ConfirmationFixture) {
  const householdIds = [fixture.homeHouseholdId, fixture.otherHouseholdId];
  const actorIds = [fixture.home.id, fixture.peer.id, fixture.other.id];
  const financial = await financialSnapshot(fixture);
  return {
    ...financial,
    calendars: (await pool.query<Row>(`select id,time_zone from households
      where id=any($1::uuid[]) order by id`, [householdIds])).rows,
    plans: await db.select().from(recurringInvestments)
      .where(inArray(recurringInvestments.householdId, householdIds)).orderBy(recurringInvestments.id),
    proofs: (await pool.query<Row>(`select p.purchase_id,p.author_user_id,p.authorized_at,p.authorization_contract_version,
      p.authorized_frequency,p.authorized_initial_date::text as authorized_initial_date,p.authorized_terms_digest
      from investment_purchase_authorization_proofs p
      join investment_transactions t on t.id=p.purchase_id where t.household_id=any($1::uuid[]) order by p.purchase_id`, [householdIds])).rows,
    audits: await db.select().from(auditLogs).where(or(
      inArray(auditLogs.householdId, householdIds), inArray(auditLogs.userId, actorIds),
    )).orderBy(auditLogs.id),
    fences: await operationalRows("fences", householdIds),
    occurrences: await operationalRows("occurrences", householdIds),
    confirmations: await operationalRows("confirmations", householdIds),
    fills: await operationalRows("fills", householdIds),
  };
}

export async function setPeerRole(fixture: ConfirmationFixture,
  role: "admin" | "member" | "view_only" | "professional") {
  await db.update(householdMembers).set({ role }).where(eq(householdMembers.userId, fixture.peer.id));
}

/** A household has exactly one owner (NEW-12): the peer becomes owner only through the real transfer route. */
export async function transferOwnershipToPeer(app: Express, fixture: ConfirmationFixture) {
  await signedConfirmation(app, fixture, "home", "post", "/api/household/transfer-ownership")
    .send({ newOwnerId: fixture.peer.id }).expect(200);
}

export async function cleanConfirmationFixture(fixture: ConfirmationFixture) {
  const actors = [fixture.home.id, fixture.peer.id, fixture.other.id];
  await db.delete(auditLogs).where(or(
    inArray(auditLogs.userId, actors),
    inArray(auditLogs.householdId, [fixture.homeHouseholdId, fixture.otherHouseholdId]),
  ));
  await db.delete(securityAuditLogs).where(or(
    eq(securityAuditLogs.userId, fixture.peer.id), eq(securityAuditLogs.targetUserId, fixture.peer.id),
  ));
  await db.delete(outboxEvents).where(eq(sql<string>`${outboxEvents.payload}->>'userId'`, fixture.peer.id));
  // Existing guarded parent deletion releases operational children; actual
  // purchase deletion releases proofs before custody deletion. No erasure flag
  // or relaxed trigger is used merely to make cleanup pass.
  await cleanPriceFixture(fixture);
  await pool.query('delete from "session" where sess->>\'userId\'=$1', [fixture.peer.id]);
  await db.delete(users).where(eq(users.id, fixture.peer.id));
}

export async function purchaseRows(fixture: ConfirmationFixture) {
  return db.select().from(investmentTransactions)
    .where(eq(investmentTransactions.householdId, fixture.homeHouseholdId))
    .orderBy(investmentTransactions.transactionDate, investmentTransactions.createdAt, investmentTransactions.id);
}

export async function makePrivate(fixture: ConfirmationFixture) {
  await db.update(accounts).set({ isPrivate: true, ownerUserId: fixture.home.id })
    .where(eq(accounts.id, fixture.homeAccountId));
}

export async function waitForConfirmationDatabaseBlock(blockerPid: number) {
  // Test supervision only: this wall clock never supplies a financial date.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const blocked = await pool.query<{ reached: boolean }>(`select exists (
      select 1 from pg_catalog.pg_stat_activity a
      where $1::integer=any(pg_catalog.pg_blocking_pids(a.pid))) as reached`, [blockerPid]);
    if (blocked.rows[0].reached) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Signed confirmation did not reach its owned database lock barrier");
}
