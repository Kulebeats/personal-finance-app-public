import { and, eq, sql } from "drizzle-orm";
import { accounts, householdMembers, households, recurringInvestments, securities } from "@shared/schema";
import { can } from "../../core/authz/capabilities";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "../../core/errors";
import type { HouseholdContext } from "../../middleware/householdGuard";
import type { InvestmentSourceSession } from "../../modules/investments/investmentTransactionAccess";
import { lockCurrentSessionCredential } from "../session-identity";
import { securityVisibleTo } from "./securityCatalogueScope";
import type { TransactionType } from "../../utils/withTransaction";
import { normalizeSipAuthorizationTerms, SIP_AUTHORIZATION_CONTRACT_TYPE, SIP_AUTHORIZATION_CONTRACT_VERSION } from "./sipAuthorizationContract";

export type SipPlan = typeof recurringInvestments.$inferSelect;
export type SipPlanSecurity = Pick<typeof securities.$inferSelect, "type" | "currency">;
export type SipPlanResponse = Omit<SipPlan, "currentAuthorizationId"> & {
  authorizationStatus: "authorization_recorded" | "authorization_required" | "inactive" | "pending_reconciliation";
  authorizationRevision: number;
  authorizationInitialExecutionDate: string | null;
  permittedActions: Array<"authorize" | "deactivate">;
};

export function requireSignedSipSession(caller: HouseholdContext, session: InvestmentSourceSession): void {
  if (!caller?.householdId || !caller.userId || session?.snapshot?.id !== caller.userId || !session.sessionId) {
    throw new UnauthorizedError("Authentication changed; sign in again");
  }
}
/** Interactive read only. Background execution must validate its durable grant
 * independently; this helper always requires the original real signed session. */
export async function lockSipPlanReader(tx: TransactionType, caller: HouseholdContext, session: InvestmentSourceSession) {
  if (!caller?.householdId || !caller.userId) throw new ForbiddenError("Financial read access required");
  requireSignedSipSession(caller, session);
  const [household] = await tx.select({ id: households.id }).from(households)
    .where(eq(households.id, caller.householdId)).for("share");
  if (!household) throw new NotFoundError("Household");
  const [membership] = await tx.select({ role: householdMembers.role }).from(householdMembers).where(and(
    eq(householdMembers.householdId, caller.householdId), eq(householdMembers.userId, caller.userId),
  )).for("share");
  if (!membership || !can(membership.role, "financial.read")) throw new ForbiddenError("Financial read access required");
  const current = await lockCurrentSessionCredential(tx, session.snapshot, session.sessionId, session.generation);
  if (!current.emailVerified) throw new ForbiddenError("Financial read access required");
  const live = await tx.execute(sql`select sid from "session" where sid=${session.sessionId} and expire>=now()
    and sess->>'userId'=${current.id} and coalesce(sess->>'securityGeneration','0')=${String(current.securityGeneration)} for share`);
  if (live.rows.length !== 1) throw new UnauthorizedError("Authentication changed; sign in again");
  return { ...caller, role: membership.role };
}

export async function lockSipPlanAccount(tx: TransactionType, actor: HouseholdContext, accountId: string, resource = "Account") {
  const [account] = await tx.select().from(accounts).where(and(eq(accounts.id, accountId), visibleAccountPredicate(actor))).for("share");
  if (!account) throw new NotFoundError(resource);
  return account;
}

export async function lockSipPlanRow(tx: TransactionType, actor: HouseholdContext, id: string, resource = "Recurring plan") {
  const [plan] = await tx.select().from(recurringInvestments).where(and(
    eq(recurringInvestments.id, id), eq(recurringInvestments.householdId, actor.householdId),
  )).for("update");
  if (!plan) throw new NotFoundError(resource);
  return plan;
}

export async function lockVisibleSipPlan(tx: TransactionType, actor: HouseholdContext, id: string, resource = "Recurring plan") {
  const plan = await lockSipPlanRow(tx, actor, id, resource);
  await lockSipPlanAccount(tx, actor, plan.accountId, resource);
  return plan;
}

export async function lockSipPlanSecurity(tx: TransactionType, actor: HouseholdContext, id: string | null | undefined) {
  if (!id) return null;
  const [security] = await tx.select().from(securities)
    .where(and(eq(securities.id, id), securityVisibleTo(actor.householdId))).for("share");
  if (!security) throw new NotFoundError("Security");
  return security;
}

export function sipPlanTerms(plan: SipPlan, initialDate: string) {
  return normalizeSipAuthorizationTerms({ contractVersion: SIP_AUTHORIZATION_CONTRACT_VERSION,
    contractType: SIP_AUTHORIZATION_CONTRACT_TYPE, accountId: plan.accountId, securityId: plan.securityId,
    amount: plan.amount, currency: plan.currency, frequency: plan.frequency, initialDate });
}

/** Recorded grant and interactive actions are storage/disclosure facts. Neither
 * establishes the grant author's current eligibility or execution readiness. */
export function sipPlanResponse(plan: SipPlan, security: SipPlanSecurity | null | undefined,
  actor: HouseholdContext, currentInitialDate: string | null): SipPlanResponse {
  const { currentAuthorizationId, ...fields } = plan;
  const supported = plan.type === "sip" && !!plan.securityId && !!security && security.type !== "tbill";
  const pending = !supported || plan.frequency === "custom";
  const permittedActions: SipPlanResponse["permittedActions"] = [];
  if (can(actor.role, "financial.write")) {
    if (supported && plan.authorizationRevision < 2147483647) {
      try {
        const terms = sipPlanTerms(plan, currentInitialDate ?? plan.nextExecutionDate);
        if (security?.currency === terms.currency) permittedActions.push("authorize");
      } catch { /* Invalid legacy declarations require reconciliation. */ }
    }
    if (plan.isActive) permittedActions.push("deactivate");
  }
  return { ...fields, authorizationStatus: pending ? "pending_reconciliation" : !plan.isActive ? "inactive" :
    currentAuthorizationId && plan.authorizationRevision ? "authorization_recorded" : "authorization_required",
    authorizationRevision: plan.authorizationRevision, authorizationInitialExecutionDate: currentInitialDate, permittedActions };
}
