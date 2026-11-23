# R05 remembered account candidate

Allocated 30 October 2026 from canonical `8687c37ded1c5562491cfe5c042c42795ab19f5d`.
Governing contract: `ACCOUNT-MEMORY-NEXT.md`, master R05.1 and R02/R04 boundaries.

Author: `C:\Users\USER\.codex\worktrees\capital-r05-account-memory\personal-finance-app`,
branch `codex/r05-account-memory`. All104 files in the frozen manual-draft
manifest were hash-verified before copying and again at the destination. Manifest
SHA256 `863a619d54910d24b22d75a1c97c0a6850b04186162a57c2405558d845ede2d8`.
The manual-draft author remains frozen. Dependencies are local candidate evidence,
not canonical source integration or full packet acceptance.

## Ownership and verification

Two Sol Extra High workers have separate ownership: account_memory_core owns
transactionAccountMemory.ts and its pure tests; account_memory_integration owns
the draft initializer, transaction form hook and focused hook tests. Existing
manual-draft test fixtures may be adjusted only while preserving their assertions.
account_memory_review is independent Sol Extra High general reviewer. Parent
owns this record, test execution, eventual browser work and canonical integration
scheduling. Language review and Astra High final review remain separate gates.

Tests are written before production changes. Parent runs the protected focused
RED and GREEN commands with the pinned Node24 runtime and records exact outcomes.
No new DB/browser process has been started. Reconciliation found no active agents
before allocation and no owned PostgreSQL/account-memory browser process. The
separate R09 chat remains terminal with its recorded network-permission failure;
its work is not duplicated.

Memory is optional and restores only an eligible account into a pristine new
draft. Delayed accounts must not reset other fields or block ordinary form use.
Every storage access requires a live captured subject/household operation,
acknowledged own enabled preference and successful current visible-account list.
Successful financial mutations may remember the primary account, including the
transfer source; storage failure cannot make the financial save appear failed.
Legacy global memory is never read, migrated or deleted by this change.

## Implementation and regression evidence

The helper now scopes optional storage by a versioned subject/household tuple,
rejects disabled/unknown/errored/mismatched preferences and ineligible accounts,
and contains storage failures. Legacy global memory is untouched. The initializer
restores only the account field of a pristine new draft; delayed list resolution
does not reset amount/date/type. All five successful ordinary/recurring/edit and
transfer create/edit routes remember only their primary source account.

Both restoration and post-await writes read the originating identity-bound
QueryClient immediately at the storage boundary. Rendered query snapshots alone
can lag an acknowledgement. General review identified that restoration still had
this race after the first save-boundary repair; three layout-effect regressions
failed before the final getter repair and now pass. The existing R02 QueryClient
lifetime supplies list provenance; cached account visibility is not fresh server
authorization and financial mutation behavior remains authoritative server-side.

Protected Node24 evidence in author `.local/r05-account-memory/`:

- Initial `integration-red`, `account-red` and `account-green` artifacts are
  preserved but their integration storage fixture was invalid: shared test setup
  replaces localStorage with no-op mocks, while those tests seeded it and spied
  on native Storage.prototype. Their apparent negative passes are not acceptance.
- Corrected tests use a scoped Map-backed Storage. Parent temporarily substituted
  the two frozen manual-draft hooks, ran `integration-corrected-red` (25 failed,
  7 passed), then restored exact saved candidate bytes and verified their hashes.
  `account-corrected-green` passed109/109 across five files.
- `restore-race-red` used the wrong test-name filter and skipped all35; it is not
  proof. The corrected `restore-race-selected-red` failed all3 selected cases.
- `account-final-green` passed112/112 across five files after the fresh-cache
  restore repair. These include helper isolation/eligibility/storage failures,
  actual RHF hook behavior with mocked financial mutations, real QueryClient
  before-render acknowledgements and preserved manual-date/tag/modal regressions.
- Initial repository `check` passed before the final getter repair. Final check
  and browser evidence are tracked separately below; no ESLint task is declared.

Browser source adds real UI preferences, two public accounts and income creation,
same-household actors sharing one browser storage context, reload and disabled
remembrance, with independent SQL reads. Its execution is pending. The fresh
marked target is `pfa_completion_memory_r05m20261030a_test`, loopback55432,
browser54329. Bootstrap retained two refusal artifacts (wrong manifest variable,
then missing run marker); both failed static guards before a database connection.
Corrected bootstrap created the target with15 migrations. Protected preflight
verified its marker, zero users/households and zero other client connections.

Independent TypeScript and general source re-reviews found no remaining actionable
issue after the getter repair, including the browser test/config. Final repository
`check-final` passed after that repair and the diagnostic addition below.

## Browser failures and investigation

The first `browser` attempt failed before fixture execution because the selected
runtime directory contained Chromium but not its headless executable. The next
`browser-runtime` attempt used the verified installed headless runtime and reached
the login document (HTTP200), but no sign-in form appeared: diagnostics recorded
`/@vite/client` request failure around10.8seconds, no pending scripts at the end,
and a41.05second observation. This is a repeated unresolved cold-start symptom,
not evidence of a transaction-memory defect or a diagnosed cache problem.

The protected browser guard previously discarded the route.fetch error. A bounded
diagnostic addition to e2e/protected-test.ts now records same-origin script paths,
allowlisted error names and fixed transport categories, plus denied redirect
path/status. Raw messages, headers, query strings and bodies are never logged;
each category is capped12 per context. Strict origins, maxRedirects0 and abort
semantics are unchanged. Independent general and TypeScript reviewers cleared
this diagnostic delta; their approval is not an execution claim.

The instrumented `browser-diagnostic` attempt rendered login in4083ms without a
script-fetch diagnostic. It then failed on a separate account-creation assertion:
the UI selected Shared (Household), but POST201 returned the actor's ownerUserId
instead of null. This failed evidence and synthetic fixtures are preserved. The
ownership mismatch needs a separate R04 diagnosis; it must not be reported as
shared-account acceptance. A warm successful login does not resolve cold startup.

Astra High final review and canonical source integration remain pending. All101
groups remain OPEN. No production, external-message/provider, deployment, release
or shared-database authority is changed.

## Successful bounded browser journey

After preserving the failed Shared-selection spec and identifying the R04 service
null-coalescing defect, the memory fixture explicitly selects Me and verifies the
actor owner in the request, response and SQL. The accounts remain public and both
actors must receive the same real account list and see both picker options.
This exercises R05 personal memory without claiming shared-ownership correctness.

`browser-public` reached first-actor transaction persistence and reload restoration,
then failed a role locator while the Radix menu hid the underlying trigger from
the accessibility tree. The actual snapshot contained both options and the blank
trigger text. Final assertions observe both options, close the menu with Escape,
confirm the dialog is visible, then verify the blank picker. No product behavior
changed. Failed spec/log/screenshot are preserved; general and TypeScript reviewers
cleared this test-only correction. Final screenshots use durable path attachments.

`browser-final` passed1/1 in43.0seconds against the real development-mode server:
UI creates two actor-owned public cash accounts; both actors save preferences;
income creates return201 and persist exact11.25/23.50 rows; first actor's selection
survives reload; real logout and second login retain the same browser storage but
start the second actor blank despite both accounts being visible; second actor's
different choice persists; returning first actor restores its own choice. Finally
UI disables memory, SQL verifies first=false/second=true, a legacy global key is
seeded, and a fresh transaction-page reload stays blank. Three durable screenshots
and precredential render diagnostics accompany the final log. This is local R05
consumer evidence, not full R08 accounting, cross-device or production acceptance.

Final marked-target readback retains all failed and successful fixtures:8 users,
8 households,5 public actor-owned accounts,4 saved preferences and3 incomes
(11.25 from the earlier interrupted journey plus11.25/23.50 from the final one).
Unknown users/households and other client connections were all0. SQL also confirms
the failed Shared attempt's row is actor-owned. Owned PostgreSQL PID16472 was
identity-checked and stopped with pg_ctl smart shutdown, exit0; its PID file is
gone and no browser-server process remains. Source freeze/evidence receipt below
bind this checkpoint; raw failures are not removed or relabelled as passes.

Next concrete prerequisite repair is `../R04/SHARED-ACCOUNT-OWNER-NEXT.md`.
`RECEIPT-REVIEW-NEXT.md` records the subsequent bounded preference consumer and
the separate unresolved automatic-conversion, merchant-memory and timezone policy
questions. Cold login reliability remains unresolved: the warm successful final
journey does not diagnose or repair the earlier failed Vite client request.

## Frozen checkpoint

Final repository `check-verified` passed on the final source and browser-spec
bytes. All104 prior manual-draft files were rechecked in their frozen author and
remain unchanged. The current author changes four inherited candidate paths
(initializer, form hook, manual-test fixtures, completion test registration), adds
the helper/two test files/browser spec, and includes the separately reviewed
protected-test diagnostic. Its109-file final manifest is
`.local/r05-account-memory/source-freeze-final.json`, SHA256
`5be48a0e98696930fbf2f2d06d5e411e58fcaf4b94d4c192bd10e4737cf58c15`.

All87 raw evidence files were copied with SHA256 verification into canonical
`.local/r05-account-memory-oct30/`; `receipt.json` SHA256 is
`932c17a5ce72640db5283455780ba27eba187e463b948d8247c25764ecd84f45`.
This includes invalid/failed attempts, successful logs, three durable final
screenshots, failed-source snapshots, database preflight/readback and owned
shutdown. The source candidate remains uncommitted and isolated pending Astra
High final review/canonical source integration. The canonical commit records
evidence and next work only. Goal and continuation automation remain active.
