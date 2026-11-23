import { inArray, sql, type SQL } from "drizzle-orm";
import { grzTBills, type GrzTBill } from "@shared/schema";

/**
 * A-36: the T-bill states that are still a holding in net worth. A bill
 * awaiting receipt has matured but its principal has not yet returned as cash.
 */
export const HELD_TBILL_STATUSES = ["active", "awaiting_receipt"] as const;

export const heldTBillPredicate = (): SQL => inArray(grzTBills.status, [...HELD_TBILL_STATUSES]);

/**
 * A held bill's carrying value: its face value while active, and once due the
 * booked proceeds (face less withholding), which the confirmed receipt then
 * moves to cash unchanged. Every net-worth reader uses this one definition.
 * A due bill without booked proceeds has no carrying value: null, which every
 * reader treats as unavailable, never as zero or as face.
 */
export const tbillCarryingValueSql = sql<string | null>`(case when ${grzTBills.status}='awaiting_receipt'
  then ${grzTBills.maturityNetProceeds} else ${grzTBills.faceValue} end)::text`;

export function tbillCarryingValue(bill: Pick<GrzTBill, "status" | "faceValue" | "maturityNetProceeds">): string | null {
  return bill.status === "awaiting_receipt" ? bill.maturityNetProceeds : bill.faceValue;
}
