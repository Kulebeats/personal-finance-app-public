import { sql } from "drizzle-orm";
import { boolean, check, date, decimal, foreignKey, index, integer, pgTable,
  primaryKey, smallint, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

type SipSchemaDependencies = Pick<typeof schema, "households" | "users" |
  "recurringInvestments" | "investmentTransactions" | "recurringFrequencyEnum">;

/** Mapping for reviewed migration 0028. Instantiate/export its tables only through schema.ts.
 * Trigger functions, privileges and FK deferral timing remain migration-only. */
export function createSipAuthorizationSchema({ households, users, recurringInvestments,
  investmentTransactions, recurringFrequencyEnum }: SipSchemaDependencies) {
  const investmentPlanAuthorizations = pgTable("investment_plan_authorizations", {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id").notNull(),
    householdId: uuid("household_id").notNull(),
    authorUserId: uuid("author_user_id").notNull(),
    revision: integer("revision").notNull(),
    authorizationContractVersion: smallint("authorization_contract_version").notNull(),
    authorizationKind: text("authorization_kind").notNull(),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    securityGeneration: integer("security_generation").notNull(),
    // Immutable granted identifiers intentionally have no source-table FK.
    accountId: uuid("account_id").notNull(),
    securityId: uuid("security_id").notNull(),
    amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    frequency: recurringFrequencyEnum("frequency").notNull(),
    initialExecutionDate: date("initial_execution_date").notNull(),
    authorizedTermsDigest: varchar("authorized_terms_digest", { length: 64 }).notNull(),
  }, table => [
    foreignKey({ name: "investment_plan_authorizations_household_id_fkey",
      columns: [table.householdId], foreignColumns: [households.id] }).onDelete("cascade"),
    foreignKey({ name: "investment_plan_authorizations_author_user_id_fkey",
      columns: [table.authorUserId], foreignColumns: [users.id] }),
    foreignKey({ name: "investment_authorization_plan_fk",
      columns: [table.planId, table.householdId],
      foreignColumns: [recurringInvestments.id, recurringInvestments.householdId] }).onDelete("cascade"),
    unique("investment_authorization_revision").on(table.planId, table.revision),
    unique("investment_authorization_pointer_identity").on(table.id, table.planId, table.householdId, table.revision),
    unique("investment_authorization_operation_identity")
      .on(table.id, table.planId, table.householdId, table.authorUserId),
    index("investment_authorization_actor").on(table.authorUserId),
    check("investment_plan_authorizations_revision_check", sql`${table.revision} > 0`),
    // PostgreSQL-generated names use balanced identifier truncation at 63 bytes.
    check("investment_plan_authorizatio_authorization_contract_versi_check",
      sql`${table.authorizationContractVersion} = 1`),
    check("investment_plan_authorizations_authorization_kind_check", sql`${table.authorizationKind} = 'record_only_sip'`),
    check("investment_plan_authorizations_security_generation_check", sql`${table.securityGeneration} >= 0`),
    check("investment_plan_authorizations_amount_check", sql`${table.amount} > 0 AND ${table.amount}::text ~ '^[0-9]+[.][0-9]{2}$'`),
    check("investment_plan_authorizations_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("investment_plan_authorizations_authorized_terms_digest_check", sql`${table.authorizedTermsDigest} ~ '^[0-9a-f]{64}$'`),
  ]);

  const investmentPlanOperations = pgTable("investment_plan_operations", {
    householdId: uuid("household_id").notNull(),
    actorUserId: uuid("actor_user_id").notNull(),
    operationId: uuid("operation_id").notNull(),
    action: text("action").notNull(),
    requestVersion: smallint("request_version").notNull(),
    requestDigest: varchar("request_digest", { length: 64 }).notNull(),
    expectedRevision: integer("expected_revision").notNull(),
    planId: uuid("plan_id").notNull(),
    authorizationId: uuid("authorization_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }, table => [
    primaryKey({ name: "investment_plan_operation_identity",
      columns: [table.householdId, table.actorUserId, table.operationId] }),
    foreignKey({ name: "investment_plan_operations_household_id_fkey",
      columns: [table.householdId], foreignColumns: [households.id] }).onDelete("cascade"),
    foreignKey({ name: "investment_plan_operations_actor_user_id_fkey",
      columns: [table.actorUserId], foreignColumns: [users.id] }),
    foreignKey({ name: "investment_plan_operation_plan_fk", columns: [table.planId, table.householdId],
      foreignColumns: [recurringInvestments.id, recurringInvestments.householdId] }).onDelete("cascade"),
    foreignKey({ name: "investment_plan_operation_authorization_fk",
      columns: [table.authorizationId, table.planId, table.householdId, table.actorUserId],
      foreignColumns: [investmentPlanAuthorizations.id, investmentPlanAuthorizations.planId,
        investmentPlanAuthorizations.householdId, investmentPlanAuthorizations.authorUserId] }).onDelete("cascade"),
    index("investment_plan_operation_actor").on(table.actorUserId),
    check("investment_plan_operations_action_check", sql`${table.action} IN ('create', 'reconfirm')`),
    check("investment_plan_operations_request_version_check", sql`${table.requestVersion} = 1`),
    check("investment_plan_operations_request_digest_check", sql`${table.requestDigest} ~ '^[0-9a-f]{64}$'`),
    check("investment_plan_operations_expected_revision_check", sql`${table.expectedRevision} >= 0`),
    check("investment_plan_operation_create_revision", sql`${table.action} <> 'create' OR ${table.expectedRevision} = 0`),
  ]);

  // Exactly the seven owner-approved retained columns; no operational identity.
  const investmentPurchaseAuthorizationProofs = pgTable("investment_purchase_authorization_proofs", {
    purchaseId: uuid("purchase_id").primaryKey(),
    authorUserId: uuid("author_user_id").notNull(),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }).notNull(),
    authorizationContractVersion: smallint("authorization_contract_version").notNull(),
    authorizedFrequency: recurringFrequencyEnum("authorized_frequency").notNull(),
    authorizedInitialDate: date("authorized_initial_date").notNull(),
    authorizedTermsDigest: varchar("authorized_terms_digest", { length: 64 }).notNull(),
  }, table => [
    foreignKey({ name: "investment_purchase_authorization_proofs_purchase_id_fkey",
      columns: [table.purchaseId], foreignColumns: [investmentTransactions.id] }).onDelete("cascade"),
    foreignKey({ name: "investment_purchase_authorization_proofs_author_user_id_fkey",
      columns: [table.authorUserId], foreignColumns: [users.id] }),
    index("investment_purchase_proof_author").on(table.authorUserId),
    check("investment_purchase_authoriz_authorization_contract_versi_check", sql`${table.authorizationContractVersion} IN (1, 2)`),
    check("investment_purchase_authorization_authorized_terms_digest_check", sql`${table.authorizedTermsDigest} ~ '^[0-9a-f]{64}$'`),
  ]);

  const investmentSipPurchaseReservations = pgTable("investment_sip_purchase_reservations", {
    purchaseId: uuid("purchase_id").primaryKey(),
    authorizationId: uuid("authorization_id").notNull(),
    // SQL's INSERT trigger supplies/overwrites this; there is no column default.
    creationXid: text("creation_xid").notNull(),
    postingConfirmed: boolean("posting_confirmed").notNull().default(false),
  }, table => [
    foreignKey({ name: "investment_sip_purchase_reservations_authorization_id_fkey",
      columns: [table.authorizationId], foreignColumns: [investmentPlanAuthorizations.id] }).onDelete("cascade"),
    // Drizzle cannot express DEFERRABLE INITIALLY DEFERRED; preserve it in migration 0028.
    foreignKey({ name: "investment_sip_reservation_purchase_fk",
      columns: [table.purchaseId], foreignColumns: [investmentTransactions.id] }).onDelete("cascade"),
    index("investment_sip_reservation_authorization").on(table.authorizationId),
  ]);

  return { investmentPlanAuthorizations, investmentPlanOperations,
    investmentPurchaseAuthorizationProofs, investmentSipPurchaseReservations };
}
