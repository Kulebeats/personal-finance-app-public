/**
 * R05.2 saved views: thin HTTP layer (Rule 5). Request -> Zod -> service -> response.
 */
import type { Request, Response } from "express";
import { createSavedViewSchema, deleteSavedViewQuerySchema, updateSavedViewSchema } from "@shared/saved-views";
import { created, noContent, success } from "../../core/http";
import { ValidationError } from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";
import { savedViewsService } from "./saved-views.service";

export const savedViewsController = {
  async list(req: Request, res: Response): Promise<void> {
    success(res, await savedViewsService.list(req.householdContext!));
  },

  async create(req: Request, res: Response): Promise<void> {
    const parsed = createSavedViewSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Invalid saved view", parsed.error.errors);
    created(res, await savedViewsService.create(req.householdContext!, parsed.data, businessAuditService.getIpAddress(req)));
  },

  async update(req: Request, res: Response): Promise<void> {
    const parsed = updateSavedViewSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Invalid saved view", parsed.error.errors);
    success(res, await savedViewsService.update(
      req.householdContext!, req.params.id, parsed.data, businessAuditService.getIpAddress(req),
    ));
  },

  async remove(req: Request, res: Response): Promise<void> {
    const parsed = deleteSavedViewQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new ValidationError("The current version is required", parsed.error.errors);
    await savedViewsService.remove(req.householdContext!, req.params.id, parsed.data.version, businessAuditService.getIpAddress(req));
    noContent(res);
  },
};
