import { Router } from "express";
import { healthController } from "./health.controller";
import { generalLimiter } from "../../middleware/rateLimit";

const router = Router();

// SEC-RATE-001: Apply rate limiting to health endpoints to prevent DoS
// Health endpoints are public but still need protection
router.use(generalLimiter);

router.get("/live", healthController.getLive);
router.get("/ready", healthController.getReady);
router.get("/startup", healthController.getStartup);

export default router;
