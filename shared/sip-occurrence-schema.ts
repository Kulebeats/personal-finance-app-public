import { sql } from "drizzle-orm";
import { boolean, check, date, decimal, foreignKey, index, integer, pgTable, primaryKey,
  smallint, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

type Dependencies = Pick<typeof schema, "households" | "users" | "recurringInvestments" |
  "investmentTransactions" | "recurringFrequencyEnum">;

/** Candidate mapping for reserved 0029. Trigger/privilege/FK deferral stays SQL-owned. */
export function createSipOccurrenceSchema({ households, users, recurringInvestments,
  investmentTransactions, recurringFrequencyEnum }: Dependencies) {
  const investmentSipOccurrenceFences = pgTable("investment_sip_occurrence_fences", {
    planId: uuid("plan_id").notNull(),
    originalDueDate: date("original_due_date").notNull(),
    terminal: boolean("terminal").notNull().default(false),
  }, table => [
    primaryKey({ name: "investment_sip_occurrence_fence_pk", columns: [table.planId, table.originalDueDate] }),
    foreignKey({ name: "investment_sip_occurrence_fence_plan_fk", columns: [table.planId],
      foreignColumns: [recurringInvestments.id] }).onDelete("cascade"),
    check("investment_sip_fence_date", sql`${table.originalDueDate} BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'`),
  ]);

  const investmentSipOccurrences = pgTable("investment_sip_occurrences", {
    planId: uuid("plan_id").notNull(),
    originalDueDate: date("original_due_date").notNull(),
    householdId: uuid("household_id").notNull(),
    accountId: uuid("account_id").notNull(),
    securityId: uuid("security_id").notNull(),
    plannedAmount: decimal("planned_amount", { precision: 15, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    authorizedFrequency: recurringFrequencyEnum("authorized_frequency").notNull(),
    authorizedInitialDate: date("authorized_initial_date").notNull(),
    occurrenceRevision: integer("occurrence_revision").notNull().default(0),
    state: text("state").notNull().default("pending"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  }, table => [
    primaryKey({ name: "investment_sip_occurrence_pk", columns: [table.planId, table.originalDueDate] }),
    unique("investment_sip_occurrence_scope").on(table.planId, table.originalDueDate, table.householdId),
    foreignKey({ name: "investment_sip_occurrence_fence_fk", columns: [table.planId, table.originalDueDate],
      foreignColumns: [investmentSipOccurrenceFences.planId, investmentSipOccurrenceFences.originalDueDate] }).onDelete("cascade"),
    foreignKey({ name: "investment_sip_occurrence_plan_scope_fk", columns: [table.planId, table.householdId],
      foreignColumns: [recurringInvestments.id, recurringInvestments.householdId] }).onDelete("cascade"),
    index("investment_sip_occurrence_household_date").on(table.householdId, table.planId, table.originalDueDate),
    check("investment_sip_occurrence_state", sql`(${table.state}='pending' AND ${table.occurrenceRevision}=0) OR (${table.state}='closed' AND ${table.occurrenceRevision}=1)`),
    check("investment_sip_occurrence_amount", sql`${table.plannedAmount}>0 AND ${table.plannedAmount}::text ~ '^[0-9]+[.][0-9]{2}$'`),
    check("investment_sip_occurrence_currency", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("investment_sip_occurrence_frequency", sql`${table.authorizedFrequency}<>'custom'`),
    check("investment_sip_occurrence_initial_date", sql`${table.authorizedInitialDate} BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'`),
  ]);

  const investmentSipConfirmations = pgTable("investment_sip_confirmations", {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id").notNull(),
    actorUserId: uuid("actor_user_id").notNull(),
    operationId: uuid("operation_id").notNull(),
    planId: uuid("plan_id").notNull(),
    originalDueDate: date("original_due_date").notNull(),
    expectedOccurrenceRevision: integer("expected_occurrence_revision").notNull(),
    requestVersion: smallint("request_version").notNull(),
    requestDigest: varchar("request_digest", { length: 64 }).notNull(),
    outcome: text("outcome").notNull(),
    fillCount: integer("fill_count").notNull(),
    brokerReference: text("broker_reference"),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    // SQL forces this from the same authorized_at instant and locked household zone.
    confirmationCutoffDate: date("confirmation_cutoff_date").notNull(),
    securityGeneration: integer("security_generation").notNull(),
  }, table => [
    unique("investment_sip_confirmation_operation").on(table.householdId, table.actorUserId, table.operationId),
    unique("investment_sip_confirmation_occurrence").on(table.planId, table.originalDueDate),
    foreignKey({ name: "investment_sip_confirmation_actor_fk", columns: [table.actorUserId], foreignColumns: [users.id] }),
    foreignKey({ name: "investment_sip_confirmation_household_fk", columns: [table.householdId], foreignColumns: [households.id] }).onDelete("cascade"),
    foreignKey({ name: "investment_sip_confirmation_occurrence_fk", columns: [table.planId, table.originalDueDate, table.householdId],
      foreignColumns: [investmentSipOccurrences.planId, investmentSipOccurrences.originalDueDate, investmentSipOccurrences.householdId] }).onDelete("cascade"),
    index("investment_sip_confirmation_actor_household").on(table.actorUserId, table.householdId),
    check("investment_sip_confirmation_revision", sql`${table.expectedOccurrenceRevision}=0`),
    check("investment_sip_confirmation_version", sql`${table.requestVersion}=1`),
    check("investment_sip_confirmation_digest", sql`${table.requestDigest} ~ '^[0-9a-f]{64}$'`),
    check("investment_sip_confirmation_generation", sql`${table.securityGeneration}>=0`),
    check("investment_sip_confirmation_cardinality", sql`(${table.outcome}='unfilled' AND ${table.fillCount}=0) OR (${table.outcome} IN ('filled','partially_filled') AND ${table.fillCount} BETWEEN 1 AND 100)`),
    check("investment_sip_confirmation_reference", sql`${table.brokerReference} IS NULL OR (char_length(${table.brokerReference}) BETWEEN 1 AND 200 AND ${table.brokerReference} ~ '[^[:space:]]')`),
  ]);

  const investmentSipConfirmedFills = pgTable("investment_sip_confirmed_fills", {
    confirmationId: uuid("confirmation_id").notNull(),
    fillIndex: integer("fill_index").notNull(),
    purchaseId: uuid("purchase_id").notNull(),
    executionDate: date("execution_date").notNull(),
    quantity: decimal("quantity", { precision: 18, scale: 8 }).notNull(),
    price: decimal("price", { precision: 15, scale: 4 }).notNull(),
    fees: decimal("fees", { precision: 15, scale: 2 }).notNull(),
    amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
    creationXid: text("creation_xid").notNull(),
    postingConfirmed: boolean("posting_confirmed").notNull().default(false),
  }, table => [
    primaryKey({ name: "investment_sip_confirmed_fill_pk", columns: [table.confirmationId, table.fillIndex] }),
    unique("investment_sip_confirmed_fill_purchase").on(table.purchaseId),
    foreignKey({ name: "investment_sip_confirmed_fill_confirmation_fk", columns: [table.confirmationId],
      foreignColumns: [investmentSipConfirmations.id] }).onDelete("cascade"),
    // DEFERRABLE INITIALLY DEFERRED is supplied only by the reviewed SQL.
    foreignKey({ name: "investment_sip_confirmed_fill_purchase_fk", columns: [table.purchaseId],
      foreignColumns: [investmentTransactions.id] }).onDelete("cascade"),
    check("investment_sip_confirmed_fill_index", sql`${table.fillIndex} BETWEEN 0 AND 99`),
    check("investment_sip_confirmed_fill_date", sql`${table.executionDate} BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'`),
    check("investment_sip_confirmed_fill_quantity", sql`${table.quantity}>0 AND ${table.quantity}::text ~ '^[0-9]+[.][0-9]{8}$'`),
    check("investment_sip_confirmed_fill_price", sql`${table.price}>0 AND ${table.price}::text ~ '^[0-9]+[.][0-9]{4}$'`),
    check("investment_sip_confirmed_fill_fees", sql`${table.fees}>=0 AND ${table.fees}::text ~ '^[0-9]+[.][0-9]{2}$'`),
    check("investment_sip_confirmed_fill_amount", sql`${table.amount}>=0 AND ${table.amount}=round(${table.quantity}*${table.price},2)+${table.fees} AND ${table.amount}::text ~ '^[0-9]+[.][0-9]{2}$'`),
  ]);

  return { investmentSipOccurrenceFences, investmentSipOccurrences, investmentSipConfirmations, investmentSipConfirmedFills };
}
