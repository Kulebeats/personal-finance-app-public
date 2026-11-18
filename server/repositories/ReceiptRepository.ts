import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { db } from "../db";
import {
  accounts,
  pendingReceipts,
  transactions,
  type OcrExtractedData,
  type PendingReceipt,
} from "@shared/schema";

type CreatePendingReceiptInput = {
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
};

type UpdatePendingReceiptInput = Partial<{
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
}>;

export class ReceiptRepository {
  async create(data: CreatePendingReceiptInput): Promise<PendingReceipt> {
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

  async findById(id: string): Promise<PendingReceipt | undefined> {
    const result = await db
      .select()
      .from(pendingReceipts)
      .where(eq(pendingReceipts.id, id))
      .limit(1);
    return result[0];
  }

  async update(
    id: string,
    data: UpdatePendingReceiptInput
  ): Promise<PendingReceipt | undefined> {
    const result = await db
      .update(pendingReceipts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(pendingReceipts.id, id))
      .returning();
    return result[0];
  }

  async delete(id: string): Promise<void> {
    await db.delete(pendingReceipts).where(eq(pendingReceipts.id, id));
  }

  // FIX SEC-RECEIPTS-001: Scope idempotency to household
  async findByIdempotencyKey(
    idempotencyKey: string,
    householdId: string
  ): Promise<PendingReceipt | undefined> {
    const result = await db
      .select()
      .from(pendingReceipts)
      .where(
        and(
          eq(pendingReceipts.idempotencyKey, idempotencyKey),
          eq(pendingReceipts.householdId, householdId)
        )
      )
      .limit(1);
    return result[0];
  }

  async findByImageHash(
    householdId: string,
    imageHash: string
  ): Promise<PendingReceipt | undefined> {
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

  async findPendingReceipts(
    householdId: string,
    filters?: { status?: string; search?: string; limit?: number; offset?: number }
  ): Promise<{ receipts: PendingReceipt[]; total: number }> {
    const whereConditions = [eq(pendingReceipts.householdId, householdId)];
    if (filters?.status) {
      whereConditions.push(eq(pendingReceipts.matchStatus, filters.status));
    }
    if (filters?.search) {
      const searchTerm = `%${filters.search.toLowerCase()}%`;
      whereConditions.push(
        or(
          ilike(pendingReceipts.originalFilename, searchTerm),
          sql`LOWER(${pendingReceipts.ocrData}->>'merchantName') LIKE ${searchTerm}`
        )!
      );
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
        .select({ count: sql<number>`count(*)` })
        .from(pendingReceipts)
        .where(and(...whereConditions)),
    ]);

    return { receipts, total: Number(totalResult[0]?.count ?? 0) };
  }

  async findForMatching(limit: number = 50): Promise<PendingReceipt[]> {
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

  async findTransactionsForMatch(
    householdId: string,
    userId: string,
    criteria: {
      amountMin?: number;
      amountMax?: number;
      dateMin?: Date;
      dateMax?: Date;
      merchantPattern?: string;
    }
  ) {
    const conditions = [
      eq(transactions.householdId, householdId),
      isNull(transactions.deletedAt),
      or(
        eq(transactions.isPrivate, false),
        eq(transactions.ownerUserId, userId)
      ),
      or(
        eq(accounts.isPrivate, false),
        eq(accounts.ownerUserId, userId)
      ),
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

    const results = await db
      .select()
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(and(...conditions))
      .orderBy(desc(transactions.date))
      .limit(20);

    return results.map((row) => row.transactions);
  }
}

export const receiptRepository = new ReceiptRepository();
