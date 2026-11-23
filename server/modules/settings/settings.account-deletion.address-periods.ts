/**
 * Right-to-erasure: when the erased user held each address (A-49, R3-2).
 *
 * An address is not a subject: after a change it can belong to someone else.
 * Rows of other subjects that name an address are rewritten only if they were
 * written while the erased user held it. The periods come from:
 *   - the start: the account's creation (or its REGISTER row, if earlier), with
 *     the registered address;
 *   - each EMAIL_CHANGED event of the user, which ends one period and starts the
 *     next. The event row holds no address, but its notices do: they go to the
 *     old address (when it was verified) and always to the new one;
 *   - the end: the current address, held until erasure.
 * A period whose address cannot be proved from these rows is left out, so no
 * row is rewritten on a guess. Bounds are read back and compared as database
 * timestamp text, with no time-zone conversion in JavaScript. The change time
 * itself is the app clock's (security-notice.ts sets createdAt), while most
 * other rows take the database's now(): a row written within that clock skew
 * of a change can fall on either side of it.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { outboxEvents, securityAuditLogs, users } from "@shared/schema";
import { EventTypes } from "../../core/events/eventTypes";
import type { TransactionType } from "../../utils/withTransaction";

export interface AddressPeriod {
  readonly email: string;
  /** Inclusive start, as Postgres timestamp text. */
  readonly from: string;
  /** Exclusive end, as Postgres timestamp text; null while held at erasure. */
  readonly to: string | null;
}

type Change = { readonly at: string; readonly recipients: ReadonlySet<string> };
const lower = (email: string) => email.toLowerCase();

/** The one recipient that is not `known`, or undefined when that is not provable. */
function otherRecipient(recipients: ReadonlySet<string>, known: string | undefined): string | undefined {
  if (known === undefined) return undefined;
  const others = [...recipients].filter(email => email !== lower(known));
  return others.length === 1 ? others[0] : undefined;
}

/** Address held in each span between changes, oriented forward from registration and back from now. */
export function orientAddresses(
  registered: string | undefined, changes: readonly Change[], current: string,
): (string | undefined)[] {
  const held: (string | undefined)[] = [registered, ...changes.map(() => undefined)];
  held[changes.length] = current;
  changes.forEach((change, index) => {
    if (held[index + 1] !== undefined) return;
    // The new address is always notified; a single recipient is the new address.
    held[index + 1] = change.recipients.size === 1 ? [...change.recipients][0] : otherRecipient(change.recipients, held[index]);
  });
  for (let index = changes.length - 1; index >= 0; index--) {
    if (held[index] === undefined) held[index] = otherRecipient(changes[index].recipients, held[index + 1]);
  }
  return held;
}

async function startOf(tx: TransactionType, userId: string): Promise<{ at: string; registered?: string }> {
  const [user] = await tx.select({ at: sql<string | null>`${users.createdAt}::text` }).from(users).where(eq(users.id, userId));
  const [register] = await tx.select({
    at: sql<string>`${securityAuditLogs.createdAt}::text`, email: sql<string | null>`${securityAuditLogs.details}->>'email'`,
  }).from(securityAuditLogs)
    .where(and(eq(securityAuditLogs.userId, userId), eq(securityAuditLogs.eventType, "REGISTER")))
    .orderBy(asc(securityAuditLogs.createdAt)).limit(1);
  const starts = [user?.at, register?.at].filter((at): at is string => typeof at === "string").sort();
  return { at: starts[0] ?? "-infinity", registered: register?.email ?? undefined };
}

async function changesOf(tx: TransactionType, userId: string): Promise<Change[]> {
  const events = await tx.select({ id: securityAuditLogs.id, at: sql<string>`${securityAuditLogs.createdAt}::text` })
    .from(securityAuditLogs)
    .where(and(eq(securityAuditLogs.userId, userId), eq(securityAuditLogs.eventType, "EMAIL_CHANGED")))
    .orderBy(asc(securityAuditLogs.createdAt), asc(securityAuditLogs.id));
  if (events.length === 0) return [];
  const notices = await tx.select({ eventId: outboxEvents.aggregateId, recipient: sql<string | null>`${outboxEvents.payload}->>'recipient'` })
    .from(outboxEvents)
    .where(and(eq(outboxEvents.eventType, EventTypes.SECURITY_NOTICE_REQUESTED),
      sql`${outboxEvents.payload}->>'userId' = ${userId}`, inArray(outboxEvents.aggregateId, events.map(event => event.id))));
  return events.map(event => ({
    at: event.at,
    recipients: new Set(notices.filter(notice => notice.eventId === event.id && typeof notice.recipient === "string")
      .map(notice => lower(notice.recipient!))),
  }));
}

/** The provable periods in which `userId` held each address. Read before any rewrite. */
export async function addressPeriodsOf(
  tx: TransactionType, userId: string, currentEmail: string, isAddress: (email: string) => boolean,
): Promise<AddressPeriod[]> {
  const start = await startOf(tx, userId);
  const changes = await changesOf(tx, userId);
  const registered = start.registered && isAddress(start.registered) ? start.registered : undefined;
  const held = orientAddresses(registered, changes, currentEmail);
  const bounds = [start.at, ...changes.map(change => change.at)];
  return held.flatMap((email, index): AddressPeriod[] => email && isAddress(email)
    ? [{ email, from: bounds[index], to: index < changes.length ? changes[index].at : null }]
    : []);
}
