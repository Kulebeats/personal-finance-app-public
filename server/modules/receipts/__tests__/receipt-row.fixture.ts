import type { PendingReceipt } from "@shared/schema";

/** A complete synthetic pending_receipts row, so mapper tests see every column. */
export function receiptRow(overrides: Partial<PendingReceipt> = {}): PendingReceipt {
  const id = overrides.id ?? "22222222-2222-2222-2222-222222222222";
  return {
    id,
    householdId: "11111111-1111-1111-1111-111111111111",
    uploadedBy: "44444444-4444-4444-4444-444444444444",
    filename: `${id}.jpg`,
    originalFilename: "receipt.jpg",
    mimeType: "image/jpeg",
    size: 1024,
    storagePath: `uploads/receipts/11111111-1111-1111-1111-111111111111/${id}.jpg`,
    thumbnailPath: `uploads/receipts/11111111-1111-1111-1111-111111111111/${id}_thumb.jpg`,
    ocrStatus: "pending",
    ocrData: null,
    ocrConfidence: null,
    ocrProcessedAt: null,
    ocrErrorMessage: null,
    matchStatus: "pending",
    matchedTransactionId: null,
    matchAttempts: 0,
    lastMatchAttempt: null,
    nextMatchAt: null,
    idempotencyKey: null,
    imageHash: "a".repeat(64),
    createdAt: new Date("2026-10-05T08:00:00.000Z"),
    updatedAt: new Date("2026-10-05T08:00:00.000Z"),
    ...overrides,
  };
}
