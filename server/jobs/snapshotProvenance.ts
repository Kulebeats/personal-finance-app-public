import { randomUUID } from "node:crypto";
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { accountWorthCaptureGenerations, accounts, grzBonds, grzTBills, holdings, netWorthSnapshots, pensionHoldings } from "@shared/schema";
import type { TransactionType } from "../utils/withTransaction";

export interface SnapshotContribution {
  accountId: string;
  kind: "asset" | "liability";
  accountType: string;
  baseAmount: string;
  sourceCurrency: string | null;
  baseCurrency: string;
  fx: "same_currency" | "unproven";
}
export interface SnapshotInventory { holdings: number; tbills: number; pensions: number; bonds: number }

const SCHEDULED_SNAPSHOT_JOB = "snapshots.daily";
const CAPTURE_ID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

/** Only the scheduled worker can supply this marker after valuation succeeds. */
export function scheduledSnapshotReceipt(householdId: string, date: string, captureId: string) {
  return { version: 1, job: SCHEDULED_SNAPSHOT_JOB, householdId: householdId.toLowerCase(), date, captureId };
}

type ScheduledSnapshotReceipt = ReturnType<typeof scheduledSnapshotReceipt>;

export async function readScheduledSnapshotReceipt(tx: TransactionType, householdId: string, date: string) {
  const { provenance } = netWorthSnapshots;
  const marker = sql`(${provenance}->'scheduledCapture')`;
  const slotCaptureId = sql`(${marker}->>'captureId')`;
  const aggregateCaptureId = sql`(${provenance}->>'captureId')`;
  const hasGeneration = (captureId: SQL) => sql`exists (
    select 1 from ${accountWorthCaptureGenerations} where ${accountWorthCaptureGenerations.captureId} =
      case when ${captureId} ~ ${CAPTURE_ID_PATTERN} then ${captureId}::uuid end
  )`;
  // A manual recapture can advance the aggregate and native receipt while the
  // preceding scheduled generation still attests the completed slot.
  const [completed] = await tx.select({ receipt: sql<ScheduledSnapshotReceipt>`${marker}` }).from(netWorthSnapshots)
    .where(and(eq(netWorthSnapshots.householdId, householdId), eq(netWorthSnapshots.date, date),
      sql`${marker} = jsonb_build_object('version', 1, 'job', ${SCHEDULED_SNAPSHOT_JOB}::text,
        'householdId', ${netWorthSnapshots.householdId}::text, 'date', ${date}::text, 'captureId', ${slotCaptureId})`,
      hasGeneration(slotCaptureId), hasGeneration(aggregateCaptureId)))
    .limit(1);
  return completed?.receipt;
}

/** Count interests independently of their value, including unattributed/foreign references. */
export async function readSnapshotInventory(tx: TransactionType, householdId: string): Promise<SnapshotInventory> {
  const householdAccounts = tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.householdId, householdId));
  const [positions] = await tx.select({ count: sql<number>`count(*)::int` }).from(holdings)
    .where(or(eq(holdings.householdId, householdId), inArray(holdings.accountId, householdAccounts)));
  const [bills] = await tx.select({ count: sql<number>`count(*)::int` }).from(grzTBills)
    .where(or(eq(grzTBills.householdId, householdId), inArray(grzTBills.accountId, householdAccounts)));
  const [pensions] = await tx.select({ count: sql<number>`count(*)::int` }).from(pensionHoldings)
    .where(or(eq(pensionHoldings.householdId, householdId), inArray(pensionHoldings.accountId, householdAccounts)));
  const [bonds] = await tx.select({ count: sql<number>`count(*)::int` }).from(grzBonds)
    .where(or(eq(grzBonds.householdId, householdId), inArray(grzBonds.accountId, householdAccounts)));
  return { holdings: positions.count, tbills: bills.count, pensions: pensions.count, bonds: bonds.count };
}

export function createSnapshotProvenance(
  householdId: string, date: string, currency: string, inventory: SnapshotInventory,
  contributions: SnapshotContribution[], omittedEligibleAccounts: number,
  captureId = randomUUID(),
) {
  const investmentsAbsent = Object.values(inventory).every(count => count === 0);
  return {
    version: 1,
    captureId,
    householdId: householdId.toLowerCase(), date, currency,
    coverage: investmentsAbsent && omittedEligibleAccounts === 0 && contributions.every(item => item.fx === "same_currency")
      ? "complete" : "unavailable",
    investmentsAbsent, investmentInventory: inventory, omittedEligibleAccounts, contributions,
  };
}
