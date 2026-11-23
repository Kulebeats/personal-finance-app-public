import { Router } from "express";
import { healthController } from "./health.controller";
import rateLimit, { MemoryStore } from "express-rate-limit";

const router = Router();

// Health must remain usable when Redis is unavailable. Keep the existing
// 100/minute public-IP budget in a process-local store, independent of API
// coordination. Multi-instance health counters are intentionally per process.
export const healthLimiter = rateLimit({
  windowMs: 60_000,
  limit: 100,
  store: new MemoryStore(),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ success: false, error: {
      code: "RATE_LIMITED", message: "Too many requests. Please try again later.", retryAfter: 60,
    } });
  },
});
router.use(healthLimiter);

router.get("/live", healthController.getLive);
router.get("/ready", healthController.getReady);
router.get("/startup", healthController.getStartup);

export default router;
