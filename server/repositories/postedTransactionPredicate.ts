import { sql } from "drizzle-orm";
import { transactions } from "@shared/schema";

// Either marker can identify a pending row. Older posted rows may have no status.
export const postedTransactionPredicate = sql`${transactions.isPending} IS NOT TRUE
  AND ${transactions.status} IS DISTINCT FROM 'pending'`;
