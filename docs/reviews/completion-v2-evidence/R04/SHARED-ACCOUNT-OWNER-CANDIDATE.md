# R04 shared account owner candidate

Allocated30 October2026 from canonical6c8d20e16f7ef8488f0f0e29d347edcdef9150c3.
Governing contract: SHARED-ACCOUNT-OWNER-NEXT.md and master R04. Prior account-memory
candidate remains frozen, independently locally verified but pending Astra/canonical
source integration. All101 completion groups remain OPEN.

Author: `C:\Users\USER\.codex\worktrees\capital-r04-shared-owner\personal-finance-app`,
branch `codex/r04-shared-owner`. All109 source files were verified against the
account-memory manifest SHA256
`5be48a0e98696930fbf2f2d06d5e411e58fcaf4b94d4c192bd10e4737cf58c15`
before copying, then each destination hash was verified. Dependencies are bounded
local evidence, not full packet or release acceptance.

## Ownership

account_memory_integration (Sol Extra High) owns only AccountCoreService.ts and new
tests server/services/__tests__/completion-r04.account-shared-owner.test.ts and
server/modules/accounts/__tests__/completion-r04.account-shared-owner.realdb.integration.test.ts.
account_memory_core (Sol Extra High) owns only the new browser spec
e2e/completion-r04-shared-owner.spec.ts and its completion-config registration.
account_memory_review provides independent general review. Parent owns canonical
records, serialized unit/DB/browser execution and later review scheduling.

Explicit null must remain Shared; omitted owner still defaults to the actor.
Existing member-level create capability, owner/admin assignment checks, target
household membership and private-account owner validation remain required. No
financial input, posting or permission policy is changed. Tests are written first
and parent captures RED before the bounded service edit.

At allocation canonical Git was clean, no prior team worker remained active, and
no owned PostgreSQL/browser process was found. Separate R09 remains terminal with
its existing network-permission failure; no duplicate R09 work is assigned.

## Regression and implementation evidence

Tests were frozen before production changes. On the fresh marked loopback target
`pfa_completion_shared_r04s20261030a_test` (runr04s20261030a, PostgreSQL55432,
browser54330), bootstrap applied15 migrations. Marker preflight verified zero
users/households and zero other client connections. Parent owns the target window.

The new browser RED reached the actual Shared selection and captured the explicit
null request but actor-owned response before failing; the observation JSON and
failed screenshot are durable. Service RED failed2/13 and protected signed-session
HTTP/SQL RED failed4/15. These reproduce the null-coalescing defect and a related
private-account validation bypass: private+Shared returned201 rather than400.
All failed logs remain in author `.local/r04-shared-owner/`.

The production delta is only AccountCoreService.ts: default ownership to the actor
only when undefined; preserve explicit null; mark assignedToOther only for a
non-null different owner; clarify the existing Shared/self contract in comments.
Capability, target membership and private-owner validation branches are unchanged.
Shared creation does not invent a new capability: existing financial.write and
member-level route authorization already permit it. No ledger, money or schema
change is included. Existing duplicate service/controller CREATE audit rows are
not redesigned; the test identifies the ownership-bearing audit row specifically.

After repair, unit-green passed32/32 (13 new regressions and19 existing account
service tests). db-green passed15/15 using real signed login sessions, actual HTTP
guards and independent parameterized SQL for ownership/household/privacy/balances
and ownership audit metadata. Denials compare business-state snapshots of accounts,
transactions, audit and outbox across both test households. UUID-scoped cleanup
removes those DB-test fixtures; the failed browser fixture remains separately
retained, and its rows are outside that cleanup scope.

Independent general and TypeScript source reviews found no actionable defect in
the frozen service/tests/browser delta. Database reviewer verified target-guard
provenance and scoped SQL/cleanup evidence without executing connections/tests.
Reviewed service SHA256:
`d6f1fb65b1b9620a38e4d5e2585e638c7c282b70bdce0de9eb6e94285afa05f7`.
## Browser, final type contract and freeze

The first post-fix browser attempt passed request/response and raw SQL null-owner
assertions, then failed an exact My Accounts locator: the real accessible option
name includes the avatar prefix, `U My Accounts`. The actual snapshot and failed
source are retained. The spec now matches the label suffix; general/TypeScript
reviewers confirmed the remaining filter/persistence assertions are unchanged.
No product behavior was altered for that selector correction.

browser-final passed1/1 in24.7seconds. Real UI Shared creation sends null, returns
null and persists null with public cash/zero balance; Mine excludes the account,
Shared includes it; the filter save is acknowledged and read back in SQL; reload
and real logout/fresh login retain the saved Shared filter and account. Durable
request/response observations, precredential render diagnostics and screenshot
accompany the log. This is the corrected Shared journey, not the actor-owned
public fixture workaround used in the prior R05 packet.

Final TypeScript review identified Account.ownerUserId in client/src/lib/api.ts
still excluded null. Parent added only `| null`, preserving optionality. This
annotation correction followed the successful browser run and emits no JavaScript;
both reviewers cleared it, and final npm run check passed including its consumer
type checking. No runtime behavior changed after the browser pass. Unit/HTTP
evidence predates only this annotation and the browser-only locator correction.

Final protected readback retains3 synthetic browser users/households/accounts:
one failed pre-fix actor-owned row and two post-fix Shared rows. All are public
with0.00 balances; there is1 saved Shared preference and0 transactions. Unknown
users/households and other client connections are0. UUID-scoped DB-suite fixtures
were cleaned by their own tests. Owned PostgreSQL30272 was identity-checked and
stopped cleanly (smart shutdown exit0, PID file gone); no browser process remains.

All109 frozen account-memory author files were rechecked unchanged. The final
candidate adds the service, three regressions and nullable response annotation;
only completion-config registration changes among inherited manifest files.
A Git-path completeness audit found the provisional113-file manifest omitted the
new api.ts annotation; the provisional manifest/receipt are preserved and explicitly
superseded. Final114-file source manifest
`.local/r04-shared-owner/source-freeze-final.json` SHA256:
`2ccc0f804a2b30970b85e05e89d4a4e49494ce140b7a1929cc9cc8f0d69ce411`.
Canonical58-file evidence copy `.local/r04-shared-owner-oct30-v2/receipt.json`
SHA256: `a50c5e824b0ed4f0e9032879652e81cb384e3ec77fa23ec1f7f566ef163c171b`.
The earlier oct30 receipt is not the authoritative continuation packet.

Independent general, TypeScript and database reviews found no remaining actionable
bounded finding. Source remains isolated/uncommitted pending Astra High final
review and canonical source integration. All101 groups, full R04/R08 acceptance,
existing cold-start uncertainty and external deployment/release gates remain OPEN.
Next dependency-ready consumer is `../R05/RECEIPT-REVIEW-NEXT.md`; its automatic
conversion/merchant/timezone policy questions are not resolved by this repair.
