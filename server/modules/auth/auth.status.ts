import type { Request, Response, NextFunction } from "express";
import type { SessionStatus, SessionSubject } from "@shared/session-status";
import { resolveSessionIdentity } from "../../auth";
import { resolveImplicitHouseholdContext } from "../../core/authz/implicit-household-context";
import { success } from "../../core/http";
import { mfaCompliance } from "./auth.mfa-compliance";

/** Read-only snapshot, never a grant for later protected requests. */
export async function getSessionStatus(req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "private, no-store");
  res.vary("Cookie");
  try {
    const identity = await resolveSessionIdentity(req);
    let status: SessionStatus;
    if (identity.state !== "authenticated") {
      status = { state: identity.state };
    } else {
      const { user } = identity;
      const subject: SessionSubject = { id: user.id, email: user.email, displayName: user.displayName ?? null };
      const compliance = mfaCompliance(user);
      // Email verification comes first; then, after the MFA grace, enrolment (AH-11).
      if (user.emailVerified !== true) {
        status = { state: "verification_pending", subject };
      } else if (compliance.state === "enrolment_required") {
        status = { state: "mfa_enrolment_required", subject, graceEndedAt: compliance.graceEndsAt };
      } else {
        const mfa = compliance.state === "grace" ? { mfa: compliance } : {};
        const context = await resolveImplicitHouseholdContext(user.id);
        status = context
          ? { state: "ready", subject, household: { id: context.householdId, role: context.role }, ...mfa }
          : { state: "verified_without_household", subject, ...mfa };
      }
    }
    return success(res, status);
  } catch (error) {
    next(error);
  }
}
