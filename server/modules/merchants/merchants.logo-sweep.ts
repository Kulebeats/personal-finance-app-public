/**
 * Merchants Module - orphan logo sweep (scheduled job cleanup.merchant-logos)
 *
 * A replaced or removed logo keeps its file and merchant_logo_uploads row,
 * because a merge or edit may have copied its URL onto another merchant
 * (merchants.assets.service). This sweep retires a file only when:
 * - no merchant, active or not, in any household references its URL;
 * - its upload is older than the grace period (an open edit form may still
 *   hold the old URL);
 * - it lies inside its merchant's household logo folder.
 *
 * Each file is retired in its own transaction under the folder lock that
 * merchant create/edit take when they set a logoUrl, so a merchant cannot
 * start showing the file between the re-check and the delete. The row is
 * deleted and the file removed (stored object and manifest row, or a legacy
 * file on the old uploads disk) inside that transaction: a failed removal rolls
 * the row back for the next run, and a file already gone only retires the
 * row. Logs counts only.
 *
 * @module modules/merchants/logo-sweep
 */

import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { merchantLogoUploads, merchants } from "@shared/schema";
import { db } from "../../db";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { logger } from "../../utils/logger";
import { removeUploadTarget, resolveUploadTarget, type UploadObjectTarget } from "../../core/storage/upload-objects";
import { lockMerchantLogoFolder, resolveHouseholdLogoPath } from "./merchants.logo-paths";

/** Uploads younger than this are never swept. */
const ORPHAN_LOGO_GRACE_HOURS = 24;
/** Upper bound on files retired per run; the rest wait for the next run. */
const ORPHAN_LOGO_BATCH_LIMIT = 500;

export type LogoSweepSummary = {
  readonly removed: number;
  readonly kept: number;
  readonly failed: number;
};

type Candidate = { id: string; filePath: string; householdId: string | null };

/** The URL merchants.logoUrl holds for an upload row (see logoUrlFor). */
const uploadUrl = sql`'/' || replace(${merchantLogoUploads.filePath}, chr(92), '/')`;

const isReferenced = sql`EXISTS (SELECT 1 FROM ${merchants} AS shown WHERE shown.logo_url = ${uploadUrl})`;

async function findCandidates(): Promise<Candidate[]> {
  return db
    .select({
      id: merchantLogoUploads.id,
      filePath: merchantLogoUploads.filePath,
      householdId: merchants.householdId,
    })
    .from(merchantLogoUploads)
    .innerJoin(merchants, eq(merchants.id, merchantLogoUploads.merchantId))
    .where(and(
      isNotNull(merchantLogoUploads.uploadedAt),
      sql`${merchantLogoUploads.uploadedAt} < now() - make_interval(hours => ${ORPHAN_LOGO_GRACE_HOURS}::int)`,
      sql`NOT ${isReferenced}`,
    ))
    .orderBy(asc(merchantLogoUploads.uploadedAt))
    .limit(ORPHAN_LOGO_BATCH_LIMIT);
}

/**
 * Retire one orphan's record under the folder lock and capture its stored file;
 * null when it is no longer an orphan. The bytes go only after this commits,
 * so a rollback never leaves a restored upload row without its file.
 */
async function retire(tx: TransactionType, candidate: Candidate, householdId: string): Promise<RetiredLogo | null> {
  await lockMerchantLogoFolder(tx, householdId);
  const [removed] = await tx
    .delete(merchantLogoUploads)
    .where(and(eq(merchantLogoUploads.id, candidate.id), sql`NOT ${isReferenced}`))
    .returning({ id: merchantLogoUploads.id });
  if (!removed) return null;
  return { file: await resolveUploadTarget(candidate.filePath, tx, { purpose: "merchant-logo", householdId }) };
}

/** A retired upload record and its file; `file` is null when the record named another owner's file, which stays. */
type RetiredLogo = { readonly file: UploadObjectTarget | null };

/** Remove merchant logo files that no merchant references any more. */
export async function sweepOrphanMerchantLogos(): Promise<LogoSweepSummary> {
  let removed = 0;
  let kept = 0;
  let failed = 0;
  for (const candidate of await findCandidates()) {
    const householdId = candidate.householdId;
    const resolvedPath = householdId ? resolveHouseholdLogoPath(candidate.filePath, householdId) : null;
    if (!householdId || !resolvedPath) {
      kept++; // Outside its household folder: never touched by the sweep.
      continue;
    }
    try {
      const retired = await withTransaction((tx) => retire(tx, candidate, householdId));
      if (!retired) { kept++; continue; }
      if (retired.file) await removeUploadTarget(retired.file).catch((error: unknown) => {
        // The record is retired; the manifest row (removed last) still names what is left.
        logger.error("Merchant logo sweep could not remove a retired file", {
          job: "merchant-logo-cleanup", objectKey: retired.file?.key ?? null, uploadName: retired.file?.name,
        });
        throw error;
      });
      removed++;
    } catch (err) {
      failed++;
      logger.error("Merchant logo sweep could not retire a file", {
        job: "merchant-logo-cleanup",
        errorCode: (err as { code?: string }).code ?? "UNKNOWN",
      });
    }
  }
  logger.info("Merchant logo sweep completed", { job: "merchant-logo-cleanup", removed, kept, failed });
  return { removed, kept, failed };
}
