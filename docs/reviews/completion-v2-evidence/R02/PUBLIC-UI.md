# R02 public verification UI repair

15 October 2026. Bounded client source/regression implementation under the
parent's master v2.3 routineSol allocation. Authoring base: `dfff690`, shared
`codex/capital-r02-verification` worktree. This document does not close R02 or J01.

## Source boundary and resulting behavior

- `client/src/pages/VerifyEmail.tsx`: missing/rejected tokens expose a required,
  labeled email input and explicit public resend action. It reuses the existing
  `handleResendVerificationApi(email)` helper, which POSTs the entered email to
  `/api/auth/resend-verification` through the shared CSRF API client. It never
  uses the signed-in settings resend without an email. Successful requests show
  the same conditional wording regardless of response details and say a link
  was requested; they do not assert delivery. Failures show a generic retry
  message without backend details.
- The page retains `useVerifyEmail` and the existing generic token consumer at
  `/api/settings/security/email/verify` for registration and email-change
  challenges. Query purpose hints cannot select a different endpoint. The
  signed-in security hooks and their purpose enforcement remain unchanged.
- A guarded layout effect captures the token, removes every `token` query
  parameter with history replacement, and then submits once per mounted page.
  Other query parameters and the fragment survive. It uses the mutation promise
  to update the result because per-call mutation callbacks can be lost during
  React StrictMode observer re-subscription.
- Success and recovery both offer an explicit `/login` link. Email-change retry
  help separately explains signing in and requesting a fresh link from Security
  Settings; it does not reinterpret an email-change token as registration.
- `client/src/App.tsx`: a client fallback redirects `/auth/verify-email` to
  `/verify-email` with the original query and fragment, using replacement before
  the canonical page consumes the token. The existing route switch has a named
  export so focused tests can exercise its real route map without instantiating
  unrelated global providers. The parent owns the production server redirect.

No session/cookie/header implementation, automatic login/identity switching,
CSRF exemption/guard, server handler, query provider, schema or migration was
changed by this client allocation.

## Test-first evidence

The tests use real components, React Query, wouter and user-event. Only fetch
transport is stubbed, including CSRF acquisition. They are jsdom client unit
tests and make no real HTTP request.

1. On the unchanged page, `VerifyEmail.test.tsx` failed **7/7** at 08:59:50:
   missing public email input/request action, missing public sign-in navigation,
   and an address bar still carrying the bearer during transport. This was an
   expected assertion failure run, not an import/setup error.
2. The first lifecycle repair passed six tests but left the StrictMode result
   loading. Awaiting `mutateAsync` fixed the dropped callback; **7/7 passed** at
   09:01:11.
3. With the actual App switch exported but its route map unchanged,
   `VerifyEmail.routing.test.tsx` passed the canonical route and failed the legacy
   route with the actual **404 Page Not Found** at 09:01:44. After wiring the
   redirect, **9/9** page/routing tests passed at 09:02:00.
4. Final focused verification after formatting: **4 files / 24 tests passed**,
   exit 0, 09:02:56, duration 6.43 seconds:

```powershell
node scripts/run-protected-tests.mjs unit vitest run --config client/vitest.config.ts client/src/pages/__tests__/VerifyEmail.test.tsx client/src/pages/__tests__/VerifyEmail.routing.test.tsx client/src/hooks/__tests__/useSecurity.test.tsx client/src/pages/Login/__tests__/useAuthHandlers.csrf.test.ts --maxWorkers=1
```

Covered behaviors include missing token, empty-email refusal, public resend
payload/CSRF, conditional response wording, resend failure/retry, rejected-token
recovery, unchanged generic consumption for an email-change query hint,
StrictMode single automatic consumption/result completion, token removal, and
both actual App route entries preserving the token until canonical capture.
Existing signed-in hook and public auth-helper tests pass in the same run.

## Acceptance limits and handoff

Source files are frozen for parent review after this focused green run. Parent
owns independent review, combined diff/checks, any database and broader test
release, and commit authorization. No staging, commit, checkout or reset was
performed by this allocation.

No application server/browser, database, SMTP/native transport, external service,
TypeScript/broad suite or production profile was executed. These tests cannot
prove SMTP delivery, challenge persistence or purpose checks on a real server,
fresh anonymous CSRF continuity, limiter behavior, visitor session identity,
global provider first-run behavior or a production fresh-browser journey.
`FRESH-BROWSER-PROOF-CONTRACT.md`, master R02 and J01 remain the acceptance
contracts for those separate boundaries.
