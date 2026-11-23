/**
 * Personal-data export HTTP handlers (R07.1, AH-08). User-level: identity comes
 * from the signed session only; the household, when there is one, is the
 * request's authoritative implicit context and is re-checked in the service.
 */
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { created, success } from "../../core/http";
import { ValidationError } from "../../core/errors";
import { resolveRequestImplicitHouseholdContext } from "../../core/authz/session-preconditions";
import { businessAuditService } from "../../services/BusinessAuditService";
import { createPersonalExport, listPersonalExports, releasePersonalExport } from "./settings.privacy-export.service";

const exportIdSchema = z.string().uuid();

export const privacyExportController = {
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.session.userId!;
      const context = await resolveRequestImplicitHouseholdContext(req, userId);
      const item = await createPersonalExport({
        userId, householdId: context?.householdId, ipAddress: businessAuditService.getIpAddress(req),
      });
      created(res, item);
    } catch (error) {
      next(error);
    }
  },

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      success(res, await listPersonalExports(req.session.userId!));
    } catch (error) {
      next(error);
    }
  },

  async download(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = exportIdSchema.safeParse(req.params.id);
      if (!parsed.success) throw new ValidationError("Invalid export id");
      const { bytes, fileName, contentType } = await releasePersonalExport(
        req.session.userId!, parsed.data, businessAuditService.getIpAddress(req),
      );
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.status(200).send(bytes);
    } catch (error) {
      next(error);
    }
  },
};
