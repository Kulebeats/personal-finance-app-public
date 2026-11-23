import { sql } from "drizzle-orm";
import { bigserial, check, date, decimal, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { accounts, grzBonds, households, users } from "./schema";

/** Member-recorded attributable evidence; never provider-attested market data. */
export const grzBondValuations = pgTable("grz_bond_valuations", {
  id: uuid("id").defaultRandom().primaryKey(),
  sequence: bigserial("sequence", { mode: "number" }).notNull(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  bondId: uuid("bond_id").notNull().references(() => grzBonds.id),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  operationId: uuid("operation_id").notNull(),
  intentHash: varchar("intent_hash", { length: 64 }).notNull(),
  recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  authority: varchar("authority", { length: 30 }).notNull(),
  isin: varchar("isin", { length: 20 }).notNull(),
  nominalAmount: decimal("nominal_amount", { precision: 15, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  valuationDate: date("valuation_date").notNull(),
  sourceDate: date("source_date").notNull(),
  sourceKind: varchar("source_kind", { length: 30 }).notNull(),
  sourceReference: text("source_reference").notNull(),
  quoteBasis: varchar("quote_basis", { length: 10 }).notNull(),
  quoteUnits: varchar("quote_units", { length: 30 }).notNull(),
  quotedAmount: decimal("quoted_amount", { precision: 23, scale: 8 }).notNull(),
  accruedQuote: decimal("accrued_quote", { precision: 23, scale: 8 }),
  cleanValue: decimal("clean_value", { precision: 15, scale: 2 }),
  dirtyValue: decimal("dirty_value", { precision: 15, scale: 2 }).notNull(),
  accruedValue: decimal("accrued_value", { precision: 15, scale: 2 }),
  couponState: jsonb("coupon_state").$type<unknown[]>().notNull(),
  policyVersion: varchar("policy_version", { length: 60 }).notNull(),
}, table => ({
  operation: uniqueIndex("uq_grz_valuation_household_operation").on(table.householdId, table.operationId),
  dated: index("idx_grz_valuation_bond_date_sequence").on(table.bondId, table.valuationDate, table.sequence),
  authority: check("ck_grz_valuation_authority", sql`${table.authority}='member_recorded'`),
  currency: check("ck_grz_valuation_currency", sql`${table.currency}='ZMW'`),
  datedSource: check("ck_grz_valuation_source_date", sql`${table.sourceDate}=${table.valuationDate}`),
  source: check("ck_grz_valuation_source", sql`${table.sourceKind} in ('custodian_statement','same_issue_quote','same_issue_trade') and length(trim(${table.sourceReference}))>0`),
  quote: check("ck_grz_valuation_quote", sql`${table.quoteBasis} in ('clean','dirty') and ${table.quoteUnits} in ('holding_amount','per_100_nominal')
    and ${table.nominalAmount}>0 and ${table.nominalAmount}::text ~ '^[0-9]+([.][0-9]+)?$'
    and ${table.quotedAmount}>0 and ${table.quotedAmount}::text ~ '^[0-9]+([.][0-9]+)?$'
    and (${table.accruedQuote} is null or (${table.accruedQuote}>=0 and ${table.accruedQuote}::text ~ '^[0-9]+([.][0-9]+)?$'))`),
  components: check("ck_grz_valuation_components", sql`${table.dirtyValue}>=0 and ${table.dirtyValue}::text ~ '^[0-9]+([.][0-9]+)?$' and
    ((${table.cleanValue} is null and ${table.accruedValue} is null) or
    (${table.cleanValue} is not null and ${table.accruedValue} is not null and ${table.cleanValue}>=0 and ${table.accruedValue}>=0
      and ${table.cleanValue}::text ~ '^[0-9]+([.][0-9]+)?$' and ${table.accruedValue}::text ~ '^[0-9]+([.][0-9]+)?$'
      and ${table.cleanValue}+${table.accruedValue}=${table.dirtyValue}))`),
}));

export type GrzBondValuation = typeof grzBondValuations.$inferSelect;
