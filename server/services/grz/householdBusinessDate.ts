import { sql } from "drizzle-orm";
import type { TransactionType } from "../../utils/withTransaction";
import { HouseholdCalendarUnavailable } from "../householdCalendarToday";

/** Caller holds the household policy stable until the financial transaction commits. */
export async function grzHouseholdBusinessDate(tx: TransactionType, householdId: string): Promise<string> {
  const { rows: [row] } = await tx.execute<{ date: string | null }>(sql`
    select to_char(public.grz_household_business_date(${householdId}::uuid), 'YYYY-MM-DD') as date`);
  if (!row?.date) throw new HouseholdCalendarUnavailable();
  return row.date;
}
