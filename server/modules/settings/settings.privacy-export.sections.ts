/**
 * Personal-data export, version 2 sections (A-27; R07.1 "every entity the
 * user can see"). Each section is read on the caller's REPEATABLE READ
 * transaction through the same visibility rule as that entity's own reads, so
 * the file never holds more than the member could open in the app.
 *
 * Every amount carries its own currency ({@link PersonalExportAmount}), never
 * the household's by default. A withheld or missing value is a null amount
 * (written "unavailable" in CSV), never zero. Other members' user ids never
 * leave: a row says whether it is yours instead. Receipts are metadata only:
 * no stored object key, file name or path.
 */
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { budgets, goals, grzBonds as grzBondTable, holdings, pendingReceipts, recurringTransactions, securities, tags } from "@shared/schema";
import type { PersonalExportAmount } from "@shared/personal-data-export";
import type { TransactionType } from "../../utils/withTransaction";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { can } from "../../core/authz/capabilities";
import { visibleHoldingPredicate } from "../../core/authz/investment-visibility";
import { visibleReceiptPredicate } from "../../core/authz/receipt-visibility";
import { visibleRulePredicate } from "../../services/recurring/RecurringAudienceQuery";
import { verifiedRecurringCurrencySql } from "../../services/recurring/RecurringDenomination";
import { readGoalSourceVisibility, toViewerGoal } from "../../services/goal/GoalViewerProgress";
import { listVisibleBills, readVisibleBonds } from "../../services/grz/holdingVisibility";
import { HELD_TBILL_STATUSES, tbillCarryingValue } from "../../services/grz/tbillCarryingValue";
import { householdSecurityPriceEvidence } from "../../services/investment/householdSecurityPriceRead";

/** GRZ bonds and T-bills are issued and settled in kwacha. */
const GRZ_CURRENCY = "ZMW";
const CURRENCY_CODE = /^[A-Z]{3}$/;

export type ExportRow = Record<string, unknown>;

export interface HouseholdInventory {
  goals: ExportRow[];
  budgets: ExportRow[];
  recurringRules: ExportRow[];
  holdings: ExportRow[];
  grzBonds: ExportRow[];
  grzBondPayments: ExportRow[];
  grzTBills: ExportRow[];
  receipts: ExportRow[];
  tags: ExportRow[];
}

/**
 * Rows whose visibility can change after the export, re-checked before every
 * download. Budgets and tags have no privacy of their own (like categories),
 * so they are not sources; a goal is a source only when its progress was shown.
 */
export interface InventorySources {
  sourceGoalIds: string[];
  sourceRuleIds: string[];
  sourceHoldingIds: string[];
  sourceBondIds: string[];
  sourceBondPaymentIds: string[];
  sourceTBillIds: string[];
  sourceReceiptIds: string[];
}

export function amountOf(amount: string | null | undefined, currency: string | null | undefined): PersonalExportAmount {
  return { amount: amount ?? null, currency: currency ?? null };
}

/** An optional amount: null when it does not apply, an unavailable amount when withheld. */
function optionalAmount(amount: string | null, currency: string | null, withheld = false): PersonalExportAmount | null {
  return amount === null && !withheld ? null : amountOf(amount, currency);
}

const ids = (rows: { id: string }[]) => rows.map(row => row.id);

async function readGoals(tx: TransactionType, actor: HouseholdContext) {
  const rows = await tx.select().from(goals).where(eq(goals.householdId, actor.householdId))
    .orderBy(asc(goals.createdAt), asc(goals.id));
  const verdicts = await readGoalSourceVisibility(actor, ids(rows), tx);
  return rows.map(goal => {
    const viewer = toViewerGoal(goal, verdicts.get(goal.id));
    const withheld = viewer.progressAvailability === "unavailable";
    const currency = goal.currency;
    // customImageUrl is a stored upload path, not the member's data.
    const { householdId: _household, createdBy, customImageUrl: _image, targetAmount, currentAmount, originalBalance,
      monthlyProjection, minimumPayment, monthlyPayment, oneTimePayment, ...rest } = viewer;
    return {
      ...rest,
      createdByYou: createdBy === actor.userId,
      targetAmount: amountOf(targetAmount, currency),
      currentAmount: amountOf(currentAmount, currency),
      originalBalance: optionalAmount(originalBalance, currency, withheld),
      monthlyProjection: optionalAmount(monthlyProjection, currency, withheld),
      minimumPayment: optionalAmount(minimumPayment, currency),
      monthlyPayment: optionalAmount(monthlyPayment, currency),
      oneTimePayment: optionalAmount(oneTimePayment, currency),
    };
  });
}

/** Definitions only: a budget names a household category or group, never an account or a member. */
async function readBudgets(tx: TransactionType, actor: HouseholdContext) {
  const rows = await tx.select().from(budgets).where(eq(budgets.householdId, actor.householdId))
    .orderBy(asc(budgets.createdAt), asc(budgets.id));
  return rows.map(({ householdId: _household, amount, rolloverAmount, ...rest }) => ({
    // A budget with no default amount has none; it is not a missing figure.
    ...rest, amount: optionalAmount(amount, rest.currency), rolloverAmount: optionalAmount(rolloverAmount, rest.currency),
  }));
}

/** A rule's unit is shown only where it is proven (R14 denomination); otherwise unavailable. */
async function readRules(tx: TransactionType, actor: HouseholdContext) {
  const rows = await tx.select({ rule: recurringTransactions, currency: verifiedRecurringCurrencySql() })
    .from(recurringTransactions).where(visibleRulePredicate(actor))
    .orderBy(asc(recurringTransactions.createdAt), asc(recurringTransactions.id));
  return rows.map(({ rule: { householdId: _household, amount, ...rest }, currency }) => ({
    ...rest, amount: amountOf(amount, currency),
  }));
}

export const holdingColumns = {
  id: holdings.id, accountId: holdings.accountId, securityId: holdings.securityId,
  securitySymbol: securities.symbol, securityName: securities.name, securityType: securities.type,
  securityCurrency: securities.currency, quantity: holdings.quantity, costBasis: holdings.costBasis,
  costBasisZmw: holdings.costBasisZmw, acquiredDate: holdings.acquiredDate, acquisitionFxRate: holdings.acquisitionFxRate,
  createdAt: holdings.createdAt, updatedAt: holdings.updatedAt,
};

async function readHoldings(tx: TransactionType, actor: HouseholdContext) {
  const priceEvidence = householdSecurityPriceEvidence(actor.householdId);
  const rows = await tx.select({
    ...holdingColumns, currentPrice: sql<string | null>`((${priceEvidence})->>'currentPrice')`,
  }).from(holdings).innerJoin(securities, eq(securities.id, holdings.securityId))
    .where(visibleHoldingPredicate(actor)).orderBy(asc(holdings.id));
  return rows.map(({ costBasis, costBasisZmw, currentPrice, ...rest }) => ({
    ...rest,
    costBasis: amountOf(costBasis, rest.securityCurrency),
    costBasisZmw: optionalAmount(costBasisZmw, "ZMW"),
    // No price (or an ambiguous household mark) is unavailable, never zero.
    currentPrice: amountOf(currentPrice, rest.securityCurrency),
  }));
}

/**
 * Visible bonds whose sale was settled into cash. A plain read on the same
 * snapshot: with the cash hidden, the visible row no longer shows it was settled.
 */
async function readSettledBondIds(tx: TransactionType, bondIds: string[]): Promise<Set<string>> {
  if (!bondIds.length) return new Set();
  const rows = await tx.select({ id: grzBondTable.id }).from(grzBondTable)
    .where(and(inArray(grzBondTable.id, bondIds), isNotNull(grzBondTable.saleCashTransactionId)));
  return new Set(ids(rows));
}

async function readGrz(tx: TransactionType, actor: HouseholdContext) {
  const zmw = (amount: string | null) => amountOf(amount, GRZ_CURRENCY);
  const bonds = await readVisibleBonds(actor, tx);
  const settled = await readSettledBondIds(tx, ids(bonds));
  const grzBonds = bonds.map(({ householdId: _household, payments: _payments, faceValue, purchasePrice, soldPrice,
    saleFees, saleCostBasis, saleRealizedGain, ...rest }) => {
    // A sale settled into cash this member cannot see keeps its date; its figures are withheld
    // (unavailable). A legacy sale recorded before settlement tracking has no figures (none).
    const sold = settled.has(rest.id) && rest.saleCashTransactionId === null;
    return {
      ...rest, faceValue: zmw(faceValue), purchasePrice: zmw(purchasePrice),
      soldPrice: optionalAmount(soldPrice, GRZ_CURRENCY, sold), saleFees: optionalAmount(saleFees, GRZ_CURRENCY, sold),
      saleCostBasis: optionalAmount(saleCostBasis, GRZ_CURRENCY, sold),
      saleRealizedGain: optionalAmount(saleRealizedGain, GRZ_CURRENCY, sold),
    };
  });
  const grzBondPayments = bonds.flatMap(bond => bond.payments).map(({ grossAmount, withholdingTax, netAmount, ...rest }) => ({
    ...rest, grossAmount: zmw(grossAmount), withholdingTax: zmw(withholdingTax), netAmount: zmw(netAmount),
  }));
  const bills = await listVisibleBills(actor, tx);
  const grzTBills = bills.map(bill => {
    const isHeld = (HELD_TBILL_STATUSES as readonly string[]).includes(bill.status ?? "");
    // Internal settlement idempotency fields are not the member's data.
    const { householdId: _household, settlementOperationId: _operation, settlementRequestDigest: _digest, faceValue,
      purchasePrice, discountAmount, maturityWithholdingTax, maturityNetProceeds, ...rest } = bill;
    return {
      ...rest, faceValue: zmw(faceValue), purchasePrice: zmw(purchasePrice),
      discountAmount: optionalAmount(discountAmount, GRZ_CURRENCY),
      maturityWithholdingTax: optionalAmount(maturityWithholdingTax, GRZ_CURRENCY),
      maturityNetProceeds: optionalAmount(maturityNetProceeds, GRZ_CURRENCY),
      // A-36: what the bill is still worth until its cash arrives; a due bill without booked proceeds is unavailable.
      amountDue: isHeld ? zmw(tbillCarryingValue(bill)) : null,
    };
  });
  return { grzBonds, grzBondPayments, grzTBills };
}

const textOf = (value: unknown): string | null => typeof value === "string" ? value : null;

export const receiptColumns = {
  id: pendingReceipts.id, mimeType: pendingReceipts.mimeType, size: pendingReceipts.size,
    ocrStatus: pendingReceipts.ocrStatus, ocrData: pendingReceipts.ocrData, ocrConfidence: pendingReceipts.ocrConfidence,
    ocrProcessedAt: pendingReceipts.ocrProcessedAt, matchStatus: pendingReceipts.matchStatus,
    matchedTransactionId: pendingReceipts.matchedTransactionId, uploadedBy: pendingReceipts.uploadedBy,
    createdAt: pendingReceipts.createdAt, updatedAt: pendingReceipts.updatedAt,
};

async function readReceipts(tx: TransactionType, actor: HouseholdContext) {
  const rows = await tx.select(receiptColumns).from(pendingReceipts).where(visibleReceiptPredicate(actor))
    .orderBy(asc(pendingReceipts.createdAt), asc(pendingReceipts.id));
  return rows.map(({ ocrData, uploadedBy, ...rest }) => {
    // OCR output is untrusted text: a malformed currency is unproven, not assumed.
    const code = textOf(ocrData?.currency);
    const currency = code && CURRENCY_CODE.test(code) ? code : null;
    return {
      ...rest,
      merchantName: textOf(ocrData?.merchantName),
      receiptDate: textOf(ocrData?.date),
      amount: amountOf(textOf(ocrData?.amount), currency),
      tax: optionalAmount(textOf(ocrData?.tax), currency),
      uploadedByYou: uploadedBy === actor.userId,
    };
  });
}

/** Stored usage counts include other members' private transactions, so they are left out. */
export const tagColumns = {
  id: tags.id, name: tags.name, color: tags.color, icon: tags.icon, memberSpecific: tags.memberSpecific,
  memberId: tags.memberId, isArchived: tags.isArchived, createdAt: tags.createdAt, updatedAt: tags.updatedAt,
};

async function readTags(tx: TransactionType, actor: HouseholdContext) {
  const rows = await tx.select(tagColumns).from(tags).where(eq(tags.householdId, actor.householdId)).orderBy(asc(tags.name), asc(tags.id));
  return rows.map(({ memberId, ...rest }) => ({ ...rest, forYou: memberId === actor.userId }));
}

export function emptyInventory(): { inventory: HouseholdInventory; sources: InventorySources } {
  return {
    inventory: { goals: [], budgets: [], recurringRules: [], holdings: [], grzBonds: [], grzBondPayments: [], grzTBills: [], receipts: [], tags: [] },
    sources: { sourceGoalIds: [], sourceRuleIds: [], sourceHoldingIds: [], sourceBondIds: [], sourceBondPaymentIds: [], sourceTBillIds: [], sourceReceiptIds: [] },
  };
}

/** The version 2 household sections, and the source ids captured from the same snapshot. */
export async function readHouseholdInventory(
  tx: TransactionType, actor: HouseholdContext,
): Promise<{ inventory: HouseholdInventory; sources: InventorySources }> {
  if (!can(actor.role, "financial.read")) return emptyInventory();
  const goalRows = await readGoals(tx, actor);
  const budgetRows = await readBudgets(tx, actor);
  const ruleRows = await readRules(tx, actor);
  const holdingRows = await readHoldings(tx, actor);
  const grz = await readGrz(tx, actor);
  const receiptRows = await readReceipts(tx, actor);
  const tagRows = await readTags(tx, actor);
  return {
    inventory: {
      goals: goalRows, budgets: budgetRows, recurringRules: ruleRows, holdings: holdingRows,
      grzBonds: grz.grzBonds, grzBondPayments: grz.grzBondPayments, grzTBills: grz.grzTBills,
      receipts: receiptRows, tags: tagRows,
    },
    sources: {
      sourceGoalIds: ids(goalRows.filter(goal => goal.progressAvailability === "available")),
      sourceRuleIds: ids(ruleRows), sourceHoldingIds: ids(holdingRows),
      sourceBondIds: ids(grz.grzBonds), sourceBondPaymentIds: ids(grz.grzBondPayments),
      sourceTBillIds: ids(grz.grzTBills), sourceReceiptIds: ids(receiptRows),
    },
  };
}
