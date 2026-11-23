# R02 verification CSRF: local acceptance record

## Scope and source

Owner-authorized continuation implements the approved narrow token-authorized
exception for exactly POST `/api/auth/verify-email` and
`/api/settings/security/email/verify`. All other policy branches, cookie/session
configuration, token consumers and limiters retain their behavior. No visitor
authentication or identity switching is granted by a verification token.

Author candidate `1b767b49694475382dff886170e3eb9625afeb63`, direct parent
`5db5f5a9e2be29fedcfefef85e868446f06b4270`, contains exactly the five assigned
paths. Independent Sol Extra High general/security review and separate Sol Extra
High TypeScript/async/security review accepted this frozen SHA without actionable
findings. The first typed-review attempt failed at model capacity before reviewing;
the replacement completed the review. Neither reviewer executed tests or DB work.

Parent independently reviewed the policy, app integration, component and mounted
regressions, token-owner behavior and raw evidence. Local integration is
`1bc793224a7ede1c56fdd23501b7438b6e336e3a`, preserving author provenance. Git
comparison confirms server/shared/client/package/lock parity with the author.

## Focused evidence

Author logs are under the capital-r04-foundation checkout's
`.local/r02-verification-csrf/`. Parent read the raw summaries:

- Old-policy component red: 6 failed / 22 passed, exit 1, 4.03 seconds.
- Final real csrf-csrf component: 29 passed, exit 0, 0.907 seconds.
- Mounted public-entry, email-lifecycle and session-access: 3 files / 63 passed,
  exit 0, 110.43 seconds.
- Author nonincremental TypeScript and npm check: exit 0. The silent standalone
  TypeScript log relies on its recorded process exit, not empty output alone.

The middleware component uses the actual app policy and real session/CSRF
middleware with synthetic HTTP cookies. Mounted tests use the protected test-mode
app and marked PostgreSQL, where CSRF/limiters are intentionally skipped. Their
separate scopes do not constitute full production-browser/cookie/limiter proof.
Captured mocked email HTML or challenges are not actual SMTP/MIME evidence.

## Integrated validation

Parent freshly verified the persisted identity marker for run `r01int15a1`,
`127.0.0.1:55432/pfa_completion_identity_r01int15a1_test`, before starting the
protected full server regression on frozen integration `1bc7932`. Canonical
manifest: `.local/r01-integrated/target.json`. Command:
`node scripts/run-protected-tests.mjs database vitest --server run --maxWorkers=1 --reporter=verbose`.
Log: `.local/r02-verification-csrf/server-integrated-oct28.log`.
The run finished exit 1: **240 files passed / 1 failed; 3,356 tests passed /
1 failed**, 712.59 seconds. The failed older R04 tag test rejected the substring
`987` anywhere in the serialized response. The actual safe response had that
sequence only in its ISO timestamp (`2026-10-28T08:43:14.987Z`). Parent replaces
that accidental timestamp sensitivity with an exact error-envelope assertion:
only `success:false`, the fixed conflict code/message and a well-formed ISO
timestamp are allowed. Additional counter fields or changed error wording still
fail, and the unchanged-state assertion remains. This is a test-only repair;
the original failed log is retained. Independent general and typed reviewers
accepted this nonweakening repair; parent committed it as `ac915c5`. The complete
affected file then passed **25/25**, exit 0, 27.89 seconds:
`.local/r02-verification-csrf/tag-repair-oct28.log`. This is a focused repair rerun,
not a claim that the earlier full run was entirely green.

Fresh integrated `npm run check`, `npm run build` and `npm run check:bundle`
all exited 0 on `ac915c5`. Their logs are `check-integrated-oct28.log`,
`build-integrated-oct28.log` and `bundle-integrated-oct28.log` in the same canonical
log directory. Initial gzip remains 190.35 kB against the unchanged 300 kB budget.
The runtime observer is inert tooling, not an application import. Application,
client, configuration, package and lockfile bytes remain equal to the exercised
CSRF integration; only the described test assertion and inert observer files
changed after the full run. The unchanged client source retains its prior
1,497-test baseline; no repeat client-unit execution is claimed.

All **eight protected Chromium cases passed**, exit 0, 1.3 minutes, one worker,
zero retries, on `ac915c5`. The later `645dbb2` commit changes only the native
fixture protocol and its documentation; browser/application source is unchanged.
Golden target was freshly marker-verified:
`.local/r20-golden/target.json`, run `r20ga15a1`,
`127.0.0.1:55432/pfa_completion_golden_r20ga15a1_test`, owned origin
`http://127.0.0.1:5157`. Command:
`node scripts/run-protected-tests.mjs database playwright test --config playwright.completion.config.ts --project chromium`.
Log: `.local/r02-verification-csrf/browser-integrated-oct28.log`.

The separate runtime observer was authored in isolation, then integrated and
validated through `e7da0c4`; it is not imported by the application. Git comparison
confirms the later changes affect only the two observer/fixture files and
documentation. The server and browser results above retain their original tested
heads; no prior run is relabelled as a later execution.

## Limits

Parent accepts the bounded local CSRF checkpoint with the failed full-run record
and focused assertion repair disclosed above. The runtime lane has its separate
native/installed observation acceptance record; it does not upgrade this test-mode
browser evidence into production-profile coverage.

Full R02/J01/G1, captured-mail independent-browser proof, native HTTPS, real Redis
limiter behavior, dependency closure/custody, all 101 canonical requirement
groups and release remain open. Primary checkout remains untouched. No push,
main merge, external delivery or deployment is included in this local checkpoint.
