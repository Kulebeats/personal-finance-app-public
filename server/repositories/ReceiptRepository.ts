import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  lte,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { db } from "../db";
import { withTransaction, type TransactionType } from "../utils/withTransaction";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../utils/errorHandler";
import { visibleReceiptPredicate } from "../core/authz/receipt-visibility";
import { lockTransactionCreateGrant } from "./TransactionCreateBoundary";
import type { HouseholdContext } from "../middleware/householdGuard";
import {
  accounts,
  pendingReceipts,
  receiptConversionRecords,
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

async function lockReceiptWriter(tx: TransactionType, householdId: string, userId: string): Promise<HouseholdContext | undefined> {
  try {
    return await lockTransactionCreateGrant(tx, householdId, { createActor: { householdId, userId } });
  } catch (error: unknown) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) return undefined;
    throw error;
  }
}

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

  async updateUnmatchedReceipt(
    id: string, householdId: string,
    data: Pick<UpdatePendingReceiptInput, "matchStatus" | "ocrErrorMessage" | "matchAttempts" | "lastMatchAttempt" | "nextMatchAt">,
    actorUserId?: string,
  ): Promise<void> {
    const write = (executor: typeof db | TransactionType) => executor.update(pendingReceipts).set({ ...data, updatedAt: new Date() }).where(and(
      eq(pendingReceipts.id, id), eq(pendingReceipts.householdId, householdId),
      ne(pendingReceipts.matchStatus, "matched"), isNull(pendingReceipts.matchedTransactionId),
      notExists(executor.select({ id: receiptConversionRecords.receiptId }).from(receiptConversionRecords)
        .where(eq(receiptConversionRecords.receiptId, pendingReceipts.id))),
    ));
    if (!actorUserId) {
      await write(db);
      return;
    }
    await withTransaction(async tx => {
      if (await lockReceiptWriter(tx, householdId, actorUserId)) await write(tx);
    });
  }

  /**
   * R6-08: delete a receipt the caller can read, checked before the matched
   * and conversion refusals, so a hidden receipt reads as missing (undefined)
   * like an unknown id. Returns the deleted row for its file cleanup.
   */
  async deleteVisible(actor: HouseholdContext, id: string): Promise<PendingReceipt | undefined> {
    return withTransaction(async tx => {
      const current = await lockReceiptWriter(tx, actor.householdId, actor.userId);
      if (!current) return undefined;
      const receipt = await this.lockVisibleReceiptForWrite(tx, current, id);
      if (!receipt) return undefined;
      if (receipt.matchStatus === "matched") {
        throw new ValidationError("Cannot delete matched receipt. Delete the transaction attachment instead.");
      }
      const [conversion] = await tx.select({ id: receiptConversionRecords.receiptId })
        .from(receiptConversionRecords).where(eq(receiptConversionRecords.receiptId, id));
      if (conversion) throw new ConflictError("Receipt is already linked");
      await tx.delete(pendingReceipts).where(eq(pendingReceipts.id, id));
      return receipt;
    });
  }

  /** Distinguish a fresh household key from an existing receipt without revealing a hidden ID. */
  async findUploadReplay(
    idempotencyKey: string,
    actor: HouseholdContext,
  ): Promise<{ receiptId: string | null } | undefined> {
    const result = await db
      .select({ receiptId: sql<string | null>`case when ${visibleReceiptPredicate(actor)} then ${pendingReceipts.id} end` })
      .from(pendingReceipts)
      .where(
        and(
          eq(pendingReceipts.idempotencyKey, idempotencyKey),
          eq(pendingReceipts.householdId, actor.householdId),
        )
      )
      .limit(1);
    return result[0];
  }

  /**
   * A-38: duplicate detection sees only receipts the uploader may read, so a
   * duplicate answer never carries the id of a hidden receipt.
   */
  async findVisibleByImageHash(
    actor: HouseholdContext,
    imageHash: string
  ): Promise<PendingReceipt | undefined> {
    const result = await db
      .select()
      .from(pendingReceipts)
      .where(and(visibleReceiptPredicate(actor), eq(pendingReceipts.imageHash, imageHash)))
      .limit(1);
    return result[0];
  }

  /**
   * After the caller holds current write authority, lock the receipt and
   * its linked transaction and account. Check visibility after all waits.
   */
  async lockVisibleReceiptForWrite(tx: TransactionType, actor: HouseholdContext, id: string): Promise<PendingReceipt | undefined> {
    const [receipt] = await tx.select().from(pendingReceipts)
      .where(and(eq(pendingReceipts.id, id), eq(pendingReceipts.householdId, actor.householdId)))
      .for("update").limit(1);
    if (!receipt) return undefined;
    if (receipt.matchedTransactionId) {
      const [linked] = await tx.select({ accountId: transactions.accountId }).from(transactions).where(and(
        eq(transactions.id, receipt.matchedTransactionId), eq(transactions.householdId, actor.householdId),
      )).for("share");
      if (!linked) return undefined;
      const [account] = await tx.select({ id: accounts.id }).from(accounts).where(and(
        eq(accounts.id, linked.accountId), eq(accounts.householdId, actor.householdId),
      )).for("share");
      if (!account) return undefined;
    }
    const [visible] = await tx.select({ id: pendingReceipts.id }).from(pendingReceipts)
      .where(and(eq(pendingReceipts.id, id), visibleReceiptPredicate(actor)));
    return visible ? receipt : undefined;
  }

  async updateVisibleOcrResults(
    actor: HouseholdContext,
    id: string,
    data: Pick<UpdatePendingReceiptInput, "ocrStatus" | "ocrData" | "ocrConfidence" | "ocrProcessedAt">,
  ): Promise<boolean> {
    return withTransaction(async (tx) => {
      const current = await lockReceiptWriter(tx, actor.householdId, actor.userId);
      if (!current) return false;
      if (!await this.lockVisibleReceiptForWrite(tx, current, id)) return false;
      await tx.update(pendingReceipts).set({ ...data, updatedAt: new Date() }).where(eq(pendingReceipts.id, id));
      return true;
    });
  }

  async findForSignedMatch(id: string, householdId: string, userId: string): Promise<PendingReceipt | undefined> {
    return withTransaction(async tx => {
      const current = await lockReceiptWriter(tx, householdId, userId);
      if (!current) return undefined;
      const [receipt] = await tx.select().from(pendingReceipts)
        .where(and(eq(pendingReceipts.id, id), visibleReceiptPredicate(current))).limit(1);
      return receipt;
    });
  }

  /** Rule 11: the page and its count share one visibility predicate. */
  async findPendingReceipts(
    actor: HouseholdContext,
    filters?: { status?: string; search?: string; limit?: number; offset?: number }
  ): Promise<{ receipts: PendingReceipt[]; total: number }> {
    const whereConditions = [visibleReceiptPredicate(actor)];
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
