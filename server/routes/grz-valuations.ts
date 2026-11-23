import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { householdGuard } from "../middleware/householdGuard";
import { requireCapability } from "../core/authz/requireCapability";
import { ValidationError } from "../core/errors";
import { listGrzBondValuations, recordGrzBondValuation } from "../services/grz/bondValuation";

const router = Router();
router.use(requireAuth, householdGuard);
router.post("/bonds/:id/valuations", requireCapability("financial.write"), async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const result = await recordGrzBondValuation(req.householdContext!, id, req.body, req.ip);
    return res.status(result.created ? 201 : 200).json({ success: true, data: result.data });
  } catch (error) { next(error instanceof z.ZodError ? new ValidationError("Invalid valuation evidence", error.issues) : error); }
});
router.get("/bonds/:id/valuations", requireCapability("financial.read"), async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    return res.json({ success: true, data: await listGrzBondValuations(req.householdContext!, id) });
  } catch (error) { next(error instanceof z.ZodError ? new ValidationError("Invalid holding identifier", error.issues) : error); }
});
export default router;
