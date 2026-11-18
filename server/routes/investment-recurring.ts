import { Router } from "express";
import { investmentAutomationService } from "../services/InvestmentAutomationService";
import { householdGuard, requireRole, requireAuth } from "../middleware/auth";
import { generalLimiter } from "../middleware/rateLimit";
import { z } from "zod";
import { getErrorMessage } from "../core/errors";

const router = Router();

// SEC-AUTH-009: Apply authentication, rate limiting, and household guard
router.use(requireAuth);
router.use(generalLimiter);
router.use(householdGuard);

const createRecurringInvestmentSchema = z.object({
  accountId: z.string().uuid(),
  securityId: z.string().uuid().optional().nullable(),
  type: z.enum(["sip", "rollover"]),
  frequency: z.enum([
    "daily",
    "weekly",
    "biweekly",
    "monthly",
    "quarterly",
    "semi_annually",
    "annually",
    "yearly",
    "custom",
  ]),
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Invalid amount format")
    .refine((val) => parseFloat(val) > 0, "Amount must be positive"),
  currency: z.string().length(3).optional(),
  nextExecutionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

router.get("/", async (req, res) => {
  try {
    const { householdId } = req.householdContext!;
    const plans = await investmentAutomationService.getAllPlans(householdId);
    res.json({ success: true, data: plans });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// FIX AUTH-INV-REC-002: Pass householdId to validate account ownership
router.post("/", requireRole("member"), async (req, res) => {
  try {
    const { householdId } = req.householdContext!;
    const parsed = createRecurringInvestmentSchema.parse(req.body);
    const plan = await investmentAutomationService.createPlan(
      {
        ...parsed,
        amount: parsed.amount,
        currency: parsed.currency?.toUpperCase() || "ZMW",
        householdId,
      },
      householdId
    );
    res.json({ success: true, data: plan });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors });
    }
    res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

// FIX AUTH-INV-REC-001: Pass householdId to enforce isolation
router.delete("/:id", requireRole("member"), async (req, res) => {
  try {
    const { householdId } = req.householdContext!;
    await investmentAutomationService.deactivatePlan(req.params.id, householdId);
    res.json({ success: true, message: "Plan deactivated" });
  } catch (error: unknown) {
    res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
});

export default router;
