/**
 * Right-to-erasure: identity traces outside the user row (R07.2, AH-08 DEL-02).
 *
 * Security events and the household audit history are retained (they are the
 * record of what happened), but they must not keep identifying the erased
 * person. Inside the erasure transaction:
 *
 * - security_audit_logs rows the user acted in lose IP and user agent, ip keys
 *   in details are dropped, their address becomes the tombstone address and any
 *   other address is redacted (never attributed to the tombstone);
 * - a row about the user (a security event targeting them, an audit row they
 *   acted in or that is about them, or the record of a household invitation
 *   they accepted, which may predate their account) gets the tombstone address
 *   in place of any of their addresses, whenever it was written;
 * - anyone else's row (another actor's, an anonymous failed login, a household
 *   invitation record) gets the tombstone in place of an address only if it was
 *   written while the user held that address (A-49, R3-2: an address can belong
 *   to someone else after a change; see settings.account-deletion.address-periods.ts).
 *   Nothing else in that row changes: that actor's IP, user agent and own
 *   address stay;
 * - "the address" means every address the user has had: the current one, the
 *   one they registered with, and each recipient of their security notices
 *   (an e-mail change notifies both the old and the new address);
 * - the user's own security-notice outbox rows are deleted (the security
 *   event is the record); other users keep their security notices and delivery
 *   recipients. Other outbox event types still get address pseudonymisation;
 * - an address only matches as a whole address: "xa@b.com" or "a@b.company"
 *   never match "a@b.com";
 * - the user's personal-data exports are deleted, and their files removed
 *   after commit.
 */
import { and, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { auditLogs, dataExports, householdInvitations, outboxEvents, securityAuditLogs } from "@shared/schema";
import { EventTypes } from "../../core/events/eventTypes";
import type { TransactionType } from "../../utils/withTransaction";
import { logger } from "../../utils/logger";
import { PERSONAL_EXPORT_TYPE } from "@shared/personal-data-export";
import { removePersonalExportFile } from "./settings.privacy-export.files";
import { addressPeriodsOf, type AddressPeriod } from "./settings.account-deletion.address-periods";

// Characters an address can hold inside JSON text: never a quote or backslash,
// so replacing a match keeps the JSON valid.
const EMAIL_PATTERN = "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}";
const REDACTED_EMAIL = "redacted@deleted.invalid";
const IP_DETAIL_KEYS = ["ipAddress", "ip", "userAgent", "requestIp"];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Any of the addresses as a whole address: no address character joined on either side. */
export function wholeAddressPattern(emails: string | readonly string[]): string {
  const alternatives = (typeof emails === "string" ? [emails] : emails).map(escapeRegex).join("|");
  return `(?<![A-Za-z0-9._%+-])(?:${alternatives})(?![A-Za-z0-9-]|\\.[A-Za-z0-9])`;
}

const ADDRESS_SHAPE = new RegExp(`^${EMAIL_PATTERN}$`);

/**
 * Every address the user is known to have had: the current one, the one they
 * registered with, and each recipient of their security notices (an e-mail
 * change notifies the old and the new address). Read before any rewrite.
 */
async function addressesOf(tx: TransactionType, userId: string, currentEmail: string): Promise<string[]> {
  const registered = await tx.select({ email: sql<string | null>`${securityAuditLogs.details}->>'email'` })
    .from(securityAuditLogs)
    .where(and(eq(securityAuditLogs.userId, userId), eq(securityAuditLogs.eventType, "REGISTER")));
  const notified = await tx.selectDistinct({ email: sql<string | null>`${outboxEvents.payload}->>'recipient'` })
    .from(outboxEvents)
    .where(and(eq(outboxEvents.eventType, EventTypes.SECURITY_NOTICE_REQUESTED),
      sql`${outboxEvents.payload}->>'userId' = ${userId}`));
  const candidates = [currentEmail, ...registered.map(row => row.email), ...notified.map(row => row.email)];
  const known = new Map<string, string>();
  for (const email of candidates) {
    if (typeof email === "string" && ADDRESS_SHAPE.test(email)) known.set(email.toLowerCase(), email);
  }
  return [...known.values()];
}

type Details = typeof auditLogs.details | typeof securityAuditLogs.details;
const mentions = (details: Details, pattern: string) => sql`${details}::text ~* ${pattern}`;
const replaceAddress = (text: SQL, pattern: string, replacement: string) =>
  sql`regexp_replace(${text}, ${pattern}, ${replacement}, 'gi')`;
/** Written inside the period; its bounds are database timestamp text. */
const heldAt = (createdAt: PgColumn, period: AddressPeriod) => period.to === null
  ? sql`${createdAt} >= cast(${period.from} as timestamp)`
  : sql`${createdAt} >= cast(${period.from} as timestamp) and ${createdAt} < cast(${period.to} as timestamp)`;
const notSubject = (column: PgColumn, userId: string) => sql`${column} is distinct from ${userId}`;
/** The household's record of an invitation the user accepted: about them, even if sent before they registered. */
const acceptedInvitationRow = (tx: TransactionType, userId: string) => and(
  eq(auditLogs.entityType, "household_invitation"),
  inArray(auditLogs.entityId, tx.select({ id: householdInvitations.id }).from(householdInvitations)
    .where(eq(householdInvitations.acceptedBy, userId))));

/** Swap the address in rows of other subjects written while the user held it. */
async function rewriteHeldAddress(tx: TransactionType, userId: string, period: AddressPeriod, tombstoneEmail: string) {
  const held = wholeAddressPattern(period.email);
  await tx.update(securityAuditLogs).set({
    details: sql`${replaceAddress(sql`${securityAuditLogs.details}::text`, held, tombstoneEmail)}::jsonb`,
  }).where(and(notSubject(securityAuditLogs.userId, userId), notSubject(securityAuditLogs.targetUserId, userId),
    heldAt(securityAuditLogs.createdAt, period), mentions(securityAuditLogs.details, held)));
  await tx.update(auditLogs).set({
    details: sql`${replaceAddress(sql`${auditLogs.details}::text`, held, tombstoneEmail)}::jsonb`,
  }).where(and(notSubject(auditLogs.userId, userId), notSubject(auditLogs.entityId, userId),
    heldAt(auditLogs.createdAt, period), mentions(auditLogs.details, held)));
  await tx.update(outboxEvents).set({
    payload: sql`${replaceAddress(sql`${outboxEvents.payload}::text`, held, tombstoneEmail)}::jsonb`,
  }).where(and(ne(outboxEvents.eventType, EventTypes.SECURITY_NOTICE_REQUESTED),
    sql`${outboxEvents.payload}->>'userId' is distinct from ${userId}`,
    heldAt(outboxEvents.createdAt, period), sql`${outboxEvents.payload}::text ~* ${held}`));
}

export async function pseudonymiseErasedIdentity(
  tx: TransactionType,
  userId: string,
  originalEmail: string,
  tombstoneEmail: string,
): Promise<void> {
  const pattern = wholeAddressPattern(await addressesOf(tx, userId, originalEmail));
  const periods = await addressPeriodsOf(tx, userId, originalEmail, email => ADDRESS_SHAPE.test(email));
  const details = securityAuditLogs.details;
  const withoutIpKeys = sql`case when jsonb_typeof(${details}) = 'object'
    then ${details} - ${sql.raw(`array[${IP_DETAIL_KEYS.map(key => `'${key}'`).join(",")}]`)} else ${details} end`;
  // (a) The erased user's own security events.
  const ownAddress = replaceAddress(sql`(${withoutIpKeys})::text`, pattern, tombstoneEmail);
  await tx.update(securityAuditLogs).set({
    ipAddress: null,
    userAgent: null,
    details: sql`case when ${details} is null then null
      else regexp_replace(${ownAddress}, ${`(?<![A-Za-z0-9._%+-])(?!${escapeRegex(tombstoneEmail)})${EMAIL_PATTERN}`}, ${REDACTED_EMAIL}, 'g')::jsonb end`,
  }).where(eq(securityAuditLogs.userId, userId));

  // (b) Rows about the user: any of their addresses, whenever written. Only rows
  // that name one change, so unrelated audit rows (and their dependency
  // triggers) are never touched.
  await tx.update(securityAuditLogs).set({
    details: sql`${replaceAddress(sql`${details}::text`, pattern, tombstoneEmail)}::jsonb`,
  }).where(and(notSubject(securityAuditLogs.userId, userId), eq(securityAuditLogs.targetUserId, userId), mentions(details, pattern)));
  await tx.update(auditLogs).set({
    details: sql`${replaceAddress(sql`${auditLogs.details}::text`, pattern, tombstoneEmail)}::jsonb`,
  }).where(and(or(eq(auditLogs.userId, userId), eq(auditLogs.entityId, userId), acceptedInvitationRow(tx, userId)),
    mentions(auditLogs.details, pattern)));

  // (c) Anyone else's rows: an address only while the user held it.
  for (const period of periods) await rewriteHeldAddress(tx, userId, period, tombstoneEmail);

  // The user's own security notices only deliver mail to them; the security
  // event above is the record. Deleting them also stops a pending delivery.
  // (Rewriting would collide: one e-mail change notifies two addresses, and the
  // notice identity is unique per recipient.)
  await tx.delete(outboxEvents).where(and(eq(outboxEvents.eventType, EventTypes.SECURITY_NOTICE_REQUESTED),
    sql`${outboxEvents.payload}->>'userId' = ${userId}`));
  // The notice subject fixes who owned the recipient at enqueue, including on
  // verified email changes. A reused address can now belong to another subject.
  // Other outbox event types about the user lose any of their addresses; the
  // rest are rewritten by period in (c).
  await tx.update(outboxEvents).set({
    payload: sql`${replaceAddress(sql`${outboxEvents.payload}::text`, pattern, tombstoneEmail)}::jsonb`,
  }).where(and(ne(outboxEvents.eventType, EventTypes.SECURITY_NOTICE_REQUESTED),
    sql`${outboxEvents.payload}->>'userId' = ${userId}`, sql`${outboxEvents.payload}::text ~* ${pattern}`));
}

/** Delete the user's personal-data export rows; returns ids whose files go after commit. */
export async function erasePersonalExports(tx: TransactionType, userId: string): Promise<string[]> {
  const removed = await tx.delete(dataExports)
    .where(and(eq(dataExports.userId, userId), eq(dataExports.exportType, PERSONAL_EXPORT_TYPE)))
    .returning({ id: dataExports.id });
  return removed.map(row => row.id);
}

/** Best effort after commit: a leftover file is logged, never an erasure failure. */
export async function removeErasedExportFiles(exportIds: readonly string[]): Promise<void> {
  for (const exportId of exportIds) {
    try {
      await removePersonalExportFile(exportId);
    } catch (error) {
      logger.error("Failed to remove an erased personal export file", { exportId },
        error instanceof Error ? error : new Error(String(error)));
    }
  }
}
