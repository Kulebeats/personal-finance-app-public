/**
 * Receipt Query Service
 *
 * Handles read operations for receipts.
 *
 * @module services/receipt/query.service
 */

import { and, eq } from "drizzle-orm";
import { pendingReceipts, type PendingReceipt } from "@shared/schema";
import { db } from "../../db";
import { receiptRepository } from "../../repositories/ReceiptRepository";
import { NotFoundError } from "../../utils/errorHandler";
import { visibleReceiptPredicate } from "../../core/authz/receipt-visibility";
import type { HouseholdContext } from "../../core/authz/implicit-household-context";

export class ReceiptQueryService {
  /**
   * Get receipt by ID
   */
  async getReceipt(id: string, householdId: string): Promise<PendingReceipt> {
    const receipt = await receiptRepository.findById(id);
    if (!receipt || receipt.householdId !== householdId) {
      throw new NotFoundError("Receipt not found");
    }
    return receipt;
  }

  /**
   * A receipt as `actor` may read it, or a 404 exactly like a missing one. A
   * receipt linked to a transaction takes that transaction's privacy and its
   * account's (Rule 11); an unlinked receipt is household-visible.
   */
  async getVisibleReceipt(id: string, actor: HouseholdContext): Promise<PendingReceipt> {
    const [receipt] = await db.select().from(pendingReceipts)
      .where(and(eq(pendingReceipts.id, id), visibleReceiptPredicate(actor))).limit(1);
    if (!receipt) throw new NotFoundError("Receipt not found");
    return receipt;
  }

  /**
   * The household's receipts as `actor` may read them (Rule 11): the page and
   * its total both leave out receipts linked to a transaction the actor cannot see.
   */
  async getPendingReceipts(
    actor: HouseholdContext,
    filters?: { status?: string; search?: string; limit?: number; offset?: number }
  ): Promise<{ receipts: PendingReceipt[]; total: number }> {
    return receiptRepository.findPendingReceipts(actor, filters);
  }
}

export const receiptQueryService = new ReceiptQueryService();
