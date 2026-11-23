import { accounts, grzBondPayments, grzBonds, grzTBills, investmentTransactions, transactions } from "@shared/schema";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "../../db";
import { readableMembershipPredicate, visibleAccountPredicate, visibleTransactionPredicate } from "../../core/authz/transaction-visibility";
import { visibleInvestmentTransactionPredicate } from "../../core/authz/investment-visibility";
import type { HouseholdContext } from "../../middleware/householdGuard";
import type { TransactionType } from "../../utils/withTransaction";

type BondRow = typeof grzBonds.$inferSelect;

/** A maturity date carries both a coupon and the principal: list the coupon first, every load. */
const paymentTypeRank = sql`case ${grzBondPayments.paymentType} when 'coupon' then 0 when 'principal' then 1 else 2 end`;

function visibleAccounts(actor: HouseholdContext) {
  return db.select({ id: accounts.id }).from(accounts).where(visibleAccountPredicate(actor));
}

function holdingVisibility(table: typeof grzBonds | typeof grzTBills, actor: HouseholdContext) {
  return and(eq(table.householdId, actor.householdId), readableMembershipPredicate(actor),
    or(isNull(table.accountId), inArray(table.accountId, visibleAccounts(actor))));
}

/**
 * A bond sale this reader may count (GRZ-03): the bond is visible, and so is its
 * settlement cash, which listVisibleBonds otherwise redacts. A sold bond without
 * settlement cash stays in, so its missing gain surfaces instead of vanishing.
 */
export function visibleBondSalePredicate(actor: HouseholdContext) {
  return and(holdingVisibility(grzBonds, actor), or(isNull(grzBonds.saleCashTransactionId), inArray(grzBonds.saleCashTransactionId,
    db.select({ id: transactions.id }).from(transactions).where(visibleTransactionPredicate(actor)))))!;
}

function visibleReceiptLinks(incomeId: AnyPgColumn, investmentId: AnyPgColumn, actor: HouseholdContext) {
  const income = db.select({ id: transactions.id }).from(transactions).where(visibleTransactionPredicate(actor));
  const investments = db.select({ id: investmentTransactions.id }).from(investmentTransactions)
    .where(visibleInvestmentTransactionPredicate(actor));
  return and(or(isNull(incomeId), inArray(incomeId, income)), or(isNull(investmentId), inArray(investmentId, investments)));
}

/** A T-bill awaiting receipt that this reader may count as due interest (A-36). */
export function visibleDueBillPredicate(actor: HouseholdContext) {
  return and(holdingVisibility(grzTBills, actor), eq(grzTBills.status, "awaiting_receipt"))!;
}

/** A bond this reader may see: in their household, held in no account or a visible one. */
export function visibleBondPredicate(actor: HouseholdContext) {
  return holdingVisibility(grzBonds, actor)!;
}

/** A bill this reader may see, with its receipt links and settlement cash (listVisibleBills' filter). */
export function visibleBillPredicate(actor: HouseholdContext) {
  const settlementCash = db.select({ id: transactions.id }).from(transactions).where(visibleTransactionPredicate(actor));
  return and(holdingVisibility(grzTBills, actor),
    visibleReceiptLinks(grzTBills.maturityIncomeTxId, grzTBills.maturityInvestmentTxId, actor),
    or(isNull(grzTBills.settlementCashTransactionId), inArray(grzTBills.settlementCashTransactionId, settlementCash)))!;
}

/** A bond payment this reader may see: its bond is visible, and so are its receipt links. */
export function visibleBondPaymentPredicate(actor: HouseholdContext) {
  const bondIds = db.select({ id: grzBonds.id }).from(grzBonds).where(visibleBondPredicate(actor));
  return and(inArray(grzBondPayments.bondId, bondIds),
    visibleReceiptLinks(grzBondPayments.incomeTransactionId, grzBondPayments.investmentTransactionId, actor))!;
}

export async function listVisibleBills(actor: HouseholdContext, executor: typeof db | TransactionType = db) {
  const bills = await executor.select().from(grzTBills).where(visibleBillPredicate(actor))
    .orderBy(desc(grzTBills.purchaseDate));
  const visibleIds = new Set(bills.map(bill => bill.id));
  return bills.map(bill => bill.rolloverToId && !visibleIds.has(bill.rolloverToId) ? { ...bill, rolloverToId: null } : bill);
}

export type VisibleBond = BondRow & { payments: (typeof grzBondPayments.$inferSelect)[] };

/** Visible bonds with their visible payments, on the caller's transaction. */
export async function readVisibleBonds(actor: HouseholdContext, tx: TransactionType): Promise<VisibleBond[]> {
  const bonds = await tx.select().from(grzBonds).where(visibleBondPredicate(actor)).orderBy(desc(grzBonds.purchaseDate));
  if (!bonds.length) return [];
  const payments = await tx.select().from(grzBondPayments).where(visibleBondPaymentPredicate(actor))
    .orderBy(grzBondPayments.paymentDate, paymentTypeRank, grzBondPayments.id);
  const grouped = new Map<string, typeof payments>();
  for (const payment of payments) {
    const group = grouped.get(payment.bondId);
    if (group) group.push(payment);
    else grouped.set(payment.bondId, [payment]);
  }
  const saleCashIds = bonds.flatMap(bond => bond.saleCashTransactionId ? [bond.saleCashTransactionId] : []);
  const visibleSaleCash = new Set(saleCashIds.length ? (await tx.select({ id: transactions.id }).from(transactions)
    .where(and(inArray(transactions.id, saleCashIds), visibleTransactionPredicate(actor)))).map(row => row.id) : []);
  return bonds.map(bond => ({
    ...(bond.saleCashTransactionId && !visibleSaleCash.has(bond.saleCashTransactionId) ? redactSale(bond) : bond),
    payments: grouped.get(bond.id) ?? [],
  }));
}

export function listVisibleBonds(actor: HouseholdContext) {
  return db.transaction(tx => readVisibleBonds(actor, tx), { isolationLevel: "repeatable read", accessMode: "read only" });
}

/**
 * A shared bond may be sold into an account this reader cannot see. The bond stays
 * listed as sold, but the settlement figures are that private receipt's: the price
 * less fees is the net cash. Hide all of them, as bills hide a receipt they can't link.
 */
function redactSale(bond: BondRow): BondRow {
  return { ...bond, soldPrice: null, soldYield: null, saleCashTransactionId: null, saleFees: null,
    saleCostBasis: null, saleRealizedGain: null };
}
