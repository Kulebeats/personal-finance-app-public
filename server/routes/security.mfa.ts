/**
 * Security MFA Routes
 *
 * Multi-factor authentication enable/disable/verify operations.
 *
 * @module routes/security.mfa
 */

import { Router } from "express";
import { registerMfaAuthRoutes } from "./security.mfa.auth";
import { registerMfaLoginRoutes } from "./security.mfa.login";
import { registerMfaStepUpRoutes } from "./security.mfa.stepup";
import { strictLimiter } from "../middleware/rateLimit";

const router = Router();

// SEC-RATE-007: Apply strict rate limiting to MFA routes (5 req/min)
// This prevents brute-force attacks on MFA codes
router.use(strictLimiter);

registerMfaAuthRoutes(router);
registerMfaLoginRoutes(router);
registerMfaStepUpRoutes(router);

export default router;
