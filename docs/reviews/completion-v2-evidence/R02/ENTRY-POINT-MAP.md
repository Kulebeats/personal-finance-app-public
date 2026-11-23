# R02 current entry points and bounded next handoff

Read-only source inventory, 15 October2026, application a796a78, combined
checkpoint ee5187d (later3939b08 is documentation only). No R02 code, database,
SMTP, browser or production-security result is supplied by this document.
Master R02 and J01 remain the governing contracts; all four R02 groups are OPEN.

Independent reviewer accepted source inventory cd274ef after reading the actual
mail, client, route mount, CSRF and authentication/query entry points. No runtime
check was performed by that review; the acceptance is for this map only.

## Current source, not a replay of the historical audit

- `server/modules/auth/auth.email.service.ts` generates both initial and resent
  registration links as APP_URL plus `/auth/verify-email?token=...`, falling back
  to localhost. `client/src/App.tsx` registers `/verify-email` only. There is no
  corresponding legacy alias in its Switch. This route mismatch is still present.
- The current VerifyEmail page calls useVerifyEmail from useSecurity.ts, which
  POSTs to `/api/settings/security/email/verify`. Its retry calls the signed-in
  `/api/settings/security/email/resend` without an email. Success and secondary
  navigation point to security settings, even for a fresh anonymous visitor.
  Initial registration, pending email change and anonymous recovery therefore
  need explicit UI states, without changing the settled token-purpose rules.
- `server/routes/security.ts` mounts the email router BEFORE requireAuth, and
  security.email.ts mounts `/verify` BEFORE its own requireAuth. Do not diagnose
  the public verification handler as hidden behind that authentication middleware.
- `server/app.ts` skips CSRF entirely in NODE_ENV=test. Its explicit pre-auth
  exclusions include registration and public resend, but neither verification
  POST. The client API obtains a CSRF token through lib/csrf.ts. Whether a fresh
  anonymous session retains that token's session identity needs an actual guarded
  non-test proof; ordinary passing Vitest/Playwright tests cannot establish it.
- `server/modules/auth/auth.service.ts` registers emailVerified:false, then puts
  userId/securityGeneration in a durable tracked session. Login separately rejects
  unverified users. Both requireAuth variants in server/auth.ts check user
  existence but do not check email verification; householdGuard validates current
  membership/role but also has no email-verification check. Restricted pending
  state must be enforced across actual household/financial entry points, rather
  than relying on the login check alone. Fresh runtime reproduction is still due.
- Global SettingsProvider calls useDisplaySettings on public pages. This is a
  concrete first-run query lead, not a measured complete error cascade or a reason
  to suppress legitimate settings failures. Trace auth/session/household-dependent
  queries and retained cache data before selecting the UX-01 repair.

## Required first implementation boundary

Use current shared token issue/consume services. R01 already added atomic hashed
token consumption, purpose separation, credential-change invalidation and the
no-visitor-login/identity-switch boundary; retain those controls and their tests.
The source of truth is an actually captured synthetic mail token, never the
database hash, a production message or an existing session jar.

Start with a fresh A registration and exact emitted link opened in B. Capture
mail only at an owned local sink; real delivery remains gated. Pin registered
client routes and configured public origin; preserve a legacy link redirect.
Choose the master's narrow token-authenticated CSRF exception only after proving
the endpoint performs no ambient-session-authorized mutation and cannot log in
or switch B. Keep ordinary cookie-authorized mutations and signed-in resend
protected; public resend keeps email input, throttling and non-enumeration.

Then test pending-session access against every relevant route class, permitted
resend/recovery/logout, verified/household-free navigation, replay/expiry and
unchanged wrong-user cookie identity. R02's broad gates must not break R01's
pending-MFA/logout or credential/session invariants. Allocate shared app.ts,
auth.ts, auth routes/services, public UI/query gates and production-profile
changes explicitly before concurrent edits. Tests in test mode may support
regression development but do not satisfy real CSRF/cookie/limiter acceptance.
