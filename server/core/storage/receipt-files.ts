/**
 * A receipt's two files, bound to the receipt (OPS-001 follow-up B).
 *
 * The receipt writer names its files after the receipt: the image is
 * `receipts/{householdId}/{receiptId}.{ext}` and the thumbnail
 * `receipts/{householdId}/{receiptId}_thumb.jpg`. A row whose stored path names
 * any other file (a stale or edited path, possibly another member's private
 * receipt in the same household) is never served: authorizing the row is only
 * as good as the binding between the row and the file it names.
 *
 * @module core/storage/receipt-files
 */
import { logger } from "../../utils/logger";
import {
  nameMatchesOwner, readUploadObject, removeUploadTarget, resolveUploadTarget, uploadNameOf, type UploadObjectContent,
} from "./upload-objects";

export type ReceiptFileKind = "receipt" | "receipt-thumbnail";

/**
 * `{receiptId}{ext}`. Before `sanitizeUploadExtension`, the writer took `ext`
 * raw from `path.extname(originalFilename)` (".jpg" when empty), so a legacy
 * extension is any one segment-safe suffix with no further dot.
 */
const IMAGE_FILE = /^([0-9a-f-]{36})\.[A-Za-z0-9_-]+$/;
const THUMBNAIL_FILE = /^([0-9a-f-]{36})_thumb\.jpg$/i;

/** The receipt id a receipt file's logical name is bound to, or null when it is not a receipt file of that household. */
export function receiptIdOfName(name: string, kind: ReceiptFileKind, householdId: string): string | null {
  if (!nameMatchesOwner(name, { purpose: kind, householdId })) return null;
  const segments = name.split("/");
  if (segments.length !== 3) return null;
  const match = (kind === "receipt" ? IMAGE_FILE : THUMBNAIL_FILE).exec(segments[2]);
  return match ? match[1].toLowerCase() : null;
}

/** True when `name` is the file the receipt writer puts for this receipt. */
export function nameMatchesReceipt(name: string, receipt: { id: string; householdId: string }, kind: ReceiptFileKind): boolean {
  return receiptIdOfName(name, kind, receipt.householdId) === receipt.id.toLowerCase();
}

export interface ReceiptFiles {
  readonly id: string;
  readonly householdId: string;
  readonly storagePath: string;
  readonly thumbnailPath: string | null;
}

/**
 * The bytes of an already-authorized receipt's image or thumbnail, or null.
 * A path that is not this receipt's own file, or a manifest row recorded for
 * another purpose, reads as absent.
 */
export async function readReceiptFile(receipt: ReceiptFiles, kind: ReceiptFileKind): Promise<UploadObjectContent | null> {
  const stored = kind === "receipt" ? receipt.storagePath : receipt.thumbnailPath;
  const name = stored ? uploadNameOf(stored) : null;
  if (!stored || !name || !nameMatchesReceipt(name, receipt, kind)) {
    logger.warn("A receipt row names a file that is not its own; it is not served", { receiptId: receipt.id, purpose: kind });
    return null;
  }
  return readUploadObject(stored, receipt.householdId, kind);
}

/**
 * A-28: delete a receipt's image or thumbnail with the same binding reads
 * enforce. Only the file the receipt writer named after this receipt, with a
 * manifest row of this household and kind, is removed. Any other name (a
 * stale or edited path, possibly another receipt's file) leaves the object
 * and its manifest row untouched.
 */
export async function removeReceiptFile(receipt: ReceiptFiles, kind: ReceiptFileKind): Promise<void> {
  const stored = kind === "receipt" ? receipt.storagePath : receipt.thumbnailPath;
  if (!stored) return;
  const name = uploadNameOf(stored);
  if (!name || !nameMatchesReceipt(name, receipt, kind)) {
    logger.warn("A receipt row names a file that is not its own; it is not deleted", { receiptId: receipt.id, purpose: kind, uploadName: name });
    return;
  }
  const target = await resolveUploadTarget(stored, undefined, { purpose: kind, householdId: receipt.householdId });
  if (target) await removeUploadTarget(target);
}
