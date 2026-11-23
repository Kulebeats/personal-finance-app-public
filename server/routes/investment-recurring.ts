import { Router, type Request } from "express";
import { investmentAutomationService } from "../services/InvestmentAutomationService";
import { householdGuard, requireRole, requireAuth } from "../middleware/auth";
import { UnauthorizedError } from "../core/errors";
import type { InvestmentSourceSession } from "../modules/investments/investmentTransactionAccess";

const router = Router();

router.use(requireAuth);
router.use(householdGuard);

/** Capture the actual authenticated identity before the first handler await.
 * Service locks must recheck this snapshot, never adopt a newer credential. */
function signedSession(req: Request): InvestmentSourceSession {
  if (!req.user || req.session?.userId !== req.user.id || !req.sessionID) throw new UnauthorizedError("Authentication required");
  return { snapshot: structuredClone(req.user), sessionId: req.sessionID, generation: req.session.securityGeneration };
}

router.get("/", async (req, res, next) => {
  try {
    const session = signedSession(req), actor = { ...req.householdContext! };
    const plans = await investmentAutomationService.getAllPlans(actor, session);
    res.json({ success: true, data: plans });
  } catch (error) { next(error); }
});

router.post("/", requireRole("member"), async (req, res, next) => {
  try {
    const session = signedSession(req), actor = { ...req.householdContext! };
    const plan = await investmentAutomationService.createPlan(req.body, actor, session);
    res.json({ success: true, data: plan });
  } catch (error) { next(error); }
});

router.post("/:id/authorize", requireRole("member"), async (req, res, next) => {
  try {
    const session = signedSession(req), actor = { ...req.householdContext! };
    const plan = await investmentAutomationService.authorizePlan(req.params.id, req.body, actor, session);
    res.json({ success: true, data: plan });
  } catch (error) { next(error); }
});

router.delete("/:id", requireRole("member"), async (req, res, next) => {
  try {
    const session = signedSession(req), actor = { ...req.householdContext! };
    await investmentAutomationService.deactivatePlan(req.params.id, actor, session);
    res.json({ success: true, message: "Plan deactivated" });
  } catch (error) { next(error); }
});

export default router;
