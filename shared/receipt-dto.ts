import type { OcrExtractedData } from "./schema";

/**
 * The only receipt shape the API returns (NEW-39, Rule 18). It is an explicit
 * allow-list: storage paths, stored filenames, upload directories, hashes,
 * idempotency keys and internal matching state never leave the server. Images
 * are reached through the authenticated receipt routes named here.
 */
export interface ReceiptDto {
  id: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  ocrStatus: string;
  ocrData: OcrExtractedData | null;
  ocrConfidence: string | null;
  ocrProcessedAt: string | null;
  matchStatus: string;
  matchedTransactionId: string | null;
  /** Authenticated route for the full receipt image. */
  imageUrl: string;
  /** Authenticated route for the thumbnail, or null when none was stored. */
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export const RECEIPT_DTO_KEYS = [
  "id", "originalFilename", "mimeType", "size", "ocrStatus", "ocrData", "ocrConfidence", "ocrProcessedAt",
  "matchStatus", "matchedTransactionId", "imageUrl", "thumbnailUrl", "createdAt", "updatedAt",
] as const satisfies readonly (keyof ReceiptDto)[];
