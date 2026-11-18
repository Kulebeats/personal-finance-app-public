# Step-Up Re-Authentication ("Sudo Mode") — Design Spec

**Date:** 2026-06-05
**Status:** Approved (brainstorming) — pending spec review → implementation plan
**Related:** [auth-session-strategy.md](./auth-session-strategy.md), `docs/reviews/production-readiness-audit-2026-06-04.md`
**Owner:** Auth/Security

---

## 1. Problem (verified end-to-end)

The `requireStepUp` middleware ([server/middleware/requireStepUp.ts](../../server/middleware/requireStepUp.ts)) gates destructive/financial actions on `req.session.stepUpVerifiedAt`. It returns `401 { requiresStepUp: true, error.code: "STEP_UP_REQUIRED", level, ttlMinutes }` when that timestamp is missing or older than the level TTL.

The **only** code that sets `stepUpVerifiedAt` is `setStepUpVerified()`, called solely by `POST /api/settings/security/step-up` ([server/routes/security.mfa.stepup.ts](../../server/routes/security.mfa.stepup.ts)). That endpoint returns `400 "MFA not enabled"` when `user.mfaEnabled` is false.

With `MFA_ENFORCEMENT_ENABLED = false` ([auth.mfa-policy.ts:35](../../server/modules/auth/auth.mfa-policy.ts)) and `mfa_enabled` defaulting to `false` ([schema.ts:297](../../shared/schema.ts)), **a default user can never satisfy step-up** — every gated route is permanently `401` with no recovery path.

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

1. **Step-up is broken for *everyone*, even MFA-enabled users.** MFA here is **email-OTP, not TOTP** ([auth.mfa.service.ts:201](../../server/modules/auth/auth.mfa.service.ts)). No endpoint issues a *step-up* code — `mfa_code` is only set transiently during the login challenge (`beginMfaLogin`) or the deprecated login `/send-code`. So even an enrolled user has no reliable way to obtain a fresh step-up code.
2. **Email may be unconfigured** (`isEmailServiceConfigured()` can be false), making any MFA-mandatory approach unsafe as a default.
3. **Client has zero handling.** No file in `client/src` references `requiresStepUp`/`STEP_UP_REQUIRED`. [api.ts](../../client/src/lib/api.ts) throws `error.code = "STEP_UP_REQUIRED"`; gated mutations (e.g. `useDeleteAccount`) show a generic toast → UI dead-ends.
4. **The bug is test-masked.** [accounts.integration.test.ts:81-83](../../server/modules/accounts/__tests__/accounts.integration.test.ts) mocks `requireStepUp` to a no-op, so the DELETE test passes green.

---

## 2. Decision

Implement **password re-authentication ("sudo mode")**: make the step-up endpoint satisfiable by the user's **current password** for every user, while still accepting an emailed MFA code for enrolled users. The middleware stays **enforcing** — we fix *how step-up is satisfied*, not the gate.

**Rationale:** This keeps step-up a genuine security control (re-auth before destructive/financial actions, the GitHub/Google "confirm your password" pattern), works for the default non-MFA user, fixes the latent no-code-issuance gap, requires no email service, and stays compatible with later enabling `MFA_ENFORCEMENT_ENABLED`.

### Non-goals
- Not enabling MFA enforcement or mandatory enrolment.
- Not introducing TOTP.
- Not changing the set of gated routes.

### Explicit trade-off
Password step-up is accepted **even for MFA-enrolled users** (sudo = re-auth, not necessarily second factor). If MFA enforcement is later turned on, a follow-up toggle can require the code path for enrolled users. Documented here so it is a conscious choice, not an accident.

---

## 3. Backend design

### 3.1 `POST /api/settings/security/step-up` — dual-mode

Request schema (Zod): `{ password?: string, code?: string }` with `.refine()` requiring **at least one**. `code` keeps the 6-char constraint when present.

Verification logic:

| Condition | Action |
|---|---|
| `code` present **and** `user.mfaEnabled` **and** code valid/unexpired | verify emailed OTP, clear `mfa_code`/`mfa_code_expiry` (one-time), **success** |
| `password` present **and** `verifyPassword(password, user.passwordHash)` | **success** |
| otherwise | audit `MFA_FAILED`, return `401 { error.code: "INVALID_CREDENTIALS", message: "Invalid credentials" }` |

On success: `setStepUpVerified(req)`; audit `MFA_VERIFIED` with `details: { action: "step-up", method: "password" | "mfa_code" }`; respond `200 { success: true, expiresIn }`.

Notes:
- Generic failure message — do not reveal whether password vs code was wrong, or whether MFA is enabled.
- `verifyPassword` is `bcrypt.compare` ([server/auth.ts:168](../../server/auth.ts)).
- Keep `requireAuth` on the route.

### 3.2 Rate limiting (new)
Apply `authLimiter` (10/min) to `POST /step-up`. A hijacked session must not be able to brute-force the password to escalate to sudo. The route currently has **no** limiter.

### 3.3 TTL change
In `STEP_UP_TTL` ([requireStepUp.ts:21-25](../../server/middleware/requireStepUp.ts)): **DESTRUCTIVE 1 min → 5 min**. Final: `FINANCIAL 5`, `SETTINGS 15`, `DESTRUCTIVE 5` (minutes). Rationale: avoid re-prompting on back-to-back destructive actions while keeping the window short.

### 3.4 `requireStepUp` middleware
**Unchanged** behaviour (still enforces). The existing 401 payload already carries `requiresStepUp`, `level`, `ttlMinutes` — sufficient for the client. No no-op escape hatch (password re-auth works for all users, so the control stays intact).

---

## 4. Frontend design

### 4.1 Centralized 401 interception + retry — [client/src/lib/api.ts](../../client/src/lib/api.ts)
Centralizing here gives every gated route **whose client caller goes through `apiCall`** step-up handling with **zero per-hook changes** — this covers `DELETE /accounts/:id` (the flagship delete flow) and the transfer routes.

> **Post-review correction** (original text claimed "all 8 gated routes"): the centralized handler only intercepts calls that flow through `apiCall`. Several gated routes (session revoke; password change) are invoked by hooks that use raw `fetch` and therefore bypass it, and there are pre-existing client/server route mismatches. See **§10 Known limitations & follow-ups**.

- Module-level bridge: `let stepUpHandler: ((level: string) => Promise<boolean>) | null` + `export function registerStepUpHandler(fn)`.
- In `apiCall`, when `response.status === 401` and `data?.error?.code === "STEP_UP_REQUIRED"` (or `data.requiresStepUp`) and a handler is registered and this call is not already a step-up retry:
  1. `const verified = await stepUpHandler(data.level)`
  2. if `verified` → **retry the original request once** (guarded by an internal flag to prevent loops)
  3. if not verified (user cancelled) → throw the original error
- New API: `securityApi.stepUp({ password?, code? })` → `POST /settings/security/step-up`. (Not gated by `requireStepUp`, so no recursion. Mutating → `apiCall` attaches CSRF automatically.)

### 4.2 `StepUpProvider` + `StepUpDialog` (new, under `client/src/components/security/`)
- `StepUpProvider` mounts near the app root, owns dialog state, and on mount calls `registerStepUpHandler` with a function that opens the dialog and returns a promise resolving `true` on verify / `false` on cancel.
- `StepUpDialog` — Radix modal matching existing `@/components/ui` primitives: explains the action needs confirmation (copy keyed off `level`), password field, inline error on wrong password, submit calls `securityApi.stepUp({ password })`. **Password-only for v1**; the backend still accepts `code`, so an MFA-code field can be added later without backend changes.
- Accessibility: labelled input, keyboard/focus handling, error announced (WCAG 2.1 AA per CLAUDE.md).

### 4.3 UX result
`useDeleteAccount` and the other gated mutations need **no change**: on 401 the dialog appears, the user confirms their password, and the original request transparently retries and succeeds (mutation `onSuccess` fires normally). Cancel → original error surfaces.

---

## 5. Testing strategy (requirement #3)

New real-DB integration test `server/modules/accounts/__tests__/accounts.stepup.db.integration.test.ts`, following the `*.db.integration.test.ts` pattern: real app via `getTestApp()`, **real `requireStepUp` (no mocks)**, real Postgres, assertions on DB state. Per the `real-db-integration-test` skill, the key case **must fail against unfixed code and pass against the fix**.

Fixtures: household, **non-MFA** user with a known password (`hashPassword`), one account; plus a second account + categories as needed for the transfer case. Auth via `POST /api/auth/login`, reuse the `set-cookie` value across requests so the session (and `stepUpVerifiedAt`) persists.

Cases:
1. **DESTRUCTIVE — fail-then-pass guard:** `POST /settings/security/step-up { password }` → **expect 200** (unfixed code returns 400 "MFA not enabled" → test FAILS, as required). Then `DELETE /accounts/:id` with same cookie → **200**, and assert the account row has `deleted_at` set in the DB.
2. **FINANCIAL — cross-level proof:** step up, then `POST /transactions/transfer` between the two accounts → **200/201**, assert both transfer rows persisted.
3. **No step-up → blocked:** `DELETE /accounts/:id` without step-up → `401`, `body.requiresStepUp === true`, `error.code === "STEP_UP_REQUIRED"`.
4. **Wrong password → blocked:** `POST /step-up { password: "wrong" }` → `401`; subsequent `DELETE` still `401`.

The existing mocked [accounts.integration.test.ts](../../server/modules/accounts/__tests__/accounts.integration.test.ts) is retained for controller-level validation, with a comment pointing to the real-DB test as the authoritative step-up guard.

---

## 6. Verification (final requirement)

1. Run the new test against **unfixed** code → case 1 (and 2) **fail** (400 not 200). Records that the test can fail.
2. Apply the backend fix → new test **passes**.
3. `npm run check` (clean), `npm run test:server:run`, `npm run test:run` (client).
4. Manual/automated trace of the end-to-end non-MFA delete flow: 401 → dialog → password → step-up 200 → delete 200.

---

## 7. Files touched

**Backend**
- `server/routes/security.mfa.stepup.ts` — dual-mode verification, generic failure, audit `method` field.
- `server/routes/security.mfa.ts` (or step-up registration site) — apply `authLimiter` to `POST /step-up`.
- `server/middleware/requireStepUp.ts` — DESTRUCTIVE TTL 1→5 min.

**Frontend**
- `client/src/lib/api.ts` — `securityApi.stepUp`, `registerStepUpHandler`, 401 retry in `apiCall`.
- `client/src/components/security/StepUpDialog.tsx` (new).
- `client/src/components/security/StepUpProvider.tsx` (new).
- App root (e.g. `client/src/App.tsx`) — mount `StepUpProvider`.

**Tests**
- `server/modules/accounts/__tests__/accounts.stepup.db.integration.test.ts` (new, real-DB).
- (optional) client test for dialog + retry behaviour.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Password step-up becomes a brute-force oracle | `authLimiter` (10/min) on the endpoint; generic failure message; already behind `requireAuth`. |
| Infinite retry loop in `apiCall` | Retry **once** only, guarded by an internal flag. |
| Session not persisting `stepUpVerifiedAt` across requests in tests | Reuse the login `set-cookie` across supertest requests (established pattern); express-session saves at end of request. |
| CSRF in test env | Tests run with CSRF disabled (existing `*.db.integration.test.ts` POST without a token); confirm during implementation. |
| Weakening "MFA-grade" step-up for enrolled users | Documented trade-off (§2); future toggle can require code path under enforcement. |
| Local verification needs Postgres | Confirmed reachable (`finance_app`, schema migrated); CI uses an ephemeral Postgres service. |

---

## 9. Security considerations

- No secrets logged; password never persisted or echoed.
- Audit both success (`MFA_VERIFIED`) and failure (`MFA_FAILED`) with `method`, IP, user-agent — supports the Zambia DPA monitoring posture.
- No PII added to responses; failure messages are generic (no user/MFA enumeration).
- Step-up remains session-scoped and time-boxed.

---

## 10. Known limitations & follow-ups (post-implementation)

The backend fix makes step-up satisfiable by password for **every** user on **every** gated route. The client-side dialog+retry is delivered via the centralized `apiCall` interceptor and is **verified end-to-end for the flagship `DELETE /accounts/:id` flow and the transfer routes** (real-DB integration test, cases 1–5; client unit test). The following are out of scope for this change and are recorded as follow-ups:

1. **Raw-`fetch` callers bypass the dialog.** `client/src/hooks/use-settings.ts` and `client/src/hooks/useSecurity.ts` invoke gated routes (session revoke at `DELETE /api/settings/security/sessions/:id` and `/`; password change) with raw `fetch`, not `apiCall`, so they never reach the 401 interception and still dead-end for non-MFA users. Fix: migrate those callers to `apiCall` (or add per-call step-up handling). The backend already accepts password step-up for them once migrated.
2. **Pre-existing client/server route mismatches.** The gated `PUT /api/settings/password` (settings.routes.ts) is not the path the client calls (`/api/settings/security/password`); and there are parallel session route sets (`/settings/*` vs `/settings/security/*`). These predate this change and need reconciliation so the gate and the caller line up.
3. **Dead/uninvoked gated routes.** `POST /api/settings/account/delete` and `/account/export` (settings.routes.ts) have no client caller; reconcile or remove.
4. **Rate-limit hardening (review I-2).** `authLimiter` (10/min, per-user) guards the endpoint; account lockout (implemented) is the primary brute-force defense. Consider additionally stacking an IP-based limiter (`strictLimiter`/`ipAuthLimiter`) on `POST /step-up`.
5. **`expiresIn` accuracy.** The success response hardcodes `expiresIn: 15*60`; it is not read by the client, but should be derived from the requesting level (or dropped) if ever consumed.
