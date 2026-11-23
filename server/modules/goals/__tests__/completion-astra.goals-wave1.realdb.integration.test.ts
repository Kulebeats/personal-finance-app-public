/**
 * Astra post-takeover review, Wave 1, goals half. Real HTTP against real
 * Postgres; synthetic data only. Each group has its own household.
 *
 * - A-04: a goal whose sources the viewer cannot see is never valued. A hidden
 *   holding with no rate neither fails the read nor names its currency.
 * - A-30: a holding with shares and no price is "unavailable" progress, and the
 *   balance sync never stores a zero for it.
 * - A-09: the summary converts each goal into the household currency and counts
 *   the goals it had to leave out for want of a rate.
 * - A-06: a transfer amount keeps its currency; one unlike the goals' is refused.
 * - A-23: the transfer's audit row is written in the transfer's transaction, so
 *   a failing audit insert rolls the transfer back.
 * - A-70: a pay-down goal against a loan the creator cannot see is refused like
 *   a missing loan, with no balance; the loan's owner creates it and sees it.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  accounts, auditLogs, fxRates, goalActivityLog, goalTransfers, goals, holdings, householdFxRateOverrides, householdMembers, households,
  merchants, outboxEvents, securities, transactions, users,
} from "@shared/schema";
import { db, pool } from "../../../db";
import { createFXRateRepository, createFXRateService, setGlobalFXService } from "../../../core/calculations";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { businessAuditService } from "../../../services/BusinessAuditService";
import { goalActivityLogService } from "../../../services/GoalActivityLogService";
import { goalService } from "../../../services/GoalService";

type Member = { id: string; cookie: string };
type Household = { id: string; owner: Member; member: Member };

const password = "SyntheticAstraWaveOne123!";
// No household or provider rate to ZMW exists for this currency (asserted below).
const UNRATED = "ISK";
const DAY_MS = 86_400_000;
const utcDay = (offset: number) => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
const householdIds: string[] = [];
const userIds: string[] = [];
const securityIds: string[] = [];
let app: Awaited<ReturnType<typeof getTestApp>>;

async function addMember(householdId: string, role: "owner" | "member"): Promise<Member> {
  const id = randomUUID();
  const email = `astra-wave1-${id}@example.invalid`;
  userIds.push(id);
  await db.insert(users).values({ id, email, username: `astra-wave1-${id}`, passwordHash: await hashPassword(password), emailVerified: true });
  await db.insert(householdMembers).values({ householdId, userId: id, role });
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return { id, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") };
}

async function newHousehold(name: string): Promise<Household> {
  const id = randomUUID();
  householdIds.push(id);
  await db.insert(households).values({ id, name: `Synthetic ${name}`, currency: "ZMW" });
  return { id, owner: await addMember(id, "owner"), member: await addMember(id, "member") };
}

const as = (household: Household, who: Member) => ({
  get: (path: string) => request(app).get(path).set("Cookie", who.cookie)
    .set("X-Capital-Subject", who.id).set("X-Capital-Household", household.id),
  post: (path: string) => request(app).post(path).set("Cookie", who.cookie)
    .set("X-Capital-Subject", who.id).set("X-Capital-Household", household.id),
  put: (path: string) => request(app).put(path).set("Cookie", who.cookie)
    .set("X-Capital-Subject", who.id).set("X-Capital-Household", household.id),
});

/** An owner's investment account holding 10 shares of a security, and a holdings goal on it. */
async function holdingsGoal(household: Household, security: { currency: string; currentPrice: string | null }, isPrivate: boolean) {
  const accountId = randomUUID();
  const securityId = randomUUID();
  const goalId = randomUUID();
  securityIds.push(securityId);
  await db.insert(accounts).values({ id: accountId, householdId: household.id, ownerUserId: household.owner.id,
    name: "Synthetic broker", type: "investment", currency: "ZMW", initialBalance: "0.00", balance: "0.00", isPrivate });
  await db.insert(securities).values({ id: securityId, symbol: `AW${securityId.slice(0, 8)}`, name: "Synthetic instrument",
    type: "stock", ...security });
  await db.insert(holdings).values({ householdId: household.id, accountId, securityId, quantity: "10", costBasis: "0" });
  await db.insert(goals).values({ id: goalId, householdId: household.id, name: "Synthetic holdings goal", type: "investment",
    goalType: "retirement", currency: "ZMW", targetAmount: "10000.00", currentAmount: "250.00", progressSource: "holdings",
    linkedAccountId: accountId });
  return { accountId, goalId };
}

async function saveUpGoal(householdId: string, currency: string, currentAmount: string, targetAmount: string) {
  const id = randomUUID();
  await db.insert(goals).values({ id, householdId, name: `Synthetic ${currency} saving`, type: "save_up",
    goalType: "other", currency, targetAmount, currentAmount });
  return id;
}

const storedAmount = async (goalId: string) =>
  (await db.select({ currentAmount: goals.currentAmount }).from(goals).where(eq(goals.id, goalId)))[0].currentAmount;

beforeAll(async () => {
  app = await getTestApp();
  // The server sets the FX service at startup; the test app does not.
  setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates)));
  const provider = await pool.query("select 1 from fx_rates where from_currency = $1 and to_currency = 'ZMW'", [UNRATED]);
  expect(provider.rows, `a provider ${UNRATED} rate would make the missing-rate tests meaningless`).toEqual([]);
}, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (householdIds.length) {
    await db.delete(outboxEvents).where(inArray(outboxEvents.householdId, householdIds));
    await db.delete(auditLogs).where(inArray(auditLogs.householdId, householdIds));
    await db.delete(goalTransfers).where(inArray(goalTransfers.householdId, householdIds));
    await db.delete(goals).where(inArray(goals.householdId, householdIds));
    await db.delete(holdings).where(inArray(holdings.householdId, householdIds));
    await db.delete(transactions).where(inArray(transactions.householdId, householdIds));
    await db.delete(merchants).where(inArray(merchants.householdId, householdIds));
    await db.delete(householdFxRateOverrides).where(inArray(householdFxRateOverrides.householdId, householdIds));
    await db.delete(accounts).where(inArray(accounts.householdId, householdIds));
    await db.delete(householdMembers).where(inArray(householdMembers.householdId, householdIds));
    await db.delete(households).where(inArray(households.id, householdIds));
  }
  if (securityIds.length) await db.delete(securities).where(inArray(securities.id, securityIds));
  for (const userId of userIds) {
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [userId]);
    await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1", [userId]);
    await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
  }
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
});

describe("A-04: a goal with hidden sources is not valued for that viewer", () => {
  it("shows the member the target and unavailable progress, with the hidden holding's currency nowhere", async () => {
    const household = await newHousehold("A-04 hidden holding");
    const { goalId } = await holdingsGoal(household, { currency: UNRATED, currentPrice: "10.0000" }, true);
    const member = as(household, household.member);

    const detail = await member.get(`/api/goals/${goalId}`).expect(200);
    expect(detail.body.data).toMatchObject({ id: goalId, progressAvailability: "unavailable", currentAmount: null,
      targetAmount: { amount: "10000.00", currency: "ZMW" } });
    const list = await member.get("/api/goals").expect(200);
    expect(list.body.data.find((goal: { id: string }) => goal.id === goalId))
      .toMatchObject({ progressAvailability: "unavailable", currentAmount: null });
    const summary = await member.get("/api/goals/summary").expect(200);

    for (const body of [detail.body, list.body, summary.body]) expect(JSON.stringify(body)).not.toContain(UNRATED);
  });
});

describe("A-30: a holding with no price is unavailable progress, never zero", () => {
  it("reads as unavailable, and a balance sync on the account leaves the stored progress as it was", async () => {
    const household = await newHousehold("A-30 unpriced holding");
    const { accountId, goalId } = await holdingsGoal(household, { currency: "ZMW", currentPrice: null }, false);
    const owner = as(household, household.owner);

    const detail = await owner.get(`/api/goals/${goalId}`).expect(200);
    expect(detail.body.data).toMatchObject({ id: goalId, progressAvailability: "unavailable", currentAmount: null });
    const list = await owner.get("/api/goals").expect(200);
    expect(list.body.data.find((goal: { id: string }) => goal.id === goalId))
      .toMatchObject({ progressAvailability: "unavailable", currentAmount: null });

    // Creating a transaction on the account syncs its holdings goals.
    await owner.post("/api/transactions").send({ accountId, type: "income", name: "Synthetic cash in",
      date: utcDay(0), amount: { amount: "5.00", currency: "ZMW" } }).expect(201);
    expect(await storedAmount(goalId)).toBe("250.00");
  });
});

describe("A-09: the goals summary is stated in the household currency", () => {
  it("converts each goal at the household rate and counts the goal it cannot convert", async () => {
    const household = await newHousehold("A-09 mixed currencies");
    await db.insert(householdFxRateOverrides).values({ householdId: household.id, actorUserId: household.owner.id,
      fromCurrency: "USD", toCurrency: "ZMW", effectiveDate: utcDay(-1), validThrough: utcDay(1), rate: "20" });
    await saveUpGoal(household.id, "ZMW", "100.00", "1000.00");
    await saveUpGoal(household.id, "USD", "10.00", "100.00");
    await saveUpGoal(household.id, UNRATED, "5.00", "50.00");

    const summary = await as(household, household.owner).get("/api/goals/summary").expect(200);
    expect(summary.body.data.saveUp).toMatchObject({
      total: 3,
      totalSaved: { amount: "300.00", currency: "ZMW" },
      totalTarget: { amount: "3000.00", currency: "ZMW" },
      overallProgress: 10,
      excludedCount: 1,
    });
  });
});

describe("A-70: a pay-down goal is linked only to a loan the member can see", () => {
  // The loan is in USD, unlike the ZMW household, so a leak of its currency is visible.
  const LOAN = { currency: "USD", balance: "1500.00" };
  const payDown = (debtAccountId: string) => ({ name: "Synthetic loan payoff", type: "pay_down", goalType: "personal_loan",
    debtAccountId, interestRate: "12.50",
    minimumPayment: { amount: "50.00", currency: LOAN.currency }, monthlyPayment: { amount: "100.00", currency: LOAN.currency } });
  const errorOf = (body: { error: { code: string; message: string; details?: unknown } }) =>
    ({ code: body.error.code, message: body.error.message, details: body.error.details });
  const expectNoLoanFigures = (body: unknown) => {
    expect(JSON.stringify(body)).not.toContain(LOAN.balance);
    expect(JSON.stringify(body)).not.toContain(LOAN.currency);
  };
  let household: Household;
  let loanId: string;
  const originalCardId = randomUUID();
  const visibleDestinationId = randomUUID();

  beforeAll(async () => {
    household = await newHousehold("A-70 privatised loan");
    loanId = randomUUID();
    await db.insert(accounts).values({ id: loanId, householdId: household.id, ownerUserId: household.owner.id,
      name: "Synthetic loan", type: "loan", currency: LOAN.currency, isAsset: false, initialBalance: LOAN.balance,
      balance: LOAN.balance, isPrivate: false });
    // The loan was shared, so the member may know its id; its owner then makes it private.
    await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, loanId));
    await db.insert(accounts).values([originalCardId, visibleDestinationId].map((id, index) => ({
      id, householdId: household.id, ownerUserId: household.member.id,
      name: `Synthetic member card ${index + 1}`, type: "credit" as const, currency: LOAN.currency, isAsset: false,
      initialBalance: "200.00", balance: "200.00", isPrivate: false,
    })));
  }, 20_000);

  it("refuses the peer's create exactly like a missing loan, writing nothing", async () => {
    const member = as(household, household.member);

    const missing = await member.post("/api/goals").send(payDown(randomUUID())).expect(400);
    const refused = await member.post("/api/goals").send(payDown(loanId)).expect(400);
    expect(errorOf(refused.body)).toEqual(errorOf(missing.body));
    expectNoLoanFigures(refused.body);
    expect(await db.select().from(goals).where(eq(goals.debtAccountId, loanId))).toEqual([]);
    expect(await db.select().from(auditLogs)
      .where(and(eq(auditLogs.householdId, household.id), eq(auditLogs.entityType, "goal")))).toEqual([]);
  });

  // Positive control, in its own case so its result on the tip is visible on its own.
  it("lets the loan's owner create the goal over HTTP and see the balance as debt and progress", async () => {
    const created = await as(household, household.owner).post("/api/goals").send(payDown(loanId));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data).toMatchObject({ type: "pay_down", debtAccountId: loanId, currency: LOAN.currency,
      originalBalance: { amount: LOAN.balance, currency: LOAN.currency },
      currentAmount: { amount: LOAN.balance, currency: LOAN.currency } });
  });

  async function createMemberPayDown() {
    const created = await as(household, household.member).post("/api/goals").send(payDown(originalCardId)).expect(201);
    expect(created.body.data).toMatchObject({ debtAccountId: originalCardId, targetAmount: { amount: "0.00", currency: LOAN.currency } });
    return created.body.data.id as string;
  }

  it("re-links a normally created pay-down goal with its zero target to another visible account", async () => {
    const goalId = await createMemberPayDown();
    const updated = await as(household, household.member).put(`/api/goals/${goalId}`)
      .send({ debtAccountId: visibleDestinationId }).expect(200);
    expect(updated.body.data).toMatchObject({
      debtAccountId: visibleDestinationId, targetAmount: { amount: "0.00", currency: LOAN.currency },
    });
    const [stored] = await db.select().from(goals).where(eq(goals.id, goalId));
    expect(stored).toMatchObject({ debtAccountId: visibleDestinationId, targetAmount: "0.00",
      currentAmount: "200.00", originalBalance: "200.00", currency: LOAN.currency });
    const detail = await as(household, household.member).get(`/api/goals/${goalId}`).expect(200);
    expect(detail.body.data).toMatchObject({ debtAccountId: visibleDestinationId, progressAvailability: "available",
      targetAmount: { amount: "0.00", currency: LOAN.currency },
      currentAmount: { amount: "200.00", currency: LOAN.currency } });
  });

  it("refuses the peer re-linking their own goal to the private loan exactly like a missing loan, changing nothing", async () => {
    const goalId = await createMemberPayDown();
    const [before] = await db.select().from(goals).where(eq(goals.id, goalId));
    const auditRows = () => db.select().from(auditLogs).where(and(
      eq(auditLogs.householdId, household.id), eq(auditLogs.entityType, "goal"), eq(auditLogs.entityId, goalId),
    ));
    const auditBefore = await auditRows();
    const relink = (debtAccountId: string) => as(household, household.member).put(`/api/goals/${goalId}`).send({ debtAccountId });

    const missing = await relink(randomUUID()).expect(400);
    const refused = await relink(loanId).expect(400);
    expect(errorOf(missing.body)).toMatchObject({ message: "Debt account not found" });
    expect(errorOf(refused.body)).toEqual(errorOf(missing.body));
    expectNoLoanFigures(refused.body);
    expect((await db.select().from(goals).where(eq(goals.id, goalId)))[0]).toEqual(before);
    expect(await auditRows()).toEqual(auditBefore);
  });

  async function seedLegacyOwnerPayDown(debtAccountId = loanId) {
    const id = randomUUID();
    // The relink cases can also run before the forward zero-target migration.
    await db.insert(goals).values({ id, householdId: household.id, createdBy: household.owner.id,
      name: "Synthetic existing payoff", type: "pay_down", goalType: "personal_loan", debtAccountId,
      currency: LOAN.currency, targetAmount: "1.00", originalBalance: LOAN.balance, currentAmount: LOAN.balance,
      minimumPayment: "50.00", monthlyPayment: "100.00" });
    return id;
  }

  it("withholds the private loan's progress while and after the owner relinks to a shared account", async () => {
    const goalId = await seedLegacyOwnerPayDown();
    const path = `/api/goals/${goalId}`;
    const owner = as(household, household.owner);
    const member = as(household, household.member);
    const [before] = await db.select().from(goals).where(eq(goals.id, goalId));
    const original = goalActivityLogService.log.bind(goalActivityLogService);
    let activityStarted!: () => void;
    const writingActivity = new Promise<void>(resolve => { activityStarted = resolve; });
    let resumeActivity!: () => void;
    const activityMayContinue = new Promise<void>(resolve => { resumeActivity = resolve; });
    vi.spyOn(goalActivityLogService, "log").mockImplementation(async entry => {
      if (entry.goalId === goalId && entry.activityType === "goal_updated") {
        activityStarted();
        await activityMayContinue;
      }
      return original(entry);
    });

    const relink = owner.put(path).send({ debtAccountId: visibleDestinationId }).expect(200).then(response => response);
    try {
      await Promise.race([writingActivity, relink.then(() => { throw new Error("Relink finished without writing activity"); })]);
      const during = await member.get(path).expect(200);
      expect(during.body.data).toMatchObject({ progressAvailability: "unavailable", currentAmount: null, originalBalance: null });
      expect((await db.select().from(goals).where(eq(goals.id, goalId)))[0]).toEqual(before);
    } finally {
      resumeActivity();
      await relink;
    }

    const updated = await relink;
    expect(updated.body.data).toMatchObject({ debtAccountId: visibleDestinationId,
      targetAmount: { amount: "1.00", currency: LOAN.currency },
      progressAvailability: "available", originalBalance: { amount: LOAN.balance, currency: LOAN.currency } });
    const after = await member.get(path).expect(200);
    expect(after.body.data).toMatchObject({ debtAccountId: visibleDestinationId,
      progressAvailability: "unavailable", currentAmount: null, originalBalance: null });
    expect(JSON.stringify(after.body)).not.toContain(LOAN.balance);
    const ownerActivity = await owner.get(`${path}/activity`).expect(200);
    expect(ownerActivity.body.data).toEqual(expect.arrayContaining([expect.objectContaining({
      activityType: "goal_updated", createdBy: household.owner.id,
      metadata: expect.objectContaining({ previousValues: expect.objectContaining({ debtAccountId: loanId }) }),
    })]));
    const memberActivity = await member.get(`${path}/activity`).expect(200);
    expect(memberActivity.body.data).not.toEqual(expect.arrayContaining([expect.objectContaining({ activityType: "goal_updated" })]));
    expect(JSON.stringify(memberActivity.body)).not.toContain(loanId);
    const updates = await db.select().from(auditLogs).where(and(
      eq(auditLogs.householdId, household.id), eq(auditLogs.entityType, "goal"),
      eq(auditLogs.entityId, goalId), eq(auditLogs.action, "UPDATE"),
    ));
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ userId: household.owner.id, details: {
      oldValue: { currentAmount: before.currentAmount, status: before.status },
      newValue: { currentAmount: LOAN.balance, status: updated.body.data.status },
    } });
  });

  it("rolls the relink and its audit back when the goal activity insert fails", async () => {
    const goalId = await seedLegacyOwnerPayDown();
    const goalRows = () => db.select().from(goals).where(eq(goals.id, goalId));
    const activityRows = () => db.select().from(goalActivityLog).where(eq(goalActivityLog.goalId, goalId));
    const auditRows = () => db.select().from(auditLogs).where(and(
      eq(auditLogs.householdId, household.id), eq(auditLogs.entityType, "goal"), eq(auditLogs.entityId, goalId),
    ));
    const before = await Promise.all([goalRows(), activityRows(), auditRows()]);
    const original = goalActivityLogService.log.bind(goalActivityLogService);
    // A missing activity author makes the real INSERT fail its foreign key.
    const failingInsert = vi.spyOn(goalActivityLogService, "log").mockImplementation(entry => original(
      entry.goalId === goalId && entry.activityType === "goal_updated" ? { ...entry, createdBy: randomUUID() } : entry,
    ));

    const path = `/api/goals/${goalId}`;
    await as(household, household.owner).put(path).send({ debtAccountId: visibleDestinationId }).expect(500);
    expect(failingInsert).toHaveBeenCalledWith(expect.objectContaining({ goalId, activityType: "goal_updated" }));
    expect(await Promise.all([goalRows(), activityRows(), auditRows()])).toEqual(before);
    const peer = await as(household, household.member).get(path).expect(200);
    expect(peer.body.data).toMatchObject({ progressAvailability: "unavailable", currentAmount: null, debtAccountId: null });
  });

  it("retains the previous private investment account when the owner clears the optional link", async () => {
    const accountId = randomUUID();
    await db.insert(accounts).values({ id: accountId, householdId: household.id, ownerUserId: household.owner.id,
      name: "Synthetic private investment", type: "investment", currency: LOAN.currency, initialBalance: "0.00",
      balance: "0.00", isPrivate: true });
    const owner = as(household, household.owner);
    const created = await owner.post("/api/goals").send({ name: "Synthetic investment goal", type: "investment",
      goalType: "other", linkedAccountId: accountId, progressSource: "contributions",
      targetAmount: { amount: "1000.00", currency: LOAN.currency },
    }).expect(201);
    const path = `/api/goals/${created.body.data.id}`;

    const detached = await owner.put(path).send({ linkedAccountId: null }).expect(200);
    expect(detached.body.data).toMatchObject({ linkedAccountId: null, progressAvailability: "available" });
    const peer = await as(household, household.member).get(path).expect(200);
    expect(peer.body.data).toMatchObject({ linkedAccountId: null, progressAvailability: "unavailable", currentAmount: null });
    const ownerActivity = await owner.get(`${path}/activity`).expect(200);
    expect(ownerActivity.body.data).toEqual(expect.arrayContaining([expect.objectContaining({
      activityType: "goal_updated", metadata: expect.objectContaining({ previousValues: { linkedAccountId: accountId } }),
    })]));
  });

  it("checks the member's current write grant before creating a linked investment goal", async () => {
    const accountId = randomUUID();
    await db.insert(accounts).values({ id: accountId, householdId: household.id, ownerUserId: household.member.id,
      name: "Synthetic active investment", type: "investment", currency: LOAN.currency, initialBalance: "0.00",
      balance: "0.00", isPrivate: false });
    const member = as(household, household.member);
    const data = { name: "Synthetic signed investment", type: "investment", goalType: "other",
      linkedAccountId: accountId, progressSource: "contributions", targetAmount: { amount: "1000.00", currency: LOAN.currency } };
    const membership = and(eq(householdMembers.householdId, household.id), eq(householdMembers.userId, household.member.id));
    const create = goalService.createGoal.bind(goalService);
    const downgrade = vi.spyOn(goalService, "createGoal").mockImplementation(async (input, householdId, userId, actor, audit) => {
      // The signed route has admitted the member; revoke write permission before the service locks it.
      await db.update(householdMembers).set({ role: "view_only" }).where(membership);
      return create(input, householdId, userId, actor, audit);
    });
    try {
      const denied = await member.post("/api/goals").send(data).expect(403);
      expect(denied.body.error.code).toBe("FORBIDDEN");
      // The fifth argument is the request's audit context (FIN-13: the CREATE row is written in the goal's transaction).
      expect(downgrade).toHaveBeenCalledWith(expect.objectContaining({ linkedAccountId: accountId }),
        household.id, household.member.id, expect.objectContaining({ role: "member" }), expect.any(Object));
      expect(await db.select().from(goals).where(eq(goals.linkedAccountId, accountId))).toEqual([]);
    } finally {
      downgrade.mockRestore();
      await db.update(householdMembers).set({ role: "member" }).where(membership);
    }

    const created = await member.post("/api/goals").send(data).expect(201);
    expect(created.body.data).toMatchObject({ linkedAccountId: accountId, currency: LOAN.currency });
  });

  it("refuses an archived debt destination but keeps an existing archived link editable", async () => {
    const archivedId = randomUUID();
    await db.insert(accounts).values({ id: archivedId, householdId: household.id, ownerUserId: household.owner.id,
      name: "Synthetic archived card", type: "credit", currency: LOAN.currency, initialBalance: LOAN.balance,
      balance: LOAN.balance, isPrivate: false, isArchived: true });
    const owner = as(household, household.owner);
    const missingCreate = await owner.post("/api/goals").send(payDown(randomUUID())).expect(400);
    const archivedCreate = await owner.post("/api/goals").send(payDown(archivedId)).expect(400);
    expect(errorOf(archivedCreate.body)).toEqual(errorOf(missingCreate.body));
    expect(await db.select().from(goals).where(eq(goals.debtAccountId, archivedId))).toEqual([]);

    const goalId = await seedLegacyOwnerPayDown();
    const missingUpdate = await owner.put(`/api/goals/${goalId}`).send({ debtAccountId: randomUUID() }).expect(400);
    const archivedUpdate = await owner.put(`/api/goals/${goalId}`).send({ debtAccountId: archivedId }).expect(400);
    expect(errorOf(archivedUpdate.body)).toEqual(errorOf(missingUpdate.body));
    expect((await db.select().from(goals).where(eq(goals.id, goalId)))[0].debtAccountId).toBe(loanId);

    const legacyId = await seedLegacyOwnerPayDown(archivedId);
    const updated = await owner.put(`/api/goals/${legacyId}`)
      .send({ name: "Synthetic renamed payoff", debtAccountId: archivedId }).expect(200);
    expect(updated.body.data).toMatchObject({ name: "Synthetic renamed payoff", debtAccountId: archivedId,
      targetAmount: { amount: "1.00", currency: LOAN.currency } });
  });
});

describe("A-70: stored goal targets retain the existing constraint with a zero pay-down exception", () => {
  let household: Household;

  beforeAll(async () => {
    household = await newHousehold("A-70 target constraint");
  }, 20_000);

  const insertTarget = (type: "save_up" | "investment" | "pay_down", targetAmount: string | null) =>
    pool.query<{ id: string; target_amount: string }>(
      "insert into goals (household_id, name, type, target_amount) values ($1, $2, $3, $4) returning id, target_amount",
      [household.id, "Synthetic goal target", type, targetAmount],
    );

  it("accepts a zero pay-down and preserves positive targets for all goal types", async () => {
    const zero = await insertTarget("pay_down", "0.00");
    expect(zero.rows[0].target_amount).toBe("0.00");
    for (const type of ["save_up", "investment", "pay_down"] as const) {
      const positive = await insertTarget(type, "123.45");
      expect(positive.rows[0].target_amount).toBe("123.45");
      const [updated] = await db.update(goals).set({ name: "Synthetic renamed goal" })
        .where(eq(goals.id, positive.rows[0].id)).returning({ targetAmount: goals.targetAmount });
      expect(updated.targetAmount).toBe("123.45");
    }
  });

  it("rejects zero ordinary targets, negative targets, and null pay-down targets", async () => {
    for (const type of ["save_up", "investment"] as const) {
      await expect(insertTarget(type, "0.00"))
        .rejects.toMatchObject({ code: "23514", constraint: "chk_goal_target_positive" });
    }
    for (const type of ["save_up", "investment", "pay_down"] as const) {
      await expect(insertTarget(type, "-0.01"))
        .rejects.toMatchObject({ code: "23514", constraint: "chk_goal_target_positive" });
    }
    await expect(insertTarget("pay_down", null))
      .rejects.toMatchObject({ code: "23502", column: "target_amount" });
  });
});

describe("A-06 / A-23: a goal transfer keeps its currency and commits with its audit row", () => {
  let household: Household;
  let fromGoalId: string;
  let toGoalId: string;
  const transfer = (amount: { amount: string; currency: string }) => as(household, household.owner)
    .post("/api/goals/transfers").send({ fromGoalId, toGoalId, amount });
  const transferRows = () => db.select().from(goalTransfers).where(eq(goalTransfers.fromGoalId, fromGoalId));
  const balances = async () => [await storedAmount(fromGoalId), await storedAmount(toGoalId)];

  beforeAll(async () => {
    household = await newHousehold("A-06 transfers");
  }, 20_000);

  // Each case starts from its own pair of goals, so no case sees another's transfer.
  beforeEach(async () => {
    fromGoalId = await saveUpGoal(household.id, "USD", "100.00", "1000.00");
    toGoalId = await saveUpGoal(household.id, "USD", "100.00", "1000.00");
  });

  it("A-06: refuses an amount in another currency than the goals', moving nothing", async () => {
    const refused = await transfer({ amount: "10.00", currency: "ZMW" }).expect(400);
    expect(refused.body.success).toBe(false);
    expect(await balances()).toEqual(["100.00", "100.00"]);
    expect(await transferRows()).toEqual([]);
  });

  it("A-23: a failing audit insert rolls the transfer back", async () => {
    const original = businessAuditService.log.bind(businessAuditService);
    // The audit row names a household that does not exist, so its insert fails the foreign key.
    vi.spyOn(businessAuditService, "log").mockImplementation((entry) =>
      original(entry.entityType === "goal_transfer" ? { ...entry, householdId: randomUUID() } : entry));

    const failed = await transfer({ amount: "10.00", currency: "USD" });
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(await balances()).toEqual(["100.00", "100.00"]);
    expect(await transferRows()).toEqual([]);
  });

  it("a transfer in the goals' currency commits with exactly one goal_transfer audit row", async () => {
    const created = await transfer({ amount: "10.00", currency: "USD" }).expect(201);
    expect(await balances()).toEqual(["90.00", "110.00"]);
    const [row, ...extra] = await transferRows();
    expect(extra).toEqual([]);
    expect(created.body.data.transfer.id).toBe(row.id);
    const audits = await db.select().from(auditLogs)
      .where(and(eq(auditLogs.entityType, "goal_transfer"), eq(auditLogs.entityId, row.id)));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ householdId: household.id, userId: household.owner.id, action: "CREATE" });
    expect(audits[0].details).toMatchObject({ newValue: { amount: { amount: "10.00", currency: "USD" } } });
  });
});
