# Checkpoint 2 reviewer/coordinator handoff

31 October 2026. Resume from the existing isolated checkout
`C:\Users\USER\.codex\worktrees\c2-review-remediation`, branch
`codex/c2-review-remediation`, base `aa62784c70c5001e570a2a89ef88d88b600a65ac`.
Read `C2-REMEDIATION.md` first, then the eight bounded repair commits, their
regressions, and the proposals below. Main owns independent review/integration.
No new agents were used. Primary and canonical source were not edited.
No push, merge, DB connection, browser/native window, broad check, provider or
real message was performed. Local implementation is not release acceptance.

## Candidate and limitations

| Commit | Repair |
|---|---|
| 79f802c2 | Import financial.write admission |
| 283555f5 | Credential rejection distinguished from session authority loss |
| cb725c62 | Bulk writer delegates atomic tag mutation; receipt actual insert increments counter |
| 662d117d | Resend strict limiter and locked persisted cooldown across entry points |
| 87e6b0a8 | APP_URL boot validation; generic unexpected import errors |
| c646b096 | Shortcut modifier/widget guards and prefix cancellation |
| 7a09b8bd | Rejected auth attempts do not broadcast; uncertain/successful transitions still do |
| 84f769f0 | Summary re-reads amounts/visibility; removes uninvalidation-aware cache consumer |

Review counter lock ordering, receipt rollback, and every legacy producer. This
repair does not reconcile existing mismatches. AccountImportService still uses
separate link/count calls; rule actions use a supplied transaction. Those wider
producer contracts are not certified by these bounded repairs. Bulk retains its
existing controller audit in addition to the writer's atomic actual-effect audit;
review this duplicate audit representation before integration. No hidden audit
failure was used to substitute for the writer's atomic audit.

Resend cooldown uses the existing 24-hour challenge expiry to infer issue time
and applies 60 seconds under the user-row lock. Registration uses the same TTL.
This avoids a new schema/Redis namespace; a future TTL change must migrate this
contract. It limits issuance, not confirmed mail delivery. Public replies remain
generic. Adapted existing DB tests age the synthetic challenge and assert 429
before successful rotation; those edits are prepared, not executed.

Summary always aggregates current repository results. This avoids stale financial
and visibility snapshots and date-range registry growth from this consumer; it
increases database reads. Generic cache registry expiry remains a separate issue.
No throughput claim is made. Unknown auth network/5xx outcomes still broadcast;
real multi-tab and session-expiry journeys remain necessary.

## Remaining findings and concrete proposals

- C2-04: `config/redis.ts:assertRequiredJobCapabilities` deliberately refuses the
  admitted profile without scheduler lock capability. Keep it. R14 owner should
  specify durable due-job claim/fencing, lease loss before/after dispatch and
  unknown external outcomes. R20 owner then admits exactly that capability and
  proves built/installed identity plus boot and lease-loss refusal. Do not expose
  unrestricted Redis commands or turn admission into a boolean bypass. The 64
  pending-operation bound is not a demonstrated 32-request capacity threshold.
- C2-07: transaction invalidation lists 13 endpoints; ordinary backend duplicates
  a connection per call. `deleteByPatterns` caps scans at 128, inspected keys at
  10,000, and ordinary execution at one second. COUNT is a scan hint, not an
  exact key threshold. Propose one owned connection and one household-scoped
  traversal per entity event with an explicit endpoint-set filter; all key
  namespace validation, bounded work, lifecycle checks and disconnect guarantees
  must remain. This changes shared invalidation contracts: coordinate before code.
- C2-08 generic registry: registration has no TTL/LRU eviction hook. Propose
  expiry-bounded registrations plus stale in-flight load fencing, tested against
  invalidation/load races and process-local versus distributed behavior. This is
  separate from the repaired summary consumer and requires cache-owner review.
- C2-09: `removeMemberWithLastMemberGuard` deletes membership without updating
  `tags.memberId`; the accepted `R04/TAG-LINK-WRITES.md` requires persisted member
  references to remain valid. Removing the writer check would violate that
  contract. Propose an explicit audited departure transition that clears only
  departing-user tag attribution in that household under compatible ordered
  locks, preserving links, counters and visibility. Adjudicate historical
  departed references separately; no automatic legacy backfill authorized here.
- C2-12: `Accounts.tsx:41` renders an alert and Retry Loading Account Filter.
  `useAccountOwnerPreference` supplies explicit retry and requires saved state
  before financial queries. No master requirement found demanding fallback to
  all. Keep that behavior; an explicit temporary-view choice would be a separate
  product decision. Success toast from `useUpdateUserPreferences` is UX noise;
  consider a silent option for automatic filter persistence, retaining error UI.
- C2-13: synchronous URL revocation is confirmed; cross-browser failure is not.
  Existing reports E2E only opens the export menu, so it cannot clear this claim.
  Add an actual download-event test, read the saved bytes and compare expected
  content in Firefox and WebKit before choosing cleanup timing. No arbitrary
  timeout was introduced.
- C2-15: 0014 is one-shot additive SQL, and protected bootstrap uses the migration
  journal. Re-running it on a manually pushed schema is not the same contract.
  Push-built adoption needs a schema-and-history diff, equivalent constraint
  proof, and explicit baseline acknowledgement. No safe automatic adoption was
  found or executed; `IF NOT EXISTS` alone could conceal an incompatible column.
- C2-16: production.mjs statically imports manifest authority and dynamically
  imports owned-service/credential authority modules under testing/production.
  Static reachability is confirmed; emitted bytes and runtime side effects are
  not measured here. R20 owner may relocate genuine runtime authority to a
  production package boundary, preserving identity/brand checks and fresh
  installed-format evidence. Directory name alone is not proof of unsafe boot.

## Verification allocation

Pinned runtime:
`C:\Users\USER\AppData\Local\capital-r00-runtime\node-v24.22.0-win-arm64`.
Prepend to PATH and clear NODE_OPTIONS/NODE_PATH. Unit runs use
`node scripts/run-protected-tests.mjs unit vitest ... --maxWorkers=1`.
Logs are under this checkout's `.local/c2/`; they are ignored local evidence.
Install used `npm ci --ignore-scripts --no-audit --no-fund` in this worktree.

For real DB proof, coordinator must allocate a fresh disposable synthetic target
and matching TEST_TARGET_MANIFEST, TEST_RUN_ID and TEST_DATABASE_URL. Never use
ambient finance_app. Run serially from this checkout:

```text
node scripts/run-protected-tests.mjs database vitest --server run routes/__tests__/import.execute.realdb.integration.test.ts --maxWorkers=1
node scripts/run-protected-tests.mjs database vitest --server run modules/tags/__tests__/completion-c2.cross-writers.realdb.integration.test.ts modules/tags/__tests__/completion-r04.tag-writes.realdb.integration.test.ts modules/tags/__tests__/completion-r04.tag-write-races.realdb.integration.test.ts --maxWorkers=1
node scripts/run-protected-tests.mjs database vitest --server run routes/__tests__/completion-r01.email-lifecycle.realdb.integration.test.ts routes/__tests__/security.email-tokens-hashed.realdb.integration.test.ts --maxWorkers=1
```

Add a true concurrent resend test across public/authenticated requests and verify
one issuance and unchanged token on cooldown; UNIT adapters do not prove locks.
For allocated browser time, existing protected R02 journeys can run with:

```text
node scripts/run-protected-tests.mjs database playwright test e2e/completion-r02.spec.ts --project=chromium --workers=1
```

Manifest must also bind an owned server origin; do not reuse an ambient server.
This existing suite does not prove the new C2 two-tab, Radix typeahead or download
cases. Add those journeys before claiming browser acceptance. Then coordinator
allocates `npm run check`, build and broader regressions on the exact reviewed
candidate; none has been claimed green here.

## Dependency, backup and CI disposition

Fresh `npm audit --omit=dev --json`: 4 high, 3 moderate. Full audit: 10 high,
13 moderate. Raw snapshots: `.local/c2/audit-production.json` and
`audit-full.json`. No package/lockfile change, audit fix, force or downgrade.
Registry metadata confirmed compatible candidates multer 2.5.0, nodemailer
10.1.4, body-parser 1.20.9, qs 6.17.1. Propose separate bounded updates: direct
multer/nodemailer patches/minor, explicit qs override update, and body-parser
transitive refresh through Express's allowed range. Inspect exact lock diff and
run upload/body parsing/email parsing regressions plus fresh audits. These are
unexecuted candidate upgrades, not accepted fixes.

Advisories verified live: [body-parser](https://github.com/advisories/GHSA-27r3-jxmh-p828),
[multer](https://github.com/advisories/GHSA-q7qp-rjg7-q26m), and
[Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). Zod's patched line is
4.6.6+, while the app uses v3; this needs a separate compatibility migration for
drizzle-zod, resolvers and validation/error shapes. Audit suggests a major
zod-validation-error upgrade and a drizzle-kit downgrade; do not apply blindly.
Dev-tree updates require toolchain/build/native/installed-format revalidation.
Coordinate all lock changes with R20 before regenerating its pinned evidence.

Coordinator retains backlog-preservation ownership. Recommend an encrypted local
snapshot with hashes of dirty/untracked work and ignored evidence, plus a Git
bundle of refs; a bundle alone cannot preserve uncommitted files. Verify restore
into a fresh directory and keep secrets/DB dumps out of source commits. No backup
operation or external upload was performed here.

Prepare CI around pinned runtime and lockfile, type/build checks, protected unit
runs, disposable synthetic PostgreSQL migrations with independent readback,
separate browser jobs and retained failure artifacts. No real provider/mail
credentials. Exact candidate SHA must bind results. Publication and remote CI
dispatch still require the coordinator's authorized delivery step; local tests
do not imply GitHub CI exists or passed.
