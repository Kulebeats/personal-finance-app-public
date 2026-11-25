import { Router, type Request } from "express";
import { pensionService } from "../services/PensionService";
import { householdGuard, requireRole, requireAuth } from "../middleware/auth";
import { insertPensionHoldingSchema } from "@shared/schema";
import { pensionContributionSchema } from "./investment-pension.validation";
import { businessAuditService } from "../services/BusinessAuditService";
import { z } from "zod";
import { getErrorMessage, HttpError, UnauthorizedError, ValidationError } from "../core/errors";
import { logger } from "../utils/logger";

const router = Router();
/** The shared 500 body (errorHandler.ts); the cause is logged, never returned. */
const INTERNAL_ERROR_BODY = { success: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } } as const;

function pensionWriter(req: Request) {
  const actor = req.householdContext!;
  if (!req.user || req.user.id !== actor.userId || req.session?.userId !== actor.userId || !req.sessionID) {
    throw new UnauthorizedError("Authentication changed; sign in again");
  }
  return {
    actor,
    session: { snapshot: structuredClone(req.user), sessionId: req.sessionID, generation: req.session.securityGeneration },
    ipAddress: businessAuditService.getIpAddress(req),
  };
}

// SEC-AUTH-007: Apply authentication, rate limiting, and household guard
router.use(requireAuth);
router.use(householdGuard);

router.get("/", async (req, res, next) => {
  try {
    const holdings = await pensionService.getHoldings(req.householdContext!);
    res.json({ success: true, data: holdings });
  } catch (error: unknown) {
    next(error);
  }
});

// FIX AUTH-PENSION-001 + A-56: only a holding the actor can see (else 404)
router.get("/:id/contributions", async (req, res, next) => {
  try {
    const contributions = await pensionService.getContributions(req.params.id, req.householdContext!);
    res.json({ success: true, data: contributions });
  } catch (error: unknown) {
    next(error);
  }
});

// FIX AUTH-PENSION-002: Pass householdId to validate account ownership
// FIX DATA-PENSION-003: Add Zod validation
router.post("/", requireRole("member"), async (req, res) => {
  try {
    const writer = pensionWriter(req);

    // Validate input with Zod
    const validated = insertPensionHoldingSchema.parse({
      ...req.body,
      householdId: writer.actor.householdId,
    });

    const holding = await pensionService.addHolding(validated, writer);
    res.json({ success: true, data: holding });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, errors: error.errors });
    }
    if (error instanceof HttpError) {
      return res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
    }
    // NEW-24: log the cause; never return raw error text.
    logger.error("Pension holding create failed", { householdId: req.householdContext?.householdId, detail: getErrorMessage(error) },
      error instanceof Error ? error : undefined);
    res.status(500).json(INTERNAL_ERROR_BODY);
  }
});

// NEW-24: validated, atomic and audited. Amounts are MoneyDto objects; the
// service locks the holding, checks its currency and writes the audit row.
router.post("/:id/contributions", requireRole("member"), async (req, res) => {
  try {
    const parsed = pensionContributionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid pension contribution", parsed.error.errors);
    }

    const contribution = await pensionService.addContribution(parsed.data, {
      pensionHoldingId: req.params.id,
      ...pensionWriter(req),
    });
    res.status(201).json({ success: true, data: contribution });
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return res.status(error.statusCode).json({ success: false, error: { code: error.code, message: error.message } });
    }
    logger.error("Pension contribution failed", { householdId: req.householdContext?.householdId,
      pensionHoldingId: req.params.id, detail: getErrorMessage(error) }, error instanceof Error ? error : undefined);
    res.status(500).json(INTERNAL_ERROR_BODY);
  }
});

export default router;
