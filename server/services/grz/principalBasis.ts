import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { accounts, grzBonds, households, users } from "@shared/schema";
import { grzBondPrincipalBasis, type GrzPrincipalBasisRecord } from "@shared/grz-principal-basis-schema";
import { db } from "../../db";
import { Money, toMoneyDto } from "../../core/money";
import { ConflictError, NotFoundError, ValidationError } from "../../core/errors";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import type { HouseholdContext } from "../../middleware/householdGuard";
import type { TransactionType } from "../../utils/withTransaction";
import { isValidDateString } from "../../utils/dateUtils";
import { grzHouseholdBusinessDate } from "./householdBusinessDate";
import { businessAuditService } from "../BusinessAuditService";
import { lockGrzWriter } from "./couponPaymentAccess";
import { isPostgresError } from "../../utils/postgresError";

export const PRINCIPAL_BASIS_POLICY = "grz_member_recorded_principal_basis_v1";
const money = z.string().regex(/^\d+(?:\.\d{1,2})?$/).refine(value => {
  try { const amount = new Money(value, "ZMW"); return amount.amount.isFinite() && !amount.isNegative() && amount.lte("9999999999999.99"); }
  catch { return false; }
}).transform(value => new Money(value, "ZMW").toString());
const date = z.string().refine(isValidDateString, "A valid calendar date is required");
export const principalBasisInput = z.object({ operationId: z.string().uuid().transform(value => value.toLowerCase()),
  acquisitionDate: date, sourceDate: date, isin: z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/), currency: z.literal("ZMW"),
  purchaseCashAmount: money, principalCost: money, purchasedInterest: money, acquisitionFees: money,
  sourceKind: z.enum(["custodian_statement", "trade_confirmation", "contract_note"]), sourceReference: z.string().trim().min(1).max(500),
}).strict();

export interface PrincipalBasis {
  costBasis: Money; purchasedInterest: Money; acquisitionFees: Money; purchaseCashAmount: Money;
  acquisitionDate: string; sourceDate: string; sourceKind: string; sourceId: string; policyVersion: string;
}
function projection(row: GrzPrincipalBasisRecord) {
  return { id: row.id, operationId: row.operationId, bondId: row.bondId, authority: row.authority, acquisitionDate: row.acquisitionDate, sourceDate: row.sourceDate,
    sourceKind: row.sourceKind, sourceReference: row.sourceReference, isin: row.isin, currency: row.currency,
    purchaseCashAmount: toMoneyDto(new Money(row.purchaseCashAmount, "ZMW")), principalCost: toMoneyDto(new Money(row.principalCost, "ZMW")),
    purchasedInterest: toMoneyDto(new Money(row.purchasedInterest, "ZMW")), acquisitionFees: toMoneyDto(new Money(row.acquisitionFees, "ZMW")),
    policyVersion: row.policyVersion };
}
function reconciles(input: { principalCost: string; purchasedInterest: string; acquisitionFees: string; purchaseCashAmount: string }) {
  try {
    const cost = new Money(input.principalCost, "ZMW"), interest = new Money(input.purchasedInterest, "ZMW"), fees = new Money(input.acquisitionFees, "ZMW");
    const cash = new Money(input.purchaseCashAmount, "ZMW");
    return [cost, interest, fees, cash].every(value => value.amount.isFinite() && !value.isNegative() && value.lte("9999999999999.99")) &&
      cost.gt(0) && cost.add(interest).add(fees).equals(cash);
  } catch { return false; }
}

/** Record an already-owned acquisition breakdown. This never debits cash or
 * promotes the member's evidence into issuer/provider-attested tax authority. */
export async function recordGrzPrincipalBasis(caller: HouseholdContext, bondId: string, body: unknown, ipAddress?: string) {
  bondId = bondId.toLowerCase();
  const parsed = principalBasisInput.safeParse(body);
  if (!parsed.success) throw new ValidationError("Invalid principal acquisition evidence", parsed.error.errors);
  const input = parsed.data;
  if (!reconciles(input) || input.sourceDate < input.acquisitionDate) {
    throw new ValidationError("Principal, purchased interest and acquisition fees must reconcile to dated purchase cash");
  }
  const intentHash = createHash("sha256").update(JSON.stringify({ ...input, bondId, userId: caller.userId, policyVersion: PRINCIPAL_BASIS_POLICY })).digest("hex");
  return db.transaction(async tx => {
    // Erasure takes household -> membership; acquire its shared fence first.
    const [household] = await tx.select({ id: households.id }).from(households).where(eq(households.id, caller.householdId)).for("share");
    if (!household) throw new NotFoundError("GRZ holding");
    const actor = await lockGrzWriter(tx, caller);
    // NEW-22: "not in the future" means the household's calendar date, not UTC's.
    if (input.sourceDate > await grzHouseholdBusinessDate(tx, actor.householdId)) {
      throw new ValidationError("Principal, purchased interest and acquisition fees must reconcile to dated purchase cash");
    }
    const [bond] = await tx.select().from(grzBonds).where(and(eq(grzBonds.id, bondId), eq(grzBonds.householdId, actor.householdId))).for("update");
    if (!bond?.accountId) throw new NotFoundError("GRZ holding");
    const [account] = await tx.select().from(accounts).where(and(eq(accounts.id, bond.accountId), visibleAccountPredicate(actor))).for("update");
    if (!account) throw new NotFoundError("GRZ holding");
    const nominal = money.safeParse(bond.faceValue);
    if (!nominal.success || new Money(nominal.data, "ZMW").isZero()) throw new ValidationError("Holding nominal amount requires reconciliation");
    if (account.currency !== "ZMW" || !account.isAsset || input.isin !== bond.isin || input.acquisitionDate !== bond.purchaseDate ||
        !new Money(bond.purchasePrice, "ZMW").equals(new Money(input.purchaseCashAmount, "ZMW"))) {
      throw new ConflictError("Acquisition evidence disagrees with the recorded holding");
    }
    const [existing] = await tx.select().from(grzBondPrincipalBasis).where(and(eq(grzBondPrincipalBasis.householdId, actor.householdId),
      eq(grzBondPrincipalBasis.operationId, input.operationId)));
    if (existing) {
      if (existing.intentHash !== intentHash || existing.bondId !== bondId || existing.accountId !== account.id || existing.isin !== bond.isin ||
          !new Money(existing.nominalAmount, "ZMW").equals(new Money(bond.faceValue, "ZMW")) || existing.acquisitionDate !== bond.purchaseDate ||
          !new Money(existing.purchaseCashAmount, "ZMW").equals(new Money(bond.purchasePrice, "ZMW"))) throw new ConflictError("Basis operation belongs to another acquisition record");
      return { created: false, data: projection(existing) };
    }
    if (bond.status !== "active") throw new ConflictError("An inactive holding cannot acquire new principal basis evidence");
    const [saved] = await tx.insert(grzBondPrincipalBasis).values({ ...input, householdId: actor.householdId, bondId, accountId: account.id,
      recordedBy: actor.userId, intentHash, authority: "member_recorded", nominalAmount: bond.faceValue, policyVersion: PRINCIPAL_BASIS_POLICY }).returning();
    await businessAuditService.logCreate({ tx, householdId: account.isPrivate ? null : actor.householdId, userId: actor.userId, entityType: "grz_bond", entityId: bond.id,
      newValue: { principalBasisId: saved.id, operationId: input.operationId, authority: "member_recorded", policyVersion: PRINCIPAL_BASIS_POLICY }, ipAddress });
    return { created: true, data: projection(saved) };
  }).catch(error => {
    if (isPostgresError(error, "23505", "uq_grz_basis_household_operation")) throw new ConflictError("Basis operation belongs to another acquisition record");
    throw error;
  });
}

/** Caller holds household -> grant -> bond -> payment/receipt -> sorted accounts. Selection
 * binds the original acquisition instead of treating dirty purchase cash as
 * clean principal cost. No evidence is inferred for an ambiguous legacy buy. */
export async function readLockedGrzPrincipalBasis(tx: TransactionType, actor: HouseholdContext, bondId: string): Promise<PrincipalBasis | null> {
  const [source] = await tx.select({ record: grzBondPrincipalBasis, recorderId: users.id }).from(grzBondPrincipalBasis)
    .innerJoin(grzBonds, eq(grzBonds.id, grzBondPrincipalBasis.bondId)).innerJoin(accounts, eq(accounts.id, grzBonds.accountId))
    .leftJoin(users, eq(users.id, grzBondPrincipalBasis.recordedBy))
    .where(and(eq(grzBonds.id, bondId), eq(grzBonds.householdId, actor.householdId), visibleAccountPredicate(actor),
      eq(accounts.currency, "ZMW"), eq(accounts.isAsset, true), eq(grzBondPrincipalBasis.householdId, actor.householdId),
      eq(grzBondPrincipalBasis.accountId, accounts.id), eq(grzBondPrincipalBasis.isin, grzBonds.isin),
      eq(grzBondPrincipalBasis.nominalAmount, grzBonds.faceValue), eq(grzBondPrincipalBasis.acquisitionDate, grzBonds.purchaseDate),
      eq(grzBondPrincipalBasis.purchaseCashAmount, grzBonds.purchasePrice)))
    .orderBy(desc(grzBondPrincipalBasis.sequence)).limit(1).for("share", { of: grzBondPrincipalBasis });
  const row = source?.record;
  const today = row ? await grzHouseholdBusinessDate(tx, actor.householdId) : null;
  // An anonymised, retained user ID remains attributable. Missing identity or
  // reference is unavailable; never fall back past the latest bad record.
  if (!row || !source.recorderId || !row.recordedBy || !row.sourceReference.trim() || row.policyVersion !== PRINCIPAL_BASIS_POLICY ||
    row.currency !== "ZMW" || row.authority !== "member_recorded" || today === null || row.sourceDate > today || !reconciles(row)) return null;
  return { costBasis: new Money(row.principalCost, "ZMW"), purchasedInterest: new Money(row.purchasedInterest, "ZMW"),
    acquisitionFees: new Money(row.acquisitionFees, "ZMW"), purchaseCashAmount: new Money(row.purchaseCashAmount, "ZMW"),
    acquisitionDate: row.acquisitionDate, sourceDate: row.sourceDate, sourceKind: row.sourceKind, sourceId: row.id, policyVersion: row.policyVersion };
}
