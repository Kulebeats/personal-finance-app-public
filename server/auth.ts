import { type Request, type Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";
import { userRepository } from "./repositories/UserRepository";
import type { User } from "@shared/schema";
import { logger } from "./utils/logger";
import { passwordPolicySchema } from "./modules/auth/auth.password-policy";
import { HttpError, MfaEnrolmentRequiredError, UnauthorizedError } from "./core/errors";
import { mfaCompliance } from "./modules/auth/auth.mfa-compliance";
import { readSessionPreconditions, assertSubjectPrecondition, assertHouseholdPrecondition, resolveRequestImplicitHouseholdContext } from "./core/authz/session-preconditions";

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export type SessionIdentity =
  | { state: "anonymous" }
  | { state: "mfa_pending" }
  | { state: "authenticated"; user: User };

/** Recheck the current row; attachUser and session flags are not authority.
 * The guarded store separately fences selected-SID revocation and delayed saves.
 */
export async function resolveSessionIdentity(req: Request): Promise<SessionIdentity> {
  const userId = req.session?.userId;
  const pendingId = req.session?.mfaPendingUserId;
  if (userId && pendingId) throw new UnauthorizedError("Authentication changed; sign in again");
  const id = userId || pendingId;
  if (!id) return { state: "anonymous" };
  const generation = userId ? req.session.securityGeneration : req.session.mfaPendingSecurityGeneration;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ||
      (generation !== undefined && (!Number.isSafeInteger(generation) || generation < 0))) return { state: "anonymous" };
  const user = await userRepository.findById(id);
  if (!user || user.erasedAt || user.passwordHash.startsWith("!erased!") ||
      (user.securityGeneration ?? 0) !== (generation ?? 0)) return { state: "anonymous" };
  return userId ? { state: "authenticated", user } : { state: "mfa_pending" };
}

async function resolveAuthorizedUser(
  req: Request, res: Response, verified: boolean, explicitHousehold = false, allowMfaEnrolment = false,
): Promise<User | undefined> {
  // A cached user must not survive a failed authorization decision.
  delete req.user;
  try {
    const preconditions = readSessionPreconditions(req);
    const identity = await resolveSessionIdentity(req);
    if (identity.state !== "authenticated") {
      res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } });
      return;
    }
    assertSubjectPrecondition(preconditions, identity.user.id);
    if (verified && identity.user.emailVerified !== true) {
      res.status(403).json({ success: false, error: { code: "EMAIL_VERIFICATION_REQUIRED", message: "Verify your email address to continue. You can request another verification email or sign out." } });
      return;
    }
    // AH-11: after the grace, no data until MFA is on. Uses the row loaded above (no extra query),
    // so a session that began in the grace is stopped the moment the grace ends.
    if (verified && !allowMfaEnrolment) {
      const compliance = mfaCompliance(identity.user);
      if (compliance.state === "enrolment_required") throw new MfaEnrolmentRequiredError(compliance.graceEndsAt);
    }
    if (verified && !explicitHousehold && preconditions.household) {
      const context = await resolveRequestImplicitHouseholdContext(req, identity.user.id);
      assertHouseholdPrecondition(preconditions, context?.householdId);
    }
    req.user = identity.user;
    return identity.user;
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.statusCode).json(error.toJSON());
      return;
    }
    logger.error("Error resolving session user", { requestId: req.requestId }, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Failed to verify user" } });
  }
}

/** Shared verified check for guards that are also mounted independently. */
export function resolveVerifiedSessionUser(req: Request, res: Response, options: { explicitHousehold?: boolean } = {}): Promise<User | undefined> {
  return resolveAuthorizedUser(req, res, true, options.explicitHousehold);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (await resolveVerifiedSessionUser(req, res)) next();
}

/** Explicit-target routes must select this mode before householdGuardWithId.
 * Subject/verification remain mandatory; that guard checks target membership
 * and household expectation. Never infer this mode from request body/params.
 */
export async function requireAuthForExplicitHousehold(req: Request, res: Response, next: NextFunction) {
  if (await resolveVerifiedSessionUser(req, res, { explicitHousehold: true })) next();
}

/**
 * AH-11: the verified check WITHOUT the mandatory-MFA gate, so a member past the grace
 * can still step up and enrol. Attach it per route, on exactly the step-up and
 * enrolment handlers (server/routes/security.ts); never on a router or a path prefix.
 */
export async function requireAuthAllowingMfaEnrolment(req: Request, res: Response, next: NextFunction) {
  if (await resolveAuthorizedUser(req, res, true, false, true)) next();
}

/** Compatibility export: both variants populate the same current verified user. */
export const requireAuthWithUser = requireAuth;

/** Narrow own-identity/recovery routes only; never admits MFA-only identity. */
export async function requirePendingAwareSessionUser(req: Request, res: Response, next: NextFunction) {
  if (await resolveAuthorizedUser(req, res, false)) next();
}

/**
 * Middleware to attach user to request
 */
export async function attachUser(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (req.session.userId) {
    try {
      const user = await userRepository.findById(req.session.userId);
      if (user) {
        req.user = user;
      }
    } catch (error) {
      logger.error(
        "Error attaching user",
        { requestId: req.requestId },
        error as Error
      );
    }
  }
  next();
}

/**
 * Hash password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 12;
  return await bcrypt.hash(password, saltRounds);
}

/**
 * Verify password against hash
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}

/**
 * Validate password complexity
 * Requirements: minimum 8 characters, uppercase, numbers, special characters
 */
export function validatePasswordComplexity(password: string): {
  valid: boolean;
  errors: string[];
} {
  const result = passwordPolicySchema.safeParse(password);
  return { valid: result.success, errors: result.success ? [] : result.error.issues.map((issue) => issue.message) };
}
