import { sql } from "drizzle-orm";
import { bigserial, check, date, decimal, index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { accounts, grzBonds, households, users } from "./schema";

/** Attributable acquisition breakdown, not a tax-basis convention or a cash
 * posting. Coordinator composes the common 0025 migration and journal. */
export const grzBondPrincipalBasis = pgTable("grz_bond_principal_basis", {
  id: uuid("id").primaryKey().defaultRandom(),
  sequence: bigserial("sequence", { mode: "number" }).notNull(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  bondId: uuid("bond_id").notNull().references(() => grzBonds.id),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
  operationId: uuid("operation_id").notNull(),
  intentHash: varchar("intent_hash", { length: 64 }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  authority: varchar("authority", { length: 30 }).notNull(),
  isin: varchar("isin", { length: 20 }).notNull(),
  nominalAmount: decimal("nominal_amount", { precision: 15, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  acquisitionDate: date("acquisition_date").notNull(),
  sourceDate: date("source_date").notNull(),
  sourceKind: varchar("source_kind", { length: 30 }).notNull(),
  sourceReference: text("source_reference").notNull(),
  purchaseCashAmount: decimal("purchase_cash_amount", { precision: 15, scale: 2 }).notNull(),
  principalCost: decimal("principal_cost", { precision: 15, scale: 2 }).notNull(),
  purchasedInterest: decimal("purchased_interest", { precision: 15, scale: 2 }).notNull(),
  acquisitionFees: decimal("acquisition_fees", { precision: 15, scale: 2 }).notNull(),
  policyVersion: varchar("policy_version", { length: 64 }).notNull(),
}, table => ({
  operation: uniqueIndex("uq_grz_basis_household_operation").on(table.householdId, table.operationId),
  sequence: index("idx_grz_basis_bond_sequence").on(table.bondId, table.sequence),
  terms: check("chk_grz_principal_basis_terms", sql`${table.authority}='member_recorded' and ${table.currency}='ZMW'
    and ${table.sourceDate}>=${table.acquisitionDate} and ${table.sourceKind} in ('custodian_statement','trade_confirmation','contract_note')
    and ${table.sourceReference} ~ '[^[:space:]]'
    and ${table.principalCost}>0 and ${table.purchasedInterest}>=0 and ${table.acquisitionFees}>=0 and ${table.nominalAmount}>0
    and ${table.purchaseCashAmount}=${table.principalCost}+${table.purchasedInterest}+${table.acquisitionFees}
    and ${table.principalCost}::text ~ '^[0-9]+([.][0-9]+)?$' and ${table.purchasedInterest}::text ~ '^[0-9]+([.][0-9]+)?$'
    and ${table.acquisitionFees}::text ~ '^[0-9]+([.][0-9]+)?$' and ${table.purchaseCashAmount}::text ~ '^[0-9]+([.][0-9]+)?$'
    and ${table.nominalAmount}::text ~ '^[0-9]+([.][0-9]+)?$'`),
}));

export type GrzPrincipalBasisRecord = typeof grzBondPrincipalBasis.$inferSelect;
