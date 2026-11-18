import { and, eq } from "drizzle-orm";
import { db } from "../db";
import type { OcrExtractedData } from "@shared/schema";
import { StorageSessionModule } from "./StorageSessionModule";

export class StorageReceiptModule extends StorageSessionModule {
  // ============================================================================
  // PENDING RECEIPT METHODS (Receipt Scanning)
  // ============================================================================

  async createPendingReceipt(data: {
    id?: string;
    householdId: string;
    uploadedBy: string;
    filename: string;
    originalFilename: string;
    mimeType: string;
    size: number;
    storagePath: string;
    thumbnailPath?: string;
    ocrStatus?: string;
    matchStatus?: string;
    idempotencyKey?: string;
    imageHash?: string;
    nextMatchAt?: Date;
  }) {
    const { pendingReceipts } = await import("@shared/schema");
    const result = await db
      .insert(pendingReceipts)
      .values({
        ...data,
        ocrStatus: data.ocrStatus ?? "pending",
        matchStatus: data.matchStatus ?? "pending",
      })
      .returning();
    return result[0];
  }

  async getPendingReceipt(id: string) {
    const { pendingReceipts } = await import("@shared/schema");
    const result = await db
      .select()
      .from(pendingReceipts)
      .where(eq(pendingReceipts.id, id))
      .limit(1);
    return result[0];
  }

  async updatePendingReceipt(
    id: string,
    data: Partial<{
      ocrStatus: string;
      ocrData: OcrExtractedData | null;
      ocrConfidence: string;
      ocrProcessedAt: Date;
      ocrErrorMessage: string;
      matchStatus: string;
      matchedTransactionId: string;
      matchAttempts: number;
      lastMatchAttempt: Date;
      nextMatchAt: Date;
    }>
  ) {
    const { pendingReceipts } = await import("@shared/schema");
    const result = await db
      .update(pendingReceipts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(pendingReceipts.id, id))
      .returning();
    return result[0];
  }

  async deletePendingReceipt(id: string) {
    const { pendingReceipts } = await import("@shared/schema");
    await db.delete(pendingReceipts).where(eq(pendingReceipts.id, id));
  }

  async getPendingReceiptByIdempotencyKey(idempotencyKey: string) {
    const { pendingReceipts } = await import("@shared/schema");
    const result = await db
      .select()
      .from(pendingReceipts)
      .where(eq(pendingReceipts.idempotencyKey, idempotencyKey))
      .limit(1);
    return result[0];
  }

  async getPendingReceiptByImageHash(householdId: string, imageHash: string) {
    const { pendingReceipts } = await import("@shared/schema");
    const result = await db
      .select()
      .from(pendingReceipts)
      .where(
        and(
          eq(pendingReceipts.householdId, householdId),
          eq(pendingReceipts.imageHash, imageHash)
        )
      )
      .limit(1);
    return result[0];
  }

  async getPendingReceipts(
    householdId: string,
    filters?: { status?: string; limit?: number; offset?: number }
  ) {
    const { pendingReceipts } = await import("@shared/schema");
    const { desc, count } = await import("drizzle-orm");

    const whereConditions = [eq(pendingReceipts.householdId, householdId)];
    if (filters?.status) {
      whereConditions.push(eq(pendingReceipts.matchStatus, filters.status));
    }

    const [receipts, totalResult] = await Promise.all([
      db
        .select()
        .from(pendingReceipts)
        .where(and(...whereConditions))
        .orderBy(desc(pendingReceipts.createdAt))
        .limit(filters?.limit ?? 50)
        .offset(filters?.offset ?? 0),
      db
        .select({ count: count() })
        .from(pendingReceipts)
        .where(and(...whereConditions)),
    ]);

    return { receipts, total: totalResult[0]?.count ?? 0 };
  }

  async getReceiptsForMatching(limit: number = 50) {
    const { pendingReceipts } = await import("@shared/schema");
    const { lte, asc } = await import("drizzle-orm");

    return await db
      .select()
      .from(pendingReceipts)
      .where(
        and(
          eq(pendingReceipts.matchStatus, "pending"),
          lte(pendingReceipts.nextMatchAt, new Date())
        )
      )
      .orderBy(asc(pendingReceipts.nextMatchAt))
      .limit(limit);
  }

  async findTransactionsForReceiptMatch(
    householdId: string,
    criteria: {
      amountMin?: number;
      amountMax?: number;
      dateMin?: Date;
      dateMax?: Date;
      merchantPattern?: string;
    }
  ) {
    const { transactions } = await import("@shared/schema");
    const { gte, lte, ilike, isNull, desc } = await import("drizzle-orm");

    const conditions = [
      eq(transactions.householdId, householdId),
      isNull(transactions.deletedAt),
    ];

    if (criteria.amountMin !== undefined) {
      conditions.push(gte(transactions.amount, criteria.amountMin.toString()));
    }
    if (criteria.amountMax !== undefined) {
      conditions.push(lte(transactions.amount, criteria.amountMax.toString()));
    }
    if (criteria.dateMin) {
      conditions.push(
        gte(transactions.date, criteria.dateMin.toISOString().split("T")[0])
      );
    }
    if (criteria.dateMax) {
      conditions.push(
        lte(transactions.date, criteria.dateMax.toISOString().split("T")[0])
      );
    }
    if (criteria.merchantPattern) {
      conditions.push(
        ilike(transactions.name, `%${criteria.merchantPattern}%`)
      );
    }

    return await db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .orderBy(desc(transactions.date))
      .limit(20);
  }
}
