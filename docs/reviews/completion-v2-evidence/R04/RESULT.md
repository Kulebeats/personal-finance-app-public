# R04.1 bounded foundation evidence

15 October 2026. This is the named-capability, household-context and household
policy preference slice only. R04 remains OPEN; no canonical register or master
status is changed by this file. Independent source review is pending for the
commit containing this evidence.

Authority: master v2.2 sections 1–3, permissions/privacy and R04; subordinate
companion v1.2 A3/R04/Part E. The master's named grants replace the companion's
ordinal ROLE_LEVELS proposal. The accepted R20 A5 reconstruction supplies
synthetic fixture design, not an assertion of current application privacy.

Base: `ba227f1e92577e74942d6719b9f02a9d849afd96`. Isolated branch
`codex/capital-r04-foundation`, worktree
`C:/Users/USER/.codex/worktrees/capital-r04-foundation/personal-finance-app`.
Initial frozen source: `e7e2a2fb009e319aa486d5d0b80bc40c722f56b6`;
the strict request-contract correction is a separate follow-up commit.
No previous R01 or shared primary worktree was edited. Ancestor AGENTS.md was
empty; no repository AGENTS.md was present. Own npm ci added 708 packages; no
environment file, credentials or node_modules junction was copied. Selected
runtime was observed as Node v24.22.0, win32 arm64.

## Implemented boundary

`server/core/authz/capabilities.ts` declares seven named capabilities and all
five literal roles. Financial read, personal settings, personal export and
AI read are granted to all five known roles; financial write/export to
owner/admin/member; household policy write to owner/admin. These grants do not
replace account/transaction visibility, ownership, consent or paid authorization.
Unknown roles and unknown capabilities fail closed, including prototype keys.
Both household guards validate the fresh membership role before attaching
context. The legacy adapter uses explicit allowed role sets instead of numeric
comparisons. Its existing known four-role decisions are retained; Professional
does not retain the accidental undefined-role bypass.

PUT `/api/settings/preferences` requires `household.policy.write` before its
controller can create policy or audit state. The focused policy service locks
household -> acting membership -> existing policy, rechecks the persisted role,
then creates/updates and audits using the same transaction. The household anchor
orders absent-row creation and matches account erasure's household-first order.
Role update/removal conflicts on the membership row; a write ordered first can
commit while still authorized, whereas a role change ordered first is observed
and denies the write. Unknown/missing membership under the lock also denies.

The update helper explicitly copies the two real policy columns accepted by
this endpoint (`showPendingTransactions`, `allowEditPending`) and never accepts
identity/household reassignment from a patch. The follow-up request validator is
strict: at least one of those two boolean fields is required, and every other
key is rejected. Empty/unsupported/mixed owner patches return400 before any
create/write/audit; denied roles still receive capability403 before validation.
The personal preference endpoint/schema mismatch remains R05 work, not silently
implemented here. No new personal persistence or PostgreSQL schema was added.

GET preferences returns `{ preferences: null }` when no row exists. It performs
no create/update/audit and synthesizes no policy values. Authorized PUT creation
uses the existing database schema defaults; none were added or redefined.
Actual client fetch/query/card rendering with null succeeds without a mutation.
This proves null tolerance, not completion of the current mislabeled personal
workflow cards or their pre-existing UI fallbacks.

Own profile/display/security/personal export admission is unchanged. Actual
signed-cookie view_only/Professional display writes, display readback, password
step-up and own-session listing succeed in the focused database suite.

## Shared adapter compatibility

[LEGACY-CALLERS.md](LEGACY-CALLERS.md) enumerates all 124 remaining production
adapter calls in 18 caller files, including unresolved classifications. This is
the exact indirect compatibility surface, not a certified full-route matrix.

The parent explicitly authorized six gate-only read exceptions after source
tracing: POST `/api/goals/debt-strategy`, `/api/goals/calculate-projection` and
`/api/investments/grz/calculate/{bond-price,ytm,accrued,tbill-yield}`. The two goal
handlers delegate supplied input to GoalDebtService/DebtPayoffCalculator and
GoalProjectionCalculator; the four GRZ handlers delegate supplied input to
pure Money/Decimal/date calculations in grz-service. These paths create no
persisted state or jobs and call no provider. Only their route gates change to
financial.read. Signed-cookie read-only controls assert actual numeric outputs.

Saved-goal calculate-payoff remains restricted because it reads stored progress
whose private-source provenance is unresolved. AI conversation deletion,
filter-preset operations, rule preview/dry-run and operator market/reference
operations retain existing declarations pending later classification. No AI,
consent, paid-call or calculator body behavior was broadened in this slice.

## Target and red/green record

Only the reserved disposable target was created, through
`scripts/create-test-target.mjs` and `scripts/setup-test-db.mjs`:

- run `r04oct15a1`; database `pfa_completion_r04_r04oct15a1_test`;
- numeric loopback `127.0.0.1:55432`, role pfa_campaign; explicit admin /postgres;
- own ignored `.local/r04/target.json`, owned origin 5167 (browser not launched);
- guarded bootstrap reported created=true and 14 applied migrations after exact
  endpoint and persisted synthetic marker verification;
- no schema/migration/package/lock/guard/config edit or unguarded DB entrypoint.

All execution uses the native Node path and protected wrapper. DB commands use
explicit TEST_DATABASE_URL, TEST_RUN_ID and TEST_TARGET_MANIFEST; providers,
mail/push and undeclared network destinations remain blocked. Full suites are
reserved for the parent; DB/static slots were coordinated with its client run.

| Check | Observed result |
|---|---|
| Guard/adapter behavior red, existing implementation | 39 failed / 27 passed, correct bypass assertions |
| New capability-contract initial collection | Module absent, no tests collected; not counted as behavioral evidence |
| Capability/guard + existing household property tests | 4 files / 120 tests passed, 1.99s |
| Existing policy controller red | 19 failed / 3 controls passed, 21.81s |
| First repaired policy suite | 22/22 passed, 9.64s |
| Calculator read controls red, filtered run | 2 failed; remaining 22 deliberately not selected |
| Policy + calculators green | 24/24 passed, 10.20s |
| Actual client null fetch/query/cards | 1/1 passed, 1.26s |
| Final DB policy + existing settings integration | 2 files / 33 tests passed, 13.74s, no skips |
| Final strengthened audit rollback / DB rerun | 2 files / 33 tests passed, 11.75s, no skips, exit0 |
| Final unit/property rerun | 4 files / 120 tests passed, 1.90s, exit0 |
| Final client null contract rerun | 1/1 passed, 0.988s, exit0 |
| Non-incremental TypeScript | tsc --incremental false, exit0 |
| Repository npm run check | exit0; 0 new/0 grown LOC violations |
| Request-contract follow-up red | 16 failed / 10 controls passed, 9.35s; 27 earlier tests deliberately not selected |
| Strict request-contract follow-up green | 2 files / 59 tests passed, 11.61s, no skips, exit0 |
| Follow-up static | tsc --incremental false and npm run check both exit0; 0 new/0 grown LOC violations |

The 27 new DB tests use real login-issued signed cookies and the real PostgreSQL
session store. They cover all five known-role policy positives/denials with
absent/existing row snapshots, exact old/new audit subject, unknown-role
repository seam without an invalid enum insert, downgrade/removal on the next
request, and stale middleware snapshots after a committed role change/removal.

Real pg client barriers cover both transaction orders without sleep-based
assertions: pg_blocking_pids proves a policy write is waiting for an uncommitted
downgrade/removal, then it returns403 without policy/audit changes; the converse
proves a downgrade waits for the policy writer, which commits200 before the
downgrade, after which the next write is403. Audit fault injection explicitly
requires the same tx; the strengthened final checkpoint inserts the actual
audit row then raises, so readback must show both audit and policy rolled back
for absent and existing policy. This is synthetic failure evidence, not a live
database outage or external delivery claim.

The separate request-contract follow-up extends the new policy suite from27 to53
tests (59 including the six existing settings tests). Each unsupported-only
display key (`theme`, `dateFormat`, `currency`, `weekStartDay`,
`notificationsEnabled`), empty object and mixed display/unknown+valid policy
payload is exercised through a real owner cookie with absent and existing rows.
Before/after policy and audit are independently selected even on the red run;
the observed200 and persisted row/timestamp/audit changes reproduce the false
success. Green returns400 without partial writes. Single false values for both
real policy fields retain200 and preserve the omitted peer; all three denied
policy roles retain403 even for malformed request contracts.

Importer inventory found `updatePreferencesSchema` exported only from
settings.validation.ts and consumed only by settingsController.updatePreferences.
The existing export was therefore narrowed in place. Separate display,
notification and profile validators/endpoints are unchanged. This intentionally
stops claiming that display-shaped or current misrouted personal UI fields were
saved; completing the personal preference route/UI contract remains R05 work.

Ignored local logs are `.local/r04/{policy-red,policy-green,calculator-red,
policy-calculator-green,focused-db,focused-db-final,focused-unit-final,
client-final,types-final,check-final,request-contract-red,
request-contract-green,request-contract-types,request-contract-check}.log`.
The dependency's node-cron sourcemap warning was observed; tests did not fail or
skip because of it. Earlier TypeScript reported four test-double typing errors;
those test-only casts were corrected before the final checkpoint.
The first repository check also caught one extra line in the already oversized
settings routes file; a normal single-line route opening keeps its size within
the existing baseline. No LOC baseline/configuration was altered.

Reproduce with the native runtime on PATH, from this worktree:

```powershell
$env:TEST_DATABASE_URL='postgresql://pfa_campaign@127.0.0.1:55432/pfa_completion_r04_r04oct15a1_test'
$env:TEST_RUN_ID='r04oct15a1'
$env:TEST_TARGET_MANIFEST=(Resolve-Path '.local/r04/target.json').Path
node scripts/run-protected-tests.mjs database vitest --server run modules/settings/__tests__/completion-r04.policy.realdb.integration.test.ts modules/settings/__tests__/settings.integration.test.ts --maxWorkers=1
node scripts/run-protected-tests.mjs unit vitest --server run core/authz/__tests__/capabilities.test.ts middleware/__tests__/completion-r04.context.test.ts middleware/__tests__/householdGuard.property.test.ts middleware/__tests__/crossHouseholdAccess.property.test.ts
node scripts/run-protected-tests.mjs unit vitest run --config client/vitest.config.ts client/src/pages/settings/sections/PreferencesSection/__tests__/missing-policy.test.tsx
node node_modules/typescript/bin/tsc --incremental false
npm run check
```

## Limits and next gate

Independent review of the frozen commit, parent integration and fresh integrated
checks remain required. No broad server/client/browser suite ran in this worker
for this slice. No hosted/production proof, external messages or deployment.
No new migration/data backfill; existing 14-migration schema only.

Tags/goals/recurring visibility, derived amounts/counts, reference lock-time
validation, financial export/report/recap jobs, complete route/actor matrix and
the remaining R04 surfaces are OPEN. R03 household lifecycle and R05 personal
preference routing are not replaced. No tag pilot starts until this slice is
accepted and the parent assigns its next precise ownership boundary.

## Parent acceptance and integrated checkpoint

Separate reviewer accepted author e7e2a2f plus8e33b3d; parent integrated them as
e409ef6 plusa796a78. Full protected server at a796a78 passed229files/3066tests,
zero failures/skips,392.96s, exit0, one worker, on the marked14-migration identity
target. Log: .local/r01-integrated/server-full-a796a78.log. Only docs changed
during execution. Later ee5187d adds separately reviewed pure manifest modules
and tests without changing the application.

Combined ee5187d passed the actual client null-policy test1/1, npm run check,
build and185.88kB initial-JS gzip budget, plus3/3 protected Chromium journeys
in48.1s with zero retries. Reviewer read exact logs/diffs and accepted this
bounded foundation. Full R04 and all canonical groups remain OPEN. The parent
has now assigned the bounded tag visibility slice; its source/runtime acceptance
is not supplied by this checkpoint.
