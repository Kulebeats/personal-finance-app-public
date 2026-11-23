import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import { accounts, auditLogs, holdings, investmentTransactions, securities, type Holding } from "@shared/schema";
import { calculateSipFillEconomics, type SipOccurrenceFill } from "@shared/sip-occurrence-contract";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import { ConflictError, NotFoundError, ValidationError } from "../../core/errors";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { recordPurchaseLot } from "../../modules/investments/investmentTradeHistory";
import { assertRateRowStillChosen, convertInvestmentEventToZmw, DATED_INVESTMENT_FX_POLICY } from "../../modules/investments/investmentDatedFx";
import type { TransactionType } from "../../utils/withTransaction";
import { businessAuditService } from "../BusinessAuditService";
import { digestSipFillProofTerms } from "./sipFillProofContract";
import { lockSipHoldingFxSource } from "./sipHoldingFxSource";
import type { SipOccurrence } from "./sipOccurrenceAccess";
import { SipOccurrenceConflict } from "./sipOccurrenceErrors";

const Exact = Decimal.clone({ precision: 48, rounding: Decimal.ROUND_HALF_UP });
const postingTransaction = Symbol("sipOccurrencePostingTransaction");
/** Exclusive bound of holdings.cost_basis_zmw, NUMERIC(15,2). */
const HOLDING_ZMW_BASIS_LIMIT = "1e13";
interface PostingSources {
  [postingTransaction]: TransactionType;
  actor: HouseholdContext;
  occurrence: SipOccurrence;
  isPrivate: boolean;
  holding: Holding | undefined;
}

/** Preserve holding -> custody -> instrument ordering. With no holding, the
 * custody UPDATE lock fences first acquisitions across different plans/actors. */
export async function lockSipOccurrencePostingSources(tx: TransactionType, actor: HouseholdContext,
  occurrence: SipOccurrence): Promise<PostingSources> {
  const position = and(eq(holdings.accountId, occurrence.accountId), eq(holdings.securityId, occurrence.securityId));
  const candidates = await tx.select().from(holdings).where(position).orderBy(holdings.id).limit(2).for("update");
  const [account] = await tx.select().from(accounts).where(and(
    eq(accounts.id, occurrence.accountId), visibleAccountPredicate(actor),
  )).for(candidates.length ? "share" : "update");
  if (!account) throw new NotFoundError("Investment occurrence");
  const rows = candidates.length ? candidates : await tx.select().from(holdings).where(position)
    .orderBy(holdings.id).limit(2).for("update", { noWait: true });
  if (rows.length > 1 || (rows[0] && rows[0].householdId !== actor.householdId)) {
    throw new SipOccurrenceConflict("SOURCE_CHANGED");
  }
  const [security] = await tx.select().from(securities).where(eq(securities.id, occurrence.securityId)).for("share");
  if (!security || security.type === "tbill" || security.currency !== occurrence.currency) {
    throw new SipOccurrenceConflict("SOURCE_CHANGED");
  }
  return {
    [postingTransaction]: tx,
    actor,
    occurrence,
    isPrivate: account.isPrivate,
    holding: rows[0],
  };
}

/**
 * A holding's acquiredDate is its earliest purchase date, which the SIP FX
 * source check (sipHoldingFxSource) requires on every later fill. A fill dated
 * earlier moves it back (#254 r4). A declared opening's audit fixes its date,
 * so a fill before it is refused rather than leaving the plan unconfirmable.
 */
async function earlierAcquiredDate(tx: TransactionType, holding: Holding, executionDate: string): Promise<string | undefined> {
  if (holding.acquiredDate === null || executionDate >= holding.acquiredDate) return undefined;
  const declared = await tx.select({ id: auditLogs.id }).from(auditLogs).where(and(
    eq(auditLogs.entityType, "holding"), eq(auditLogs.entityId, holding.id), eq(auditLogs.action, "CREATE"),
    sql`${auditLogs.details}->>'openingBasis' = 'declared_record_only_v1'`,
  )).limit(1);
  if (declared.length) throw new SipOccurrenceConflict("FILL_BEFORE_DECLARED_OPENING");
  return executionDate;
}

/** Only actual per-fill quantities/prices/fees enter financial records. No
 * reference quote, planned amount, operational identifier or cash leg enters. */
export async function postSipOccurrenceFill(tx: TransactionType, source: PostingSources,
  confirmationId: string, fillIndex: number, fill: SipOccurrenceFill) {
  if (source[postingTransaction] !== tx) throw new SipOccurrenceConflict("SOURCE_CHANGED");
  const { actor, occurrence } = source;
  const economics = calculateSipFillEconomics(fill);
  // On the locked holding, before any conversion or reservation: a fill before
  // a declared opening is refused by name even when its date has no rate (#261).
  const acquiredDate = source.holding ? await earlierAcquiredDate(tx, source.holding, fill.executionDate) : undefined;
  // A foreign fill takes its ZMW base from the dated rate for its execution
  // date (#236 F1); no rate is a 422 before anything is written.
  const conversion = await convertInvestmentEventToZmw(tx, actor.householdId, occurrence.currency,
    fill.executionDate, economics.amount, {});
  const purchaseId = randomUUID();
  // BEFORE INSERT forces the actual XID and false seal; the actual subsequent
  // BUY INSERT alone may seal this new reservation in the same transaction.
  await tx.execute(sql`INSERT INTO public.investment_sip_confirmed_fills
    (confirmation_id,fill_index,purchase_id,execution_date,quantity,price,fees,amount)
    VALUES (${confirmationId}::uuid,${fillIndex},${purchaseId}::uuid,${fill.executionDate}::date,
      ${fill.quantity}::numeric,${fill.price}::numeric,${fill.fees}::numeric,${economics.amount}::numeric)`);
  const current = source.holding;
  if (current) {
    if (occurrence.currency !== "ZMW" && (current.costBasisZmw !== null || current.acquisitionFxRate !== null)) {
      await lockSipHoldingFxSource(tx, current, occurrence.currency);
    }
    const previous = new Exact(current.quantity);
    const quantity = previous.plus(fill.quantity);
    const priorBasis = current.costBasis === null ? null : new Exact(current.costBasis);
    if (!previous.isFinite() || previous.lt(0) || quantity.gte("1e10")
      || (priorBasis && (!priorBasis.isFinite() || priorBasis.lt(0)))) {
      throw new SipOccurrenceConflict("SOURCE_CHANGED");
    }
    const basis = priorBasis === null && !previous.isZero() ? null : new Exact(priorBasis ?? 0).plus(economics.amount);
    if (basis?.gte("1e13")) throw new SipOccurrenceConflict("SOURCE_CHANGED");
    // #242 review P2-2: a foreign fill adds its dated base to a known holding
    // base (verified against the lots above), or starts one on an empty
    // holding. An unknown base on a held position stays unknown.
    const priorZmw = current.costBasisZmw === null ? null : new Exact(current.costBasisZmw);
    const foreignBasisZmw = !conversion || (priorZmw === null && !previous.isZero()) ? null
      : new Exact(priorZmw ?? 0).plus(conversion.amountZmw);
    // #254 review: the aggregate must fit holdings.cost_basis_zmw before the UPDATE.
    if (foreignBasisZmw?.gte(HOLDING_ZMW_BASIS_LIMIT)) {
      throw new ValidationError("The holding's ZMW cost basis would be too large to store");
    }
    const [updated] = await tx.update(holdings).set({
      quantity: quantity.toFixed(8), costBasis: basis?.toFixed(2) ?? null,
      ...(acquiredDate ? { acquiredDate } : {}),
      costBasisZmw: occurrence.currency === "ZMW" && current.costBasisZmw !== null ? basis?.toFixed(2) ?? null
        : foreignBasisZmw?.toFixed(2) ?? null,
      acquisitionFxRate: null, updatedAt: new Date(),
    }).where(eq(holdings.id, current.id)).returning();
    source.holding = updated;
  } else {
    const [created] = await tx.insert(holdings).values({
      householdId: actor.householdId, accountId: occurrence.accountId, securityId: occurrence.securityId,
      quantity: fill.quantity, costBasis: economics.amount, acquiredDate: fill.executionDate,
      costBasisZmw: conversion?.amountZmw ?? null,
    }).returning();
    source.holding = created;
  }
  const [purchase] = await tx.insert(investmentTransactions).values({
    id: purchaseId, householdId: actor.householdId, accountId: occurrence.accountId,
    holdingId: source.holding.id, securityId: occurrence.securityId, type: "buy",
    quantity: fill.quantity, price: fill.price, amount: economics.amount, fees: fill.fees,
    currency: occurrence.currency, transactionDate: fill.executionDate,
    fxRate: conversion?.fxRate ?? null, amountZmw: conversion?.amountZmw ?? null, linkedTransactionId: null, notes: null,
    createdAt: sql`clock_timestamp()`,
  }).returning();
  try {
    await recordPurchaseLot(tx, purchase);
  } catch (error) {
    if (error instanceof ConflictError) throw new SipOccurrenceConflict("FIFO_HISTORY_CONFLICT");
    throw error;
  }
  await businessAuditService.logCreate({
    tx, userId: actor.userId, householdId: source.isPrivate ? null : actor.householdId,
    entityType: "investment_transaction", entityId: purchase.id,
    newValue: {
      type: purchase.type, accountId: purchase.accountId, holdingId: purchase.holdingId,
      securityId: purchase.securityId, quantity: purchase.quantity, amount: purchase.amount,
      currency: purchase.currency, transactionDate: purchase.transactionDate,
      price: purchase.price, fees: purchase.fees, feesDeclared: true,
      ...(conversion ? { fxRate: purchase.fxRate, amountZmw: purchase.amountZmw } : {}),
    },
    // 0047: the audit names the rate row the dated conversion used (F4).
    ...(conversion ? { metadata: { fxRateBasis: DATED_INVESTMENT_FX_POLICY, fxRateSource: conversion.source } } : {}),
  });
  const digest = digestSipFillProofTerms({
    contractVersion: 2, contractType: "record_only_sip_actual_fill",
    accountId: purchase.accountId, securityId: purchase.securityId,
    quantity: purchase.quantity, price: purchase.price, fees: purchase.fees,
    amount: purchase.amount, currency: purchase.currency, executionDate: purchase.transactionDate,
    authorizedFrequency: occurrence.authorizedFrequency, authorizedInitialDate: occurrence.authorizedInitialDate,
    fxRate: purchase.fxRate, amountZmw: purchase.amountZmw,
  });
  // The proof's evidence re-checks the converter's choice; a newer rate row
  // committed since the conversion is the same retryable 409 (#254 r4).
  if (conversion) await assertRateRowStillChosen(tx, actor.householdId, occurrence.currency, fill.executionDate, conversion.source);
  const proof = await tx.execute(sql`INSERT INTO public.investment_purchase_authorization_proofs
    (purchase_id,author_user_id,authorized_at,authorization_contract_version,
      authorized_frequency,authorized_initial_date,authorized_terms_digest)
    SELECT ${purchase.id}::uuid,c.actor_user_id,c.authorized_at,2,
      o.authorized_frequency,o.authorized_initial_date,${digest}
    FROM public.investment_sip_confirmations c JOIN public.investment_sip_occurrences o
      ON o.plan_id=c.plan_id AND o.original_due_date=c.original_due_date
      AND o.household_id=c.household_id
    WHERE c.id=${confirmationId}::uuid AND c.actor_user_id=${actor.userId}::uuid
    RETURNING purchase_id`);
  if (proof.rows.length !== 1) throw new SipOccurrenceConflict("SOURCE_CHANGED");
  return purchase.id;
}
