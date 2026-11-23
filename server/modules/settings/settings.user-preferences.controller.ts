import type { Request, Response, NextFunction } from "express";
import { success } from "../../core/http";
import { UnauthorizedError, ValidationError } from "../../core/errors";
import { readUserPersonalPreferences, patchUserPersonalPreferences } from "../../repositories/UserPersonalPreferences";
import { toUserPreferencesResponse, userPreferencesPatchSchema } from "@shared/user-preferences";

export const userPreferencesController = {
  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.session.userId!;
      const row = await readUserPersonalPreferences(userId);
      return success(res, { preferences: toUserPreferencesResponse(userId, row) });
    } catch (error) {
      next(error);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const result = userPreferencesPatchSchema.safeParse(req.body);
      if (!result.success) throw new ValidationError("Invalid personal preferences", result.error.errors);

      const snapshot = req.user;
      if (!snapshot) throw new UnauthorizedError("Authentication changed; sign in again");
      const row = await patchUserPersonalPreferences(snapshot, req.sessionID, req.session.securityGeneration, result.data);
      return success(res, { preferences: toUserPreferencesResponse(snapshot.id, row) });
    } catch (error) {
      next(error);
    }
  },
};
