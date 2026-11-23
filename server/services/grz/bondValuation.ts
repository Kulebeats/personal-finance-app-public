import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { accounts, grzBonds, householdMembers, households } from "@shared/schema";
import { grzBondValuations, type GrzBondValuation } from "@shared/grz-bond-valuation-schema";
import { db } from "../../db";
import { can } from "../../core/authz/capabilities";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../core/errors";
import { Money, toMoneyDto } from "../../core/money";
import type { HouseholdContext } from "../../middleware/householdGuard";
import type { TransactionType } from "../../utils/withTransaction";
import { businessAuditService } from "../BusinessAuditService";
import { outerBondId, bondCouponStateSql, bondMarketEvidenceRowSql, deriveGrzMarketValue, GRZ_VALUATION_POLICY, hasUnreconciledCouponCash, validQuote, verifiedBondMarketValue, withCouponPostingKeys, type MarketEvidence } from "./bondValuationEvidence";
import { readPrincipalCouponProof } from "./principalCouponReconciliation";
import { grzHouseholdBusinessDate } from "./householdBusinessDate";

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
const quoteAmount = z.string().refine(validQuote, "Quote requires a finite nonnegative decimal with at most eight decimal places");
export const bondValuationInput = z.object({
  operationId: z.string().uuid(), valuationDate: calendarDate, sourceDate: calendarDate,
  isin: z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/), currency: z.literal("ZMW"),
  nominalAmount: z.string().regex(/^\d{1,13}(?:\.\d{1,2})?$/).refine(value => /^\d{1,13}(?:\.\d{1,2})?$/.test(value) && new Money(value, "ZMW").gt(0)),
  sourceKind: z.enum(["custodian_statement", "same_issue_quote", "same_issue_trade"]),
  sourceReference: z.string().trim().min(1).max(500), quoteBasis: z.enum(["clean", "dirty"]),
  quoteUnits: z.enum(["holding_amount", "per_100_nominal"]), quotedAmount: quoteAmount,
  accruedInterest: quoteAmount.nullable(),
}).strict().superRefine((value, context) => {
  if (value.valuationDate !== value.sourceDate) context.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceDate"], message: "A same-date observation is required" });
  if (validQuote(value.quotedAmount) && !new Money(value.quotedAmount, "ZMW").gt(0)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["quotedAmount"], message: "Quote must be positive" });
  if (value.quoteBasis === "clean" && value.accruedInterest === null) context.addIssue({ code: z.ZodIssueCode.custom, path: ["accruedInterest"], message: "Clean quotes require evidenced accrued interest, including explicit zero" });
});

function projection(row: Omit<GrzBondValuation, "recordedAt">) {
  const amount = (value: string | null) => value === null ? null : toMoneyDto(new Money(value, "ZMW"));
  return { id: row.id, bondId: row.bondId, valuationDate: row.valuationDate, sourceDate: row.sourceDate, authority: row.authority,
    sourceKind: row.sourceKind, sourceReference: row.sourceReference, isin: row.isin, currency: row.currency,
    nominalAmount: amount(row.nominalAmount), quotedAmount: row.quotedAmount, accruedQuote: row.accruedQuote,
    roundingPolicy: "round_total_and_clean_residual_to_accrued" as const,
    quoteBasis: row.quoteBasis, quoteUnits: row.quoteUnits, dirtyValue: amount(row.dirtyValue), cleanValue: amount(row.cleanValue),
    accruedInterest: amount(row.accruedValue), policyVersion: row.policyVersion };
}

async function writer(tx: TransactionType, actor: HouseholdContext) {
  const [member] = await tx.select({ role: householdMembers.role }).from(householdMembers).where(and(
    eq(householdMembers.householdId, actor.householdId), eq(householdMembers.userId, actor.userId),
  )).for("update");
  if (!member || !can(member.role, "financial.write")) throw new ForbiddenError("GRZ valuation recording access denied");
  return { ...actor, role: member.role };
}

export async function recordGrzBondValuation(actor: HouseholdContext, bondId: string, body: unknown, ipAddress?: string) {
  const input = bondValuationInput.parse(body);
  const intent = { ...input, operationId: input.operationId.toLowerCase(), nominalAmount: new Money(input.nominalAmount, "ZMW").toString(), quotedAmount: new Money(input.quotedAmount, "ZMW").amount.toFixed(8),
    accruedInterest: input.accruedInterest === null ? null : new Money(input.accruedInterest, "ZMW").amount.toFixed(8),
    userId: actor.userId, bondId, policyVersion: GRZ_VALUATION_POLICY };
  const intentHash = createHash("sha256").update(JSON.stringify(intent)).digest("hex");
  return db.transaction(async tx => {
    // The owner calendar writer locks the household before memberships.
    const [household] = await tx.select({ id: households.id }).from(households)
      .where(eq(households.id, actor.householdId)).for("share");
    if (!household) throw new NotFoundError("GRZ holding");
    const currentActor = await writer(tx, actor);
    const [bond] = await tx.select().from(grzBonds).where(and(eq(grzBonds.id, bondId), eq(grzBonds.householdId, actor.householdId))).for("update");
    if (!bond?.accountId) throw new NotFoundError("GRZ holding");
    const [account] = await tx.select().from(accounts).where(and(eq(accounts.id, bond.accountId), visibleAccountPredicate(currentActor))).for("update");
    if (!account) throw new NotFoundError("GRZ holding");
    const [previous] = await tx.select().from(grzBondValuations).where(and(
      eq(grzBondValuations.householdId, actor.householdId), eq(grzBondValuations.operationId, input.operationId),
    ));
    if (previous) {
      if (previous.intentHash !== intentHash || previous.bondId !== bondId || previous.accountId !== account.id) throw new ConflictError("Valuation operation was already used for a different intent");
      return { created: false, data: { ...projection(previous), operationId: previous.operationId } };
    }
    if (bond.status !== "active" || account.currency !== "ZMW" || account.isAsset !== true || bond.isin !== input.isin ||
      !new Money(bond.faceValue, "ZMW").equals(new Money(input.nominalAmount, "ZMW"))) throw new ConflictError("Valuation evidence disagrees with the current holding");
    const today = await grzHouseholdBusinessDate(tx, actor.householdId);
    if (input.valuationDate > today || input.valuationDate < bond.purchaseDate || input.valuationDate > bond.maturityDate) throw new ValidationError("Valuation date is outside the supported holding dates");
    let values: ReturnType<typeof deriveGrzMarketValue>;
    try { values = deriveGrzMarketValue(bond.faceValue, input.quoteBasis, input.quoteUnits, input.quotedAmount, input.accruedInterest); }
    catch { throw new ValidationError("Invalid market valuation amount or component breakdown"); }
    const [coupon] = await tx.select({ state: bondCouponStateSql(outerBondId) }).from(grzBonds).where(eq(grzBonds.id, bondId));
    const couponState = withCouponPostingKeys(coupon.state);
    const unresolved = await tx.execute<{ pending: boolean }>(sql`select ${hasUnreconciledCouponCash(
      sql`${JSON.stringify(couponState)}::jsonb`, sql`${actor.householdId}::uuid`)} as pending`);
    if (unresolved.rows[0].pending) throw new ConflictError("Coupon posting still awaits reconciliation");
    const [recorded] = await tx.insert(grzBondValuations).values({ householdId: actor.householdId, bondId, accountId: account.id,
      operationId: input.operationId, intentHash, recordedBy: actor.userId, authority: "member_recorded", isin: input.isin,
      nominalAmount: bond.faceValue, currency: input.currency, valuationDate: input.valuationDate, sourceDate: input.sourceDate,
      sourceKind: input.sourceKind, sourceReference: input.sourceReference, quoteBasis: input.quoteBasis, quoteUnits: input.quoteUnits,
      quotedAmount: input.quotedAmount, accruedQuote: input.accruedInterest, ...values, couponState,
      policyVersion: GRZ_VALUATION_POLICY }).onConflictDoNothing({ target: [grzBondValuations.householdId, grzBondValuations.operationId] }).returning();
    if (!recorded) {
      const [competing] = await tx.select().from(grzBondValuations).where(and(eq(grzBondValuations.householdId, actor.householdId), eq(grzBondValuations.operationId, input.operationId)));
      if (!competing || competing.intentHash !== intentHash || competing.bondId !== bondId || competing.accountId !== account.id) throw new ConflictError("Valuation operation was already used for a different intent");
      return { created: false, data: { ...projection(competing), operationId: competing.operationId } };
    }
    await businessAuditService.log({ tx, householdId: account.isPrivate ? null : actor.householdId, userId: actor.userId, action: "CREATE", entityType: "grz_bond", entityId: recorded.id,
      details: { valuationId: recorded.id, operationId: input.operationId, authority: "member_recorded", policyVersion: GRZ_VALUATION_POLICY }, ipAddress });
    return { created: true, data: { ...projection(recorded), operationId: recorded.operationId } };
  });
}

/** Caller already locks membership -> bond -> payment/receipt -> sorted accounts.
 * This resolver acquires only the evidence share lock, never an inverse lock. */
export async function readLockedGrzPrincipalValuation(tx: TransactionType, actor: HouseholdContext, bondId: string, asOfDate: string, receiptDate = asOfDate) {
  if (!calendarDate.safeParse(asOfDate).success) return null;
  const [member] = await tx.select({ role: householdMembers.role }).from(householdMembers).where(and(
    eq(householdMembers.householdId, actor.householdId), eq(householdMembers.userId, actor.userId),
  ));
  if (!member || !can(member.role, "financial.write")) throw new ForbiddenError("GRZ settlement access denied");
  const [source] = await tx.select({ bond: grzBonds })
    .from(grzBonds).innerJoin(accounts, eq(accounts.id, grzBonds.accountId)).where(and(eq(grzBonds.id, bondId),
      eq(grzBonds.householdId, actor.householdId), visibleAccountPredicate({ ...actor, role: member.role }), eq(accounts.currency, "ZMW"), eq(accounts.isAsset, true)));
  if (!source) return null;
  const [locked] = await tx.select().from(grzBondValuations).where(and(eq(grzBondValuations.bondId, bondId),
    eq(grzBondValuations.valuationDate, asOfDate))).orderBy(desc(grzBondValuations.sequence)).limit(1).for("share");
  if (!locked) return null;
  // Validate the captured market component in isolation. Retirement separately
  // requires the current schedule/cash proof; daily publication keeps its
  // unchanged exact-day, exact-current-snapshot admission.
  if (!Array.isArray(locked.couponState) || locked.couponState.some(row => !row || typeof row !== "object" || !("id" in row))) return null;
  const value = verifiedBondMarketValue(source.bond, { ...locked }, locked.couponState as Parameters<typeof withCouponPostingKeys>[0], asOfDate);
  if (!value?.clean || locked.accruedValue === null) return null;
  return { amount: value.clean, asOfDate, sourceKind: locked.sourceKind, sourceId: locked.id,
    includedCouponAmount: new Money(locked.accruedValue, "ZMW"),
    policyVersion: locked.policyVersion, component: "ex_coupon_principal" as const,
    couponReconciliation: await readPrincipalCouponProof(tx, actor, bondId, locked.id, receiptDate) };
}

export async function listGrzBondValuations(actor: HouseholdContext, bondId: string) {
  const result = await db.execute<{ allowed: boolean; visible: boolean; rows: MarketEvidence[] }>(sql`
    with allowed_member as (select 1 from ${householdMembers} where household_id=${actor.householdId}::uuid
      and user_id=${actor.userId}::uuid and role in ('owner','admin','member','view_only','professional')),
    visible_bond as (select ${grzBonds.id} from ${grzBonds} inner join ${accounts} on ${accounts.id}=${grzBonds.accountId}
      where ${grzBonds.id}=${bondId}::uuid and ${grzBonds.householdId}=${actor.householdId}::uuid
      and ${visibleAccountPredicate({ ...actor, role: "member" })} and exists(select 1 from allowed_member))
    select exists(select 1 from allowed_member) as allowed,exists(select 1 from visible_bond) as visible,
      coalesce((select jsonb_agg(${bondMarketEvidenceRowSql()} order by v.sequence desc) from ${grzBondValuations} v
        inner join ${accounts} on ${accounts.id}=v.account_id
        where v.household_id=${actor.householdId}::uuid and v.bond_id in (select id from visible_bond)
          and ${visibleAccountPredicate({ ...actor, role: "member" })}),'[]'::jsonb) as rows`);
  const current = result.rows[0];
  if (!current?.allowed) throw new ForbiddenError("GRZ valuation access denied");
  if (!current.visible) throw new NotFoundError("GRZ holding");
  return current.rows.map(projection);
}
