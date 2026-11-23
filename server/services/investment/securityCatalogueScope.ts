import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { securities } from "@shared/schema";

/**
 * NEW-13: a curated row (no owning household) is in every household's catalogue;
 * a custom row is in its owning household's only. Every lookup by a caller-named
 * security id goes through this, so another household's custom security reads
 * exactly like an unknown id. Migration 0058 enforces the same rule on every row
 * that points at a security.
 */
export function securityVisibleTo(householdId: string | SQLWrapper): SQL {
  return sql`(${securities.ownerHouseholdId} is null or ${securities.ownerHouseholdId} = ${householdId}::uuid)`;
}
