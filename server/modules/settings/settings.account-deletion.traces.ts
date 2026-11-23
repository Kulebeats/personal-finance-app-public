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
 *   in place of each of their addresses, whenever it was written, except where
 *   another account held that address, and the user did not, when the row was
 *   written (A-49 P2-3: A's later invitation to B at an address A left names
 *   B, not A; a case-variant sign-up while A holds it does not count);
 * - the household_invitations rows the user accepted take the tombstone
 *   address, first, before any audit row is locked; invitations they sent, and
 *   unaccepted ones, stay;
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
import { addressPeriodsOf, foreignPeriodsOf, type AddressPeriod } from "./settings.account-deletion.address-periods";

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

/** An address, and when a match of it becomes the tombstone. */
type AddressRule = { readonly pattern: string; readonly when: SQL };
// regexp_replace's "the whole match": a rule whose condition fails leaves the match as it was.
const KEEP_MATCH = "\\&";
/** One regexp_replace per rule, chained, so the SQL grows linearly with the rules. */
const swapAddresses = (text: SQL, rules: readonly AddressRule[], tombstoneEmail: string) => rules.reduce<SQL>(
  (current, rule) => sql`regexp_replace(${current}, ${rule.pattern}, case when ${rule.when} then ${tombstoneEmail} else ${KEEP_MATCH} end, 'gi')`,
  text);
const anyOf = (conditions: readonly SQL[]) => conditions.length === 0 ? sql`false`
  : sql`(${sql.join(conditions.map(condition => sql`(${condition})`), sql` or `)})`;
/** The user's and the other accounts' periods of each address, by lowercased address. */
type Holdings = { readonly own: readonly AddressPeriod[]; readonly foreign: readonly AddressPeriod[] };
const heldWithin = (periods: readonly AddressPeriod[], email: string, createdAt: PgColumn) =>
  anyOf(periods.filter(period => period.email.toLowerCase() === email.toLowerCase()).map(period => heldAt(createdAt, period)));
/**
 * The user's addresses in rows about them, except where another account held
 * that address when the row was written and the user did not. While the user
 * held it, it is theirs, even if another account registered it in another case.
 */
const ownRules = (addresses: readonly string[], holdings: Holdings, createdAt: PgColumn, alsoWhen?: SQL) =>
  addresses.map((email): AddressRule => {
    const ours = sql`${heldWithin(holdings.own, email, createdAt)} or not ${heldWithin(holdings.foreign, email, createdAt)}`;
    return { pattern: wholeAddressPattern(email), when: alsoWhen ? sql`(${alsoWhen}) or ${ours}` : ours };
  });
/** Each period's address, only in rows written inside that period. */
const heldRules = (periods: readonly AddressPeriod[], createdAt: PgColumn) =>
  periods.map((period): AddressRule => ({ pattern: wholeAddressPattern(period.email), when: heldAt(createdAt, period) }));
const mentionedWhileHeld = (text: SQL, rules: readonly AddressRule[]) =>
  anyOf(rules.map(rule => sql`${rule.when} and ${text} ~* ${rule.pattern}`));

/** Swap the address in rows of other subjects written while the user held it: one scan per table. */
async function rewriteHeldAddresses(tx: TransactionType, userId: string, periods: readonly AddressPeriod[], tombstoneEmail: string) {
  if (periods.length === 0) return;
  const security = heldRules(periods, securityAuditLogs.createdAt);
  const securityText = sql`${securityAuditLogs.details}::text`;
  await tx.update(securityAuditLogs).set({ details: sql`${swapAddresses(securityText, security, tombstoneEmail)}::jsonb` })
    .where(and(notSubject(securityAuditLogs.userId, userId), notSubject(securityAuditLogs.targetUserId, userId),
      mentionedWhileHeld(securityText, security)));
  const audit = heldRules(periods, auditLogs.createdAt);
  const auditText = sql`${auditLogs.details}::text`;
  await tx.update(auditLogs).set({ details: sql`${swapAddresses(auditText, audit, tombstoneEmail)}::jsonb` })
    .where(and(notSubject(auditLogs.userId, userId), notSubject(auditLogs.entityId, userId), mentionedWhileHeld(auditText, audit)));
  const outbox = heldRules(periods, outboxEvents.createdAt);
  const outboxText = sql`${outboxEvents.payload}::text`;
  await tx.update(outboxEvents).set({ payload: sql`${swapAddresses(outboxText, outbox, tombstoneEmail)}::jsonb` })
    .where(and(ne(outboxEvents.eventType, EventTypes.SECURITY_NOTICE_REQUESTED),
      sql`${outboxEvents.payload}->>'userId' is distinct from ${userId}`, mentionedWhileHeld(outboxText, outbox)));
}

export async function pseudonymiseErasedIdentity(
  tx: TransactionType,
  userId: string,
  originalEmail: string,
  tombstoneEmail: string,
): Promise<void> {
  const isAddress = (email: string) => ADDRESS_SHAPE.test(email);
  const addresses = await addressesOf(tx, userId, originalEmail);
  const pattern = wholeAddressPattern(addresses);
  const periods = await addressPeriodsOf(tx, userId, originalEmail, isAddress);
  const holdings: Holdings = { own: periods, foreign: await foreignPeriodsOf(tx, userId, addresses, isAddress) };
  // The invitation rows the user accepted hold their address, in a household
  // that may outlive them. Invitations they sent hold other people's. Locked
  // before any audit row: erasing a household's last owner deletes its
  // invitations first, then (by cascade) their audit rows, so the reverse order
  // here would deadlock against it.
  await tx.update(householdInvitations).set({ email: tombstoneEmail }).where(eq(householdInvitations.acceptedBy, userId));
  const details = securityAuditLogs.details;
  const withoutIpKeys = sql`case when jsonb_typeof(${details}) = 'object'
    then ${details} - ${sql.raw(`array[${IP_DETAIL_KEYS.map(key => `'${key}'`).join(",")}]`)} else ${details} end`;
  // (a) The erased user's own security events. Another account's address in
  // them (held by that account when the row was written) is redacted below,
  // never attributed to the tombstone.
  const ownAddress = swapAddresses(sql`(${withoutIpKeys})::text`,
    ownRules(addresses, holdings, securityAuditLogs.createdAt), tombstoneEmail);
  await tx.update(securityAuditLogs).set({
    ipAddress: null,
    userAgent: null,
    details: sql`case when ${details} is null then null
      else regexp_replace(${ownAddress}, ${`(?<![A-Za-z0-9._%+-])(?!${escapeRegex(tombstoneEmail)})${EMAIL_PATTERN}`}, ${REDACTED_EMAIL}, 'g')::jsonb end`,
  }).where(eq(securityAuditLogs.userId, userId));

  // (b) Rows about the user lose each of their addresses, whenever written,
  // unless another account held that address then. An invitation the user
  // accepted was addressed to them, so its records always lose the address.
  // Only rows that name one change, so unrelated audit rows (and their
  // dependency triggers) are never touched.
  await tx.update(securityAuditLogs).set({
    details: sql`${swapAddresses(sql`${details}::text`, ownRules(addresses, holdings, securityAuditLogs.createdAt), tombstoneEmail)}::jsonb`,
  }).where(and(notSubject(securityAuditLogs.userId, userId), eq(securityAuditLogs.targetUserId, userId), mentions(details, pattern)));
  const accepted = acceptedInvitationRow(tx, userId);
  await tx.update(auditLogs).set({
    details: sql`${swapAddresses(sql`${auditLogs.details}::text`, ownRules(addresses, holdings, auditLogs.createdAt, accepted), tombstoneEmail)}::jsonb`,
  }).where(and(or(eq(auditLogs.userId, userId), eq(auditLogs.entityId, userId), accepted),
    mentions(auditLogs.details, pattern)));

  // (c) Rows of other subjects: an address only while the user held it.
  await rewriteHeldAddresses(tx, userId, periods, tombstoneEmail);

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
    payload: sql`${swapAddresses(sql`${outboxEvents.payload}::text`, ownRules(addresses, holdings, outboxEvents.createdAt), tombstoneEmail)}::jsonb`,
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
