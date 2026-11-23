import type { NextFunction, Request, Response } from "express";
import { isIP } from "node:net";
import { created } from "../core/http";
import { UnauthorizedError } from "../core/errors";
import { insertCatalogueSecurity } from "../modules/investments/investmentSecurityCreate";
import { withTransaction } from "../utils/withTransaction";

/**
 * POST /api/admin/securities (super_admin). NEW-13: the only way onto the
 * curated list every household picks from; the row has no owning household.
 */
export async function createCuratedSecurity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.session?.userId;
    if (!userId) throw new UnauthorizedError("Authentication required");
    const requestIp = req.ip?.split("%")[0];
    const security = await withTransaction(tx => insertCatalogueSecurity(tx, req.body, null, {
      userId,
      householdId: null,
      ipAddress: requestIp && isIP(requestIp) ? requestIp : undefined,
    }));
    created(res, security);
  } catch (error) {
    next(error);
  }
}
