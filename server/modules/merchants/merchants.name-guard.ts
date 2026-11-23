/**
 * Merchants Module - household name namespace guard
 *
 * Merchant matching resolves a name through either a merchant's name or one of
 * its aliases (MerchantRepository.findByNameOrAlias), so names and aliases
 * share one case-insensitive namespace per household. EVERY writer to that
 * namespace goes through this module, takes the same per-household advisory
 * lock and runs the same clash check inside its own transaction, so two
 * writers cannot both claim one name:
 * - user-driven merchant create and rename, and alias add: 409 on a clash
 *   (assertMerchantNameFree);
 * - CSV import: links to the merchant that already claims the name
 *   (findOrCreateMerchantByName);
 * - automatic alias learning and rule add_merchant_alias: skip a name another
 *   merchant claims (addMerchantAliasIfFree);
 * - default seeding: skips claimed names (lockAndListClaimedMerchantNames).
 *
 * Lock order: this advisory lock comes BEFORE any merchant row lock. Create,
 * rename, alias add, import and seeding wait for it before touching merchant
 * rows. Automatic alias learning and rule actions may already hold a merchant
 * or transaction row lock when they reach it, so they only TRY the lock and
 * skip the alias when it is busy; they never wait, so no lock cycle can form.
 * A skipped alias is relearned the next time the name is matched.
 *
 * @module modules/merchants/name-guard
 */

import { eq, sql } from "drizzle-orm";
import { merchantAliases, merchants } from "@shared/schema";
import { ConflictError } from "../../core/errors";
import type { TransactionType } from "../../utils/withTransaction";

/** Advisory-lock namespace for a household's merchant names and aliases ("malz"). */
const MERCHANT_NAME_LOCK_NAMESPACE = 0x6d616c7a;

type NewMerchantValues = Omit<typeof merchants.$inferInsert, "id" | "householdId" | "name">;

interface NameClaim {
  kind: "merchant" | "alias";
  merchantId: string;
}

/** Serialise writes to this household's merchant name/alias namespace. */
export async function lockMerchantNames(
  tx: TransactionType,
  householdId: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${MERCHANT_NAME_LOCK_NAMESPACE}::int4, hashtext(${householdId}))`,
  );
}

/** Take the namespace lock only if it is free now (see the lock order above). */
async function tryLockMerchantNames(
  tx: TransactionType,
  householdId: string,
): Promise<boolean> {
  const result = await tx.execute<{ locked: boolean }>(
    sql`SELECT pg_try_advisory_xact_lock(${MERCHANT_NAME_LOCK_NAMESPACE}::int4, hashtext(${householdId})) AS locked`,
  );
  return result.rows[0]?.locked === true;
}

/**
 * The merchant whose name or alias equals `name`, case-insensitively, ignoring
 * `excludeMerchantId`. A merchant name wins over an alias when both exist.
 */
async function findNameClaim(
  tx: TransactionType,
  householdId: string,
  name: string,
  excludeMerchantId?: string,
): Promise<NameClaim | null> {
  const excludeId = excludeMerchantId ?? null;
  const result = await tx.execute<{ kind: NameClaim["kind"]; merchant_id: string }>(sql`
    SELECT kind, merchant_id FROM (
      SELECT 'merchant' AS kind, ${merchants.id} AS merchant_id, 0 AS rank FROM ${merchants}
      WHERE ${merchants.householdId} = ${householdId}
        AND LOWER(${merchants.name}) = LOWER(${name})
        AND (${excludeId}::uuid IS NULL OR ${merchants.id} <> ${excludeId}::uuid)
      UNION ALL
      SELECT 'alias' AS kind, ${merchantAliases.merchantId} AS merchant_id, 1 AS rank FROM ${merchantAliases}
      JOIN ${merchants} ON ${merchants.id} = ${merchantAliases.merchantId}
      WHERE ${merchants.householdId} = ${householdId}
        AND LOWER(${merchantAliases.aliasName}) = LOWER(${name})
        AND (${excludeId}::uuid IS NULL OR ${merchantAliases.merchantId} <> ${excludeId}::uuid)
    ) claims
    ORDER BY rank, merchant_id
    LIMIT 1`);
  const row = result.rows[0];
  return row ? { kind: row.kind, merchantId: row.merchant_id } : null;
}

/**
 * Throw ConflictError (409) when `name` is already a merchant name or an alias
 * in the household. `excludeMerchantId` ignores that merchant's own name and
 * aliases (a rename may keep its name or take one of its own aliases). Call
 * only after lockMerchantNames in the same transaction.
 */
export async function assertMerchantNameFree(
  tx: TransactionType,
  householdId: string,
  name: string,
  excludeMerchantId?: string,
): Promise<void> {
  const claim = await findNameClaim(tx, householdId, name, excludeMerchantId);
  if (claim?.kind === "merchant") {
    throw new ConflictError("A merchant with this name already exists");
  }
  if (claim?.kind === "alias") {
    throw new ConflictError("A merchant in your household already uses this name as an alias");
  }
}

/**
 * The id of the merchant that claims `name` (by name or alias), creating a
 * merchant only when nobody does. Used by automatic writers (CSV import),
 * which link to the existing merchant rather than failing.
 */
export async function findOrCreateMerchantByName(
  tx: TransactionType,
  householdId: string,
  name: string,
  values: NewMerchantValues = {},
): Promise<{ merchantId: string; isCreated: boolean }> {
  await lockMerchantNames(tx, householdId);
  const claim = await findNameClaim(tx, householdId, name);
  if (claim) {
    return { merchantId: claim.merchantId, isCreated: false };
  }
  const [created] = await tx
    .insert(merchants)
    .values({ ...values, householdId, name })
    .returning({ id: merchants.id });
  return { merchantId: created.id, isCreated: true };
}

export type AliasAddOutcome = "added" | "already-own" | "claimed-by-other" | "busy";

/**
 * Give `merchantId` the alias `aliasName` unless the name is already claimed.
 * Its own name or alias is a no-op; another merchant's name or alias is
 * skipped, never stolen and never a failure (automatic alias learning and
 * rule actions run inside larger writes that must not abort over it). When
 * another writer holds the namespace lock the alias is skipped ("busy").
 */
export async function addMerchantAliasIfFree(
  tx: TransactionType,
  householdId: string,
  merchantId: string,
  aliasName: string,
): Promise<AliasAddOutcome> {
  if (!(await tryLockMerchantNames(tx, householdId))) {
    return "busy";
  }
  const claim = await findNameClaim(tx, householdId, aliasName);
  if (claim) {
    return claim.merchantId === merchantId ? "already-own" : "claimed-by-other";
  }
  await tx.insert(merchantAliases).values({ merchantId, aliasName });
  return "added";
}

/**
 * Lock the namespace and return every merchant name and alias in the
 * household, for a bulk writer (default seeding) that filters before insert.
 */
export async function lockAndListClaimedMerchantNames(
  tx: TransactionType,
  householdId: string,
): Promise<string[]> {
  await lockMerchantNames(tx, householdId);
  const names = await tx
    .select({ name: merchants.name })
    .from(merchants)
    .where(eq(merchants.householdId, householdId));
  const aliases = await tx
    .select({ name: merchantAliases.aliasName })
    .from(merchantAliases)
    .innerJoin(merchants, eq(merchants.id, merchantAliases.merchantId))
    .where(eq(merchants.householdId, householdId));
  return [...names, ...aliases].map((row) => row.name);
}
