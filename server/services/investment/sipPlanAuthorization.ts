import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { accounts, auditLogs, investmentPlanAuthorizations, investmentPlanOperations, recurringFrequencyEnum,
  recurringInvestments, securities, users } from "@shared/schema";
import { isCanonicalImportDate } from "@shared/import-date";
import { db } from "../../db";
import { ConflictError, NotFoundError, ValidationError } from "../../core/errors";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { lockInvestmentWriterIdentity, type InvestmentSourceSession } from "../../modules/investments/investmentTransactionAccess";
import type { TransactionType } from "../../utils/withTransaction";
import { digestSipAuthorizationTerms, SIP_AUTHORIZATION_CONTRACT_TYPE, SIP_AUTHORIZATION_CONTRACT_VERSION } from "./sipAuthorizationContract";
import { lockSipPlanAccount, lockSipPlanReader, lockSipPlanRow, lockSipPlanSecurity, lockVisibleSipPlan,
  requireSignedSipSession, sipPlanResponse, sipPlanTerms, type SipPlan } from "./sipPlanAccess";

const Exact = Decimal.clone({ precision: 48 });
const uuid = z.string().length(36).uuid().transform(value => value.toLowerCase());
const amount = z.string().regex(/^[0-9]+(?:\.[0-9]{1,2})?$/).refine(value => !/\s/.test(value))
  .refine(value => { try { const number = new Exact(value); return number.isFinite() && number.gt(0) && number.lte("9999999999999.99"); } catch { return false; } })
  .transform(value => new Exact(value).toFixed(2));
const currency = z.string().length(3).regex(/^[A-Za-z]{3}$/).transform(value => value.toUpperCase());
const date = z.string().refine(value => !value.startsWith("0000-") && isCanonicalImportDate(value));
const createSchema = z.object({
  operationId: uuid.optional(), accountId: uuid, securityId: uuid.nullable().optional(),
  type: z.enum(["sip", "rollover"]), frequency: z.enum(recurringFrequencyEnum.enumValues), amount,
  currency, nextExecutionDate: date,
}).strict().superRefine((value, context) => {
  if (value.type === "sip" && !value.operationId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["operationId"], message: "Client operation UUID is required" });
  if (value.type === "sip" && !value.securityId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["securityId"], message: "Investment instrument is required for a new SIP" });
});
type CreatePlan = z.infer<typeof createSchema>;
const reconfirmSchema = z.object({
  operationId: uuid, expectedRevision: z.number().int().nonnegative().safe(), type: z.literal("sip"),
  accountId: uuid, securityId: uuid, amount, currency, frequency: z.enum(recurringFrequencyEnum.enumValues),
  initialExecutionDate: date,
}).strict();
type ReconfirmPlan = z.infer<typeof reconfirmSchema>;

function parseCreate(input: unknown): CreatePlan {
  let candidate = input;
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    const fields = input as Record<string, unknown>;
    // Preserve the original keyless-rollover caller's omitted-currency ZMW
    // declaration only. SIP, explicit nulls and source conflicts still fail.
    if (fields.type === "rollover" && !Object.hasOwn(fields, "currency")) candidate = { ...fields, currency: "ZMW" };
  }
  const parsed = createSchema.safeParse(candidate);
  if (!parsed.success) throw new ValidationError("Invalid recurring investment declaration", parsed.error.errors);
  return parsed.data;
}

/** Operational intent is deliberately distinct from the retained terms digest. */
export function sipCreateRequestDigest(input: CreatePlan): string {
  return createHash("sha256").update(JSON.stringify([1, "create", input.type, input.accountId,
    input.securityId ?? null, input.amount, input.currency, input.frequency, input.nextExecutionDate]), "utf8").digest("hex");
}

/** Request v1 binds path and compare-and-set revision; never retained as proof. */
export function sipReconfirmRequestDigest(planId: string, input: ReconfirmPlan): string {
  return createHash("sha256").update(JSON.stringify([1, "reconfirm", planId, input.expectedRevision, "sip",
    input.accountId, input.securityId, input.amount, input.currency, input.frequency, input.initialExecutionDate]), "utf8").digest("hex");
}

async function readCurrentAuthorization(tx: TransactionType, plan: SipPlan) {
  if (!plan.currentAuthorizationId) return null;
  const [grant] = await tx.select().from(investmentPlanAuthorizations)
    .where(eq(investmentPlanAuthorizations.id, plan.currentAuthorizationId)).for("share");
  if (!grant || grant.planId !== plan.id || grant.householdId !== plan.householdId || grant.revision !== plan.authorizationRevision) {
    throw new NotFoundError("Recurring plan");
  }
  return grant;
}

async function replayOperation(tx: TransactionType, actor: HouseholdContext, operationId: string | undefined,
  action: "create" | "reconfirm", requestDigest: string) {
  if (!operationId) return null;
  const [operation] = await tx.select().from(investmentPlanOperations).where(and(
    eq(investmentPlanOperations.householdId, actor.householdId), eq(investmentPlanOperations.actorUserId, actor.userId),
    eq(investmentPlanOperations.operationId, operationId),
  ));
  if (!operation) return null;
  // Reauthorize the ORIGINAL recorded outcome before comparing changed intent.
  const resource = action === "create" ? "Account" : "Recurring plan";
  const plan = await lockSipPlanRow(tx, actor, operation.planId, resource);
  const [grant] = operation.authorizationId ? await tx.select().from(investmentPlanAuthorizations)
    .where(eq(investmentPlanAuthorizations.id, operation.authorizationId)).for("share") : [];
  if (operation.authorizationId && (!grant || grant.planId !== operation.planId ||
      grant.householdId !== actor.householdId || grant.authorUserId !== actor.userId)) throw new NotFoundError(resource);
  if (grant) await lockSipPlanAccount(tx, actor, grant.accountId, resource);
  await lockSipPlanAccount(tx, actor, plan.accountId, resource);
  const originalSecurityId = grant?.securityId ?? plan.securityId;
  const originalSecurity = await lockSipPlanSecurity(tx, actor, originalSecurityId);
  const security = originalSecurityId === plan.securityId ? originalSecurity : await lockSipPlanSecurity(tx, actor, plan.securityId);
  if (operation.action !== action || operation.requestVersion !== 1 || operation.requestDigest !== requestDigest) {
    throw new ConflictError("Operation does not match its original recurring investment declaration");
  }
  const current = await readCurrentAuthorization(tx, plan);
  // A receipt acknowledges the original operation only. Return today's plan
  // without restoring its former grant, activation state or execution date.
  return sipPlanResponse(plan, security, actor, current?.initialExecutionDate ?? null);
}

export async function createAuthorizedSipPlan(input: unknown, caller: HouseholdContext, session: InvestmentSourceSession) {
  requireSignedSipSession(caller, session);
  const data = parseCreate(input);
  return db.transaction(async tx => {
    // The existing current-user credential lock serializes this actor's keys.
    // Never replace the captured SID/generation with a newer credential.
    const actor = await lockInvestmentWriterIdentity(tx, caller, session);
    const replay = await replayOperation(tx, actor, data.operationId, "create", sipCreateRequestDigest(data));
    if (replay) return replay;
    await lockSipPlanAccount(tx, actor, data.accountId);
    const security = await lockSipPlanSecurity(tx, actor, data.securityId);
    if (security && security.currency !== data.currency) throw new ConflictError("Investment source denomination changed");
    let [plan] = await tx.insert(recurringInvestments).values({ householdId: actor.householdId, accountId: data.accountId,
      securityId: data.securityId ?? null, type: data.type, frequency: data.frequency, amount: data.amount,
      currency: data.currency, nextExecutionDate: data.nextExecutionDate, isActive: true }).returning();
    let authorizationId: string | null = null;
    if (data.type === "sip" && security && security.type !== "tbill") {
      // This transaction exclusively owns its new NULL/0 plan row. Never
      // allocate from surviving grants: the plan counter survives their purge.
      if (plan.authorizationRevision >= 2147483647) throw new ConflictError("Investment plan authorization revision is exhausted");
      const revision = plan.authorizationRevision + 1;
      const [current] = await tx.select({ generation: users.securityGeneration }).from(users).where(eq(users.id, actor.userId));
      if (!current) throw new NotFoundError("Account");
      const terms = { contractVersion: SIP_AUTHORIZATION_CONTRACT_VERSION, contractType: SIP_AUTHORIZATION_CONTRACT_TYPE,
        accountId: data.accountId, securityId: security.id, amount: data.amount, currency: data.currency,
        frequency: data.frequency, initialDate: data.nextExecutionDate };
      const [grant] = await tx.insert(investmentPlanAuthorizations).values({ planId: plan.id, householdId: actor.householdId,
        authorUserId: actor.userId, revision, authorizationContractVersion: 1, authorizationKind: "record_only_sip",
        securityGeneration: current.generation, accountId: data.accountId, securityId: security.id, amount: data.amount,
        currency: data.currency, frequency: data.frequency, initialExecutionDate: data.nextExecutionDate,
        authorizedTermsDigest: digestSipAuthorizationTerms(terms) }).returning();
      authorizationId = grant.id;
      [plan] = await tx.update(recurringInvestments).set({ currentAuthorizationId: grant.id, authorizationRevision: revision })
        .where(eq(recurringInvestments.id, plan.id)).returning();
      // Actor-only operational event. Later erasure targets this family; it
      // contains no copied terms, retry identifiers or credential material.
      await tx.insert(auditLogs).values({ userId: actor.userId, householdId: null, action: "CREATE",
        entityType: "investment_plan_authorization", entityId: grant.id,
        details: { authorizationEvent: "sip_grant_v1", contractVersion: 1 } });
    } else {
      await tx.insert(auditLogs).values({ userId: actor.userId, householdId: null, action: "CREATE",
        entityType: "recurring_investment", entityId: plan.id, details: { authorizationEvent: "pending_plan_v1" } });
    }
    if (data.operationId) await tx.insert(investmentPlanOperations).values({ householdId: actor.householdId,
      actorUserId: actor.userId, operationId: data.operationId, action: "create", requestVersion: 1,
      requestDigest: sipCreateRequestDigest(data), expectedRevision: 0, planId: plan.id, authorizationId });
    return sipPlanResponse(plan, security, actor, authorizationId ? data.nextExecutionDate : null);
  }, { isolationLevel: "read committed" });
}

export async function reconfirmAuthorizedSipPlan(id: string, input: unknown, caller: HouseholdContext, session: InvestmentSourceSession) {
  requireSignedSipSession(caller, session);
  const identity = uuid.safeParse(id), parsed = reconfirmSchema.safeParse(input);
  if (!identity.success) throw new ValidationError("Invalid recurring investment identity", identity.error.errors);
  if (!parsed.success) throw new ValidationError("Invalid recurring investment confirmation", parsed.error.errors);
  const planId = identity.data, data = parsed.data, requestDigest = sipReconfirmRequestDigest(planId, data);
  return db.transaction(async tx => {
    const actor = await lockInvestmentWriterIdentity(tx, caller, session);
    const replay = await replayOperation(tx, actor, data.operationId, "reconfirm", requestDigest);
    if (replay) return replay;
    const plan = await lockVisibleSipPlan(tx, actor, planId);
    const current = await readCurrentAuthorization(tx, plan);
    const security = await lockSipPlanSecurity(tx, actor, plan.securityId);
    if (plan.type !== "sip" || !security || security.type === "tbill") {
      throw new ConflictError("Recurring investment requires reconciliation");
    }
    if (data.expectedRevision !== plan.authorizationRevision) throw new ConflictError("Recurring investment revision changed");
    // A surviving CURRENT grant preserves its declared start. A NULL pointer,
    // even after purge, requires a new explicit declaration of displayed next date.
    let terms: ReturnType<typeof sipPlanTerms>;
    try { terms = sipPlanTerms(plan, current?.initialExecutionDate ?? plan.nextExecutionDate); }
    catch { throw new ConflictError("Recurring investment terms require reconciliation"); }
    if (security.currency !== terms.currency) throw new ConflictError("Investment source denomination changed");
    if (data.accountId !== terms.accountId || data.securityId !== terms.securityId || data.amount !== terms.amount ||
        data.currency !== terms.currency || data.frequency !== terms.frequency || data.initialExecutionDate !== terms.initialDate) {
      throw new ConflictError("Recurring investment terms changed");
    }
    if (plan.authorizationRevision >= 2147483647) throw new ConflictError("Investment plan authorization revision is exhausted");
    const revision = plan.authorizationRevision + 1;
    const [identity] = await tx.select({ generation: users.securityGeneration }).from(users).where(eq(users.id, actor.userId));
    if (!identity) throw new NotFoundError("Recurring plan");
    const [grant] = await tx.insert(investmentPlanAuthorizations).values({ planId: plan.id, householdId: actor.householdId,
      authorUserId: actor.userId, revision, authorizationContractVersion: 1, authorizationKind: "record_only_sip",
      securityGeneration: identity.generation, accountId: terms.accountId, securityId: terms.securityId,
      amount: terms.amount, currency: terms.currency, frequency: terms.frequency,
      initialExecutionDate: terms.initialDate, authorizedTermsDigest: digestSipAuthorizationTerms(terms) }).returning();
    // Reconfirmation records this signer. It neither activates the instruction
    // nor advances/restarts its financial schedule.
    const [confirmed] = await tx.update(recurringInvestments)
      .set({ currentAuthorizationId: grant.id, authorizationRevision: revision })
      .where(eq(recurringInvestments.id, plan.id)).returning();
    await tx.insert(investmentPlanOperations).values({ householdId: actor.householdId, actorUserId: actor.userId,
      operationId: data.operationId, action: "reconfirm", requestVersion: 1, requestDigest,
      expectedRevision: data.expectedRevision, planId: plan.id, authorizationId: grant.id });
    await tx.insert(auditLogs).values({ userId: actor.userId, householdId: null, action: "CREATE",
      entityType: "investment_plan_authorization", entityId: grant.id,
      details: { authorizationEvent: "sip_grant_v1", contractVersion: 1 } });
    return sipPlanResponse(confirmed, security, actor, grant.initialExecutionDate);
  }, { isolationLevel: "read committed" });
}

export async function getVisibleSipPlans(caller: HouseholdContext, session: InvestmentSourceSession) {
  return db.transaction(async tx => {
    const actor = await lockSipPlanReader(tx, caller, session);
    const rows = await tx.select({ plan: recurringInvestments, security: { type: securities.type, currency: securities.currency },
      initialDate: investmentPlanAuthorizations.initialExecutionDate })
      .from(recurringInvestments).innerJoin(accounts, eq(accounts.id, recurringInvestments.accountId))
      .leftJoin(securities, eq(securities.id, recurringInvestments.securityId))
      .leftJoin(investmentPlanAuthorizations, eq(investmentPlanAuthorizations.id, recurringInvestments.currentAuthorizationId))
      .where(and(eq(recurringInvestments.householdId, actor.householdId), visibleAccountPredicate(actor))).orderBy(recurringInvestments.id);
    return rows.map(row => sipPlanResponse(row.plan, row.security, actor, row.initialDate));
  }, { isolationLevel: "read committed" });
}

export async function deactivateVisibleSipPlan(id: string, caller: HouseholdContext, session: InvestmentSourceSession) {
  requireSignedSipSession(caller, session);
  const parsed = uuid.safeParse(id);
  if (!parsed.success) throw new ValidationError("Invalid recurring investment identity", parsed.error.errors);
  return db.transaction(async tx => {
    const actor = await lockInvestmentWriterIdentity(tx, caller, session);
    const plan = await lockVisibleSipPlan(tx, actor, parsed.data);
    if (!plan.isActive) return;
    await tx.update(recurringInvestments).set({ isActive: false, updatedAt: new Date() }).where(eq(recurringInvestments.id, plan.id));
    await tx.insert(auditLogs).values({ userId: actor.userId, householdId: null, action: "UPDATE", entityType: "recurring_investment",
      entityId: plan.id, details: { authorizationEvent: "plan_deactivated_v1" } });
  }, { isolationLevel: "read committed" });
}
