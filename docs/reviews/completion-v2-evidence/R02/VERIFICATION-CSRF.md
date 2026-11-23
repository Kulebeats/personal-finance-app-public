# R02 token-authorized verification CSRF boundary

## Candidate and authority

Author: Sol Extra High in the CSRF lane, with separate independent review and
parent Astra High integration/final acceptance. Baseline:
`5db5f5a9e2be29fedcfefef85e868446f06b4270`.
Branch: `codex/capital-r02-verification-csrf`.
Author checkout:
`C:/Users/USER/.codex/worktrees/capital-r04-foundation/personal-finance-app`.
The candidate is the commit introducing this document; the exact SHA is reported
to the parent after the five owned paths are frozen.

Canonical `docs/plans/2026-10-28-r02-csrf-and-runtime-resolution.md`, Task 1,
governs. The master permits a narrow token-authenticated exemption only when the
operation does not use ambient-session authority or authenticate/switch its
visitor. Parent and independent reviewer selected the exact two-POST design;
parent separately approved the extraction/component composition before source
edits. No full non-test application launch or production-profile exception was
authorized or performed.

## Source boundary

Before the change, the verification client used `apiCall`, which obtains a token
from `GET /api/csrf-token`, then posts to
`/api/settings/security/email/verify`. The token GET only emits a CSRF cookie and
response token. `saveUninitialized:false` and the absence of a session mutation
mean a fresh anonymous request has no persisted session cookie, while csrf-csrf's
HMAC is bound to that request's generated `req.sessionID`. The source therefore
predicts broken continuity across the next anonymous request. This report does
not claim a reproduced full-production-app/browser failure.

`server/middleware/csrf-policy.ts` extracts only the old selection wrapper and
adds exactly this condition:

```ts
req.method === "POST" && (
  req.path === "/api/auth/verify-email" ||
  req.path === "/api/settings/security/email/verify"
)
```

`server/app.ts` supplies its existing real `doubleCsrfProtection` to the factory.
The environment getter remains request-time; the app uses its default
`process.env.NODE_ENV` getter. Every old safe-method, test-mode, preauth, cron,
health and token-GET branch retains its previous selection semantics. No new
prefix, case folding, slash/encoding normalization or version alias is added.
Query strings do not change Express's canonical `req.path`.

The session/store configuration, CSRF generation/validation configuration,
cookie flags, token consumers and route limiters are unchanged. No anonymous
session marker is persisted. Signed-in resend, email change/cancel and other
previously protected mutations still reach real CSRF enforcement.

Both token consumers use `consumeEmailVerificationToken`: look up the token hash,
lock its user, recheck hash/expiry/liveness/purpose and consume once atomically.
The auth endpoint is initial-only; the security endpoint also confirms a pending
email change. The token selects the subject, not the visitor's cookie. Request
context supplies audit metadata. Initial confirmation records verification;
email change updates its target, invalidates outstanding reset tokens, clears
old-channel MFA codes and enqueues its target's audit/notices. Neither promotes
or switches the visiting identity. Those implementation semantics were preserved,
not redesigned by this patch.

## Real middleware component: red and green

Feature tests were written first. With parent approval, the unchanged old
selection wrapper was mechanically extracted into the app's actual consumer.
The first behavioral run used that old policy and actual csrf-csrf enforcement:
**6 failed / 22 passed**, exit 1. Both exact POSTs, both canonical query-string
cases and both anonymous token-GET-to-POST cases returned real 403 responses.
This was behavioral red, not a missing-module collection failure.

The approved two-path POST condition was then added: **28/28 passed**, exit 0.
A final component-only extension checks that the environment provider is read
for each request and strengthens missing-CSRF status assertions: **29/29 passed**,
exit 0. Production source did not change after the 28-case green run.

The component composes real Express, real express-session with an isolated
MemoryStore (`saveUninitialized:false`), cookie-parser, actual csrf-csrf and the
same policy factory used by the app. An injected getter selects `production`
for the component without mutating protected `NODE_ENV=test`. Its synthetic
HTTP cookies explicitly use `secure:false` for Supertest. No app, auth, DB,
production-profile or external transport is imported by this component.

Its sentinel handlers establish middleware reachability, not token validity.
The 29 cases cover exact POSTs and canonical query strings; reject PUT/PATCH/
DELETE/TRACE and neighboring, trailing-slash, encoded, differently cased and
version-prefixed paths; preserve ordinary mutation missing/wrong-CSRF rejection
with real valid-cookie/header controls; reject a copied CSRF cookie/header pair
under another generated session; exercise the fresh anonymous token-GET sequence;
and retain every existing exemption/safe-method/test selector. Persisted synthetic
fixture sessions support the valid-CSRF controls only. The production app's
anonymous/session behavior is not modified to make the test pass.

This is real middleware-component evidence, **not** native HTTPS, production
secure-cookie behavior, production PostgreSQL-session-store behavior, actual
limiters/Redis, real SMTP/MIME or full-app browser acceptance.

## Mounted token and visitor regressions

Inventory before adding cases:

- Existing R01 email-lifecycle tests already covered cross-alias single-use races,
  initial-only purpose rejection, expired/undated changes, old reset invalidation,
  exact recipients/OTP clearing, actual notice failure rollback and revoked actor
  operations. They remain unchanged and were rerun.
- Existing R02 session-access tests already covered actual registration, pending
  denial, current identity/generation, membership context, MFA-only state and
  replacement-cookie logout. They remain unchanged and were rerun.
- Existing R02 public-entry tests covered real initial registration with captured
  mocked HTML links, an anonymous visitor and authenticated C, legacy redirects
  and public resend. This file alone gains the missing endpoint/visitor cases.

The extended public-entry tests cover both actual initial-verification endpoints
under anonymous, authenticated and unrelated MFA-only visitors; wrong, stored-hash
and expired inputs with user/reset/audit/outbox/identity snapshots unchanged; and email-change
purpose rejection followed by successful confirmation under unrelated authenticated
and MFA-only visitors. Independent readback checks target email/verification/
challenge state, reset invalidation, old-channel MFA clearing, exactly one change
audit and notices to the original/new addresses; replay leaves the post-consume
snapshot unchanged. Visitor snapshots include both normal and MFA-pending session
payloads, tracked identities, generation and MFA/email state. Cookie-expiry
housekeeping is excluded from identity comparisons. Cleanup includes MFA-only
session rows and the run-owned changed email addresses.

The protected mounted run passed **3 files / 63 tests**, exit 0. It uses the
unchanged test-mode app, where global CSRF and limiters are intentionally skipped;
these results establish the actual token consumers, persistence and visitor
invariants, not non-test CSRF behavior. Initial raw tokens come from actual
registration's captured mocked email template; email-change challenges are
captured at the mocked delivery boundary. This is not SMTP/MIME delivery proof.

## Commands and raw evidence

Pinned runtime: Windows ARM64 Node 24.22.0 at
`C:/Users/USER/AppData/Local/capital-r00-runtime/node-v24.22.0-win-arm64`.
Every test used `scripts/run-protected-tests.mjs` with `--maxWorkers=1`.
Parent freshly reverified the persisted target marker and assigned the exclusive
focused database slot before execution: canonical
`.local/r01-integrated/target.json`, run `r01int15a1`,
`127.0.0.1:55432/pfa_completion_identity_r01int15a1_test`, role `pfa_campaign`.
The protected wrapper rechecks identity before writes. No shared 5432,
`finance_app`, schema push, real delivery or paid provider was used.

Raw logs reside under the author checkout's `.local/r02-verification-csrf/`:

| Log | Result |
|---|---|
| `csrf-component-red-oct28.log` | Old extracted policy: 6 failed / 22 passed, exit 1, 4.03s. |
| `csrf-component-green-oct28.log` | Approved two-path condition: 28 passed, exit 0, 0.965s. |
| `csrf-component-final-oct28.log` | Final component test bytes: 29 passed, exit 0, 0.907s. |
| `verification-mounted-oct28.log` | Three actual mounted DB files: 63 passed, exit 0, 110.43s. |
| `tsc-nonincremental-oct28.log` | Nonincremental TypeScript: exit 0. |
| `npm-check-oct28.log` | Exit 0: runtime parity, TypeScript, no-storage imports, LOC, Node-tool syntax, assessment metadata/status and W9/W10 checks. |

Component command:
`node scripts/run-protected-tests.mjs unit vitest --server run middleware/__tests__/csrf-policy.component.test.ts --maxWorkers=1 --reporter=verbose`.
Mounted command uses `database vitest --server run`, the existing
`routes/__tests__/completion-r02.public-entry.realdb.integration.test.ts`,
`routes/__tests__/completion-r01.email-lifecycle.realdb.integration.test.ts`,
`routes/__tests__/completion-r02.session-access.realdb.integration.test.ts`,
and `--maxWorkers=1 --reporter=verbose`.
Static commands: `node node_modules/typescript/bin/tsc --noEmit --incremental false`
then `npm run check`, using the parent-assigned exclusive static slot.

## Review and limits

Independent general/security and typed review, parent final review and exact local
integration are pending at evidence preparation. Parent owns integrated full
server/static/build/browser checks and canonical acceptance/status updates.
This bounded patch does not establish the captured-mail A-to-independent-B
production-profile journey, normal limiter/Redis behavior, installed/transitive
dependency custody, deployment or release. No permission/certification in the
production manifest changes. R02, G1 and all 101 canonical groups remain open.
