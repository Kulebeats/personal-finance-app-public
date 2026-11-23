# R02 canonical authentication links and public entry

15 October2026. Bounded source/regression slice under masterv2.3, authored from
`dfff69027a794e158bed3dfdf55e4a878cabdcfd` on
`codex/capital-r02-verification` in the isolated former R04 author worktree.
Parent Sol Extra High owns server code/integration; delegated Sol High owns the
client allocation documented in `PUBLIC-UI.md`. This is not an Astra review or
R02/J01 completion. All101 canonical groups remain OPEN.

## Implemented boundary

- Registration, public resend, generic verification/email-change and password
  reset mail use one root-route builder. `APP_URL` must be an HTTP(S) origin
  without credentials, subpath, query or fragment. Production requires an
  explicit HTTPS origin; development/test retain the existing localhost5000
  fallback. Trailing root slash is normalized and opaque tokens URL-encoded.
  Invalid configuration produces a fixed error without reflecting its value;
  registration/resend preserve their existing sanitized delivery handling.
- The old GET `/auth/verify-email` returns a fixed relative302 to `/verify-email`,
  preserving a single token and dropping unrelated redirect/query parameters.
  Duplicate/structured or >256-character token input is rejected generically.
  Missing token reaches the public recovery page. No-store/no-referrer headers
  apply, and the route finishes before body/session/user middleware. It performs
  no token consumption or visitor-session access. Client-only Vite navigation
  has a matching SPA redirect; its complete query/fragment preservation is
  separately tested.
- Public resend keeps explicit email input and the same conditional requested
  response for pending, verified and unknown addresses. It makes no delivery
  claim. The existing issue/consume services, purpose distinction and all CSRF,
  limiter, cookie, login and session-generation controls are unchanged.
- The public UI keeps the generic token consumer so both initial and change
  challenges remain supported, submits once under StrictMode, removes the token
  before transport and offers public email-input recovery/sign-in navigation.
  Email-change recovery separately directs the account holder to settings.

## Test-first evidence

All runs use the selected Node24.22.0 ARM64 and protected test wrapper. No raw
production message, real recipient, external SMTP or paid service was used.

- Mail-boundary regressions failed16/16 against unchanged source,09:05:10,
  duration0.65s. These use the real email services with only Nodemailer mocked.
  Auth mail action links were distinguished from the template's unrelated
  preferences link before the recorded red run.
- Actual registration/HTTP/database entry regressions initially failed4/6,
  with2 identity controls passing,09:04:10,23.74s. The resend assertion was then
  corrected to the existing `meta.message` envelope and independently failed
  on the old unqualified delivery claim,09:05:11,8.25s (1 selected/5 filtered).
  Legacy links returned404 and registration emitted the unregistered old path.
- Mail compatibility green:3files/22tests,09:06:11,0.97s,zero skips,exit0.
  Includes actual serialized auth logging guards and existing SMTP configuration
  behavior. Log: author `.local/r04/r02-mail-green.log`.
- Server security/lifecycle green:3files/54tests,09:06:38,33.02s,zero skips,exit0.
  Includes6 new actual-registration tests plus existing R01 email lifecycle and
  auth-security suites. Log: author `.local/r04/r02-entry-green.log`.
- Client green:4files/24tests,09:02:56,6.43s,zero skips,exit0. See `PUBLIC-UI.md`
  for its red cases, real component/router boundary and exact focused command.

Database runs use the parent's already-owned marked target only:
`127.0.0.1:55432/pfa_completion_identity_r01int15a1_test`, run`r01int15a1`,
canonical `.local/r01-integrated/target.json`,14 versioned migrations. New tests
register unique synthetic users through the actual application, capture the
raw token solely from the final mocked `sendEmail` payload, compare hash at rest,
consume once, reject replay and independently inspect session identity/tracking,
credential generation, verified state and audit. Anonymous B remains anonymous;
signed-in C remains C. Legacy redirect is additionally observed never to read
the supplied session store. Cleanup is restricted to those synthetic users.

## Review and integration status

After a formatting-only builder change and a stricter fixed-error assertion,
the mail compatibility suite passed22/22 again at09:09:05,1.15s,exit0
(`.local/r04/r02-mail-final.log`). Nonincremental TypeScript and `npm run check`
both passed,exit0 (`r02-ts-final.log`, `r02-check-final.log` in that directory).
The reviewed commit, integration and subsequent broader results are recorded
below; focused green alone was not treated as sufficient acceptance.

Independent general code/evidence review and separate TypeScript/security review
accepted frozen author `46b83af230e12f2d2e184a3d66cfe97cde3823ce` with no
actionable findings. Both were Sol reviews and performed no suite/runtime/DB
execution. The general reviewer read the22-mail/54-server/static logs; the
focused24-client result was worker-reported. Parent integrated the exact14-file
change as `1225d2d352e62c832e45c868661db9e470120913`. All tracked
non-documentation files match the reviewed author; source-parity report:
canonical `.local/r01-integrated/r02-source-parity.json`. This is source parity,
not installed-dependency or production-profile certification.

The complete protected client run on frozen author46b83af passed **169 files /
1,396 tests**, zero failures/skips, **208.80s**, exit0. Log: author
`.local/r04/r02-client-full.log`. The source parity above ties it to the canonical
application/test candidate; it is not a second client run in the canonical path.

The first complete server attempt on the parent's marked identity target ended
exit1:233files/3,168tests passed, but Vitest could not start the fork worker for
`routes/__tests__/grz-record-only.integration.test.ts` (worker-response timeout).
There was no assertion failure, but this is a failed run, not a full-suite pass.
It reported2,199.58s and contains a1,725.048-second timestamp gap between
07:19:14.365UTC and07:47:59.413UTC. That is consistent with an interruption;
the cause of the gap is unproven. No source/config/timeout change was made.
The missing test passed alone1/1,22.34s,exit0 (`r02-worker-start-retry.log`).
The original failed log is retained at canonical
`.local/r01-integrated/server-full-r02-links.log`.

The unchanged complete server rerun passed **234 files / 3,169 tests**, zero
failures/skips/unhandled errors, **575.20s**, exit0, starting09:54:53 local.
Log: canonical `.local/r01-integrated/server-full-r02-links-retry.log`. The
same marked14-migration identity target was used with one worker/no failure-stop.
Only documentation changed after the integrated application/test candidate;
source parity was rechecked during and after execution.

At documentation HEAD7a931fc, parent `npm run check`, production build and
bundle guard passed, exit0. Build43.34s; initial JS gzip186.01kB against300kB.
Logs: canonical `.local/r01-integrated/{check,build,bundle}-r02-links.log`.
The existing protected Chromium regression suite passed **3/3**, reported
**1.7m**, exit0, one worker/zero retries. Target:
`127.0.0.1:55432/pfa_completion_golden_r20ga15a1_test`, run`r20ga15a1`,
canonical `.local/r20-golden/target.json`,14 migrations, owned HTTP server5157.
Log: canonical `.local/r20-golden/browser-r02-links.log`. These existing
test-mode journeys cover selected-device revocation and Golden A submission/
persistence plus its omitted-submit negative; they do not test actual SMTP or
production verification CSRF. No production-profile application was launched.

The bounded local checkpoint is complete. Both preintegration independent code
reviews apply to unchanged application/test source; parent read the subsequent
broad logs and source parity. No postintegration reviewer execution/read-back
is claimed: an optional documentation follow-up failed before review due to the
reviewer's usage limit. The source-only next-slice preparation is in
`SHARED-GATE-CHECKPOINT.md`; its shared auth/query decisions wait for the owner's
Astra Extra High switch under masterv2.3. No new security/cache contract or
release-readiness decision was made by this checkpoint.

## Explicit remaining acceptance

The mail unit tests mock Nodemailer, the DB tests mock final `sendEmail`, and
the UI tests mock fetch/CSRF acquisition. They do not establish SMTP acceptance
or actual MIME capture, real non-test CSRF/cookie/limiter continuity, the complete
global-provider first-run path, pending-session financial restrictions, hosted
delivery or staging/production readiness. The full application production-profile
dependency/execution gate remains open; no bypass or broader runtime was run.
`FRESH-BROWSER-PROOF-CONTRACT.md` governs the still-outstanding captured-mail
fresh-browser proof. Pending-registration access restrictions, household-free
navigation/query gates and R02's other canonical groups remain OPEN.
