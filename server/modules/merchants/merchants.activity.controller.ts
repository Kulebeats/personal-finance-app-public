/**
 * Merchants Module - detail reads (ORG-006)
 *
 * GET /merchants/:id/analytics and GET /merchants/:id/transactions, as the
 * merchant detail view calls them. Validation → service → response.
 *
 * @module modules/merchants/activity.controller
 */

import type { NextFunction, Request, Response } from "express";
import { success } from "../../core/http";
import { ValidationError } from "../../core/errors";
import { getMerchantAnalytics, listMerchantTransactions } from "./merchants.activity.service";
import {
  merchantAnalyticsQuerySchema,
  merchantIdParamsSchema,
  merchantTransactionsQuerySchema,
} from "./merchants.validation";

function merchantIdOf(req: Request): string {
  const params = merchantIdParamsSchema.safeParse(req.params);
  if (!params.success) throw new ValidationError("Invalid merchant id", params.error.errors);
  return params.data.id;
}

export const merchantActivityController = {
  async analytics(req: Request, res: Response, next: NextFunction) {
    try {
      const merchantId = merchantIdOf(req);
      const query = merchantAnalyticsQuerySchema.safeParse(req.query);
      if (!query.success) throw new ValidationError("Invalid analytics query", query.error.errors);
      const data = await getMerchantAnalytics(req.householdContext!, merchantId, query.data);
      return success(res, data);
    } catch (error) {
      next(error);
    }
  },

  async transactions(req: Request, res: Response, next: NextFunction) {
    try {
      const merchantId = merchantIdOf(req);
      const query = merchantTransactionsQuerySchema.safeParse(req.query);
      if (!query.success) throw new ValidationError("Invalid transactions query", query.error.errors);
      const data = await listMerchantTransactions(req.householdContext!, merchantId, query.data);
      return success(res, data);
    } catch (error) {
      next(error);
    }
  },
};
