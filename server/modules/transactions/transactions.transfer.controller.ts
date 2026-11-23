/**
 * Transactions Transfer Controller
 *
 * HTTP handlers for transfer operations between accounts.
 * Split from transactions.controller.ts to maintain LOC limits.
 *
 * @module modules/transactions/transactions.transfer.controller
 */

import { Request, Response } from "express";
import { transactionService as legacyTransactionService } from "../../services/TransactionService";
import { logger } from "../../utils/logger";
import { success } from "../../core/http";
import { ValidationError } from "../../core/errors";
import {
  createTransferSchema,
  updateTransferSchema,
} from "./transactions.validation";
import { businessAuditService } from "../../services/BusinessAuditService";
import { mapTransactionMoney } from "./transactions.helpers";

const transactionService = legacyTransactionService;

/**
 * Create a transfer between accounts
 * POST /api/transactions/transfer
 */
export async function createTransfer(
  req: Request,
  res: Response,
): Promise<void> {
  const { householdId, userId } = req.householdContext!;

  const parseResult = createTransferSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError(
      "Invalid transfer data",
      parseResult.error.errors,
    );
  }

  const { fromAccountId, toAccountId, amount, ...options } = parseResult.data;

  const { outflow, inflow, isDuplicate } =
    await transactionService.createTransfer(
      fromAccountId,
      toAccountId,
      amount,
      householdId,
      userId,
      { ...options, audit: { ipAddress: businessAuditService.getIpAddress(req) } },
    );

  logger.request(req, "Created transfer", { isDuplicate });

  res.status(isDuplicate ? 200 : 201).json({
    success: true,
    data: {
      outflow: mapTransactionMoney(outflow),
      inflow: mapTransactionMoney(inflow),
    },
    isDuplicate,
  });
}

/**
 * Update an existing transfer
 * PUT /api/transactions/transfer/:id
 */
export async function updateTransfer(
  req: Request,
  res: Response,
): Promise<void> {
  const { householdId, userId } = req.householdContext!;
  const { id } = req.params;

  const parseResult = updateTransferSchema.safeParse(req.body);
  if (!parseResult.success) {
    throw new ValidationError(
      "Invalid transfer data",
      parseResult.error.errors,
    );
  }

  const updated = await transactionService.updateTransfer(
    id,
    parseResult.data,
    householdId,
    userId,
    { ipAddress: businessAuditService.getIpAddress(req) },
  );

  logger.request(req, "Updated transfer");

  success(res, {
    outflow: mapTransactionMoney(updated.outflow),
    inflow: mapTransactionMoney(updated.inflow),
  });
}

export const transactionsTransferController = {
  createTransfer,
  updateTransfer,
};
