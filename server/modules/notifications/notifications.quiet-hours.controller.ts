/**
 * Quiet hours (R16.2): the signed-in user's own delivery window.
 * GET /api/notifications/quiet-hours, PUT /api/notifications/quiet-hours
 */
import type { NextFunction, Request, Response } from "express";
import { ValidationError } from "../../core/errors";
import { success } from "../../core/http";
import { resolveRequestHousehold } from "../../core/authz/session-preconditions";
import { businessAuditService } from "../../services/BusinessAuditService";
import { getQuietHours, setQuietHours } from "../../services/notification/quiet-hours";
import { quietHoursBodySchema } from "./notifications.validation";

export const quietHoursController = {
  async get(req: Request, res: Response, next: NextFunction) {
    try {
      success(res, await getQuietHours(req.session.userId!));
    } catch (error) {
      next(error);
    }
  },

  async put(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.session.userId!;
      const parsed = quietHoursBodySchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError("Invalid quiet hours", parsed.error.errors);

      // The setting belongs to the user, not a household; the audit row notes the household when there is one.
      const household = await resolveRequestHousehold(req, userId).catch(() => null);
      const saved = await setQuietHours(userId, parsed.data, {
        householdId: household?.id ?? null,
        ipAddress: businessAuditService.getIpAddress(req),
      });
      success(res, saved);
    } catch (error) {
      next(error);
    }
  },
};
