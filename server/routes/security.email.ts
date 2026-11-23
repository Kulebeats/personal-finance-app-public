import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { requireAuth, requirePendingAwareSessionUser } from "../auth";
import { strictLimiter } from "../middleware/rateLimit";
import { sendVerificationEmail, isEmailServiceConfigured } from "../services/emailService";
import { consumeEmailVerificationToken, requestEmailChange, resendOwnEmailVerification, cancelOwnEmailChange } from "../services/security-email";
import { ValidationError } from "../core/errors";
import { logger } from "../utils/logger";

const router = Router();
const verifySchema = z.object({ token: z.string().min(1).max(256) });
const changeSchema = z.object({ newEmail: z.string().email().max(255), password: z.string().min(1) });
async function sendChallenge(issued: { email: string; token: string; isEmailChange: boolean }, req: Request) {
  const configured = isEmailServiceConfigured();
  try {
    const accepted = await sendVerificationEmail(issued.email, issued.token, issued.isEmailChange);
    return accepted ? "accepted" : configured ? "unknown" : "unavailable";
  } catch {
    logger.error("Email verification delivery outcome unknown", { userId: req.session.userId });
    return "unknown";
  }
}
router.post("/verify", strictLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Invalid token");
    const changed = await consumeEmailVerificationToken(parsed.data.token, { initialOnly: false, request: req });
    return res.json({ success: true, data: null, message: changed ? "Email address updated successfully" : "Email verified successfully" });
  } catch (error) { next(error); }
});
router.post("/resend", strictLimiter, requirePendingAwareSessionUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const issued = await resendOwnEmailVerification(req);
    const delivery = issued ? await sendChallenge(issued, req) : "not_required";
    return res.json({ success: true, data: { delivery }, message: !issued ? "Email already verified" : delivery === "accepted" ? "Verification email accepted for delivery" : "Verification request created; email delivery is not confirmed" });
  } catch (error) { next(error); }
});
router.use(requireAuth);
router.post("/change", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = changeSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Invalid email change request");
    const issued = await requestEmailChange(req, parsed.data.newEmail, parsed.data.password);
    const delivery = await sendChallenge(issued, req);
    const result = {
      success: true, data: { delivery }, message: delivery === "accepted" ? "Verification email accepted for delivery" : "Verification request created; email delivery is not confirmed",
    };
    return res.json(result);
  } catch (error) { next(error); }
});
router.post("/cancel", async (req: Request, res: Response, next: NextFunction) => {
  try { await cancelOwnEmailChange(req); return res.json({ success: true, data: null, message: "Email change cancelled" }); }
  catch (error) { next(error); }
});
export default router;
