import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { householdGuard } from "../middleware/householdGuard";
import { requireCapability } from "../core/authz/requireCapability";
import { ValidationError } from "../core/errors";
import { recordGrzPrincipalBasis } from "../services/grz/principalBasis";

const router = Router();
router.use(requireAuth, householdGuard);
router.post("/bonds/:id/principal-basis", requireCapability("financial.write"), async (req, res, next) => {
  try {
    const id = z.string().uuid().transform(value => value.toLowerCase()).safeParse(req.params.id);
    if (!id.success) throw new ValidationError("Invalid holding identifier");
    const result = await recordGrzPrincipalBasis(req.householdContext!, id.data, req.body, req.ip);
    res.status(result.created ? 201 : 200).json({ success: true, data: result.data });
  } catch (error) { next(error); }
});
export default router;
