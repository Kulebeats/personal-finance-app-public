/**
 * Receipts Module - DTO mappers
 *
 * Every receipt the API returns passes through `toReceiptDto`. Fields are
 * copied by name, so a new column never reaches a client by default, and the
 * storage and thumbnail paths are replaced by the authenticated image routes.
 *
 * @module modules/receipts/helpers
 */

import type { PendingReceipt } from "@shared/schema";
import type { ReceiptDto } from "@shared/receipt-dto";

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export function toReceiptDto(receipt: PendingReceipt): ReceiptDto {
  return {
    id: receipt.id,
    originalFilename: receipt.originalFilename,
    mimeType: receipt.mimeType,
    size: receipt.size,
    ocrStatus: receipt.ocrStatus,
    ocrData: receipt.ocrData ?? null,
    ocrConfidence: receipt.ocrConfidence ?? null,
    ocrProcessedAt: iso(receipt.ocrProcessedAt),
    matchStatus: receipt.matchStatus,
    matchedTransactionId: receipt.matchedTransactionId ?? null,
    imageUrl: `/api/receipts/${receipt.id}/ocr-image`,
    thumbnailUrl: receipt.thumbnailPath ? `/api/receipts/${receipt.id}/thumbnail` : null,
    createdAt: receipt.createdAt.toISOString(),
    updatedAt: receipt.updatedAt.toISOString(),
  };
}
