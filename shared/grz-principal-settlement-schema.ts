import { sql } from "drizzle-orm";
import { check, date, decimal, foreignKey, jsonb, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { accounts, grzBondPayments, grzBonds, households, investmentTransactions, transactions, users } from "./schema";
import { grzBondValuations } from "./grz-bond-valuation-schema";
import { grzBondPrincipalBasis } from "./grz-principal-basis-schema";

export interface PrincipalStoredValuation {
  amount: string; currency: string; asOfDate: string; sourceKind: string; sourceId: string;
  policyVersion: string; component: "ex_coupon_principal"; includedCouponAmount: string; settlementValueDifference: string;
}
export interface PrincipalStoredBasis {
  sourceId: string; sourceKind: string; sourceDate: string; acquisitionDate: string; purchaseCashAmount: string; policyVersion: string;
}
/** Common migration 0025 and its journal are coordinator-owned. This module
 * declares the proposed source contract; it does not apply database changes. */
export const grzPrincipalSettlements = pgTable("grz_principal_settlements", {
  operationId: uuid("operation_id").primaryKey(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  actorUserId: uuid("actor_user_id").notNull().references(() => users.id),
  bondId: uuid("bond_id").notNull().references(() => grzBonds.id, { onDelete: "cascade" }),
  paymentId: uuid("payment_id").notNull().references(() => grzBondPayments.id, { onDelete: "cascade" }),
  destinationAccountId: uuid("destination_account_id").notNull().references(() => accounts.id),
  requestedReceiptId: uuid("requested_receipt_id"),
  cashTransactionId: uuid("cash_transaction_id"),
  investmentTransactionId: uuid("investment_transaction_id"),
  receiptDate: date("receipt_date").notNull(),
  requestDigest: varchar("request_digest", { length: 64 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  currency: varchar("currency", { length: 3 }).notNull(),
  principalAmount: decimal("principal_amount", { precision: 15, scale: 2 }).notNull(),
  receivedAmount: decimal("received_amount", { precision: 15, scale: 2 }).notNull(),
  costBasis: decimal("cost_basis", { precision: 15, scale: 2 }),
  realizedBasisDifference: decimal("realized_basis_difference", { precision: 15, scale: 2 }),
  purchasedInterest: decimal("purchased_interest", { precision: 15, scale: 2 }),
  acquisitionFees: decimal("acquisition_fees", { precision: 15, scale: 2 }),
  basisId: uuid("basis_id"),
  basisEvidence: jsonb("basis_evidence").$type<PrincipalStoredBasis>(),
  fees: decimal("fees", { precision: 15, scale: 2 }).notNull(),
  valuationId: uuid("valuation_id"),
  valuation: jsonb("valuation").$type<PrincipalStoredValuation>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
}, table => ({
  onePayment: uniqueIndex("uq_grz_principal_confirmed_payment").on(table.paymentId).where(sql`${table.status}='confirmed'`),
  oneBond: uniqueIndex("uq_grz_principal_confirmed_bond").on(table.bondId).where(sql`${table.status}='confirmed'`),
  oneReceipt: uniqueIndex("uq_grz_principal_cash_receipt").on(table.cashTransactionId),
  oneInvestment: uniqueIndex("uq_grz_principal_investment").on(table.investmentTransactionId),
  // NEW-39: explicit FK names under Postgres's 63-byte identifier limit.
  requestedReceiptFk: foreignKey({ name: "grz_principal_settlements_requested_receipt_id_fk",
    columns: [table.requestedReceiptId], foreignColumns: [transactions.id] }),
  cashTransactionFk: foreignKey({ name: "grz_principal_settlements_cash_transaction_id_fk",
    columns: [table.cashTransactionId], foreignColumns: [transactions.id] }),
  investmentTransactionFk: foreignKey({ name: "grz_principal_settlements_investment_transaction_id_fk",
    columns: [table.investmentTransactionId], foreignColumns: [investmentTransactions.id] }),
  basisFk: foreignKey({ name: "grz_principal_settlements_basis_id_fk",
    columns: [table.basisId], foreignColumns: [grzBondPrincipalBasis.id] }),
  valuationFk: foreignKey({ name: "grz_principal_settlements_valuation_id_fk",
    columns: [table.valuationId], foreignColumns: [grzBondValuations.id] }),
  state: check("chk_grz_principal_state", sql`${table.status} in ('pending','confirmed') and ${table.currency}='ZMW'
    and ${table.receivedAmount}>0 and ${table.fees}>=0
    and ${table.principalAmount}=${table.receivedAmount}+${table.fees}
    and ${table.principalAmount}::text not in ('NaN','Infinity','-Infinity')
    and ${table.receivedAmount}::text not in ('NaN','Infinity','-Infinity')
    and ${table.fees}::text not in ('NaN','Infinity','-Infinity')
    and ((${table.basisId} is null and ${table.costBasis} is null and ${table.realizedBasisDifference} is null
      and ${table.purchasedInterest} is null and ${table.acquisitionFees} is null and ${table.basisEvidence} is null)
      or (${table.basisId} is not null and ${table.costBasis} is not null and ${table.realizedBasisDifference} is not null
        and ${table.purchasedInterest} is not null and ${table.acquisitionFees} is not null
        and ${table.costBasis}>0 and ${table.purchasedInterest}>=0 and ${table.acquisitionFees}>=0
        and ${table.costBasis}::text not in ('NaN','Infinity','-Infinity') and ${table.purchasedInterest}::text not in ('NaN','Infinity','-Infinity')
        and ${table.acquisitionFees}::text not in ('NaN','Infinity','-Infinity') and ${table.basisEvidence} is not null
        and ${table.realizedBasisDifference}=${table.principalAmount}-${table.costBasis}))
    and ((${table.status}='pending' and ${table.cashTransactionId} is null and ${table.investmentTransactionId} is null and ${table.confirmedAt} is null
      and ${table.valuationId} is null and ${table.valuation} is null)
      or (${table.status}='confirmed' and ${table.cashTransactionId} is not null and ${table.investmentTransactionId} is not null
        and ${table.basisId} is not null and ${table.valuationId} is not null and ${table.valuation} is not null and ${table.confirmedAt} is not null))`),
}));
