/**
 * Merchants Module - logo file paths and the logo-folder lock
 *
 * Shared by the logo writes (merchants.assets.service), merchant create/edit
 * (a logoUrl copied onto a merchant) and the orphan sweep
 * (merchants.logo-sweep), so all three agree on where a household's logos
 * live and serialise on the same lock.
 *
 * @module modules/merchants/logo-paths
 */

import * as path from "path";
import { sql } from "drizzle-orm";
import type { TransactionType } from "../../utils/withTransaction";

export const LOGO_UPLOAD_DIR = "merchant-logos";
const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

/** Advisory-lock namespace for a household's logo folder ("mlgo"). */
const MERCHANT_LOGO_LOCK_NAMESPACE = 0x6d6c676f;

/** `/uploads/merchant-logos/<household uuid>/...`: the folder a logo URL points into. */
const LOGO_URL_FOLDER = /^\/uploads\/merchant-logos\/([0-9a-f-]{36})\//i;

/** Resolve a stored logo path, or null if it is outside the household's logo folder. */
export function resolveHouseholdLogoPath(storedPath: string, householdId: string): string | null {
  const resolved = path.resolve(process.cwd(), storedPath);
  const householdDir = path.join(UPLOADS_ROOT, LOGO_UPLOAD_DIR, householdId);
  if (!resolved.startsWith(householdDir + path.sep)) {
    return null;
  }
  return resolved;
}

/** The public URL a stored logo is served at (what merchants.logoUrl holds). */
export function logoUrlFor(storedPath: string): string {
  return `/${storedPath.replace(/\\/g, "/")}`;
}

/** The household whose logo folder `logoUrl` points into, or null for any other URL. */
export function logoFolderHouseholdOf(logoUrl: string | null | undefined): string | null {
  return logoUrl ? LOGO_URL_FOLDER.exec(logoUrl)?.[1]?.toLowerCase() ?? null : null;
}

/**
 * Serialise "a merchant starts showing a file in this folder" against the
 * orphan sweep deleting a file from it. Take it in the same transaction as the
 * logoUrl write (or the sweep's delete).
 */
export async function lockMerchantLogoFolder(
  tx: TransactionType,
  folderHouseholdId: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${MERCHANT_LOGO_LOCK_NAMESPACE}::int4, hashtext(${folderHouseholdId.toLowerCase()}))`,
  );
}
