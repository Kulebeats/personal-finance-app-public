# Auth Security & UX Hardening Plan

**Date:** 2026-01-27  
**Scope:** Reconcile auth review docs with current code and close remaining gaps.

---

## What This Plan Addresses

This plan focuses on the remaining high-impact gaps found by:

- `docs/reviews/auth/auth-fintech-review.md`
- `docs/reviews/auth/auth-module-assessment.md`
- `docs/reviews/auth/auth-senior-dev-review.md`
- `docs/reviews/auth/auth-ux-review.md`
- `docs/reviews/auth/auth-qa-review.md`
- `docs/reviews/auth/auth-functionality-review.md`

It also incorporates newly observed issues in the current codebase.

---

## Reality Check (Docs vs Current Code)

Several review documents are now partially outdated:

- LOC compliance is now effectively met: `server/modules/auth/auth.service.ts` is under 500 LOC.
- MFA extraction is implemented: `server/modules/auth/auth.mfa.service.ts`.
- Modular auth is active: `server/routes.ts:109`.
- UX items like strength meter, forgot password link, and caps lock warnings exist in `client/src/pages/Login.tsx`.

---

## Outstanding Issues To Close

### P0 - Security Correctness (Do First)

1. **MFA codes are stored in plaintext and logged.**
   - Evidence: `server/modules/auth/auth.mfa.service.ts:55`, `server/modules/auth/auth.mfa.service.ts:68`
   - Risk: OTP disclosure via logs and database.

2. **Step-up MFA exists but appears unused in routes.**
   - Evidence: `server/middleware/requireStepUp.ts:21`
   - Current state: no route usage found via search.

3. **No IP-based auth limiter in addition to the existing limiter.**
   - Current state: no `ipAuthLimiter` found in `server/middleware/rateLimit.ts`.

4. **Some security tests are still missing.**
Missing explicit tests for session fixation (session ID changes on login), CSRF enforcement for protected endpoints, and rate limiting behavior (not just wiring).

### P1 - Security + UX Improvements (Next)

5. **MFA verification UX can be improved.**
   - Add resend code with cooldown.
   - Show masked destination email.
   - Support backup code entry explicitly.

6. **Post-registration and “no household” states are fragile.**
   - Many routes return 404 when no household exists.
   - Provide a guided creation flow immediately after registration.

### P2 - Deferred But Valuable

7. **MFA policy and password history are present but not integrated.**
   - Policy: `server/modules/auth/auth.mfa-policy.ts`
   - Password history: `server/modules/auth/auth.password-history.ts`

8. **Geo anomaly detection is still a stub without GeoIP.**
   - Evidence: `server/modules/auth/strategies/geo-anomaly.ts`

9. **Email verification is not enforced before full activation.**
   - Noted in `auth-functionality-review.md` as FUNC-001.

---

## Technical Specifications

### TS-01 MFA Code Storage Hardening

Goal: MFA codes must be hashed at rest and never logged.

Schema change:

```sql
-- migrations/2026-01-27-auth-mfa-code-text.sql
ALTER TABLE users
  ALTER COLUMN mfa_code TYPE text;
```

Backend changes:

- Update `server/modules/auth/auth.mfa.service.ts`.
- Replace plaintext storage with bcrypt hash.
- Replace direct string comparison with bcrypt compare.
- Remove MFA code from `logger.warn(...)` and `console.log(...)`.

Reference implementation sketch:

```ts
// auth.mfa.service.ts
import { hashPassword, verifyPassword } from "../../auth";

const hashedCode = await hashPassword(code);
await userRepository.update(user.id, {
  mfaCode: hashedCode,
  mfaCodeExpiry: expiry,
});

// later, during verify
mfaVerified = await verifyPassword(data.code, user.mfaCode);
```

Test specifications:

- Add MFA hashing tests in `server/modules/auth/__tests__/auth.security.test.ts`.
- Verify `mfaCode` stored is not equal to the raw OTP.
- Verify correct OTP succeeds and incorrect OTP fails.
- Verify expired OTP is rejected.

### TS-02 Step-Up MFA Enforcement Wiring

Goal: Tiered step-up TTL exists and must be enforced on sensitive endpoints.

Middleware reference:

- `server/middleware/requireStepUp.ts`

Wiring requirements:

- Apply `requireStepUp("FINANCIAL")` to money movement endpoints.
- Apply `requireStepUp("DESTRUCTIVE")` to account deletion and similar actions.
- Apply `requireStepUp("SETTINGS")` to highly sensitive settings.

Implementation targets (examples to confirm via code search):

- Transfers or payments routes.
- Session revocation or device trust removal.
- Account deletion routes.

Test specifications:

- Add route-level tests that assert `401 STEP_UP_REQUIRED` without recent step-up.
- Add route-level tests that succeed when `req.session.stepUpVerifiedAt` is fresh.

### TS-03 IP-Based Auth Rate Limiting

Goal: Add an additional IP-scoped limiter to defend against credential stuffing.

File changes:

- Update `server/middleware/rateLimit.ts`.
- Update `server/modules/auth/auth.routes.ts`.

Reference implementation sketch:

```ts
// rateLimit.ts
export const ipAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `ip:${getClientIp(req)}`,
  handler: createRateLimitHandler(15 * 60 * 1000),
  skip: () => process.env.NODE_ENV === "test",
});

// auth.routes.ts
router.post("/login", ipAuthLimiter, authLimiter, authController.login);
router.post("/register", ipAuthLimiter, authLimiter, authController.register);
```

Test specifications:

- Add tests that configure limiters with very small limits in test mode.
- Assert 429 responses after threshold is exceeded.

### TS-04 Session Sanity Middleware

Goal: Prevent 500s from stale or corrupted sessions.

Problem observed:

- A non-UUID `req.session.userId` can cause database UUID parse failures.

File changes:

- Add `server/middleware/sessionSanity.ts`.
- Mount early in `server/app.ts` after session setup and before route handlers.

Reference implementation sketch:

```ts
// sessionSanity.ts
import { validate as isUuid } from "uuid";
import { logger } from "../utils/logger";

export function sessionSanity(req, _res, next) {
  const userId = req.session?.userId;
  if (userId && !isUuid(userId)) {
    logger.warn("Invalid session userId detected, destroying session", {
      userIdPreview: String(userId).slice(0, 12),
    });
    req.session.destroy(() => next());
    return;
  }
  next();
}
```

Test specifications:

- Add a focused middleware test that injects a bad `session.userId`.
- Assert the session is destroyed and request proceeds unauthenticated.

### TS-05 MFA UX Improvements

Goal: MFA users should have a clear, recoverable verification experience.

Client changes:

- Update `client/src/pages/Login.tsx`.
- Add an MFA resend flow with cooldown.
- Show masked destination email.
- Support backup code entry explicitly.

Backend changes:

- Add `POST /api/auth/mfa/resend` in `auth.routes.ts` and `auth.controller.ts`.
- Implement `authMfaService.resendMfaLogin(req)` with this flow: 1) require `req.session.mfaPendingUserId`, 2) regenerate a new code and expiry, 3) store a hashed code, 4) send email if configured.

Resend endpoint sketch:

```ts
// auth.routes.ts
router.post("/mfa/resend", authLimiter, authController.resendMfa);
```

Resend service sketch:

```ts
// auth.mfa.service.ts
async resendMfaLogin(req: Request): Promise<void> {
  const pendingUserId = req.session.mfaPendingUserId;
  if (!pendingUserId) throw new UnauthorizedError("MFA session not found");
  const user = await userRepository.findById(pendingUserId);
  if (!user) throw new NotFoundError("User not found");
  // reuse beginMfaLogin with rememberMe from session
}
```

Test specifications:

- Add resend tests that require pending MFA session state.
- Assert resend fails without pending session.
- Assert resend rotates the stored MFA code.

### TS-06 Post-Registration Onboarding (Household Creation)

Goal: Eliminate “no household” 404 loops for new users.

Options:

- Server-driven: automatically create a default household on registration.
- Client-driven: route new users to a “Create Household” flow immediately after registration.

Server-driven specification:

- Update `server/modules/auth/auth.service.ts:register`.
- After user creation, create a household and add the user as owner.
- This aligns with module guard expectations.

Client-driven specification:

- On successful registration, route to `/onboarding/household`.
- The onboarding screen creates a household with CSRF token support.

---

## Implementation Plan

### Phase 1 - Close P0 Security Gaps

1. **Hash MFA codes safely and stop logging them**
Schema change: update `users.mfa_code` to support hashed values (for example, `text`).  
Service changes: hash MFA codes in `auth.mfa.service.ts`, compare with bcrypt, and remove MFA code from all logs and console output.  
Tests: add MFA verification tests for hashed codes and expiry behavior.

2. **Apply step-up MFA to sensitive routes**
Identify financial and destructive endpoints, apply `requireStepUp("FINANCIAL")` and `requireStepUp("DESTRUCTIVE")`, and add step-up tests for protected endpoints.

3. **Add IP-based rate limiting for auth endpoints**
Add a separate IP-based limiter in `server/middleware/rateLimit.ts`, apply it to `/api/auth/login` and `/api/auth/register`, and add rate limiting tests that assert 429 behavior.

4. **Add session sanity middleware**
Validate `req.session.userId` is a UUID, and if invalid, destroy the session and continue unauthenticated. This prevents 500s from stale or corrupted cookies.

### Phase 2 - Improve MFA UX and Onboarding

5. **MFA UX improvements in `Login.tsx`**
   - Resend code button with cooldown timer.
   - Masked email hint (for example: `k***@g***.com`).
   - “Use backup code” toggle.
   - Clear errors and allow returning to login safely.

6. **Post-registration onboarding**
   - Guide the user to create a household immediately after registration.
   - Or automatically create a default household server-side if appropriate.

### Phase 3 - Integrate Security Policies

7. **Integrate MFA policy**
   - Use `auth.mfa-policy.ts` in the login and post-login flows.
   - At minimum, surface “MFA recommended/required” in responses.

8. **Integrate password history**
   - Enforce history checks in password change flows.
   - Ensure old password hash is recorded on change.

---

## Suggested Acceptance Criteria

### Security

- MFA codes are hashed at rest and never logged.
- Sensitive routes enforce step-up MFA.
- Auth endpoints have both user- and IP-based rate limiting.
- Invalid sessions do not crash routes.

### Tests

- Auth test suite remains green.
- New tests cover MFA hashing and verification, step-up enforcement, rate limiting 429 behavior, and session fixation defense.

### UX

- MFA users can always complete login without guessing next steps.
- New users are not stranded by “no household” 404s.

---

## Notes

- This plan is intentionally focused on closing real remaining gaps.
- It complements the existing overhaul docs and clarifies what is truly done vs deferred.
