# R14 foundation repair checkpoint

Current isolated source is7d252f18131722ffd84ba766d4ba4cd135aa8f9e at
C:/Users/USER/.codex/worktrees/capital-r14-durable-foundation/personal-finance-app.
Ten foundation source/test paths remain isolated; canonical application source has
not received them. Parent retains shared/schema.ts, migration numbering, journal,
snapshot and every protected runtime/database window.

The accepted repair contract48019a5b40d89096b553eccf9fb733f504fe39018cfc9670094a854f5520f5ea
is implemented in source: deterministic pre-SQL admission; matching running-attempt
locks and exact conditional mutation counts; SQL-precision timestamps; row-local
constraints; unified ordered eligibility indexes; a read-only backlog hint; and
proposed corruption, race,100/101 and populated query-plan controls. Row-local SQL
checks do not independently guarantee a matching attempt exists; store mutations
must refuse corrupt claims transactionally.

Retain all predecessor commits and raw results. At3a3a1336, protected pure contracts
passed3/3, but repository check failed TS2769 on nullable claimToken. Commit7af9c058
adds return to the existing throwing guard without weakening refusal. Commit69e13adf
repairs invalid claim chronology and makes renewal-first contention meaningful.
Its repository check passed0. Astra then found a distinct held-effect race fixture
that expired a lease inside a transaction later rolled back; the green typecheck
was not proof of that database behavior. Commit7d252f18 repairs only that fence test,
using a committed short lease and an independent bounded DB-clock barrier.

Sol focused source approvalb81d940c209ea7727af24c9f363cc6b532f08bb33ce9bd3f68ea66a8e32ed2c5
and Astra focused source approval80a11e0a525c979f8885c0e5585b6452a4499b9ed2586d3cb9f73289a4e68778
close the final held finding in source. The original Astra warning1a5c73306bb2028e6fd595c0de0cf11b457b3985824589adec5aa29947ab86e6
is preserved. Final7d repository check passed0/all guards/no new or grown LOC debt:
.local/r14-foundation/check-fence-repair.log SHA256
76416047d0ca7dc62b553d980d927b7c11ced48e86d7fddb1582838c772b7871.
The earlier successful69e log has identical text bytes; these were separate actual
runs, not a copied/relabelled result. Pure tests were not repeated for later test-only
and narrowing changes. No proposed SQL test has run.

The current unregistered SQL draft has SHA256
69e70a422bfb80cbaf03966d7ff05d3d005707205f3799869657022bff5b8712.
Its policy function explicitly returns false on SQL NULL and must precede table
CHECK creation. The previous STRICT-function draft remains historical. Parent has
reserved0015_r14_durable_jobs.sql but has not registered/generated/applied it.

An ignored parent-generation packet prepares a credential-free absolute-path config
and zero-byte dotenv file. The installed Drizzle CLI loads dotenv globally even
with custom configuration, so future generation must use a clean child environment
with DOTENV_CONFIG_PATH bound to the owned empty file, never ambient root .env.
Review the exact config and all old migration hashes before offline generation;
review resulting SQL/function preamble/journal/snapshot before any protected DB run.

Empty/populated migration rehearsal, actual constraints/corruption rollback,
renewal/expiry/fence races,100/101 continuation, populated EXPLAIN plans and independent
readback remain unverified. Existing jobs/cron/financial/provider/snapshot guards and
all producer-admission, production/shared-database and release gates remain intact.

## Offline generation and preservation update, 31 October 2026

The state above is historical. Source commit
`b109794da8631d10088eca7ed1faaf3cb92cc9c9` replaces three bigint JavaScript
defaults with equivalent SQL zero defaults so Drizzle can serialize the schema.
The focused schema-default review is preserved in canonical
`.local/r14-foundation-review/SCHEMA-DEFAULT-REVIEW.md`.

Three generation attempts are preserved in the isolated author's
`.local/r14-foundation/parent-generation/`: the absolute-output attempt failed
with ENOENT despite exit zero; the relative-output attempt failed to serialize
bigint defaults despite exit zero; the SQL-default attempt produced the migration
and snapshot. No failed attempt is counted as successful generation.
The final relative config used an explicitly cleared environment and an owned
empty dotenv file. The parent prepended the reviewed policy function before
the generated table constraints. `generation-result.json` records 28 unchanged
old migration files, exactly two new tables and no changed existing tables.

WIP commit `d938529c79d8fa2a46c72d25acb0debd9571ee91` on
`codex/r14-durable-foundation` now preserves the six previously uncommitted
parent-owned paths, including the inherited R05 0014 baseline. This is an
isolated preservation commit, not a migration accepted into canonical.

Raw candidate SHA256 pins:

- 0015 SQL: `621d96c8bb8700e5631c6a83dafa1d8846dd1c6a259086e2f7cc789e85b602ab`
- 0015 snapshot: `662f7b66995e6a2ae157e5d16af0312338ed2109115c3b379396252c52cb46f2`
- Journal: `ba1937d2c09faf508cb2fffe748caac2cca6751b5254ce35ed35a1a1e20553df`

The post-default repository check completed with exit zero; its existing
`check-sql-default.exit.txt` and log were inspected. Log SHA256 is
`76416047d0ca7dc62b553d980d927b7c11ced48e86d7fddb1582838c772b7871`.
The original execution handle is no longer available; this update verifies the
saved terminal evidence and does not claim a fresh check run.

Independent generated-DDL review is still pending after reviewer quota failures.
No SQL has been applied and no protected persistence/race/EXPLAIN evidence exists.

## Independent generated-DDL source review, 31 October2026

An independent Sol Extra High database-reviewer returned bounded source approval
with no actionable defect in d938529c. It checked function precedence and SQL-NULL
refusal, policy shape/range checks, bigint SQL-zero defaults, timestamptz types,
row-local constraints, NO ACTION attempt FK, uniqueness and ordered eligibility
indexes, two-table snapshot/schema alignment and journal0015 ordering. Additive
old-binary compatibility means retaining unused new tables, not destructive down
migration. This did not certify item/attempt coherence from CHECKs alone.

The reviewer relied on coordinator candidate/preservation identity rather than
repeating Git/hash checks. Main then rechecked clean HEADd938529c and the three
SQL/snapshot/journal hashes listed above; all match. No SQL or runtime check was
run by either action. Astra final adjudication, empty/populated migration proof,
actual constraint/corruption behavior, lease/fence races,100/101 continuation,
populated EXPLAIN and independent readback remain required. No producer admission,
canonical source integration, R14 closure or release approval follows.

## Astra final generated-DDL source adjudication, 31 October2026

The existing Astra High reviewer resumed after the quota retry time, verified
clean d938529c plus all three generated artifact hashes and independently cleared
bounded SQL/schema/snapshot/journal source with no actionable finding. It also
confirmed unchanged older migrations against canonical9ab99497, correct snapshot
linkage, two added tables and the preserve-prefix/append0015 resolution. No SQL,
application, database or browser execution occurred. All migration/rehearsal,
constraint/corruption/race/100-101/EXPLAIN/readback gates above remain open.
Source clearance alone does not permit canonical integration or producer use.

## November 1 local integration and persistence verification

The October 31 entries above record the earlier source-review stage. The durable foundation and migration 0015 subsequently entered the local campaign at `b96bb7b9`. The November 1 entry “durable job storage and migration 0015 integrated locally” in [CAMPAIGN.md](../CAMPAIGN.md) records the empty and populated migration rehearsals, the previous application's compatibility run, the claim and fence tests, the query plans, and the preserved failures.

The corrected combined run at `b96bb7b9bebdd3aa16ff97ea7c980fbe4aca5aeb` passed 101 database tests in six files and three Chromium journeys. Its marked test database recorded zero durable items, attempts and other clients at postflight. The receipts are in the capital-durable-integrate-nov01 worktree under `.local/durable-merge-nov01a/`. These runs used synthetic job definitions. Production job admission, producer-specific effects and release evidence remain open.
