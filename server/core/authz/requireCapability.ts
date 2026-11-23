import type { NextFunction, Request, Response } from "express";
import { can, type Capability } from "./capabilities";

/** Requires a household guard first; mutation services must recheck under lock. */
export function requireCapability(capability: Capability) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.householdContext) {
      return res.status(500).json({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "Household context not available" },
      });
    }
    if (!can(req.householdContext.role, capability)) {
      return res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: "This action is not permitted for your household role" },
      });
    }
    next();
  };
}
