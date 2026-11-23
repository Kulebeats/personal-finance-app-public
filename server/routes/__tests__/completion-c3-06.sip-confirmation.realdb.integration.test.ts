import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { accounts, holdings, householdMembers, households, recurringInvestments, securities, securityPrices, users } from "@shared/schema";
import { db, pool } from "../../db";
import { hashPassword } from "../../auth";
import { getTestApp } from "../../__tests__/fixtures";
import { businessAuditService } from "../../services/BusinessAuditService";
import { processDueInvestments } from "../../services/investment/processDueInvestments";
import { eraseAccount } from "../../modules/settings/settings.account-deletion.service";
import { createSignedPlan, globalPriceState, metadata, setOtherRole, signed as signedPrice } from "./completion-c3-06.price-confirmation.fixture";
import {
  cleanConfirmationFixture, configureConfirmationCalendar, confirmationInput, confirmationPath, confirmationSnapshot,
  createConfirmationFixture, createPendingOccurrence, makePrivate, occurrencesPath,
  plannedSnapshot, plansPath, previousDate, purchaseRows, seedConfirmationFixture,
  purchaseSummary, setPeerRole, signedConfirmation, transferOwnershipToPeer, tick, waitForConfirmationDatabaseBlock,
  type ConfirmationActor, type ConfirmationFixture, type ConfirmationInput, type CreatedPlan,
} from "./completion-c3-06.sip-confirmation.fixture";

// TEST-FIRST / UNRUN. Main owns compilation, signed runtime, additive-schema
// composition and the unresolved authoritative calendar dependency. These are
// acceptance fixtures, not evidence that any endpoint/assertion was reached.
let app: Awaited<ReturnType<typeof getTestApp>>;
let fixture: ConfirmationFixture;
let passwordHash: string;
const securitiesPath = "/api/investments/securities";

function signed(actor: ConfirmationActor, method: "get" | "post" | "delete", path: string) {
  return signedConfirmation(app, fixture, actor, method, path);
}
function confirm(planId: string, input: string | object, actor: ConfirmationActor = "home", date = fixture.today) {
  return signed(actor, "post", confirmationPath(planId, date)).send(input);
}
function pending(planId: string, permittedActions: Array<"confirm"> = ["confirm"]) {
  return {
    planId, scheduledDate: fixture.today, state: "pending", detailsAvailable: true,
    occurrenceRevision: 0, planned: plannedSnapshot(fixture), permittedActions,
  };
}

async function expectPriceIndependentHold(plan: CreatedPlan, securityId: string = fixture.referenceSecurityId) {
  const path = occurrencesPath(plan.id);
  const pagination = { hasMore: false, nextBefore: null };
  expect((await signed("home", "get", path).expect(200)).body).toEqual({ success: true, data: [], pagination });
  const before = await confirmationSnapshot(fixture);
  expect(before.plans).toEqual([plan]);
  expect(before).toMatchObject({
    holdings: [], purchases: [], lots: [], disposals: [], cash: [], proofs: [], reservations: [],
    successLogs: [], purchaseAudits: [], fences: [], occurrences: [], confirmations: [], fills: [],
  });
  const prices = await globalPriceState(fixture);

  expect(await processDueInvestments()).toEqual({ success: 0, skipped: 0, held: 1, failed: 0, errors: [] });
  const after = await confirmationSnapshot(fixture);
  const due = new Date(`${fixture.today}T00:00:00Z`);
  const nextMonth = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 2, 0));
  nextMonth.setUTCDate(Math.min(due.getUTCDate(), nextMonth.getUTCDate()));
  expect(after).toEqual({
    ...before,
    plans: [{ ...plan, nextExecutionDate: nextMonth.toISOString().slice(0, 10), updatedAt: expect.any(Date) }],
    fences: [expect.objectContaining({ plan_id: plan.id, terminal: false })],
    occurrences: [expect.objectContaining({
      plan_id: plan.id, household_id: fixture.homeHouseholdId, account_id: fixture.homeAccountId,
      security_id: securityId, planned_amount: "10.00", currency: "ZMW", authorized_frequency: "monthly",
      occurrence_revision: 0, state: "pending",
    })],
  });

  expect(await processDueInvestments()).toEqual({ success: 0, skipped: 0, held: 0, failed: 0, errors: [] });
  const listed = pending(plan.id);
  expect((await signed("home", "get", path).expect(200)).body).toEqual({
    success: true, data: [{ ...listed, planned: { ...listed.planned, securityId } }], pagination,
  });
  expect(await confirmationSnapshot(fixture)).toEqual(after);
  expect(await globalPriceState(fixture)).toEqual(prices);
}

async function expectRecorded(planId: string, input: ConfirmationInput, actor: ConfirmationActor = "home") {
  const before = await confirmationSnapshot(fixture);
  const response = await confirm(planId, input, actor).expect(200);
  const after = await confirmationSnapshot(fixture);
  const purchases = await purchaseRows(fixture);
  const fills = response.body.data.occurrence.result.fills as Array<{
    fillIndex: number; purchaseId: string; executionDate: string;
    quantity: string; price: string; fees: string; amount: string;
  }>;
  expect(response.body).toEqual({ success: true, data: {
    requestVersion: 1, operationId: input.operationId,
    occurrence: {
      planId, scheduledDate: fixture.today, state: "closed", detailsAvailable: true,
      occurrenceRevision: 1, planned: plannedSnapshot(fixture),
      result: { outcome: input.outcome, fills, totals: {
        grossAmount: "9.34", fees: "0.33", amount: "9.67",
      } },
    },
  } });
  expect(fills).toHaveLength(2);
  expect(purchases).toHaveLength(2);
  const expectedAmounts = ["4.80", "4.87"];
  for (const [index, fill] of fills.entries()) {
    const purchase = purchases.find(row => row.id === fill.purchaseId);
    expect(fill).toEqual({ fillIndex: index, purchaseId: expect.any(String),
      ...input.fills[index], amount: expectedAmounts[index] });
    expect(purchase).toMatchObject({ householdId: fixture.homeHouseholdId,
      accountId: fixture.homeAccountId, securityId: fixture.referenceSecurityId, type: "buy",
      transactionDate: fill.executionDate, quantity: fill.quantity, price: fill.price,
      fees: fill.fees, amount: fill.amount, currency: "ZMW", fxRate: null, amountZmw: null,
      linkedTransactionId: null,
    });
    const lot = after.lots.find(row => row.transactionId === fill.purchaseId);
    expect(lot).toMatchObject({ quantity: fill.quantity, remainingQuantity: fill.quantity,
      costBasis: fill.amount, acquiredDate: fill.executionDate,
      acquisitionFxRate: null, costBasisZmw: null });
    const proof = after.proofs.find(row => row.purchase_id === fill.purchaseId);
    expect(proof).toMatchObject({ author_user_id: fixture[actor].id,
      authorization_contract_version: 2, authorized_frequency: "monthly",
      authorized_initial_date: fixture.today,
    });
    expect(Object.keys(proof ?? {}).sort()).toEqual([
      "purchase_id", "author_user_id", "authorized_at", "authorization_contract_version",
      "authorized_frequency", "authorized_initial_date", "authorized_terms_digest",
    ].sort());
    const audits = after.audits.filter(row => row.entityType === "investment_transaction" && row.entityId === fill.purchaseId);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ userId: fixture[actor].id, householdId: fixture.homeHouseholdId,
      action: "CREATE", ipAddress: null });
    expect(audits[0].details).toEqual({ newValue: {
      type: "buy", accountId: fixture.homeAccountId, holdingId: purchase?.holdingId,
      securityId: fixture.referenceSecurityId, quantity: fill.quantity, amount: fill.amount,
      currency: "ZMW", transactionDate: fill.executionDate, price: fill.price,
      fees: fill.fees, feesDeclared: true,
    } });
  }
  const times = await pool.query<{ proof_time: string; confirmation_time: string }>(`
    select p.authorized_at::text as proof_time,c.authorized_at::text as confirmation_time
    from investment_purchase_authorization_proofs p
    join investment_sip_confirmed_fills f on f.purchase_id=p.purchase_id
    join investment_sip_confirmations c on c.id=f.confirmation_id
    where c.plan_id=$1 order by f.fill_index`, [planId]);
  expect(times.rows).toHaveLength(2);
  for (const row of times.rows) expect(row.proof_time).toBe(row.confirmation_time);
  expect(after.accounts).toEqual(before.accounts);
  expect(after.cash).toEqual(before.cash);
  expect(after.plans).toEqual(before.plans);
  expect(after.holdings).toHaveLength(1);
  expect(after.holdings[0]).toMatchObject({ quantity: "3.50000000", costBasis: "9.67" });
  const closure = after.audits.filter(row => row.entityType === "investment_sip_confirmation");
  expect(closure).toHaveLength(1);
  expect(closure[0]).toMatchObject({ userId: fixture[actor].id, householdId: null, action: "CREATE", ipAddress: null,
    details: { authorizationEvent: "sip_final_confirmation_v1", requestVersion: 1 } });
  expect(closure[0].entityId).toBe(after.confirmations[0].id);
  expect(after.confirmations[0].broker_reference).toBe(input.brokerReference ?? null);
  return { response, before, after };
}

describe("C3-06 signed final-statement occurrence confirmation", () => {
  beforeAll(async () => {
    app = await getTestApp();
    passwordHash = await hashPassword("SyntheticC306Prices123!");
  });
  beforeEach(async () => {
    fixture = createConfirmationFixture();
    await seedConfirmationFixture(fixture, app, passwordHash);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (fixture) await cleanConfirmationFixture(fixture);
  });

  it("materializes one original-date pending occurrence, advances once and exposes no purchase success", async () => {
    const plan = await createSignedPlan(app, fixture);
    const first = await tick(app);
    const second = await tick(app);
    const listed = await signed("home", "get", occurrencesPath(plan.id)).expect(200);
    expect(listed.body).toEqual({ success: true, data: [pending(plan.id)],
      pagination: { hasMore: false, nextBefore: null } });
    const state = await confirmationSnapshot(fixture);
    expect(state.fences).toHaveLength(1);
    expect(state.occurrences).toHaveLength(1);
    expect(state.confirmations).toEqual([]);
    expect(state.purchases).toEqual([]);
    expect(state.lots).toEqual([]);
    expect(state.proofs).toEqual([]);
    expect(state.successLogs).toEqual([]);
    // The door reports the purchase job's journal summary, which has no purchase success.
    for (const response of [first, second]) {
      expect(purchaseSummary(response)).toBeDefined();
      expect(purchaseSummary(response)).not.toHaveProperty("success");
    }
    expect(state.plans[0].nextExecutionDate).not.toBe(fixture.today);
  });

  // These two signed writer controls require the reviewed price API at d6b10e66
  // and its household price storage composed with the occurrence candidate.
  it("holds the home plan after refusing an other-household global price attempt", async () => {
    const plan = await createSignedPlan(app, fixture);
    const path = `${securitiesPath}/${fixture.referenceSecurityId}`;
    const before = await confirmationSnapshot(fixture);
    const global = await globalPriceState(fixture);
    expect(global.instruments).toHaveLength(1);
    const reference = global.instruments[0];
    const attempt = { price: "1.0000", date: fixture.today };
    await signedPrice(app, fixture, "other", "put", `${path}/price`).send(attempt).expect(403);
    await signedPrice(app, fixture, "other", "put", `${path}/price`)
      .send({ ...attempt, validThrough: fixture.today }).expect(403);
    await setOtherRole(fixture, "owner");
    const refused = await signedPrice(app, fixture, "other", "put", `${path}/price`).send(attempt).expect(400);
    expect(refused.body).toMatchObject({ success: false, error: {
      code: "VALIDATION_ERROR", fields: expect.arrayContaining([expect.objectContaining({ field: "validThrough" })]),
    } });
    for (const actor of ["home", "other"] as const) {
      const readback = await signed(actor, "get", path).expect(200);
      expect(readback.body.data).toMatchObject({ id: reference.id, currentPrice: reference.currentPrice, valuationPrice: null });
    }
    expect(await globalPriceState(fixture)).toEqual(global);
    expect(await confirmationSnapshot(fixture)).toEqual(before);
    await expectPriceIndependentHold(plan);
  });

  it("holds the home plan after refusing a price on other-household metadata creation", async () => {
    const fields = metadata(fixture);
    const before = await confirmationSnapshot(fixture);
    const global = await globalPriceState(fixture);
    const rejected = await signed("other", "post", securitiesPath).send({ ...fields, currentPrice: "1.00" }).expect(400);
    expect(rejected.body).toMatchObject({ success: false, error: {
      code: "VALIDATION_ERROR", fields: expect.arrayContaining([expect.objectContaining({ field: "currentPrice" })]),
    } });
    expect(await confirmationSnapshot(fixture)).toEqual(before);
    expect(await globalPriceState(fixture)).toEqual(global);

    const created = await signed("other", "post", securitiesPath).send(fields).expect(201);
    const securityId = created.body.data.id as string;
    const afterCreate = await globalPriceState(fixture);
    expect(afterCreate.instruments).toHaveLength(global.instruments.length + 1);
    expect(afterCreate.instruments.filter(row => row.id !== securityId)).toEqual(global.instruments);
    expect(afterCreate.instruments.find(row => row.id === securityId)).toMatchObject({
      ...fields, currentPrice: null, lastPriceUpdate: null,
    });
    expect(afterCreate.prices).toEqual(global.prices);
    // NEW-13: other's security is other's custom row; home can neither read it nor plan on it.
    await signed("home", "get", `${securitiesPath}/${securityId}`).expect(404);
    await signed("home", "post", "/api/investments/recurring").send({
      operationId: randomUUID(), accountId: fixture.homeAccountId, securityId, type: "sip", frequency: "monthly",
      amount: "10.00", currency: "ZMW", nextExecutionDate: fixture.today,
    }).expect(404);
    const afterMetadata = await confirmationSnapshot(fixture);
    const priorAuditIds = new Set(before.audits.map(row => row.id));
    expect(afterMetadata.audits.filter(row => !priorAuditIds.has(row.id))).toMatchObject([{
      action: "CREATE", entityType: "security", entityId: securityId,
      householdId: fixture.otherHouseholdId, userId: fixture.other.id, details: { newValue: fields },
    }]);
    expect({ ...afterMetadata, audits: afterMetadata.audits.filter(row => priorAuditIds.has(row.id)) }).toEqual(before);
    await expectPriceIndependentHold(await createSignedPlan(app, fixture));
  });

  it.each([
    { label: "stale manual reference with a fresh write timestamp", source: "manual", date: "2000-01-01" },
    { label: "stale provider reference with a fresh observation timestamp", source: "synthetic_provider", date: "2000-01-01" },
    { label: "current provider reference with a fresh observation timestamp", source: "synthetic_provider", date: "today" },
  ])("holds a due signed plan with a $label", async reference => {
    // Synthetic storage facts exercise the actual scheduler without a provider call.
    const price = "2.0000";
    const observedAt = new Date();
    const date = reference.date === "today" ? fixture.today : reference.date;
    await db.update(securities).set({ currentPrice: price, lastPriceUpdate: observedAt })
      .where(eq(securities.id, fixture.referenceSecurityId));
    await db.insert(securityPrices).values({ securityId: fixture.referenceSecurityId,
      price, date, source: reference.source, createdAt: observedAt });
    const quotes = await globalPriceState(fixture);
    expect(quotes.instruments).toMatchObject([{ id: fixture.referenceSecurityId, currentPrice: price, lastPriceUpdate: observedAt }]);
    expect(quotes.prices).toMatchObject([{ securityId: fixture.referenceSecurityId, price, date, source: reference.source, createdAt: observedAt }]);
    await expectPriceIndependentHold(await createSignedPlan(app, fixture));
  });

  it("holds an authorized confirmation without writes while the household calendar policy is unresolved", async () => {
    const { plan } = await createPendingOccurrence(app, fixture, false);
    const before = await confirmationSnapshot(fixture);
    const response = await confirm(plan.id, confirmationInput(fixture)).expect(409);
    expect(response.body).toMatchObject({ success: false, error: {
      code: "HOUSEHOLD_CALENDAR_REQUIRED",
      message: "Confirmation is unavailable until the household calendar is configured.",
    } });
    expect(await confirmationSnapshot(fixture)).toEqual(before);
  });

  it("keeps the calendar unset until a currently signed household owner explicitly configures it", async () => {
    const unset = await signed("home", "get", "/api/investments/calendar").expect(200);
    expect(unset.body).toEqual({ success: true, data: {
      timeZone: null, configured: false, permittedActions: ["configure"],
    } });
    const before = await confirmationSnapshot(fixture);
    const configured = await configureConfirmationCalendar(app, fixture, "Europe/London");
    expect(configured.body).toEqual({ success: true, data: {
      timeZone: "Europe/London", configured: true, permittedActions: ["configure"],
    } });
    const after = await confirmationSnapshot(fixture);
    expect(after.calendars.find(row => row.id === fixture.homeHouseholdId)?.time_zone).toBe("Europe/London");
    const [identity] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, fixture.home.id));
    expect(identity.timezone).toBe("Africa/Lusaka");
    const audits = after.audits.filter(row => row.entityType === "household_preferences");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "UPDATE", userId: fixture.home.id,
      householdId: fixture.homeHouseholdId, entityId: fixture.homeHouseholdId,
      details: { oldValue: { timeZone: null }, newValue: { timeZone: "Europe/London" } } });
    expect(after.purchases).toEqual(before.purchases);
    await configureConfirmationCalendar(app, fixture, "Europe/London");
    expect(await confirmationSnapshot(fixture)).toEqual(after);
  });

  it("exposes an unsupported stored calendar as unconfigured so the current owner can recover through signed PUT", async () => {
    // Explicit negative stored-policy fixture only. This does not supply a
    // positive owner choice; recovery must use the actual signed owner route.
    await db.update(households).set({ timeZone: "Invalid/Stored_Policy" })
      .where(eq(households.id, fixture.homeHouseholdId));
    const beforeRead = await confirmationSnapshot(fixture);
    expect((await signed("home", "get", "/api/investments/calendar").expect(200)).body).toEqual({
      success: true, data: { timeZone: null, configured: false, permittedActions: ["configure"] },
    });
    expect((await signed("peer", "get", "/api/investments/calendar").expect(200)).body).toEqual({
      success: true, data: { timeZone: null, configured: false, permittedActions: [] },
    });
    expect(await confirmationSnapshot(fixture)).toEqual(beforeRead);
    await request(app).put("/api/investments/calendar").set("Cookie", fixture.peer.cookie)
      .set("X-Capital-Subject", fixture.peer.id).set("X-Capital-Household", fixture.homeHouseholdId)
      .send({ timeZone: "Africa/Lusaka" }).expect(403);
    expect(await confirmationSnapshot(fixture)).toEqual(beforeRead);
    const { plan } = await createPendingOccurrence(app, fixture, false);
    const pendingState = await confirmationSnapshot(fixture);
    const held = await confirm(plan.id, confirmationInput(fixture)).expect(409);
    expect(held.body.error.code).toBe("HOUSEHOLD_CALENDAR_REQUIRED");
    expect(await confirmationSnapshot(fixture)).toEqual(pendingState);
    await configureConfirmationCalendar(app, fixture);
    expect((await signed("home", "get", "/api/investments/calendar").expect(200)).body).toEqual({
      success: true, data: { timeZone: "Africa/Lusaka", configured: true, permittedActions: ["configure"] },
    });
    await expectRecorded(plan.id, confirmationInput(fixture));
  });

  it.each(["admin", "member", "view_only", "professional"] as const)(
    "allows current %s calendar reads but denies even same-value writes", async role => {
      await configureConfirmationCalendar(app, fixture);
      await setPeerRole(fixture, role);
      const read = await signed("peer", "get", "/api/investments/calendar").expect(200);
      expect(read.body).toEqual({ success: true, data: {
        timeZone: "Africa/Lusaka", configured: true, permittedActions: [],
      } });
      const before = await confirmationSnapshot(fixture);
      await request(app).put("/api/investments/calendar").set("Cookie", fixture.peer.cookie)
        .set("X-Capital-Subject", fixture.peer.id).set("X-Capital-Household", fixture.homeHouseholdId)
        .send({ timeZone: "Africa/Lusaka" }).expect(403);
      expect(await confirmationSnapshot(fixture)).toEqual(before);
    },
  );

  it("rolls back a calendar change when its mandatory owner audit fails", async () => {
    const before = await confirmationSnapshot(fixture);
    const original = businessAuditService.log.bind(businessAuditService);
    let reached = false;
    const fault = vi.spyOn(businessAuditService, "log").mockImplementation(async entry => {
      if (entry.entityType === "household_preferences" && entry.action === "UPDATE") {
        reached = true;
        throw new Error("Synthetic mandatory household calendar audit refusal");
      }
      return original(entry);
    });
    const failed = await request(app).put("/api/investments/calendar").set("Cookie", fixture.home.cookie)
      .set("X-Capital-Subject", fixture.home.id).set("X-Capital-Household", fixture.homeHouseholdId)
      .send({ timeZone: "Africa/Lusaka" });
    expect(failed.status).toBeGreaterThanOrEqual(400);
    expect(reached).toBe(true);
    expect(await confirmationSnapshot(fixture)).toEqual(before);
    fault.mockRestore();
    await configureConfirmationCalendar(app, fixture);
  });

  it.each([null, "", "Not/AZone", "UTC+02", " Africa/Lusaka "])(
    "rejects an invalid owner calendar declaration without persisting it: %s", async timeZone => {
      const before = await confirmationSnapshot(fixture);
      const response = await request(app).put("/api/investments/calendar").set("Cookie", fixture.home.cookie)
        .set("X-Capital-Subject", fixture.home.id).set("X-Capital-Household", fixture.homeHouseholdId)
        .send({ timeZone }).expect(400);
      expect(response.body).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR",
        fields: expect.arrayContaining([expect.objectContaining({ field: "timeZone" })]),
      } });
      expect(await confirmationSnapshot(fixture)).toEqual(before);
    },
  );

  it("records each dated actual fill separately with explicit fees and no plan or cash mutation", async () => {
    const { plan } = await createPendingOccurrence(app, fixture);
    await expectRecorded(plan.id, confirmationInput(fixture));
  });

  it("dates a newly opened holding from the earliest actual fill without reordering confirmation intent", async () => {
    const { plan } = await createPendingOccurrence(app, fixture);
    const original = confirmationInput(fixture);
    const input = { ...original, fills: [...original.fills].reverse() };
    const before = await confirmationSnapshot(fixture);
    expect(before.holdings).toEqual([]);
    const response = await confirm(plan.id, input).expect(200);
    const after = await confirmationSnapshot(fixture);
    const fills = response.body.data.occurrence.result.fills as Array<{
      fillIndex: number; purchaseId: string; executionDate: string;
    }>;
    expect(fills.map(fill => ({ index: fill.fillIndex, date: fill.executionDate }))).toEqual([
      { index: 0, date: fixture.today }, { index: 1, date: previousDate(fixture.today) },
    ]);
    expect(after.holdings).toHaveLength(1);
    expect(after.holdings[0]).toMatchObject({
      acquiredDate: previousDate(fixture.today), quantity: "3.50000000", costBasis: "9.67",
    });
    expect(after.purchases).toHaveLength(2);
    expect(after.lots).toHaveLength(2);
    expect(after.proofs).toHaveLength(2);
    for (const fill of fills) {
      expect(after.purchases.find(row => row.id === fill.purchaseId)).toMatchObject({ transactionDate: fill.executionDate });
      expect(after.lots.find(row => row.transactionId === fill.purchaseId)).toMatchObject({ acquiredDate: fill.executionDate });
    }
    expect(after.accounts).toEqual(before.accounts);
    expect(after.cash).toEqual(before.cash);
    const replay = await confirm(plan.id, input).expect(200);
    expect(replay.body).toEqual(response.body);
    expect(await confirmationSnapshot(fixture)).toEqual(after);
  });

  it("closes a final partial fill batch at its actual amount even when it differs from the plan", async () => {
    const { plan } = await createPendingOccurrence(app, fixture);
    const input = confirmationInput(fixture);
    input.outcome = "partially_filled";
    await expectRecorded(plan.id, input);
    await tick(app);
    expect((await confirmationSnapshot(fixture)).purchases).toHaveLength(2);
  });

  it("closes a final unfilled order with no fabricated purchase, lot, proof or holding", async () => {
    const { plan } = await createPendingOccurrence(app, fixture);
    const input = { ...confirmationInput(fixture), outcome: "unfilled" as const, fills: [] };
    const before = await confirmationSnapshot(fixture);
    const response = await confirm(plan.id, input).expect(200);
    expect(response.body.data.occurrence).toMatchObject({ state: "closed", occurrenceRevision: 1,
      result: { outcome: "unfilled", fills: [], totals: { grossAmount: "0.00", fees: "0.00", amount: "0.00" } } });
    const after = await confirmationSnapshot(fixture);
    for (const key of ["accounts", "holdings", "purchases", "lots", "proofs", "cash", "plans"] as const) {
      expect(after[key], key).toEqual(before[key]);
    }
    expect(after.confirmations).toHaveLength(1);
    expect(after.fills).toEqual([]);
    expect(after.audits.filter(row => row.entityType === "investment_sip_confirmation")).toHaveLength(1);
    expect(after.fences[0]).toMatchObject({ terminal: true });
    await confirm(plan.id, input).expect(200);
    await confirm(plan.id, { ...input, operationId: randomUUID() }).expect(409);
  });

  it("preserves two identical legitimate fills as two purchase IDs and two lots", async () => {
    const { plan } = await createPendingOccurrence(app, fixture);
    const input = confirmationInput(fixture);
    input.fills = [input.fills[0], { ...input.fills[0] }];
    const response = await confirm(plan.id, input).expect(200);
    const fills = response.body.data.occurrence.result.fills as Array<{ fillIndex: number; purchaseId: string }>;
    expect(fills.map(fill => fill.fillIndex)).toEqual([0, 1]);
    expect(new Set(fills.map(fill => fill.purchaseId)).size).toBe(2);
    expect(await purchaseRows(fixture)).toHaveLength(2);
    expect((await confirmationSnapshot(fixture)).lots).toHaveLength(2);
  });

  it.each(["owner", "admin", "member"] as const)("allows a current %s to confirm visible shared custody", async role => {
    const { plan } = await createPendingOccurrence(app, fixture);
    if (role === "owner") await transferOwnershipToPeer(app, fixture);
    else await setPeerRole(fixture, role);
    await expectRecorded(plan.id, confirmationInput(fixture), "peer");
  });

  it.each(["view_only", "professional"] as const)("keeps %s read permission separate from confirmation authority", async role => {
    const { plan } = await createPendingOccurrence(app, fixture);
    await setPeerRole(fixture, role);
    const before = await confirmationSnapshot(fixture);
    const listed = await signed("peer", "get", occurrencesPath(plan.id)).expect(200);
    expect(listed.body.data).toEqual([pending(plan.id, [])]);
    await confirm(plan.id, confirmationInput(fixture), "peer").expect(403);
    expect(await confirmationSnapshot(fixture)).toEqual(before);
  });

  it("hides a private occurrence from a same-household peer and foreign household", async () => {
    await makePrivate(fixture);
    const { plan } = await createPendingOccurrence(app, fixture);
    const input = confirmationInput(fixture);
    const before = await confirmationSnapshot(fixture);
    const absent = await confirm(randomUUID(), input, "peer").expect(404);
    const peer = await confirm(plan.id, input, "peer").expect(404);
    const foreign = await confirm(plan.id, input, "other").expect(404);
    const invisible = { success: false, error: { code: absent.body.error.code, message: absent.body.error.message } };
    expect(peer.body).toMatchObject(invisible);
    expect(foreign.body).toMatchObject(invisible);
    await signed("peer", "get", occurrencesPath(plan.id)).expect(404);
    expect(await confirmationSnapshot(fixture)).toEqual(before);
    const recorded = await confirm(plan.id, input).expect(200);
    const after = await confirmationSnapshot(fixture);
    expect(recorded.body.data.occurrence.result.fills).toHaveLength(2);
    for (const audit of after.audits.filter(row => row.entityType === "investment_transaction")) {
      expect(audit.userId).toBe(fixture.home.id);
      expect(audit.householdId).toBeNull();
    }
  });

  it("rechecks the real signed SID and current membership before accepting a pending occurrence", async () => {
    const { plan } = await createPendingOccurrence(app, fixture);
    const input = confirmationInput(fixture);
    await signed("peer", "post", "/api/auth/logout").expect(200);
    const before = await confirmationSnapshot(fixture);
    await confirm(plan.id, input, "peer").expect(401);
    expect(await confirmationSnapshot(fixture)).toEqual(before);
    await db.delete(householdMembers).where(eq(householdMembers.userId, fixture.home.id));
    const withdrawn = await confirmationSnapshot(fixture);
    const response = await confirm(plan.id, input);
    // The request still claims the withdrawn household, so the shared session-context
    // precondition refuses it before the router; nothing reaches the occurrence.
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("SESSION_CONTEXT_CHANGED");
    expect(await confirmationSnapshot(fixture)).toEqual(withdrawn);
  });

  it("returns the original immutable acknowledgment on a same-key retry", async () => {
    const { plan } = await createPendingOccurrence(app, fixture);
    const input = { ...confirmationInput(fixture), brokerReference: "Synthetic final statement α" };
    const first = await confirm(plan.id, input).expect(200);
    const after = await confirmationSnapshot(fixture);
    const replay = await confirm(plan.id, input).expect(200);
    expect(replay.body).toEqual(first.body);
    expect(await confirmationSnapshot(fixture)).toEqual(after);
    expect(JSON.stringify(first.body)).not.toContain(input.brokerReference);
    expect(after.confirmations[0].broker_reference).toBe(input.brokerReference);
  });

  it.each([
    "outcome", "fill order", "date", "quantity", "price", "fees", "reference", "reference omission", "revision",
  ])("conflicts on same-key changed %s without changing the original result", async change => {
    const { plan } = await createPendingOccurrence(app, fixture);
    const input = { ...confirmationInput(fixture), brokerReference: "Reference A" };
    const first = await confirm(plan.id, input).expect(200);
    const changed: ConfirmationInput = structuredClone(input);
    if (change === "outcome") changed.outcome = "partially_filled";
    if (change === "fill order") changed.fills.reverse();
    if (change === "date") changed.fills[0].executionDate = fixture.today;
    if (change === "quantity") changed.fills[0].quantity = "2.10000000";
    if (change === "price") changed.fills[0].price = "2.3451";
    if (change === "fees") changed.fills[0].fees = "0.12";
    if (change === "reference") changed.brokerReference = "Reference B";
    if (change === "reference omission") delete changed.brokerReference;
    if (change === "revision") changed.expectedRevision = 1;
    const before = await confirmationSnapshot(fixture);
    await confirm(plan.id, changed).expect(409);
    expect(await confirmationSnapshot(fixture)).toEqual(before);
    expect((await confirm(plan.id, input).expect(200)).body).toEqual(first.body);
  });

  it("compares optional references byte-exactly without hashing or normalizing their Unicode", async () => {
    const { plan } = await createPendingOccurrence(app, fixture);
    const input = { ...confirmationInput(fixture), brokerReference: " final e\u0301 " };
    await confirm(plan.id, input).expect(200);
    const stored = await confirmationSnapshot(fixture);
    expect(stored.confirmations[0].broker_reference).toBe(input.brokerReference);
    await confirm(plan.id, { ...input, brokerReference: " final é " }).expect(409);
    const withoutReference: Record<string, unknown> = { ...input, operationId: randomUUID() };
    delete withoutReference.brokerReference;
    // A new key cannot reopen the occurrence even if no reference was supplied.
    await confirm(plan.id, withoutReference).expect(409);
    expect(await confirmationSnapshot(fixture)).toEqual(stored);
  });

  it("serializes same-key overlap and rejects a new key after closure", async () => {
    const { plan } = await createPendingOccurrence(app, fixture);
    const input = confirmationInput(fixture);
    const repeated = await Promise.all([confirm(plan.id, input), confirm(plan.id, input)]);
    expect(repeated.map(response => response.status)).toEqual([200, 200]);
    expect(repeated[0].body).toEqual(repeated[1].body);
    const after = await confirmationSnapshot(fixture);
    expect(after.purchases).toHaveLength(2);
    expect(after.confirmations).toHaveLength(1);
    await confirm(plan.id, { ...input, operationId: randomUUID() }, "peer").expect(409);
    expect(await confirmationSnapshot(fixture)).toEqual(after);
  });

  it("serializes different actors and different keys racing to close one occurrence", async () => {
    const { plan } = await createPendingOccurrence(app, fixture);
    const outcomes = await Promise.all([
      confirm(plan.id, confirmationInput(fixture)),
      confirm(plan.id, confirmationInput(fixture), "peer"),
    ]);
    expect(outcomes.map(response => response.status).sort()).toEqual([200, 409]);
    const after = await confirmationSnapshot(fixture);
    expect(after.purchases).toHaveLength(2);
    expect(after.lots).toHaveLength(2);
    expect(after.proofs).toHaveLength(2);
    expect(after.confirmations).toHaveLength(1);
  });

  it("binds the same operation key to its original plan and scheduled-date path", async () => {
    const first = await createPendingOccurrence(app, fixture);
    const input = confirmationInput(fixture);
    await confirm(first.plan.id, input).expect(200);
    const second = await createPendingOccurrence(app, fixture);
    const before = await confirmationSnapshot(fixture);
    await confirm(second.plan.id, input).expect(409);
    expect(await confirmationSnapshot(fixture)).toEqual(before);
    expect((await signed("home", "get", occurrencesPath(second.plan.id)).expect(200)).body.data)
      .toEqual([pending(second.plan.id)]);
  });

  it("rolls back both fills, lots, proof, receipt and closure when the second mandatory financial audit fails", async () => {
    const { plan } = await createPendingOccurrence(app, fixture);
    const input = confirmationInput(fixture);
    const before = await confirmationSnapshot(fixture);
    const original = businessAuditService.logCreate.bind(businessAuditService);
    let count = 0;
    const fault = vi.spyOn(businessAuditService, "logCreate").mockImplementation(async entry => {
      if (entry.entityType === "investment_transaction" && ++count === 2) {
        throw new Error("Synthetic second-fill mandatory audit refusal");
      }
      return original(entry);
    });
    const failed = await confirm(plan.id, input);
    expect(failed.status).toBeGreaterThanOrEqual(400);
    expect(failed.status).toBeLessThan(600);
    expect(count).toBe(2);
    expect(await confirmationSnapshot(fixture)).toEqual(before);
    fault.mockRestore();
    await expectRecorded(plan.id, input);
  });

  it("keeps the original pending snapshot confirmable after deactivation and another actor's reconfirmation", async () => {
    const { plan, listed } = await createPendingOccurrence(app, fixture);
    await signed("home", "delete", `${plansPath}/${plan.id}`).expect(200);
    const snapshot = plannedSnapshot(fixture);
    await signed("peer", "post", `${plansPath}/${plan.id}/authorize`).send({
      operationId: randomUUID(), expectedRevision: plan.authorizationRevision,
      type: "sip", accountId: snapshot.accountId, securityId: snapshot.securityId,
      amount: snapshot.amount, currency: snapshot.currency, frequency: snapshot.authorizedFrequency,
      initialExecutionDate: snapshot.authorizedInitialDate,
    }).expect(200);
    expect((await signed("peer", "get", occurrencesPath(plan.id)).expect(200)).body.data).toEqual(listed.body.data);
    await expectRecorded(plan.id, confirmationInput(fixture), "peer");
    const [current] = await db.select().from(recurringInvestments).where(eq(recurringInvestments.id, plan.id));
    expect(current.isActive).toBe(false);
    expect(current.authorizationRevision).toBe(2);
  });

  it("retains actorless pending plan state after the original schedule author's actual erasure", async () => {
    const { plan, listed } = await createPendingOccurrence(app, fixture);
    await eraseAccount({ userId: fixture.home.id, householdId: fixture.homeHouseholdId, userEmail: fixture.home.email });
    const afterErase = await confirmationSnapshot(fixture);
    expect(afterErase.occurrences).toHaveLength(1);
    expect(afterErase.fences[0].terminal).toBe(false);
    expect((await signed("peer", "get", occurrencesPath(plan.id)).expect(200)).body.data).toEqual(listed.body.data);
    await expectRecorded(plan.id, confirmationInput(fixture), "peer");
  });

  it("purges a closed confirmer's operational reference and snapshot while retaining financial rows and only a terminal fence", async () => {
    const { plan } = await createPendingOccurrence(app, fixture);
    const input = { ...confirmationInput(fixture), brokerReference: "Erase this synthetic reference" };
    await confirm(plan.id, input).expect(200);
    const before = await confirmationSnapshot(fixture);
    await eraseAccount({ userId: fixture.home.id, householdId: fixture.homeHouseholdId, userEmail: fixture.home.email });
    const after = await confirmationSnapshot(fixture);
    for (const key of ["purchases", "lots", "proofs", "holdings", "cash"] as const) expect(after[key]).toEqual(before[key]);
    expect(after.occurrences).toEqual([]);
    expect(after.confirmations).toEqual([]);
    expect(after.fills).toEqual([]);
    expect(after.fences).toHaveLength(1);
    expect(Object.keys(after.fences[0]).sort()).toEqual(["plan_id", "original_due_date", "terminal"].sort());
    expect(after.fences[0].terminal).toBe(true);
    expect(after.audits.filter(row => row.entityType === "investment_transaction"))
      .toEqual(before.audits.filter(row => row.entityType === "investment_transaction"));
    expect(after.audits.filter(row => row.entityType === "investment_sip_confirmation")).toEqual([]);
    expect(JSON.stringify(after)).not.toContain(input.brokerReference);
    expect((await signed("peer", "get", occurrencesPath(plan.id)).expect(200)).body.data).toEqual([
      { planId: plan.id, scheduledDate: fixture.today, state: "closed", detailsAvailable: false },
    ]);
    const refused = await confirm(plan.id, { ...input, operationId: randomUUID() }, "peer").expect(409);
    expect(refused.body.error.code).toBe("OCCURRENCE_CLOSED_DETAILS_UNAVAILABLE");
    expect((await confirmationSnapshot(fixture)).purchases).toEqual(after.purchases);
  });

  it("rejects changed authoritative instrument denomination before any fill or closure", async () => {
    const { plan } = await createPendingOccurrence(app, fixture);
    await db.update(securities).set({ currency: "USD" }).where(eq(securities.id, fixture.referenceSecurityId));
    const before = await confirmationSnapshot(fixture);
    await confirm(plan.id, confirmationInput(fixture)).expect(409);
    expect(await confirmationSnapshot(fixture)).toEqual(before);
  });

  it.each(["terminal conflict", "revision conflict", "changed replay"] as const)(
    "rechecks original custody after waiting before revealing a %s", async conflict => {
    const { plan } = await createPendingOccurrence(app, fixture);
    const original = confirmationInput(fixture);
    if (conflict !== "revision conflict") await confirm(plan.id, original).expect(200);
    const command = conflict === "changed replay" ? structuredClone(original) : confirmationInput(fixture);
    if (conflict === "changed replay") command.fills[0].fees = "0.12";
    if (conflict === "revision conflict") command.expectedRevision = 1;
    const before = await confirmationSnapshot(fixture);
    const blocker = await pool.connect();
    let running: Promise<Awaited<ReturnType<typeof confirm>>> | undefined;
    try {
      await blocker.query("begin");
      const identity = await blocker.query<{ pid: number }>("select pg_backend_pid() as pid");
      await blocker.query("select id from accounts where id=$1 for update", [fixture.homeAccountId]);
      // Explicit synthetic source-state race, never a forged signer/grant.
      await blocker.query("update accounts set is_private=true,owner_user_id=$2 where id=$1",
        [fixture.homeAccountId, fixture.peer.id]);
      running = confirm(plan.id, command).then(response => response);
      await waitForConfirmationDatabaseBlock(identity.rows[0].pid);
      await blocker.query("commit");
      const response = await running;
      expect(response.status).toBe(404);
      const absent = await confirm(randomUUID(), confirmationInput(fixture)).expect(404);
      expect(response.body).toMatchObject({ success: false,
        error: { code: absent.body.error.code, message: absent.body.error.message } });
      const after = await confirmationSnapshot(fixture);
      for (const key of ["purchases", "lots", "proofs", "fences", "occurrences", "confirmations", "fills"] as const) {
        expect(after[key], key).toEqual(before[key]);
      }
    } finally {
      await blocker.query("rollback");
      blocker.release();
      if (running) await running;
    }
  });

  it.each(["role", "logout", "private custody"] as const)(
    "reauthorizes the original receipt before replay after %s withdrawal", async withdrawal => {
      const { plan } = await createPendingOccurrence(app, fixture);
      const input = confirmationInput(fixture);
      await confirm(plan.id, input).expect(200);
      if (withdrawal === "role") {
        await db.update(householdMembers).set({ role: "view_only" }).where(eq(householdMembers.userId, fixture.home.id));
      }
      if (withdrawal === "logout") await signed("home", "post", "/api/auth/logout").expect(200);
      if (withdrawal === "private custody") {
        await db.update(accounts).set({ isPrivate: true, ownerUserId: fixture.peer.id })
          .where(eq(accounts.id, fixture.homeAccountId));
      }
      const before = await confirmationSnapshot(fixture);
      const result = await confirm(plan.id, input);
      expect(result.status).toBe(withdrawal === "role" ? 403 : withdrawal === "logout" ? 401 : 404);
      expect(await confirmationSnapshot(fixture)).toEqual(before);
    },
  );

  it("accepts explicit zero fees and a positive sub-cent fill without inventing a nonzero settlement", async () => {
    const { plan } = await createPendingOccurrence(app, fixture);
    const input = confirmationInput(fixture);
    input.fills = [{ executionDate: fixture.today, quantity: "0.00000001", price: "0.0001", fees: "0.00" }];
    const result = await confirm(plan.id, input).expect(200);
    expect(result.body.data.occurrence.result).toMatchObject({
      fills: [{ fillIndex: 0, quantity: "0.00000001", price: "0.0001", fees: "0.00", amount: "0.00" }],
      totals: { grossAmount: "0.00", fees: "0.00", amount: "0.00" },
    });
    const after = await confirmationSnapshot(fixture);
    expect(after.purchases).toHaveLength(1);
    expect(after.purchases[0]).toMatchObject({ quantity: "0.00000001", amount: "0.00", fees: "0.00", fxRate: null, amountZmw: null });
    expect(after.lots[0]).toMatchObject({ quantity: "0.00000001", costBasis: "0.00" });
    expect(after.proofs[0]).toMatchObject({ authorization_contract_version: 2 });
  });

  it("keeps valid native remaining basis through actual fills, an ordinary signed FIFO sale and another confirmation", async () => {
    const first = await createPendingOccurrence(app, fixture);
    await confirm(first.plan.id, confirmationInput(fixture)).expect(200);
    const purchases = await purchaseRows(fixture);
    await signed("home", "post", "/api/investments/transactions").send({
      accountId: fixture.homeAccountId, holdingId: purchases[0].holdingId,
      securityId: fixture.referenceSecurityId, type: "sell", quantity: "1.00000000",
      price: "3.0000", fees: "0.00", amount: "3.00", currency: "ZMW", transactionDate: fixture.today,
    }).expect(201);
    const second = await createPendingOccurrence(app, fixture);
    const before = await confirmationSnapshot(fixture);
    expect(before.holdings[0]).toMatchObject({ quantity: "2.50000000", costBasis: "7.27" });
    await confirm(second.plan.id, confirmationInput(fixture)).expect(200);
    const after = await confirmationSnapshot(fixture);
    expect(after.holdings[0]).toMatchObject({ quantity: "6.00000000", costBasis: "16.94" });
    expect(after.lots).toHaveLength(4);
    expect(after.proofs).toHaveLength(4);
    expect(after.disposals).toEqual(before.disposals);
    expect(after.accounts).toEqual(before.accounts);
    expect(after.cash).toEqual(before.cash);
  });

  it.each([null, "2020-01-01"])("preserves old acquisition date %j and unknown basis while adding only actual new fill lots", async acquiredDate => {
    await db.insert(holdings).values({ householdId: fixture.homeHouseholdId, accountId: fixture.homeAccountId,
      securityId: fixture.referenceSecurityId, quantity: "1.00000000", costBasis: null,
      costBasisZmw: null, acquisitionFxRate: null, acquiredDate });
    const { plan } = await createPendingOccurrence(app, fixture);
    await confirm(plan.id, confirmationInput(fixture)).expect(200);
    const after = await confirmationSnapshot(fixture);
    expect(after.holdings).toHaveLength(1);
    expect(after.holdings[0]).toMatchObject({ quantity: "4.50000000", costBasis: null, costBasisZmw: null, acquiredDate });
    expect(after.purchases).toHaveLength(2);
    expect(after.lots).toHaveLength(2);
    expect(after.lots.map(row => row.quantity)).toEqual(expect.arrayContaining(["2.00000000", "1.50000000"]));
    expect(after.proofs).toHaveLength(2);
    expect(after.cash).toEqual([]);
  });

  it("rejects a future actual fill against the selected household calendar without retaining a receipt", async () => {
    const { plan } = await createPendingOccurrence(app, fixture);
    const future = await pool.query<{ value: string }>(
      "select ((clock_timestamp() at time zone 'Africa/Lusaka')::date + 2)::text as value",
    );
    const input = confirmationInput(fixture);
    input.fills[0].executionDate = future.rows[0].value;
    const before = await confirmationSnapshot(fixture);
    const response = await confirm(plan.id, input).expect(400);
    expect(response.body).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR",
      fields: expect.arrayContaining([expect.objectContaining({ field: "fills.0.executionDate" })]),
    } });
    expect(await confirmationSnapshot(fixture)).toEqual(before);
  });

  it("refuses an earlier actual fill that would invalidate an already recorded FIFO sale", async () => {
    const first = await createPendingOccurrence(app, fixture);
    await confirm(first.plan.id, confirmationInput(fixture)).expect(200);
    const purchases = await purchaseRows(fixture);
    await signed("home", "post", "/api/investments/transactions").send({
      accountId: fixture.homeAccountId, holdingId: purchases[0].holdingId,
      securityId: fixture.referenceSecurityId, type: "sell", quantity: "1.00000000",
      price: "3.0000", fees: "0.00", amount: "3.00", currency: "ZMW", transactionDate: fixture.today,
    }).expect(201);
    const second = await createPendingOccurrence(app, fixture);
    const input = confirmationInput(fixture);
    input.fills = [{ ...input.fills[0], executionDate: previousDate(previousDate(fixture.today)) }];
    const before = await confirmationSnapshot(fixture);
    expect(before.disposals).toHaveLength(1);
    await confirm(second.plan.id, input).expect(409);
    expect(await confirmationSnapshot(fixture)).toEqual(before);
  });

  it("accepts 200 supplied Unicode code points without treating surrogate pairs as two characters", async () => {
    const { plan } = await createPendingOccurrence(app, fixture);
    const input = { ...confirmationInput(fixture), brokerReference: "😀".repeat(200) };
    await confirm(plan.id, input).expect(200);
    expect((await confirmationSnapshot(fixture)).confirmations[0].broker_reference).toBe(input.brokerReference);
  });

  it.each([
    { name: "false final statement", patch: { finalStatement: false } },
    { name: "missing final statement", patch: { finalStatement: undefined } },
    { name: "invalid operation UUID", patch: { operationId: "invalid" } },
    { name: "negative revision", patch: { expectedRevision: -1 } },
    { name: "unfilled with fills", patch: { outcome: "unfilled" } },
    { name: "filled without fills", patch: { fills: [] } },
    { name: "partially filled without fills", patch: { outcome: "partially_filled", fills: [] } },
    { name: "null reference", patch: { brokerReference: null } },
    { name: "blank reference", patch: { brokerReference: " \t " } },
    { name: "oversized reference", patch: { brokerReference: "x".repeat(201) } },
    { name: "malformed Unicode reference", patch: { brokerReference: "\ud800" } },
    { name: "NUL reference", patch: { brokerReference: "a\u0000b" } },
  ])("rejects $name without any financial or operational mutation", async invalid => {
    const { plan } = await createPendingOccurrence(app, fixture);
    const before = await confirmationSnapshot(fixture);
    await confirm(plan.id, { ...confirmationInput(fixture), ...invalid.patch }).expect(400);
    expect(await confirmationSnapshot(fixture)).toEqual(before);
  });

  it.each([
    { name: "impossible date", patch: { executionDate: "2026-02-30" } },
    { name: "quantity precision", patch: { quantity: "1.000000001" } },
    { name: "nonpositive quantity", patch: { quantity: "0" } },
    { name: "price precision", patch: { price: "2.00001" } },
    { name: "nonpositive price", patch: { price: "-2" } },
    { name: "fee precision", patch: { fees: "0.001" } },
    { name: "missing fee", patch: { fees: undefined } },
    { name: "blank fee", patch: { fees: "" } },
    { name: "negative fee", patch: { fees: "-0.01" } },
    { name: "nonfinite quantity", patch: { quantity: "NaN" } },
  ])("rejects per-fill $name before any batch is recorded", async invalid => {
    const { plan } = await createPendingOccurrence(app, fixture);
    const input = confirmationInput(fixture);
    const before = await confirmationSnapshot(fixture);
    await confirm(plan.id, { ...input, fills: [{ ...input.fills[0], ...invalid.patch }] }).expect(400);
    expect(await confirmationSnapshot(fixture)).toEqual(before);
  });

  it("rejects 101 fills as one unchanged request rather than truncating, splitting or averaging", async () => {
    const { plan } = await createPendingOccurrence(app, fixture);
    const input = confirmationInput(fixture);
    const before = await confirmationSnapshot(fixture);
    await confirm(plan.id, { ...input, fills: Array.from({ length: 101 }, () => ({ ...input.fills[0] })) }).expect(400);
    expect(await confirmationSnapshot(fixture)).toEqual(before);
  });

  it("validates natural path dates and list filters without accepting an occurrence UUID or impossible date", async () => {
    const { plan } = await createPendingOccurrence(app, fixture);
    const before = await confirmationSnapshot(fixture);
    await confirm(plan.id, confirmationInput(fixture), "home", "2026-02-30").expect(400);
    await confirm(plan.id, confirmationInput(fixture), "home", randomUUID()).expect(400);
    for (const query of ["state=unknown", "limit=101", "before=2026-02-30"]) {
      await signed("home", "get", `${occurrencesPath(plan.id)}?${query}`).expect(400);
    }
    expect((await signed("home", "get", `${occurrencesPath(plan.id)}?state=pending&limit=1`).expect(200)).body.data)
      .toEqual([pending(plan.id)]);
    expect((await signed("home", "get", `${occurrencesPath(plan.id)}?before=${fixture.today}`).expect(200)).body.data)
      .toEqual([]);
    expect(await confirmationSnapshot(fixture)).toEqual(before);
  });
});
