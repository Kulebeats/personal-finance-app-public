# Step-Up Re-Authentication ("Sudo Mode") — Design Spec

**Date:** 2026-06-05
**Status:** Approved (brainstorming) — pending spec review → implementation plan
**Canonical copy:** also maintained at [docs/architecture/step-up-reauth-design.md](../../architecture/step-up-reauth-design.md)
**Related:** `docs/architecture/auth-session-strategy.md`, `docs/reviews/production-readiness-audit-2026-06-04.md`

---

## 1. Problem (verified end-to-end)

The `requireStepUp` middleware (`server/middleware/requireStepUp.ts`) gates destructive/financial actions on `req.session.stepUpVerifiedAt`. It returns `401 { requiresStepUp: true, error.code: "STEP_UP_REQUIRED", level, ttlMinutes }` when that timestamp is missing or older than the level TTL.

The **only** code that sets `stepUpVerifiedAt` is `setStepUpVerified()`, called solely by `POST /api/settings/security/step-up` (`server/routes/security.mfa.stepup.ts`). That endpoint returns `400 "MFA not enabled"` when `user.mfaEnabled` is false.

With `MFA_ENFORCEMENT_ENABLED = false` (`auth.mfa-policy.ts:35`) and `mfa_enabled` defaulting to `false` (`shared/schema.ts:297`), **a default user can never satisfy step-up** — every gated route is permanently `401` with no recovery path.

### Gated routes (all unsatisfiable for non-MFA users today)

| Route | Level |
|---|---|
| `DELETE /api/accounts/:id` | DESTRUCTIVE |
| `POST /api/transactions/transfer` | FINANCIAL |
| `PUT /api/transactions/transfer/:id` | FINANCIAL |
| `PUT /api/settings/password` | SETTINGS |
| `DELETE /api/settings/sessions/:id` | SETTINGS |
| `POST /api/settings/sessions/revoke-all` | DESTRUCTIVE |
| `POST /api/settings/account/delete` | DESTRUCTIVE |
| `POST /api/settings/account/export` | SETTINGS |

### Additional findings (beyond the original report)

1. **Step-up is broken for *everyone*, even MFA-enabled users.** MFA here is **email-OTP, not TOTP** (`auth.mfa.service.ts:201`). No endpoint issues a *step-up* code — `mfa_code` is only set transiently during the login challenge (`beginMfaLogin`) or the deprecated login `/send-code`. Even an enrolled user has no reliable way to obtain a fresh step-up code.
2. **Email may be unconfigured** (`isEmailServiceConfigured()` can be false), making any MFA-mandatory approach unsafe as a default.
3. **Client has zero handling.** No file in `client/src` references `requiresStepUp`/`STEP_UP_REQUIRED`. `api.ts` throws `error.code = "STEP_UP_REQUIRED"`; gated mutations (e.g. `useDeleteAccount`) show a generic toast → UI dead-ends.
4. **The bug is test-masked.** `accounts.integration.test.ts:81-83` mocks `requireStepUp` to a no-op, so the DELETE test passes green.

---

## 2. Decision

Implement **password re-authentication ("sudo mode")**: make the step-up endpoint satisfiable by the user's **current password** for every user, while still accepting an emailed MFA code for enrolled users. The middleware stays **enforcing** — we fix *how step-up is satisfied*, not the gate.

**Rationale:** keeps step-up a genuine security control (re-auth before destructive/financial actions, the GitHub/Google "confirm your password" pattern), works for the default non-MFA user, fixes the latent no-code-issuance gap, requires no email service, and stays compatible with later enabling `MFA_ENFORCEMENT_ENABLED`.

### Non-goals
- Not enabling MFA enforcement or mandatory enrolment.
- Not introducing TOTP.
- Not changing the set of gated routes.

### Explicit trade-off
Password step-up is accepted **even for MFA-enrolled users** (sudo = re-auth, not necessarily second factor). If MFA enforcement is later turned on, a follow-up toggle can require the code path for enrolled users.

---

## 3. Backend design

### 3.1 `POST /api/settings/security/step-up` — dual-mode
Request schema (Zod): `{ password?: string, code?: string }` with `.refine()` requiring **at least one**. `code` keeps the 6-char constraint when present.

| Condition | Action |
|---|---|
| `code` present **and** `user.mfaEnabled` **and** code valid/unexpired | verify emailed OTP, clear `mfa_code`/`mfa_code_expiry` (one-time), **success** |
| `password` present **and** `verifyPassword(password, user.passwordHash)` | **success** |
| otherwise | audit `MFA_FAILED`, return `401 { error.code: "INVALID_CREDENTIALS", message: "Invalid credentials" }` |

On success: `setStepUpVerified(req)`; audit `MFA_VERIFIED` with `details: { action: "step-up", method: "password" | "mfa_code" }`; respond `200 { success: true, expiresIn }`.

Notes: generic failure message (no password-vs-code / MFA-enabled enumeration); `verifyPassword` is `bcrypt.compare` (`server/auth.ts:168`); keep `requireAuth`.

### 3.2 Rate limiting (new)
Apply `authLimiter` (10/min) to `POST /step-up` — a hijacked session must not brute-force the password to escalate to sudo. The route currently has no limiter.

### 3.3 TTL change
`STEP_UP_TTL`: **DESTRUCTIVE 1 min → 5 min**. Final: `FINANCIAL 5`, `SETTINGS 15`, `DESTRUCTIVE 5` (minutes).

### 3.4 `requireStepUp` middleware
**Unchanged** behaviour (still enforces). Existing 401 payload (`requiresStepUp`, `level`, `ttlMinutes`) is sufficient for the client. No no-op escape hatch.

---

## 4. Frontend design

### 4.1 Centralized 401 interception + retry — `client/src/lib/api.ts`
Gives all 8 gated routes step-up handling with zero per-hook changes.
- Module-level bridge `registerStepUpHandler(fn)` + `let stepUpHandler`.
- In `apiCall`: on `401` + `error.code === "STEP_UP_REQUIRED"` (or `data.requiresStepUp`), with a handler registered and not already retrying → `await stepUpHandler(level)`; if verified, **retry once** (internal flag guards loops); if cancelled, throw original error.
- New `securityApi.stepUp({ password?, code? })` → `POST /settings/security/step-up` (not gated; CSRF auto-attached).

### 4.2 `StepUpProvider` + `StepUpDialog` (new, `client/src/components/security/`)
- `StepUpProvider` mounts at app root, owns dialog state, registers the handler (opens dialog, returns promise resolving `true` on verify / `false` on cancel).
- `StepUpDialog` — Radix modal matching `@/components/ui`: copy keyed off `level`, password field, inline error, submit → `securityApi.stepUp({ password })`. **Password-only for v1**; backend still accepts `code` so an MFA-code field can be added later. Labelled input, keyboard/focus, error announced (WCAG 2.1 AA).

### 4.3 UX result
Gated mutations need no change: 401 → dialog → confirm password → original request transparently retries and succeeds. Cancel → original error surfaces.

---

## 5. Testing strategy (requirement #3)

New real-DB integration test `server/modules/accounts/__tests__/accounts.stepup.db.integration.test.ts` (pattern: `getTestApp()`, **real `requireStepUp`, no mocks**, real Postgres, assert DB state). Per the `real-db-integration-test` skill, the key case **must fail against unfixed code and pass against the fix**.

Fixtures: household, **non-MFA** user with known password (`hashPassword`), two accounts (+ categories for transfer). Auth via `POST /api/auth/login`, reuse `set-cookie` so session/`stepUpVerifiedAt` persists.

Cases:
1. **DESTRUCTIVE fail-then-pass:** `POST /step-up { password }` → **200** (unfixed: 400 → FAILS). Then `DELETE /accounts/:id` → **200**, assert `deleted_at` set in DB.
2. **FINANCIAL cross-level:** step up, `POST /transactions/transfer` → 200/201, assert both rows persisted.
3. **No step-up → blocked:** `DELETE` → 401, `requiresStepUp === true`, `error.code === "STEP_UP_REQUIRED"`.
4. **Wrong password → blocked:** `POST /step-up { password:"wrong" }` → 401; `DELETE` still 401.

Existing mocked `accounts.integration.test.ts` retained (controller validation) with a comment pointing to the real-DB test as the authoritative guard.

---

## 6. Verification

1. Run new test vs **unfixed** code → cases 1–2 **fail**.
2. Apply backend fix → new test **passes**.
3. `npm run check`, `npm run test:server:run`, `npm run test:run`.
4. Trace end-to-end non-MFA delete: 401 → dialog → password → step-up 200 → delete 200.

---

## 7. Files touched

**Backend:** `security.mfa.stepup.ts` (dual-mode + audit method), step-up registration site (`authLimiter`), `requireStepUp.ts` (DESTRUCTIVE TTL).
**Frontend:** `lib/api.ts`, `components/security/StepUpDialog.tsx` (new), `components/security/StepUpProvider.tsx` (new), app root wiring.
**Tests:** `accounts.stepup.db.integration.test.ts` (new); optional client test.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Brute-force oracle | `authLimiter` + generic failure + behind `requireAuth`. |
| Infinite retry loop | Retry once, internal flag. |
| Session not persisting in tests | Reuse login `set-cookie`; express-session saves per request. |
| CSRF in test env | Existing db tests POST without token; confirm at implementation. |
| Weakened step-up for MFA users | Documented trade-off; future enforcement toggle. |
| Local verification needs Postgres | Confirmed reachable (`finance_app`, migrated); CI uses ephemeral Postgres. |

---

## 9. Security considerations
- No secrets logged; password never persisted/echoed.
- Audit success + failure with `method`, IP, user-agent (Zambia DPA monitoring).
- No PII in responses; generic failure messages (no enumeration).
- Step-up stays session-scoped and time-boxed.
