import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { accounts, auditLogs, transactions } from "@shared/schema";
import { NotFoundError } from "../../core/errors";
import { visibleAccountPredicate, visibleTransactionPredicate } from "../../core/authz/transaction-visibility";
import type { HouseholdContext } from "../../middleware/householdGuard";
import type { TransactionType } from "../../utils/withTransaction";

type Audit = typeof auditLogs.$inferSelect;
export interface HoldingDeletionAudits { origins: Audit[]; activity: Audit[] }
const uuid = z.string().uuid();
const ids = (values: string[]) => Array.from(new Set(values)).sort();
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Source rows can be lost or rebound while their actual committed posting
 * audits retain the immutable holding UUID. Audience/actor are deliberately
 * not filters for this internal, source-authorized destructive-write guard. */
export async function readHoldingDeletionAudits(tx: TransactionType, holdingId: string): Promise<HoldingDeletionAudits> {
  const rows = await tx.select().from(auditLogs).where(or(
    and(eq(auditLogs.entityType, "holding"), eq(auditLogs.entityId, holdingId)),
    and(eq(auditLogs.entityType, "investment_transaction"), sql`(lower(${auditLogs.details}->'newValue'->>'holdingId')=${holdingId}
      OR lower(${auditLogs.details}->'oldValue'->>'holdingId')=${holdingId})`),
  )).orderBy(auditLogs.id);
  return { origins: rows.filter(row => row.entityType === "holding"), activity: rows.filter(row => row.entityType === "investment_transaction") };
}

/** Audit existence is not permission to disclose prior posting history.
 * Reauthorize surviving original source identities before any history409.
 * Existing producers omit cash links; only an explicitly retained link can
 * supply one, and no price/date/currency/source is invented from the audit. */
export async function lockAuditedHoldingSources(tx: TransactionType, frame: HoldingDeletionAudits, actor: HouseholdContext, holdingId: string) {
  const accountIds: string[] = [], cashIds: string[] = [];
  let unknown = false;
  for (const row of [...frame.origins, ...frame.activity]) {
    const details = object(row.details), values = [object(details?.newValue), object(details?.oldValue)].filter((value): value is Record<string, unknown> => value !== null);
    const relevant = row.entityType === "holding" ? values : values.filter(value => typeof value.holdingId === "string" && value.holdingId.toLowerCase() === holdingId);
    if (!relevant.length) unknown = true;
    for (const value of relevant) {
      if (typeof value.accountId === "string" && uuid.safeParse(value.accountId).success) accountIds.push(value.accountId.toLowerCase());
      else unknown = true;
      if (value.linkedTransactionId !== null && value.linkedTransactionId !== undefined) {
        if (typeof value.linkedTransactionId === "string" && uuid.safeParse(value.linkedTransactionId).success) cashIds.push(value.linkedTransactionId.toLowerCase());
        else unknown = true;
      }
    }
  }
  const uniqueCashIds = ids(cashIds);
  const cash = await tx.select({ id: transactions.id, accountId: transactions.accountId }).from(transactions).where(and(
    inArray(transactions.id, uniqueCashIds), visibleTransactionPredicate(actor),
  ));
  if (cash.length !== uniqueCashIds.length) throw new NotFoundError("Holding");
  const uniqueAccountIds = ids([...accountIds, ...cash.map(row => row.accountId)]);
  const visibleAccounts = await tx.select({ id: accounts.id }).from(accounts).where(and(
    inArray(accounts.id, uniqueAccountIds), visibleAccountPredicate(actor),
  ));
  if (visibleAccounts.length !== uniqueAccountIds.length) throw new NotFoundError("Holding");
  const lockedAccounts = await tx.select({ id: accounts.id }).from(accounts).where(and(
    inArray(accounts.id, uniqueAccountIds), visibleAccountPredicate(actor),
  )).orderBy(accounts.id).for("share", { noWait: true });
  if (lockedAccounts.length !== uniqueAccountIds.length) throw new NotFoundError("Holding");
  const lockedCash = await tx.select({ id: transactions.id }).from(transactions).where(and(
    inArray(transactions.id, uniqueCashIds), visibleTransactionPredicate(actor),
  )).orderBy(transactions.id).for("share", { noWait: true });
  if (lockedCash.length !== uniqueCashIds.length) throw new NotFoundError("Holding");
  // Missing legacy audit source IDs are an integrity conflict, but not a
  // reason to skip the caller's remaining current-source privacy checks.
  return unknown;
}
