/**
 * Recurring Lifecycle Controller
 *
 * Handles lifecycle actions for recurring transactions:
 * skip, pause, resume, end operations. Their semantics are documented in
 * services/recurring/RecurringLifecycleRules.ts; the rule write, its history
 * and its audit row commit in one transaction in RecurringLifecycleService.
 *
 * @module modules/recurring/recurring.lifecycle.controller
 */

import { Request, Response, NextFunction } from "express";
import type { z } from "zod";
import { recurringService } from "../../services/RecurringService";
import { logger } from "../../utils/logger";
import { success } from "../../core/http";
import { ValidationError } from "../../core/errors";
import { mapRecurringRuleMoney } from "./recurring.helpers";
import { endRecurringSchema, skipRecurringSchema } from "./recurring.validation";
import { businessAuditService } from "../../services/BusinessAuditService";

type LifecycleChange = Parameters<typeof recurringService.changeLifecycle>[2];

function parseBody<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new ValidationError("Invalid request data", parsed.error.errors);
  }
  return parsed.data;
}

function lifecycleHandler(toChange: (req: Request) => LifecycleChange, logMessage: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { rule } = await recurringService.changeLifecycle(
        req.params.id, req.householdContext!, toChange(req), businessAuditService.getIpAddress(req),
      );
      logger.request(req, logMessage);
      return success(res, mapRecurringRuleMoney(rule));
    } catch (error) {
      next(error);
    }
  };
}

export const recurringLifecycleController = {
  skip: lifecycleHandler(
    req => ({ action: "skipped", ...parseBody(skipRecurringSchema, req.body) }),
    "Skipped recurring occurrence",
  ),
  pause: lifecycleHandler(() => ({ action: "paused" }), "Paused recurring rule"),
  resume: lifecycleHandler(() => ({ action: "resumed" }), "Resumed recurring rule"),
  end: lifecycleHandler(
    req => ({ action: "ended", ...parseBody(endRecurringSchema, req.body) }),
    "Ended recurring rule",
  ),
};
