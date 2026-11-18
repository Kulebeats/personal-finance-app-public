/**
 * Receipt Query Service
 *
 * Handles read operations for receipts.
 *
 * @module services/receipt/query.service
 */

import type { PendingReceipt } from "@shared/schema";
import { receiptRepository } from "../../repositories/ReceiptRepository";
import { NotFoundError } from "../../utils/errorHandler";

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
   * Get pending receipts for household
   */
  async getPendingReceipts(
    householdId: string,
    filters?: { status?: string; search?: string; limit?: number; offset?: number }
  ): Promise<{ receipts: PendingReceipt[]; total: number }> {
    return receiptRepository.findPendingReceipts(householdId, filters);
  }
}

export const receiptQueryService = new ReceiptQueryService();
