# R05 personal preferences and saved account filter candidate

Status: implementation in progress, not acceptance. Previous goal turn made
verified progress through settings writer fixes and checkpoint7e47c4af.
Governing scope is master R05.1, NEW-11/NEW-26 and the source trace in
`PERSONAL-PREFERENCES-NEXT.md`. All101 canonical groups remain OPEN.

## Author and ownership

Derived author:
`C:\Users\USER\.codex\worktrees\capital-r05-personal-preferences\personal-finance-app`.
Branch `codex/r05-personal-preferences`, base
`7e47c4af0aec58bf80ce4ae16b889856088629e9`.
All58 settings-writers source/test files were copied and byte-verified against
freeze `bc0a21c57cb9a1843554debc8a570ee4fbfc6a6a3d6b6fb72dd6df1c1044ccc8`.
The existing dependency junction is reused. Frozen prior authors remain intact.

- Sol Extra High personal_preferences_server owns shared DTO/schema/defaults,
  the personal API/repository, route mount, additive filter column/migration,
  rollback documentation and server tests.
- Sol Extra High report_settings_client owns personal hooks/settings controls,
  Accounts filter restoration/persistence/empty states and focused tests.
- Independent Sol Extra High personal_preferences_review owns general static
  review. Database and TypeScript specialist reviews will use released slots.
- Parent owns migrations against verified disposable data, actual DB/broad
  checks, evidence and later integration. Four active agents maximum.

## Settled implementation boundary

GET/PUT `/api/settings/user-preferences` is an authenticated personal endpoint
under the existing settings auth boundary. It uses session userId, accepts no
foreign identity and preserves the existing household `/preferences` policy
route. PUT is a strict nonempty typed partial patch of nine existing preference
fields plus defaultAccountFilter all/mine/shared. Full responses include own
userId, complete fields and truthful nullable ISO timestamps.

No-row GET returns existing declared defaults without creating a row. Existing
NULL fields read through those defaults without rewriting storage. Invalid
explicit stored enums/values must remain a truthful error rather than a guessed
replacement. Transaction type is expense/income/transfer. OCR confidence is an
integer percentage0..100; its UI must display that supported domain without
silently clamping existing values to the old slider50..95. The70 default and
autoCreateFromReceipt=false remain unchanged. Downstream receipt/import behavior
is not inferred from persistence.

First-row writes use the existing user-anchor lock and preserve concurrent
disjoint patches. The saved filter column is a versioned additive change with
default all, non-null constraint and allowed-value check. SQL and rollback are
reviewed before parent applies them to disposable data. No production migration,
historical-policy backfill or real-user enablement is authorized here.

Accounts waits for saved preference/current identity before the relevant query
and list. Mine resolves the current user, Shared retains existing null semantics,
All retains the SQL visibility predicate. Other member UUID filter options stay
available transiently and are never stored in the enum. Failed saves/load retain
truthful retry states. Filtered-empty versus no accessible accounts must use
authorized account-list evidence, not aggregate net-worth inference.

## Initial verification and runtime ownership

Reconciliation found a clean canonical7e47c4af, terminal previous agents and no
owned database PID file. R09 remains terminal with unchanged network-permission
failure; no duplicate R09 work. PostgreSQL started with explicit127.0.0.1:55432
using a hidden tracked pg_ctl process and WaitForExit on that launcher, avoiding
the prior inherited observation-handle stall. Owned postmaster PID8296.

Preflight in canonical `.local/r05-personal-preferences-oct30/` verified the
r01int15a1 synthetic marker, correct database/user and zero fixture users,
households, failure objects and competing connections. Actual signed-user GET
RED returned404 instead of200 before route/schema production changes:
one failed, exit1, author `.local/r05-personal-preferences/server-red.log/.exit`.
The server worker was then cleared to implement; no migration has been applied
as of this allocation record. Final cleanup/shutdown are still required.

The database-migrations skill guides additive change and rollback evidence;
existing production/shared-database, provider, message and release gates remain.
Astra High final review, canonical source integration and browser/production
acceptance remain separate. This record is allocation and RED evidence only.

## Migration and implementation evidence,30 October2026

The allocation status above is historical. The isolated author now contains
the personal endpoint, strict shared DTO, transactional first-write merge,
nine-control client save/retry flow and saved Accounts owner filter. Source
remains uncommitted and outside canonical integration pending final review.

Migration0014 adds only default_account_filter with default'all', NOT NULL and
an all/mine/shared CHECK. The parent applied it to marked disposable targets:
r01int15a1 populated upgrade and fresh r05p20261030a empty install. Both now
record15 migrations. The upgrade retained all old preference fields and exact
microsecond timestamps, exercised permitted values and invalid/NULL rejection,
and rehearsed inverse DDL inside a rolled-back transaction. The fresh install
verified default, nullability, validated CHECK and initially zero preferences.
The independent database reviewer cleared the SQL, snapshot/journal delta and
raw rehearsal evidence. This does not establish production lock duration.

Migration SQL SHA256:
`df6fb6e714d675e7dc1b9b440dc76c84a6e6f9e2241901e4addc77ebe7e739bd`.
Corrected rehearsal script SHA256:
`d5f32685acc47a4f972426db0383320f09d251dcd69bce68e61668b8b8edf686`.
Corrected rehearsal log SHA256:
`144d922d60b84e59c35ea484c4b9e243af2eaecf87f37950d94a02d034aa3f1c`.
The original rehearsal failed on a mistyped expected migration hash before
fixture writes. Its log/exit1 remain beside corrected log/exit0. Do not rerun
the one-shot upgrade script against the now-migrated targets.

Interim checks in author `.local/r05-personal-preferences/`:

- Client focused suite:113 tests in11 files passed; client production freeze
  `client-source-freeze-20261030-0152.json` records13 files.
- Combined HTTP/DB suite:179 passed,1 failed. The concurrency observer assumed
  both waiters directly block on the holder; PostgreSQL may queue the second
  behind the first. The observer now follows that known blocker chain and still
  asserts the actual user-row FOR UPDATE and merged results. No production
  change was needed for that test-observer correction.
- Personal HTTP/DB suite after correction:24 passed. Its queued erasure RED
  had previously reproduced200 after tombstoning; the in-lock erasure fence
  made the regression pass.
- Initial repository check failed TS2345 in the test request helper. The
  helper now accepts object|string and sends literal JSON null correctly;
  that targeted null-body case passed. Final full check remains pending.
- Shared DTO contract tests were moved into the server test discovery tree;
  all13 passed. The earlier root shared test path was not discoverable.
- Two real browser journeys have been authored and independently reviewed;
  execution remains pending. They cover all nine settings through UI/API/SQL/
  reload and first personal account visibility, saved Shared and reset All.

Independent general and TypeScript reviews then identified a HIGH remaining
race: a request authenticated before selected-session/global-generation
revocation could resume after the user lock and write. A bounded worker owns
test-first regressions and reuse of existing lockCurrentSessionCredential
with the request snapshot, SID and generation. The parent retains serialized
DB execution. This finding is not cleared by the earlier24 passing tests.

Downstream receipt/import behavior, full packet acceptance, Astra review,
canonical source integration and production/release evidence remain open.

## Revocation repair and first browser execution

Both real queued-revocation RED cases returned200 instead of401: selected SID
and global generation. Their actual revocation helpers execute while holding
the user lock after the signed PUT reaches its blocked writer. The production
repair passes req.user, req.sessionID and session.securityGeneration into the
existing lockCurrentSessionCredential within the preference transaction.
Independent general and TypeScript reviews cleared that repair. No new shared
authentication contract or helper was introduced.

The first full26 rerun had25 passes and one observer timeout before global
revocation executed. Rollback then allowed the held request to finish200;
that is not a failed post-revocation fence. Investigation verified the generated
credential-lock SQL is910 characters, ruling out default1024 query truncation.
The observer's direct-blocker assumption was replaced by actual blocker-graph
ancestry, retaining the precise users FOR UPDATE query and explicit holder path.
It also excludes session-store lock queries. A background login FK waiter is
a possible intermediary, not a captured fact from the failed log. Diagnostics
now expose only PIDs/blocker edges/query-class booleans. Independent review
cleared the observation change. The changed full26 rerun passed, exit0:
`server-blocker-chain-green.log/.exit`. Prior failures remain preserved.

First protected Node24 Chromium run used the newly installed r05p20261030a
database and owned origin127.0.0.1:54327. The complete account creation/filter/
reload/reset journey passed. The preference journey failed before login when
the email input had not rendered in15seconds; its screenshot is a blank page.
Cold client startup is a hypothesis, not a confirmed application exception.
The revised test waits explicitly for the real Sign in form with a30second
bound and captures redacted readiness diagnostics on failure. No mock success,
fixed sleep or authentication bypass was introduced. Original browser log,
exit1 and screenshot remain under author `.local/r05-personal-preferences/`.

The next pinned repository check passed TypeScript but failed the LOC ratchet:
settings.routes.ts grew118->123. A bounded mechanical extraction of personal
display/notification/preference routes is assigned, preserving parent auth and
the separate household-policy guards. Final checks and affected route/browser
tests must be refreshed after that correction; earlier evidence is not relabelled
as final-source verification.

## Router checks and browser-discovered accessibility defect

Mechanical routing extraction reduced the parent to108 lines against the118
baseline; the new personal router is25 lines. It mounts after requireAuth and
report-widget routes and retains all six exact handlers. General and TypeScript
reviewers found no shadowing or household-boundary regression. Parent's affected
HTTP/DB rerun passed32 tests in two files, including all26 personal cases and the
six existing settings integration cases. Full Node24 repository check then passed.
Logs: `server-routes-final` and `check-routes-final`, both exit0.

An intermediate93-file source freeze was recorded before the next browser run:
`2bacb2b739bb676ef0b1cc307a8492c6fabd625b742e3f4e3d4c5d1d56dc18e3`.
It is preserved as `source-freeze-final.json`, but is superseded by the subsequent
slider repair below; its filename does not make it the final accepted candidate.

The second browser run passed the account journey again and reached Preferences.
It exposed a real accessibility defect: the shared Slider places aria-label on
its generic Root while its interactive Thumb remains unnamed. The actual browser
accessibility snapshot shows a named generic containing an unnamed slider, and
getByRole(slider,name=OCR Confidence Threshold) fails. The earlier mocked client
test did not reveal that real-Radix behavior. The fix must name the interactive
thumb and preserve keyboard/value behavior; changing the browser locator to
ignore the missing name is not an acceptable repair. This failed run and its
screenshot/error-context remain under `browser-final-artifacts`, with exit1.

## Final local checkpoint,30 October2026

The shared Slider now forwards aria-label and aria-labelledby to the real Thumb.
The added real-Radix test checks naming/label precedence, Root ref, controlled
values, Home/End/ArrowLeft and change/commit callbacks. General and TypeScript
reviewers cleared this delta; two pre-existing unnamed investment sliders remain
separate debt. Fourteen focused Slider/preference tests passed. This overlaps
the earlier113 client tests and must not be added as a unique total.

Final pinned npm run check passed. Both protected Chromium journeys then passed:
all nine settings saved including false/zero, acknowledged API payload, raw SQL
readback and fresh reload; first personal account visible under default All,
saved Shared truthfully empty, reload and reset All retained. This is actual
development-mode browser evidence using the owned test server, not a production
bundle, staging, installed runtime or release claim. No external provider/message
was enabled. Logs are `slider-client-final`, `check-slider-final`, `browser-slider`,
all exit0. The32 affected HTTP/DB cases preceded this client-only naming delta;
server source is unchanged since that passing run.

Final95-file source freeze, author
`.local/r05-personal-preferences/source-freeze-final-v2.json`:
`3b5250f16bad6e07c6d0119b70d5e887088f752d78e01689b96fb9a043c7a496`.
All93 files in the earlier freeze remained unchanged; the only additions were
the shared Slider delta and its real-component test. Prior settings-writers
author58 files were rechecked unchanged.

Canonical78-file evidence receipt, `.local/r05-personal-preferences-oct30/receipt.json`:
`791f8938f3a37b7a47454b0a58bd342752e65d8750047aa299f9eb90b10e45ca`.
This includes failed logs/screenshots, both source freezes, migration rehearsal,
manifest identities, final checks and lifecycle evidence. Source remains in the
derived author at base7e47c4af, uncommitted; only these checkpoint documents are
integrated into canonical. Astra High final review remains held by the previously
recorded quota gate and has not been substituted with Sol approval.

Final readback verified main r01int15a1 has zero fixture users/households, failure
objects and competing connections. Dedicated r05p20261030a intentionally retains
six synthetic users/households from three browser attempts, three accounts and
four preferences; no other users/households or connections. Both targets retain
migration0014. No broad cleanup deleted browser evidence. Owned PostgreSQL PID8296
was identity-checked then stopped successfully; browser port54327 had no listener.

Next bounded inventory is `MANUAL-DRAFT-DEFAULTS-NEXT.md`: personal date-off/type
defaults and hydration must affect manual draft behavior without erasing entered
data. Timezone precedence, global account memory, personal-vs-shared category
memory and import/receipt consumers remain explicitly separate. All101 canonical
groups, full R05 acceptance, canonical source integration and release stay OPEN.
