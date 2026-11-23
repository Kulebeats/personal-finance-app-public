import { and, eq, sql } from "drizzle-orm";
import { householdMembers, households } from "@shared/schema";
import { householdCalendarDate, normalizeHouseholdTimeZone } from "@shared/household-calendar";
import type { SipOccurrenceConfirmation } from "@shared/sip-occurrence-contract";
import { ForbiddenError, NotFoundError, ValidationError } from "../../core/errors";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { lockInvestmentWriterIdentity, type InvestmentSourceSession } from "../../modules/investments/investmentTransactionAccess";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { businessAuditService } from "../BusinessAuditService";
import { lockSipPlanReader, requireSignedSipSession } from "./sipPlanAccess";
import { safeSipOccurrenceError, SipOccurrenceUnavailable } from "./sipOccurrenceErrors";
import type { SipOccurrenceReceipt } from "./sipOccurrenceRead";

function invalidZone(): ValidationError {
  return new ValidationError("Invalid household calendar", [{
    field: "timeZone", message: "Select a supported named household time zone.",
  }]);
}

/** Verify both runtimes against one database instant, never an actor/host zone. */
async function supportedZone(tx: TransactionType, input: unknown, compareRuntimeDate = true): Promise<string> {
  let zone: string;
  try {
    zone = normalizeHouseholdTimeZone(input);
  } catch {
    throw invalidZone();
  }
  const supported = await tx.execute(sql`SELECT name FROM pg_catalog.pg_timezone_names WHERE name=${zone}`);
  if (supported.rows.length !== 1) throw invalidZone();
  if (!compareRuntimeDate) return zone;
  // Raw drizzle results return timestamptz as text, so read the instant as a UTC
  // ISO string. JS keeps milliseconds, and truncating never crosses a midnight.
  const sample = await tx.execute<{ instant_iso: string; calendar_date: string }>(sql`
    WITH stamp AS MATERIALIZED (SELECT clock_timestamp() AS instant)
    SELECT to_char(instant AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS instant_iso,
      (instant AT TIME ZONE ${zone})::date::text AS calendar_date FROM stamp`);
  const instant = sample.rows[0];
  if (!instant || householdCalendarDate(new Date(instant.instant_iso), zone) !== instant.calendar_date) throw invalidZone();
  return zone;
}

function response(timeZone: string | null, role: string) {
  return { timeZone, configured: timeZone !== null,
    permittedActions: role === "owner" ? ["configure" as const] : [] };
}

export async function getSipOccurrenceCalendar(caller: HouseholdContext, session: InvestmentSourceSession) {
  try {
    return await withTransaction(async tx => {
      const actor = await lockSipPlanReader(tx, caller, session);
      const [household] = await tx.select({ timeZone: households.timeZone }).from(households)
        .where(eq(households.id, actor.householdId));
      if (!household) throw new NotFoundError("Household");
      if (household.timeZone === null) return response(null, actor.role);
      try {
        return response(await supportedZone(tx, household.timeZone), actor.role);
      } catch (error) {
        // Invalid stored policy exposes the current owner's recovery action.
        // GET never replaces it; database/transport failures remain failures.
        if (error instanceof ValidationError) return response(null, actor.role);
        throw error;
      }
    });
  } catch (error) {
    throw safeSipOccurrenceError(error);
  }
}

export async function setSipOccurrenceCalendar(input: unknown, caller: HouseholdContext, session: InvestmentSourceSession) {
  try {
    requireSignedSipSession(caller, session);
    return await withTransaction(async tx => {
      // Owner policy mutation starts at household UPDATE before member/user/SID.
      // Same-value calls still pass every current authority check below.
      const [household] = await tx.select({ timeZone: households.timeZone }).from(households)
        .where(eq(households.id, caller.householdId)).for("update");
      if (!household) throw new NotFoundError("Household");
      const [member] = await tx.select({ role: householdMembers.role }).from(householdMembers).where(and(
        eq(householdMembers.householdId, caller.householdId), eq(householdMembers.userId, caller.userId),
      )).for("share");
      if (member?.role !== "owner") throw new ForbiddenError("Household owner permission is required");
      const actor = await lockInvestmentWriterIdentity(tx, caller, session);
      const zone = await supportedZone(tx, input);
      if (household.timeZone === zone) return response(zone, actor.role);
      await tx.update(households).set({ timeZone: zone }).where(eq(households.id, actor.householdId));
      await businessAuditService.log({
        tx, userId: actor.userId, householdId: actor.householdId, action: "UPDATE",
        entityType: "household_preferences", entityId: actor.householdId,
        details: { oldValue: { timeZone: household.timeZone }, newValue: { timeZone: zone } },
      });
      return response(zone, actor.role);
    });
  } catch (error) {
    throw safeSipOccurrenceError(error);
  }
}

/** Caller already holds household SHARE via current signed writer admission. */
export async function requireSipOccurrenceCalendar(tx: TransactionType, householdId: string): Promise<string> {
  const [household] = await tx.select({ timeZone: households.timeZone }).from(households).where(eq(households.id, householdId));
  if (!household?.timeZone) throw new SipOccurrenceUnavailable("HOUSEHOLD_CALENDAR_REQUIRED");
  try {
    // Fresh confirmation checks runtime day agreement using its actual forced
    // receipt timestamp below; do not capture another confirmation clock here.
    return await supportedZone(tx, household.timeZone, false);
  } catch (error) {
    if (error instanceof ValidationError) throw new SipOccurrenceUnavailable("HOUSEHOLD_CALENDAR_REQUIRED");
    throw error;
  }
}

/** The BEFORE INSERT trigger alone supplies timestamp/cutoff. Verify agreement
 * for that same instant, then reject every future fill before reserving a BUY. */
export function assertSipOccurrenceCutoff(receipt: SipOccurrenceReceipt, zone: string,
  command: SipOccurrenceConfirmation): void {
  if (householdCalendarDate(receipt.authorizedAt, zone) !== receipt.confirmationCutoffDate) {
    throw new SipOccurrenceUnavailable("HOUSEHOLD_CALENDAR_REQUIRED");
  }
  const fields = command.fills.flatMap((fill, index) => fill.executionDate > receipt.confirmationCutoffDate
    ? [{ field: `fills.${index}.executionDate`, message: "Execution date must not be after the household confirmation date." }]
    : []);
  if (fields.length) throw new ValidationError("Invalid occurrence execution date", fields);
}
