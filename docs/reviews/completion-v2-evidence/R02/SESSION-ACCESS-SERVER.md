# R02 server session-access author evidence

28 October 2026. Server author: Sol Extra High; coordinator/final reviewer: Astra High; independent Sol review is a separate lane. This is a bounded author checkpoint, not R02/J01 closure or release readiness. All canonical groups remain OPEN under the master spec.

## Candidate and authority

Author checkout: `C:\Users\USER\.codex\worktrees\capital-r04-foundation\personal-finance-app`, branch `codex/capital-r02-session-gate`, original implementation source base `4e90bfab0f86947a0df8edfb75c77089eb4bdc80`. The original frozen implementation is `d70fb7b8fbe8f63e77b9a1d3125ebb69da924169`; the fixture-only follow-up is documented in the final section, with its exact SHA returned separately to the coordinator. Canonical authority is the owner-approved `docs/plans/2026-10-28-r02-four-agent-execution.md`, `2026-10-15-r02-session-access-design.md`, implementation Task 1 and master section 2/R02 in `C:\Users\USER\.codex\worktrees\capital-completion-v2\personal-finance-app`. The coordinator committed the corrected planning documents as `8ad063d8bbdcb1c963092d1b71296db709bb8395`; they are not silently copied into the server author branch.

The October 15 partial `server/auth.ts`, `server/middleware/householdGuard.ts` and two R02 tests were resumed and preserved. The old `.local/r02-session-access/unit-red.log` (27 failed, 14 passed) and `mounted-red.log` (1 failed, 12 skipped) remain historical evidence, not the outcome of today's implementation. Their SHA-256 values at read-back were respectively `F223F617100B1D96F2CD5AE7501C5620DC36815A22453B9330025B23B6499328` and `B310B1740FF275831184A44C6229C2A28C4FB715950981F366CDBF3228A8C91F`.

## Implemented boundary

- `server/auth.ts` resolves current cookie-user/MFA identity from the user row and current security generation. It rejects erased, deleted, stale and ambiguous simultaneous identities. `requireAuth` and its compatible `requireAuthWithUser` export require verified email. The explicitly named pending-aware guard is used only by own-identity `/api/auth/me`, authenticated logout and signed-in verification resend. Existing MFA-only logout cancellation remains intact.
- Both household guards independently resolve a verified current user before membership, explicit target parsing or downstream work. Implicit `householdGuard` and bootstrap share `server/core/authz/implicit-household-context.ts`, including known-role validation. The repository's membership-backed `findByUserId` orders by unique membership ID before limiting. `householdGuardWithId` still checks the requested target directly.
- GET `/api/auth/session` returns the usual success envelope with the five states in `shared/session-status.ts`, `Cache-Control: private, no-store` and `Vary: Cookie`. Pending status performs no household lookup; MFA-only status contains no subject. Verified status exposes only subject `id/email/displayName` and, when ready, household `id/role`. Missing membership is an expected state; inconsistent roles/membership and repository failures do not become onboarding.
- `shared/session-status.ts` was inspected and transferred byte-for-byte by the coordinator for the parallel client dependency. SHA-256: `A48A3CF7557B82B71C3EBB5D811670212B73EBCF34ACAFD2316458E5FE1F4BED`.
- After independent review identified that delayed first-party operations could otherwise execute under a replacement cookie/context, Astra approved optional `X-Capital-Subject` and `X-Capital-Household` preconditions. Each is exactly one UUID; malformed or duplicate expectations return generic 400 `BAD_REQUEST`, and changed current subject/household returns generic 409 `SESSION_CONTEXT_CHANGED` before controllers/effects. They grant no authority and echo no supplied values. Headerless callers retain the independent session/membership guards. Verified shared auth checks a supplied implicit household expectation even for routes that do not mount `householdGuard`, and the latter reuses only the authoritative context resolved by that request. Subject checks also apply to pending-aware recovery. No context is taken from `attachUser`.
- Credential login now returns structural `EMAIL_VERIFICATION_REQUIRED` only after valid password verification. Wrong-password/unknown-user and account-lockout denials retain their existing codes; this adds no login promotion or new policy.
- Explicit-target guard chains select `requireAuthForExplicitHousehold` before `householdGuardWithId`. The named mode still checks current subject and verification; the following guard independently checks target membership, role and expected household. A headerless existing `requireAuth` then `householdGuardWithId` chain remains compatible. The default `requireAuth` mode checks implicit selection, so it is not claimed to accept a different explicit H2 expectation; no mode is inferred from an untrusted body/parameter. No production WithId mount existed in the source inventory, and none was added.
- Astra explicitly extended ownership to eight request-path files after identifying repeat household selection after the guard. The private request cache now retains the full checked row and authoritative absence. Twenty-five `findByUserId` calls in household general/member/invitation controllers, settings account deletion, notification/recap/investment-preference audit attribution and import execution now use `resolveRequestHousehold`. It preserves headerless legacy lookup when no request selection exists, refuses a supplied household expectation without its authoritative selection, and never reselects H2 after H1 was checked. Existing membership, capability and atomic mutation checks remain intact. Import separately checks its effective authorized body target against the expectation, retaining headerless explicit-target semantics. MFA-only logout rejects any authenticated subject/household expectation with 409 before cancelling a replacement challenge; headerless challenge cancellation remains.

No package, runtime/config, schema, migration, token policy, limiter policy, CSRF policy or session-store policy change is included. Controller/route edits are limited to the separately approved context reuse, effective import target and MFA logout precondition checks above. `attachUser` remains optional attachment, never authorization. Bootstrap remains a snapshot: protected requests independently revalidate current membership and role.

## Focused verification

All commands used Node `v24.22.0` from `C:\Users\USER\AppData\Local\capital-r00-runtime\node-v24.22.0-win-arm64` first on PATH. Local logs are under the author checkout's `.local/r02-session-access/` and are intentionally untracked.

| Check | Observed result | Log |
|---|---|---|
| Preserved guard unit baseline | 41 passed | `unit-baseline-oct28.log` |
| New bootstrap/route tests before implementation | 16 failed: absent `/session` and pending `/me` denial | `status-red-oct28.log` |
| Existing household properties before explicit current-user fixture repair | 4 failed, 1 passed | `property-first-oct28.log` |
| Final focused guard/bootstrap/property suite after test-only type repairs | 3 files, 65 passed | `unit-typefix-oct28.log` |
| First mounted access attempt | 12 passed, 1 failed: resend mail mock boundary did not capture a same-module send | `mounted-first-oct28.log` |
| Protected mounted access/public-link/R01 revocation/logout regression | 4 files, 41 passed | `mounted-regression-oct28.log` |
| First nonincremental TypeScript | 2 test-only TS2352 errors; corrected fake-session cast and nonexistent sentinel | `typecheck-oct28.log` |
| Pre-amendment nonincremental TypeScript retry | Passed, exit 0 | `typecheck-green-oct28.log` |
| Pre-amendment `npm run check` | Failed existing LOC ratchet: one-line repository ordering addition 630 to 631 lines; chain now kept on its existing line | `npm-check-oct28.log` |
| Intended-context/login unit red | 21 failed, 10 passed | `preconditions-red-oct28.log` |
| Intended-context/login initial unit green | 5 files, 96 passed | `preconditions-unit-green-oct28.log` |
| First intended-context mounted regression | 4 files, 45 passed; before controller reuse/MFA logout amendment | `preconditions-mounted-oct28.log` |
| Explicit auth mode red | 1 failed, 30 passed: missing named mode | `explicit-mode-red-oct28.log` |
| Controller reuse/import target/MFA logout red | 3 failed, 18 intentionally unselected by focused filter | `reuse-mfa-red-oct28.log` |
| Final guard/bootstrap/context/login units | 5 files, 117 passed | `reuse-unit-final-oct28.log` |
| Final amended mounted regression | 4 files, 49 passed | `reuse-mounted-final-oct28.log` |
| Final import precondition envelope check | 1 selected passed, 21 unselected by `-t`; after limiting the new catch to precondition codes | `import-envelope-final-oct28.log` |
| Amended nonincremental TypeScript | Passed, exit 0 | `typecheck-amended-oct28.log` |
| Amended `npm run check` | Passed, exit 0; no new or grown oversized files, no baseline/config change | `npm-check-amended-oct28.log` |

The final unit command was:

```text
node scripts/run-protected-tests.mjs unit vitest --server run middleware/__tests__/completion-r02.session-preconditions.test.ts modules/auth/__tests__/auth.login-verification.test.ts middleware/__tests__/completion-r02.session-access.test.ts middleware/__tests__/householdGuard.property.test.ts modules/auth/__tests__/auth.status.test.ts --maxWorkers=1 --reporter=verbose
```

Before the protocol amendment, test changes clarified the two-membership label and guard names, replaced the nonexistent `mfaSecret` test sentinel with the real `mfaCode` field, and made the intentionally minimal isolated-route session cast explicit. The affected unit suite was rerun green. The subsequent intended-context amendment requires its own fresh focused/static evidence; the pre-amendment checks do not certify it.

The database command ran only after the coordinator released the exclusive marked-target slot. The wrapper independently verified the persisted target marker before tests, using exactly:

```text
TEST_TARGET_MANIFEST=C:\Users\USER\.codex\worktrees\capital-completion-v2\personal-finance-app\.local\r01-integrated\target.json
TEST_RUN_ID=r01int15a1
TEST_DATABASE_URL=postgresql://pfa_campaign@127.0.0.1:55432/pfa_completion_identity_r01int15a1_test

node scripts/run-protected-tests.mjs database vitest --server run routes/__tests__/completion-r02.session-access.realdb.integration.test.ts routes/__tests__/completion-r02.public-entry.realdb.integration.test.ts modules/auth/__tests__/completion-r01.logout.realdb.integration.test.ts modules/auth/__tests__/completion-r01.realdb.integration.test.ts --maxWorkers=1 --reporter=verbose
```

No ambient `.env` target, shared port 5432, `finance_app`, schema push, real mail or provider network was used. The protected wrapper's PostgreSQL/network controls remained enabled. Database runs were serialized; the slot was returned after completion.

Final static commands were `node node_modules/typescript/bin/tsc --incremental false` and `npm run check`, run in the coordinator's exclusive slot. Both completed with exit 0. The final import error-envelope restriction was checked by the existing targeted mounted case after that final source change; remaining production source matched the full 49-test run. Only this evidence document changed after the required checks. Both resource slots were returned before the author commit.

## What the tests establish

The mounted R02 fixture obtains real registration cookies and raw verification tokens from a captured mocked mail boundary. It consumes the real token to prepare verified controls; it never blanket-verifies registration fixtures. Pending membership is deliberately inserted to prove a membership does not authorize an unverified user. Denial probes cover all twelve household-only finance router families, explicit household create/accept/invite entry, personal/security changes, profile/goal/receipt/import/transaction uploads, authenticated file reads, notifications/push, recap, AI and specialized investment paths, including main-investments `analytics/fx-historical`. Probes use actual registered routes; historical nonexistent `/mfa/setup` and `/grz/holdings` probes were corrected to `/mfa/enable` and `/grz/bonds`.

The denial test asserts structural 403 `EMAIL_VERIFICATION_REQUIRED`, no membership repository invocation, unchanged hashes of 19 named user/household/finance tables, unchanged upload file hashes, no captured mail/resend, and no market refresh calls. The exact table scope is specified in `persistedSnapshot()`; these are bounded checks, not an assertion that every application table was exercised.

The five bootstrap states have exact-key assertions and cache headers. Anonymous bootstrap creates no session cookie. Read-only tracked state remains unchanged. Pending/MFA bootstrap skips household resolution; stale/erased/deleted cookies become anonymous; ambiguous identity is denied; user, membership and session-store failures remain safe 5xx. A two-membership fixture inserts the larger membership ID first, then demonstrates repeated agreement between bootstrap and real household-only `/api/accounts` reads with different roles and account rows; unchanged tracked state is asserted. The test's log initially called the lower ID "oldest"; the final test label uses "lowest", matching the actual ordering contract.

Pending `/me` preserves its existing public DTO. Signed-in resend rotates the persisted hash, exposes only delivery outcome, invalidates the old token and leaves a new token consumable after revoking logout. The initial registration captures the actual emitted template through a mocked `sendEmail`; signed-in resend's same-module helper closes over its local `sendEmail`, so that helper's send boundary is explicitly mocked and its issued token is independently checked against persistence/consumption. This is mocked transport evidence, not SMTP/MIME acceptance.

The existing R01 regression files passed unchanged: selected-device revocation, delayed session saves, generation/reset/erasure and old credential races, MFA-only cancellation and preserved devices. Existing public-entry tests passed unchanged: anonymous verification and a different signed-in visitor never become the token owner. These checks preserve the prior authority boundary without claiming all unfinished MFA policy acceptance.

The intended-context regressions send real A-origin headers under a valid B registration-derived cookie and assert both read and account-create denial before membership/effects, unchanged tracked table state, and pending resend denial. A same-subject two-household fixture removes H1 while H2 remains and proves old H1 expectations return 409 through both household-only accounts and requireAuth-only household/general. Unchanged expectations and headerless reads still work. Malformed/duplicate HTTP headers return generic 400 without reflection. Credential login tests preserve generic unknown-user, bad-password and lockout outcomes while exposing structural verification-required only after valid credentials.

The follow-up mounted reds demonstrated three concrete defects before repair: general GET selected H2 after the guard selected H1; a valid import body targeting H2 reached the mocked import service despite H1 expectation; and an A-expected logout cancelled B's MFA challenge. After repair, general GET and PUT each select once and affect H1, with H2 unchanged. The investment notification preference audit remains attributed to H1. Import's matching-membership/body-target precondition rejects before service invocation, while a headerless control reaches the mocked service with its existing explicit H2 target; this is request-routing evidence, not import-workflow acceptance. The final catch only surfaces `SESSION_CONTEXT_CHANGED`/`BAD_REQUEST` errors structurally, preserving other import error behavior. Unit tests additionally cover authoritative absence, full-row reuse, lookup errors remaining 5xx, and refusal to use attached user/context as cached authority. MFA challenge requests carrying authenticated expectations return 409 and leave the challenge current; headerless cancellation still succeeds.

The old household property tests modeled session IDs alone and therefore failed at the stronger current-user boundary. Only the properties that intentionally test membership for a verified actor now supply a matching current verified row; anonymous and separate pending/stale/erased negative tests remain intact. No production guard was weakened for mocks.

## Original author checkpoint acceptance limits

At the original author checkpoint, independent frozen-SHA Sol review, Astra final code review, canonical integration, complete server/client suites, build/bundle and protected Golden browser acceptance remained the coordinator's next gates. Later integrated full-server evidence is recorded below. The separate client boundary is not proved by these server tests. Real SMTP/MIME, production cookie/CSRF/limiter behavior, category seeding, other packets, release and staging/production are not accepted by this report.

## Integrated full-server fixture follow-up

The original server implementation was frozen as `d70fb7b8fbe8f63e77b9a1d3125ebb69da924169`. The coordinator's later complete server run at canonical `635020f` exited 1: 239 files (236 passed, 3 failed), 3303 tests (3275 passed, 28 failed), 1034.97 seconds. Its exact log is `C:\Users\USER\.codex\worktrees\capital-completion-v2\personal-finance-app\.local\r02-session-access\server-oct28-parent-full.log`. A byte-identical copy is retained locally as `.local/r02-session-access/parent-full-red-oct28-fixtures.log`, SHA-256 `54DB1AD72B457760BAF1E043BBEE3B7853680363F1F192D1E7046D5AAC536122`. The author verified no server diff between `d70fb7b` and `635020f`, including matching original blobs for all three failing test files. This is applicable red evidence, not a completed green full-suite run.

The coordinator authorized these bounded test repairs, with no production change:

- `crossHouseholdAccess.property.test.ts`: its five membership/target properties now provide a matching current verified row for each generated session user. All five 100-run properties and the foreign-household denial, valid-member success, explicit/body target, and missing-target 400/no-membership assertions remain.
- `completion-r04.context.test.ts`: only its 22 implicit/explicit membership-guard role cases now use valid UUIDs and a matching current verified row. All five known roles and six invalid roles retain their independent expectations. The 44 legacy adapter/context cases retain their original fixtures and assertions.
- `auth.verification.test.ts`: the successful-password unverified-login case still requires 403 and now asserts the authorized structural `EMAIL_VERIFICATION_REQUIRED` code. Pending registration fixtures remain pending; no credential or verification guard is bypassed.

Fresh protected unit verification passed 8 files and 196 tests in `.local/r02-session-access/fixture-repair-unit-oct28.log`. It includes those three files and the unchanged five-file R02 guard/context/status/login suite, retaining pending, anonymous, MFA-only, stale, erased, role and context negative coverage. Exact command:

```text
node scripts/run-protected-tests.mjs unit vitest --server run middleware/__tests__/crossHouseholdAccess.property.test.ts middleware/__tests__/completion-r04.context.test.ts modules/auth/__tests__/auth.verification.test.ts middleware/__tests__/completion-r02.session-access.test.ts middleware/__tests__/completion-r02.session-preconditions.test.ts middleware/__tests__/householdGuard.property.test.ts modules/auth/__tests__/auth.status.test.ts modules/auth/__tests__/auth.login-verification.test.ts --maxWorkers=1 --reporter=verbose
```

Follow-up nonincremental TypeScript and npm check both completed with exit 0 in the coordinated static slot. Their logs are `.local/r02-session-access/fixture-repair-typecheck-oct28.log` and `fixture-repair-npm-check-oct28.log`. No production/test source changed after those checks; only this evidence report was finalized. The static slot was returned before commit. The follow-up author commit is based on `d70fb7b`; its exact SHA is supplied externally to the coordinator. No DB rerun, complete-suite green, integrated client acceptance or packet closure is claimed by this fixture-only follow-up.
