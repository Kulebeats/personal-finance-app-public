# R02 first-household category defaults

## Candidate and scope

Author: Sol Extra High, category lane. Parent Astra High coordinates integration
and final acceptance; separate Sol review is independent of this author.
Base: `8dd829a9156f287a4b65a13cb062eaec425bc7e3`.
Author branch: `codex/capital-r02-category-defaults`.
Author checkout: `C:/Users/USER/.codex/worktrees/capital-r04-foundation/personal-finance-app`.
The candidate is the commit introducing this evidence; its exact SHA is reported
to the parent after freezing the explicit owned paths.

Governing plan: canonical
`docs/plans/2026-10-28-r02-defaults-and-mail-execution.md`, Task 1, with the parent's
explicit empty-tree-only adjudication on 28 October 2026. This is first-run
initialization, not repair, reconciliation, reset or migration of existing data.

## Source trace and preservation contract

Before this change, `seedDefaultCategories` in `server/seed.ts` inserted groups
and categories through global `db` in separate commits. Its production callers
were `categories.operations.controller.ts`'s explicit seed endpoint and the manual
`server/reseed-USER.ts` script. The latter deletes a hardcoded household's rows
before calling the helper; it was inventoried read-only and never run or changed.
`HouseholdRepository.createWithOwner` created the household, owner and tags in one
transaction, but did not initialize categories. Existing category/household HTTP
unit suites mock these operations and cannot establish their persistence.

`shared/schema.ts` and versioned migrations provide primary IDs and household /
group foreign keys, but no category default-provenance key or unique group/name
constraint. Names, ordering, icons, colors, archive/deletion and budget settings
are user-modifiable. Neither row counts nor a name match identify seed ownership.
The parent approved this bounded policy before production edits:

- Any existing category row, including archived or soft-deleted rows, preserves
  the whole tree byte-for-byte: no insertion, update, deletion or gap filling.
- Groups with no categories produce an explicit `ConflictError`, with no writes.
- A missing household produces `NotFoundError`, with no writes.
- A completely empty tree receives the unchanged configured 13 groups and 84
  categories, preserving group relationships, names, icons, colors, ordering,
  budgeting and rollover defaults. `config/defaultCategories.ts` is unchanged.

## Implementation and locking bounds

`server/seed-default-categories.ts` contains the focused helper; `server/seed.ts`
re-exports its existing public name so current callers remain compatible.
Standalone calls own a `withTransaction`; an optional `TransactionType` enlists
all checks and inserts in the supplied transaction without opening another one.
The helper locks the exact household row `FOR UPDATE` before inspecting either
child table. It then applies the preservation rules and inserts the defaults.
Errors propagate; no partial-error fallback or reconciliation is introduced.

`createWithOwner` invokes this helper after tags using its existing transaction.
Its per-user advisory lock, membership conflict and one-winner create semantics
remain unchanged. Users may still belong to multiple households through existing
membership flows; no user-wide uniqueness rule or migration was introduced.

The new real-DB concurrency test observes `pg_blocking_pids`: an uncommitted
ordinary category insert's household FK `KEY SHARE` lock blocks the helper's
`FOR UPDATE`; after that insert commits, seeding sees and preserves the custom
row. Concurrent seed calls also produce one exact set. This bounds initialization
only. Ordinary CRUD name checks do not all take this row lock, so this change does
not establish general CRUD uniqueness, fix stale pre-insert checks, reconcile
legacy trees or add cross-household composite FK constraints. Each seeded
category is independently checked against a group in its own household.

The existing manual seed controller's precheck/response/audit policy is unchanged.
No schema, package/config, auth/limiter, other controller or ledger changes occur.
The large historical category function/comments are removed from `seed.ts` rather
than growing its LOC debt; the extracted helper is below 500 lines. The household
repository remains within its existing LOC ratchet without baseline edits.

## Executed focused evidence

Runtime: pinned Windows ARM64 Node 24.22.0 at
`C:/Users/USER/AppData/Local/capital-r00-runtime/node-v24.22.0-win-arm64`.
All tests used `scripts/run-protected-tests.mjs`; no ambient database or outbound
mail/provider was used. The parent reverified and exclusively assigned the
disposable marked target immediately before DB execution:

- Manifest: canonical `.local/r01-integrated/target.json`.
- Run ID: `r01int15a1`.
- Database: `127.0.0.1:55432/pfa_completion_identity_r01int15a1_test`, role
  `pfa_campaign`; the protected wrapper rechecks the target before writes.

Raw logs below reside under the author checkout's
`.local/r02-category-defaults/`; raw output is not a committed artifact.

| Log | Exact scope and result |
|---|---|
| `category-defaults-red-oct28.log` | Unchanged production baseline: new original nine real-DB cases, **9 failed**, exit 1. Behavioral failures exposed absent create defaults, repeat/race duplication, existing-tree additions, absent explicit refusals and standalone partial persistence. |
| `category-defaults-green-oct28.log` | Three real-DB files: **16 passed**, exit 0, 23.38s. Includes 13 category cases plus unchanged create atomicity/concurrency's three cases. |
| `category-defaults-final-green-oct28.log` | Final test bytes after a test-only fail-fast barrier cleanup: **13 category cases passed**, exit 0, 1.50s. Production source unchanged from the 16-case run. |
| `category-household-unit-oct28.log` | Protected unit mode, existing mocked category/household suites: **2 files / 110 tests passed**, exit 0, 2.46s. This checks HTTP compatibility, not real persistence. |
| `tsc-nonincremental-oct28.log` | Initial nonincremental TypeScript: exit 0. |
| `npm-check-oct28.log` | Initial `npm run check`: exit 1 at the household repository's LOC ratchet, 630 to 631 lines. No baseline edit; corrected by shortening an existing historical comment by one line. |
| `tsc-nonincremental-final-oct28.log` | Fresh nonincremental TypeScript after that comment-only correction: exit 0. |
| `npm-check-final-oct28.log` | Final `npm run check`: exit 0, including runtime parity, TypeScript, no-storage, LOC, Node-tool syntax, assessment metadata/status and W9/W10 checks. Household repository remains at 630 lines; seed.ts shrinks from its 1,218-line baseline to 751. |

Database command prefix:
`node scripts/run-protected-tests.mjs database vitest --server run`.
Focused new file:
`repositories/__tests__/completion-r02.category-defaults.db.integration.test.ts`.
The three-file run adds
`repositories/__tests__/HouseholdRepository.createWithOwner.db.integration.test.ts`
and `repositories/__tests__/HouseholdRepository.createWithOwner.concurrency.db.integration.test.ts`.
All used `--maxWorkers=1 --reporter=verbose`.
The later LOC correction changes only a comment; runtime source and test bytes
remain those exercised by the final 13-case DB and 110-case mocked runs.
Nonincremental command: `node node_modules/typescript/bin/tsc --noEmit --incremental false`.
The unit command used `unit vitest --server run`, the existing
`modules/categories/__tests__/categories.integration.test.ts` and
`modules/household/__tests__/household.integration.test.ts`, plus
`--maxWorkers=1 --reporter=dot`.

The 13 category cases cover exact semantic defaults/own-group FK mapping,
ID/field-preserving repeat, active/customized, archived-only and soft-deleted-only
preservation, groups-only and missing-household refusal, standalone mid-seed
rollback/retry, entire create rollback/retry, concurrent standalone seeds,
caller-transaction rollback after seeding, observed FK contention, and one-winner
same-user household creation. Rollback uses a deliberately overlong in-memory
synthetic category icon to trigger the actual varchar constraint after group
insertion; configuration is restored in `finally`. No trigger/schema alteration,
mocked database or swallowed failure stands in for these rollback assertions.

## Review and acceptance limits

Independent source review and parent final review are pending at evidence
preparation. Parent separately owns real UI household creation, the default
category picker and transaction submission with independent persisted
`category_id` read-back, integrated regression/static/build/browser checks and
canonical status. Their results are not claimed by this author report.

This bounded source/focused-test change does not complete R02, G1 or any canonical
group. Real SMTP/MIME, production CSRF/cookies/limiters, unrelated category CRUD
and reference-policy repairs, membership lifecycle, deployment and release remain
outside this acceptance. All 101 canonical groups remain open.
