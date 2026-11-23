/**
 * Merchants Module - Logo and alias controller
 *
 * POST   /api/merchants/:id/logo             multipart field "logo"
 * DELETE /api/merchants/:id/logo
 * POST   /api/merchants/:id/aliases          { aliasName }
 * DELETE /api/merchants/:id/aliases/:aliasId
 *
 * @module modules/merchants/assets.controller
 */

import { Request, Response, NextFunction } from "express";
import multer from "multer";
import { z } from "zod";
import { success, created } from "../../core/http";
import { ValidationError } from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";
import { merchantAssetsService, type WriteActor } from "./merchants.assets.service";
import { LOGO_MAX_UPLOAD_BYTES, prepareLogoImage } from "./merchants.logo-image";
import {
  addMerchantAliasSchema,
  merchantAliasParamsSchema,
  merchantIdParamsSchema,
} from "./merchants.validation";

/**
 * In-memory multipart parser for the logo. The size cap is enforced while the
 * body streams; an oversized file becomes LIMIT_FILE_SIZE, which the global
 * error handler answers with 413. The request carries exactly one part, the
 * file: text fields are refused (LIMIT_FIELD_COUNT, 400) so they cannot be
 * used to buffer large bodies in memory.
 */
export const merchantLogoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LOGO_MAX_UPLOAD_BYTES, files: 1, fields: 0, parts: 1 },
}).single("logo");

function parse<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: unknown,
  message: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(message, result.error.errors);
  }
  return result.data;
}

/** The acting user for a merchant write (also used by merchants.controller). */
export function actorOf(req: Request): WriteActor {
  const { householdId, userId } = req.householdContext!;
  return {
    householdId,
    userId,
    ipAddress: businessAuditService.getIpAddress(req),
  };
}

export const merchantAssetsController = {
  async uploadLogo(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = parse(merchantIdParamsSchema, req.params, "Invalid merchant id");
      const actor = actorOf(req);
      const file = req.file;
      if (!file) {
        throw new ValidationError("Logo file is required", [
          { field: "logo", message: "Attach an image in the \"logo\" field" },
        ]);
      }

      await merchantAssetsService.assertOwnedMerchant(id, actor.householdId);
      const logo = await prepareLogoImage(file);
      const result = await merchantAssetsService.setLogo(id, actor, logo, file.originalname);
      return success(res, result);
    } catch (error) {
      next(error);
    }
  },

  async deleteLogo(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = parse(merchantIdParamsSchema, req.params, "Invalid merchant id");
      const merchant = await merchantAssetsService.removeLogo(id, actorOf(req));
      return success(res, { merchant });
    } catch (error) {
      next(error);
    }
  },

  async addAlias(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = parse(merchantIdParamsSchema, req.params, "Invalid merchant id");
      const { aliasName } = parse(addMerchantAliasSchema, req.body, "Invalid request data");
      const alias = await merchantAssetsService.addAlias(id, actorOf(req), aliasName);
      return created(res, { alias });
    } catch (error) {
      next(error);
    }
  },

  async deleteAlias(req: Request, res: Response, next: NextFunction) {
    try {
      const { id, aliasId } = parse(merchantAliasParamsSchema, req.params, "Invalid alias id");
      await merchantAssetsService.removeAlias(id, aliasId, actorOf(req));
      return success(res, { deleted: true });
    } catch (error) {
      next(error);
    }
  },
};
