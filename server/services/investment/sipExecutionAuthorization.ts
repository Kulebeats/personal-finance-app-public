import { and, eq, sql } from "drizzle-orm";
import { householdCalendarDate, LEGACY_HOUSEHOLD_CALENDAR_ZONE } from "@shared/household-calendar";
import { householdMembers, households, investmentPlanAuthorizations, recurringInvestments, users,
  type InvestmentTransaction } from "@shared/schema";
import { can } from "../../core/authz/capabilities";
import type { TransactionType } from "../../utils/withTransaction";
import { HouseholdCalendarUnavailable, storedHouseholdCalendarZone } from "../householdCalendarToday";
import { digestSipAuthorizationTerms, normalizeSipAuthorizationTerms, type SipAuthorizationTerms } from "./sipAuthorizationContract";

type Plan = typeof recurringInvestments.$inferSelect;
type Grant = typeof investmentPlanAuthorizations.$inferSelect;
const authorityTransaction = Symbol("sipExecutionTransaction");
export const SIP_EXECUTION_REFUSAL = "Recurring investment execution is unavailable";
const unavailable = () => new Error(SIP_EXECUTION_REFUSAL);

/** Internal authority is valid only while its original transaction holds the
 * author/member/plan/grant locks. A retained completed proof supplies no grant. */
export type SipExecutionAuthority = Readonly<{
  [authorityTransaction]: TransactionType;
  plan: Readonly<Plan>;
  grant: Readonly<Grant>;
  terms: SipAuthorizationTerms;
}>;

export function sipExecutionPlan(tx: TransactionType, authority: SipExecutionAuthority): Readonly<Plan> {
  if (authority[authorityTransaction] !== tx) throw unavailable();
  return authority.plan;
}

/** Keep pending occurrences available on the legacy UTC calendar when an owner
 * must repair an unsupported stored zone. Fill confirmation still requires a
 * valid owner-chosen zone and performs its own cutoff check. */
export function sipPendingCalendarDate(instant: Date, storedZone: string | null): string {
  let zone = LEGACY_HOUSEHOLD_CALENDAR_ZONE;
  try {
    zone = storedHouseholdCalendarZone(storedZone);
  } catch (error) {
    if (!(error instanceof HouseholdCalendarUnavailable)) throw error;
  }
  return householdCalendarDate(instant, zone);
}

/** Household -> actual author membership -> user -> plan/grant. No original
 * SID is needed: ordinary session endings do not cancel a durable mandate. */
export async function lockSipExecutionAuthorization(tx: TransactionType,
  candidate: Pick<Plan, "id" | "householdId">, cutoff: string | Date): Promise<SipExecutionAuthority | null> {
  const [household] = await tx.select({ id: households.id, timeZone: households.timeZone }).from(households)
    .where(eq(households.id, candidate.householdId)).for("share");
  if (!household) return null;
  const today = typeof cutoff === "string" ? cutoff : sipPendingCalendarDate(cutoff, household.timeZone);
  // Discovery conveys no authority. Re-read the plan after locking this author;
  // a replacement pointer requires rediscovery in a new transaction.
  const [hint] = await tx.select({ authorizationId: recurringInvestments.currentAuthorizationId,
    revision: recurringInvestments.authorizationRevision, authorUserId: investmentPlanAuthorizations.authorUserId,
    nextExecutionDate: recurringInvestments.nextExecutionDate })
    .from(recurringInvestments).leftJoin(investmentPlanAuthorizations,
      eq(investmentPlanAuthorizations.id, recurringInvestments.currentAuthorizationId))
    .where(and(eq(recurringInvestments.id, candidate.id), eq(recurringInvestments.householdId, household.id)));
  if (!hint || hint.nextExecutionDate > today) return null;
  let identity: { erasedAt: Date | null; emailVerified: boolean | null; generation: number } | undefined;
  if (hint.authorUserId) {
    const [member] = await tx.select({ role: householdMembers.role }).from(householdMembers).where(and(
      eq(householdMembers.householdId, household.id), eq(householdMembers.userId, hint.authorUserId),
    )).for("share");
    if (!member || !can(member.role, "financial.write")) throw unavailable();
    [identity] = await tx.select({ erasedAt: users.erasedAt, emailVerified: users.emailVerified,
      generation: users.securityGeneration }).from(users).where(eq(users.id, hint.authorUserId)).for("share");
    if (!identity || identity.erasedAt || !identity.emailVerified) throw unavailable();
  }
  const [plan] = await tx.select().from(recurringInvestments).where(and(
    eq(recurringInvestments.id, candidate.id), eq(recurringInvestments.householdId, household.id),
  )).for("update");
  // The locked cursor is the occurrence to book: due today or overdue (FIN-12).
  if (!plan || !plan.isActive || plan.nextExecutionDate > today) return null;
  if (plan.type !== "sip" || !plan.securityId || !identity || !hint.authorizationId ||
      plan.currentAuthorizationId !== hint.authorizationId || plan.authorizationRevision !== hint.revision) throw unavailable();
  const [grant] = await tx.select().from(investmentPlanAuthorizations)
    .where(eq(investmentPlanAuthorizations.id, hint.authorizationId)).for("share");
  if (!grant || grant.planId !== plan.id || grant.householdId !== household.id || grant.authorUserId !== hint.authorUserId ||
      grant.revision !== plan.authorizationRevision || grant.authorizationContractVersion !== 1 ||
      grant.authorizationKind !== "record_only_sip" || grant.securityGeneration !== identity.generation ||
      plan.accountId !== grant.accountId || plan.securityId !== grant.securityId || plan.amount !== grant.amount ||
      plan.currency !== grant.currency || plan.frequency !== grant.frequency) throw unavailable();
  const terms = normalizeSipAuthorizationTerms({ contractVersion: grant.authorizationContractVersion,
    contractType: grant.authorizationKind, accountId: grant.accountId, securityId: grant.securityId,
    amount: grant.amount, currency: grant.currency, frequency: grant.frequency, initialDate: grant.initialExecutionDate });
  const planDigest = digestSipAuthorizationTerms({ ...terms, accountId: plan.accountId, securityId: plan.securityId,
    amount: plan.amount, currency: plan.currency, frequency: plan.frequency });
  if (digestSipAuthorizationTerms(terms) !== grant.authorizedTermsDigest || planDigest !== grant.authorizedTermsDigest) throw unavailable();
  return Object.freeze({ [authorityTransaction]: tx, plan: Object.freeze(plan), grant: Object.freeze(grant), terms });
}

/** The BEFORE INSERT trigger supplies creation_xid and posting_confirmed.
 * Only the genuine subsequent BUY INSERT can seal this new UUID. */
export async function reserveSipExecutionPurchase(tx: TransactionType, authority: SipExecutionAuthority, purchaseId: string): Promise<void> {
  sipExecutionPlan(tx, authority);
  await tx.execute(sql`INSERT INTO public.investment_sip_purchase_reservations (purchase_id,authorization_id)
    VALUES (${purchaseId}::uuid,${authority.grant.id}::uuid)`);
}

export async function completeSipExecutionProof(tx: TransactionType, authority: SipExecutionAuthority,
  purchase: InvestmentTransaction): Promise<void> {
  const plan = sipExecutionPlan(tx, authority), grant = authority.grant;
  const purchaseDigest = digestSipAuthorizationTerms({ ...authority.terms, accountId: purchase.accountId,
    securityId: purchase.securityId, amount: purchase.amount, currency: purchase.currency });
  if (purchase.type !== "buy" || purchase.householdId !== plan.householdId || purchaseDigest !== grant.authorizedTermsDigest) throw unavailable();
  // Copy the exact DB timestamp, never the millisecond-truncated JS Date. The
  // storage guard also requires the sealed INSERT and its one system audit.
  const proof = await tx.execute(sql`INSERT INTO public.investment_purchase_authorization_proofs
    (purchase_id,author_user_id,authorized_at,authorization_contract_version,authorized_frequency,authorized_initial_date,authorized_terms_digest)
    SELECT ${purchase.id}::uuid,grant_record.author_user_id,grant_record.authorized_at,
      grant_record.authorization_contract_version,grant_record.frequency,grant_record.initial_execution_date,grant_record.authorized_terms_digest
    FROM public.investment_plan_authorizations grant_record
    WHERE grant_record.id=${grant.id}::uuid AND grant_record.plan_id=${plan.id}::uuid
      AND grant_record.household_id=${plan.householdId}::uuid AND grant_record.revision=${plan.authorizationRevision}
    RETURNING purchase_id`);
  if (proof.rows.length !== 1) throw unavailable();
}
