import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { accountWorthCaptures, type AccountWorthCaptureEvidence, type AccountWorthCaptureRecord } from "@shared/schema";
import type { db } from "../db";
import { CalculationError, type CalculationErrorCode } from "../core/calculations/errors";
import { getPostgresError } from "../utils/postgresError";

type CaptureTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Branded observed-data failure; arbitrary calculation/programming errors do
 * not authorize committing a receipt after an unsuccessful legacy valuation. */
export class SnapshotFinancialUnavailable extends CalculationError {
  constructor(code: CalculationErrorCode) { super(code); }
}

export function expectedSnapshotFinancialFailure(error: unknown): error is CalculationError {
  if (!(error instanceof CalculationError) || getPostgresError(error) || error.context.cause ||
      ("cause" in error && error.cause)) return false;
  return error.code === "MISSING_FX_RATE" || error instanceof SnapshotFinancialUnavailable;
}

/** Independent native facts are read before any account/portfolio conversion.
 * The 0019 function and write guard attest the same complete DB snapshot. */
export async function readNativeAccountCapture(tx: CaptureTransaction, householdId: string) {
  const result = await tx.execute<{ householdId: string; date: string; capturedAt: string; currency: string | null; accounts: unknown }>(sql`
    select id::text as "householdId", to_char(transaction_timestamp() at time zone 'UTC', 'YYYY-MM-DD') as date,
      to_char(date_trunc('milliseconds', transaction_timestamp()) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "capturedAt",
      case when currency ~ '^[A-Z]{3}$' then currency else null end as currency,
      public.r04_account_capture_records(${householdId}::uuid) as accounts
    from households where id = ${householdId}::uuid`);
  const observed = result.rows[0];
  if (!observed || !Array.isArray(observed.accounts)) throw new Error("Account capture observation contract is unavailable");
  const { date } = observed;
  const capturedAt = new Date(observed.capturedAt);
  if (!Number.isFinite(capturedAt.getTime()) || capturedAt.toISOString() !== observed.capturedAt || observed.capturedAt.slice(0, 10) !== date)
    throw new Error("Account capture database clock contract is unavailable");
  const captureId = randomUUID();
  // This array comes only from the canonical SQL builder; the 0019 guard checks
  // its exact current snapshot again when the receipt is written.
  const evidence: AccountWorthCaptureEvidence = { version: 1, captureId, householdId: observed.householdId, date,
    currency: observed.currency, capturedAt: capturedAt.toISOString(), inventoryComplete: true,
    capturedAccountCount: observed.accounts.length, accounts: observed.accounts as AccountWorthCaptureRecord[] };
  return { householdId: observed.householdId, date, captureId, capturedAt, currency: observed.currency, evidence };
}

/** Write last: legacy and individual snapshot writes precede this fresh receipt.
 * A guard rejection is an implementation failure, never a successful snapshot. */
export async function persistNativeAccountCapture(tx: CaptureTransaction, capture: Awaited<ReturnType<typeof readNativeAccountCapture>>) {
  // Valuation has finished. A changed row now forces the SERIALIZABLE worker
  // to retry from fresh native facts. A later edit waits for this receipt.
  await tx.execute(sql`SELECT id FROM accounts WHERE household_id=${capture.householdId} ORDER BY id FOR SHARE`);
  const [stored] = await tx.insert(accountWorthCaptures).values(capture).onConflictDoUpdate({
    target: [accountWorthCaptures.householdId, accountWorthCaptures.date],
    set: { captureId: capture.captureId, capturedAt: capture.capturedAt, currency: capture.currency,
      evidence: capture.evidence, updatedAt: sql`now()` },
  }).returning({ evidence: accountWorthCaptures.evidence });
  if (!stored?.evidence) throw new Error("Account capture receipt was rejected by its guard");
}
