import { Router } from "express";
import { pensionService } from "../services/PensionService";
import { householdGuard, requireRole, requireAuth } from "../middleware/auth";
import { generalLimiter } from "../middleware/rateLimit";
import {
  insertPensionHoldingSchema,
  insertPensionContributionSchema,
} from "@shared/schema";
import { z } from "zod";
import { getErrorMessage } from "../core/errors";

const router = Router();

// SEC-AUTH-007: Apply authentication, rate limiting, and household guard
router.use(requireAuth);
router.use(generalLimiter);
router.use(householdGuard);

router.get("/", async (req, res) => {
  try {
    const { householdId } = req.householdContext!;
    const holdings = await pensionService.getHoldings(householdId);
    res.json({ success: true, data: holdings });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// FIX AUTH-PENSION-001: Pass householdId to enforce isolation
router.get("/:id/contributions", async (req, res) => {
  try {
    const { householdId } = req.householdContext!;
    const contributions = await pensionService.getContributions(
      req.params.id,
      householdId
    );
    res.json({ success: true, data: contributions });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// FIX AUTH-PENSION-002: Pass householdId to validate account ownership
// FIX DATA-PENSION-003: Add Zod validation
router.post("/", requireRole("member"), async (req, res) => {
  try {
    const { householdId } = req.householdContext!;

    // Validate input with Zod
    const validated = insertPensionHoldingSchema.parse({
      ...req.body,
      householdId,
    });

    const holding = await pensionService.addHolding(validated, householdId);
    res.json({ success: true, data: holding });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, errors: error.errors });
    }
    res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// FIX AUTH-PENSION-001: Pass householdId to validate holding ownership
// FIX DATA-PENSION-003: Add Zod validation
router.post("/:id/contributions", requireRole("member"), async (req, res) => {
  try {
    const { householdId } = req.householdContext!;

    // Validate input with Zod
    const validated = insertPensionContributionSchema.parse({
      ...req.body,
      pensionHoldingId: req.params.id,
    });

    const contribution = await pensionService.addContribution(
      validated,
      householdId
    );
    res.json({ success: true, data: contribution });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, errors: error.errors });
    }
    res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

export default router;
