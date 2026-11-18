/**
 * Investment Transactions Controller
 * Handles buy/sell/dividend transaction recording
 */
import { Request, Response, NextFunction } from "express";
import { investmentService } from "./investments.service";
import { businessAuditService } from "../../services/BusinessAuditService";
import { logger } from "../../utils/logger";
import { success } from "../../core/http";
import { ValidationError } from "../../core/errors";
import {
  listInvestmentTransactionsQuerySchema,
  listTaxLotsQuerySchema,
  createInvestmentTransactionSchema,
} from "./investments.validation";

async function listTransactions(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { householdId } = req.householdContext!;
    const parsed = listInvestmentTransactionsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError("Invalid request data", parsed.error.errors);
    }

    const transactions = await investmentService.getTransactions(
      householdId,
      parsed.data,
    );

    return success(res, transactions);
  } catch (error) {
    next(error);
  }
}

async function createTransaction(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { householdId, userId } = req.householdContext!;
    const parsed = createInvestmentTransactionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid request data", parsed.error.errors);
    }

    const transaction = await investmentService.createTransaction(
      parsed.data,
      householdId,
    );

    await businessAuditService.logCreate({
      userId,
      householdId,
      entityType: "investment_transaction",
      entityId: transaction.id,
      newValue: {
        type: transaction.type,
        holdingId: transaction.holdingId,
        quantity: transaction.quantity,
        amount: transaction.amount,
      },
      ipAddress: businessAuditService.getIpAddress(req),
    });

    logger.info("Created investment transaction", { householdId });
    success(res, transaction, 201);
    return;
  } catch (error) {
    next(error);
  }
}

async function listTaxLots(req: Request, res: Response, next: NextFunction) {
  try {
    const { householdId } = req.householdContext!;
    const parsed = listTaxLotsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid tax lot query",
          fields: parsed.error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        },
      });
    }

    const data = await investmentService.getTaxLots(householdId, parsed.data);
    return success(res, data);
  } catch (error) {
    next(error);
  }
}

export const investmentsTransactionsController = {
  listTransactions,
  createTransaction,
  listTaxLots,
};
