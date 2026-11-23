# R02 defaults and captured-mail preparation implementation plan

**Goal:** Continue from accepted session-access checkpoint `8dd829a` with atomic
default-category creation and an independently reviewed current mail-proof contract.
**Architecture:** Two independent Sol Extra High lanes, one separate Sol Extra High
reviewer, and parent Astra High coordination/final acceptance. Reuse isolated
worktrees and serialize database, static and broad test execution.
**Tech stack:** Existing TypeScript, Drizzle/PostgreSQL, protected Vitest/Playwright,
Nodemailer and the existing production-profile boundaries; no new dependencies.

## Authority and baseline

Owner requested continuation with the four-agent setup. Local implementation,
synthetic proofs and local commits remain authorized. Shared DBs, providers,
external delivery, provisioning, main merge and deployment remain outside scope.
Baseline `8dd829a9156f287a4b65a13cb062eaec425bc7e3` has 3,303 server and 1,497 client
tests, static/build/bundle and seven browser cases passing from the preceding
checkpoint. Do not rerun the unchanged baseline merely to repeat evidence.

## Ownership

| Role | Workspace / write ownership |
|---|---|
| Parent coordinator/final reviewer | Canonical plans/ledger, integration, new category-picker browser acceptance/config |
| Category author, Sol Extra High | `capital-r04-foundation/personal-finance-app`, branch `codex/capital-r02-category-defaults`; `server/seed.ts`, focused new category-seeding helper if needed, `server/repositories/HouseholdRepository.ts`, related seed/household tests, `R02/CATEGORY-DEFAULTS.md` evidence |
| Mail preparation author, Sol Extra High | `capital-r19-foundation/personal-finance-app`, branch `codex/capital-r02-mail-readiness`; `R02/FRESH-BROWSER-PROOF-CONTRACT.md`, new `R02/MAIL-READINESS.md`; read current source and propose exact component files/contract before code or execution |
| Independent reviewer, Sol Extra High | Read-only design/source/evidence review; no author edits or test-slot use without parent assignment |

All agents are sharing a repository: preserve others' changes, do not revert or
reset unrelated work, and do not spawn additional agents. At most four active
agents including parent. Reuse the fourth slot for separate TypeScript/security
review after an author finishes. Parent final review remains separate.

## Task 1: Atomic household category defaults

1. Trace every category-seeding caller, schema uniqueness and current household
   transaction. Return a precise design before production edits; preserve existing
   category names, hierarchy, icons, colors and user modifications.
2. Add focused failing behavior tests for new household defaults, mid-seed rollback,
   retry/idempotence and concurrent creation. A guard that merely checks row counts
   or swallows partial failure is insufficient. Existing users may legitimately
   belong to multiple households; no user-wide uniqueness migration.
3. Make default-category seeding use the caller's transaction. Standalone seeding
   must be atomic and serialized per household; repeated calls must not duplicate
   defaults or overwrite customized/archived rows. Return ambiguity as an explicit
   design question rather than guessing a destructive reconciliation policy.
4. Invoke it inside `createWithOwner` alongside membership and tags. Preserve its
   existing per-user create lock, conflict behavior and all-or-nothing semantics.
   Keep LOC ratchets; extract the focused helper instead of growing oversized seed
   code. No schema/package/limiter/auth policy changes without parent adjudication.
5. Run focused unit/real-DB tests, nonincremental TypeScript and npm check using
   the assigned slots. Freeze a precise candidate for independent reviews.
6. Parent adds a protected real-UI household creation/category-picker/transaction
   submission case with independent persisted `category_id` read-back. Integrate
   only reviewed code, run applicable integrated regression/static/build/browser
   checks, and record bounded acceptance rather than full R02 closure.

### Category policy adjudication

The catalogue has no immutable default identity. Parent accepts an empty-tree-only
initializer: after locking the exact household row, any existing category row,
including custom, archived or soft-deleted rows, makes seeding an unchanged no-op.
Groups without any category cause explicit conflict, preserving all existing data.
Only a wholly empty catalogue receives the unchanged 13 groups / 84 defaults.
There is no inferred repair, reset or resurrection of user-deleted defaults.
Both standalone calls and household creation retain their transaction boundaries.
Independent plan review accepted the scope and required this explicit policy.

## Task 2: Refresh captured-mail proof contract

1. Reconcile the October 15 source inventory with current accepted link, pending
   session and cache boundaries. Mark repaired historical observations explicitly.
2. Identify exact remaining anonymous CSRF, real limiter/Redis, dependency custody,
   native trust and combined-egress requirements. Preserve every existing refusal
   gate; do not flip execution authorization or append SMTP to an old manifest.
3. Propose the smallest separately reviewable local mail-transport component:
   real emailService, bounded authenticated numeric-loopback synthetic sink,
   actual MIME, constrained import graph/dependency bytes and sanitized evidence.
   No app/auth/DB imports or full registration proof may be attributed to it.
4. Reviewer and parent adjudicate that concrete proposal before component code or
   runtime allocation. If a safely bounded component is accepted, add a separate
   exact-file/run-allocation amendment before implementation. Until then, this
   lane is documentation/source preparation only; no socket listeners or sends.

**Parent/reviewer prioritization:** Defer the proposed seven-file standalone mail
component. Its separately compiled service projection and synthetic input would
not clear the full registration proof's dependency-custody, native HTTPS/cookie,
Redis/limiter or anonymous-CSRF prerequisites. Preserve the refreshed source
inventory and corrected framing proposal as documentation. Prioritize the shared
full-profile dependency/resolution/custody contract and anonymous-CSRF decision;
allocate reusable sink/MIME work directly against that profile afterward. No SMTP
component implementation or runtime allocation is granted by this batch.

### Prepared decisions for the next batch

Read-only server analysis and independent review favor a POST-only CSRF exemption
for the exact paths `/api/auth/verify-email` and
`/api/settings/security/email/verify`. Parent inspected the master permission,
current middleware and token consumer and accepts this narrow design for the next
implementation plan. It is not implemented or runtime-proven by this batch.
The token hash, live owner, expiry, purpose and transaction lock authorize the
effect; unrelated authenticated or MFA-only visitor identity must not change.
Email-change token consumption intentionally changes only the token owner's email,
old-channel MFA challenge, reset tokens, notices and audit. Existing signed-in
resend/change/cancel and normal cookie-authorized mutations keep CSRF protection.
Do not normalize case, slashes, encoding or method to widen these exemptions.
Required negatives include both-endpoint races, wrong-purpose/replay/hash/expired
tokens, unrelated visitor identities, ordinary protected mutation controls and
path/method variants. The anonymous continuity problem remains a source inference
until real middleware reproduces it. Captured-mail/full-profile acceptance remains
separate from pure policy and existing protected-route tests.

The mail lane proposes a bounded native ESM-resolution and entry-byte readback
milestone using the actual externally linked server build, Node executable,
build/metafile, controlling package metadata and independent caller pins. It must
evaluate no app/dependency code and reuse current manifest/path/Windows metadata
helpers instead of a second launcher or altered CommonJS build. Exact interfaces
and a finite transitive/native/custody follow-through still require next-plan
review. Root-entry observations alone cannot set `runtimeDependencyIdentity` or
`executionAuthorized`; neither flag is changed by this preparation.

## Execution controls and completion

Pinned Node is `C:/Users/USER/AppData/Local/capital-r00-runtime/node-v24.22.0-win-arm64`.
Parent must freshly verify the existing disposable identity target before granting
the category lane DB execution: canonical `.local/r01-integrated/target.json`,
run `r01int15a1`, `127.0.0.1:55432/pfa_completion_identity_r01int15a1_test`.
Only protected wrappers may execute tests; never use ambient finance_app or 5432.
The separate Golden target remains parent-owned for browser acceptance.

No tests, guard assertions, thresholds or runtime boundaries are weakened for a
green result. Record failures and repairs. Stop only dependent work on a concrete
gate while continuing authorized independent work. Completed category acceptance
and reviewed mail preparation are distinct outcomes. All 101 canonical groups
remain open until their full criteria are met.

## Execution outcome — 28 October 2026

Completed this batch: category candidate `fb7bf58` received both independent
reviews and parent final source adjudication, then integrated as `ac9708c` with
source parity. Fresh integrated results: 240 server files / 3,316 tests passed,
npm check/build/bundle passed, eight protected browser tests passed with zero
retries. The new browser case first failed on the baseline's missing defaults and
then passed real transaction/category persistence after the fix. Author focused
red/green and nonincremental TypeScript evidence are retained separately.

Mail source/contract preparation received independent and parent documentation
review, committed as `dec0eab` and integrated as `72007d3`. The standalone component
was deferred on critical-path value grounds; no runtime launch or mail occurred.
Read-only next-batch decisions above do not alter the tested candidate or certify
full-profile readiness. Parent accepted both bounded outcomes locally; see
`docs/reviews/completion-v2-evidence/R02/CATEGORY-DEFAULTS-ACCEPTANCE.md`.
