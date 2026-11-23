# R04 foundation map — design only

15 October 2026. Read-only source inventory at canonical application
`7f44f1e408208c40b11e4bd6b3308138be3089d8`, inspected in
`C:/Users/USER/.codex/worktrees/capital-completion-v2/personal-finance-app`.
That HEAD was verified before and during inspection. The parent's later dirty
Playwright configuration/spec belong to its active R01 proof and were not edited.
This document alone is authored in the R01 worker tree. No database connection,
test, historical probe, fixture creation or implementation ran for this inventory.

Authority: master v2.2 sections 1–3, permissions/privacy contract, R04 and J05;
companion v1.2 A3/R04/Part E is subordinate. Accepted R20
[A5 reconstruction](../R20/A5-RECONSTRUCTION.md), source disposition `538bc47`,
supplies portable synthetic inputs, not present-day privacy acceptance.
R01 source is accepted; the parent's actual two-browser/full-suite prerequisite
checks remain the gate for starting R04 implementation. Nothing here closes a
canonical register row or grants implementation/file ownership.

## Required boundary

Authorization is membership AND a named operation capability AND containing
account visibility AND transaction visibility. Owner/admin do not override
another subject's private account or transaction. Account privacy and explicit
transaction privacy remain independent; never copy/backfill one from the other.
Invisible resource IDs return404, malformed IDs400 and a known forbidden
capability403. Denied mutations leave business rows, links, balances, history,
audit and outbox unchanged. Each negative needs an authorized positive control.

Owner/admin/member may write authorized financial records. View-only and
Professional may read authorized shared financial data, change their own
profile/display/security settings and request their personal privacy export;
they may not create financial/report export jobs or ad hoc recap generation.
Household policy/shared views/AI consent belong to owner/admin. Unknown roles
fail closed. Do not derive these rules from an ordinal role comparison, HTTP
verb, or a blanket read-only middleware on all personal endpoints.

## Live registration and capability seams

`server/routes.ts:102–142` mounts modular settings, tags, goals and recurring
routers. Goals/tags/recurring install `householdGuard`; settings installs
`middleware/auth.requireAuth` and adds householdGuard only to household routes.
Authenticated identity comes from the accepted guarded session path; app
attachUser supplies req.user to older recurring controller branches.

| Current seam | Source finding | Foundation implication |
|---|---|---|
| `middleware/householdGuard.ts` | Both guard variants re-read membership, but cast role to owner/admin/member/view_only. Stored professional is not modeled or validated; unrecognized values are not rejected. | Validate a complete role allowlist before attaching an actor context. Reuse fresh membership lookup so downgrade/removal takes effect on the next request. |
| `middleware/validateEntity.ts:263` requireRole | Four-role hierarchy; professional/unknown lookup is undefined, and undefined `<` requiredLevel is false. | Fail closed for every unrecognized value. Replace authorization decisions with named capabilities; any legacy requireRole adapter must use explicit role sets, with call-site classification. |
| `modules/settings/settings.routes.ts:113` PUT preferences | requireAuth + householdGuard only. Controller `updatePreferences:294` creates a missing household preference row, updates it and writes audit, without a role gate. | Owner/admin policy capability must run before any create/update/audit. Snapshot row absence as well as existing values in the denial oracle. |
| `modules/reports/reports.routes.ts:97,107` | POST custom and POST exports have analytics/membership handling but no route role gate. `reports.exports.controller.ts:38` passes household/user/scope into export service. | Explicit financial-report/export capability; do not confuse with settings/account/export personal privacy capability. Source mapping only, no report execution here. |
| `modules/weekly-recap/weekly-recap.routes.ts:20,24` | Feedback and generate have household guards but no named capability; personal recap settings are separate routes. | Classify generation as financial job capability. Feedback requires its own contract, not an automatic write prohibition on every personal POST. |

requireRole is shared across accounts, transactions, goals, tags, recurring,
budgets, categories, receipts, merchants, investments, rules, filter presets,
AI consent and legacy GRZ routes. Pure calculator POSTs also use member today
(goal projection/debt strategy/payoff and GRZ calculators). A global adapter fix
must not silently certify all these routes or assume every POST is financial
mutation. Global market/reference writes remain operator-only work, not an
admin inheritance privilege. Full route classification is a later R04 obligation.

Household membership currently has presence/role fields and a household+user
unique index, not an active/deleted flag. Do not invent such a filter or fix
R03's household lifecycle/multiple-household ambiguity as an incidental R04
cast change. An authenticated, current membership row is the available seam.

## Goal call paths

All paths below are under `/api/goals` unless noted.

| Surface | Actual path at the pinned revision | Missing boundary / retained control |
|---|---|---|
| `GET /:id/activity` | `goals.routes.ts` → `goals.controller.ts:359` → `GoalActivityLogService.getActivity:65` → goal_activity_log by goalId only | HouseholdContext is ignored; no goal household join or actor. Foreign goal activity can be selected by ID. Rows expose amount, previous/new balance and metadata. |
| `GET /:id/transactions` | `goals.extra.controller.ts:105` → household-scoped getGoalById → `TransactionGoalLinkService.getLinkedTransactions:364` | Goal household check exists; transaction join filters household only, with no account or transaction privacy and no actor parameter. |
| `DELETE /:id/transactions/:txId` | member gate → `goals.controller.unlinkTransaction` → `TransactionGoalLinkService.unlinkTransaction:192` → private getTransaction:345 | Current user is passed but ignored for source access; deprecated household-only reader precedes link deletion/progress changes. Recheck visible source under the mutation lock before deletion/audit. |
| `POST /:id/transactions` | member gate → linkTransaction → getTransactionWithVisibility:322 → TransactionRepository.findByIdWithVisibility | Already checks both privacy facts before the transaction. Preserve the positive behavior; still review lock-time reference/privacy revalidation, not only a pre-transaction snapshot. |
| `GET /:id` | `goals.controller.getById` → facade → `services/goal/GoalQueryService.getGoalWithProgress:25` | Actor is supplied for timezone but assignment query at line50 returns every joined account's name/balance/currency. The dedicated assignment endpoints below use a different filtered path. |
| `GET /assignments`, `/:id/assignments`, `/available-funds` | assignments controller → GoalAccountAssignmentService → `services/goal/assignment.queries.ts:35,67,101,141` | Existing account visibility helper/filter is a useful control; reuse rather than replace with unscoped queries. Check account household/deletion as well as privacy when centralizing it. |
| `GET /`, `/summary`, `/:id/projection`, `/:id/contributions` | GoalBaseService getGoals, GoalQueryService getSummary:97/getProjection, contribution delegate | Summary/list lose actor; summary recentActivity:174 is household-only. getGoalWithProgress/projection carry actor only to timezone. Investment holdings progress also resolves accounts/holdings without viewer visibility. Contributions need source-aware inspection rather than assumed-safe household scope. |
| `GET /api/transactions/:id/goals` | `transactions.controller.getGoalLinks:191` → TransactionGoalLinkService.getLinksForTransaction:388 | Actor is dropped; household join alone does not establish visibility of the source transaction/account. Include the reverse relation in the route matrix. |

Actual implementation paths differ from older prose: GoalQueryService is
`server/services/goal/GoalQueryService.ts`; the top-level GoalService is a facade.
GoalService inherits through GoalDebtService/other goal classes and GoalBaseService.

Filtering linked/activity rows alone is insufficient. `goals.currentAmount`,
progress/projection fields and activity previousBalance/newBalance can already
encode hidden sources. Link mutation stores clamped progress, so subtracting
invisible link amounts is not a proven inverse; R10's provenance/reversal work
is relevant. The first implementation must either compute a supported visible
projection or use an explicitly reviewed redacted/incomplete representation for
ambiguous legacy values. Do not overwrite stored progress, invent an owner-only
goal policy, report a false zero, or claim summary privacy from a filtered list.
Metadata with unresolved/malformed source IDs must default to exclusion or
reviewed quarantine, not make historical rows public.

## Tag call paths and counts

`GET /api/tags/:id/transactions` → tags.controller.getTagTransactions →
`tags.service.ts:292` (household-scoped tag check) →
`TagRepository.findTransactionsByTag:233`.
The repository uses one predicate for count and page rows, with transaction
household, deletedAt and `transaction.isPrivate=false OR transaction.owner=actor`.
It never joins/restricts accounts. A private account with an explicitly public
transaction passes; ownership of the transaction does not override ownership
of another person's private account. Preserve privacy-before-pagination and
the identical count/page predicate while adding the containing-account check.

The returned `{tag, transactions, count}` includes the raw tag usageCount from
findById. Tag list/get, analytics (`tags.service.ts:441`) and suggestion ranking
also consume stored household-wide usageCount. Filtering only returned rows
leaves a count/existence channel; use actor-visible usage projections for output
and derived ranking rather than mutating the global stored count per requester.

GET/add/set/remove transaction-tag operations already call
TagService.verifyTransactionAccess:66 → TransactionRepository.findByIdWithVisibility.
Retain those controls, then revalidate within the mutation transaction as the
shared reference contract requires. Tag merge/count idempotence is R11 work;
do not conflate repairing a visibility projection with changing merge arithmetic.

## Recurring call paths

`recurring.controller.ts:42–122` destructures householdId only for list, detail,
upcoming, summary, history and linked transactions. The facade is
`services/RecurringService.ts` → `services/recurring/RecurringService.ts` and its
base/linking/processing/creation inheritance chain.

| Surface | Delegate | Source finding |
|---|---|---|
| List/detail/upcoming | RecurringBaseService:15/25/41 → RecurringRepository:36/56/133 | Household-only rule queries; rule.accountId is not checked against actor-visible accounts. |
| Summary | RecurringLinkingService.getSummaryData:345 → RecurringRepository.getSummary:367 → RecurringQueryRepository.getSummary:193 | Household-only callbacks aggregate amount plus active/subscription/upcoming counts. Filter source rows before aggregation. |
| Linked transactions | RecurringLinkingService.getLinkedTransactions:352 → RecurringRepository delegate → RecurringQueryRepository.findLinksByRecurring:49 | Household rule join only; returned link contains transaction ID and expected/actual amount. Must validate rule/account and each linked transaction/account. |
| History | RecurringLinkingService.getHistory:362 → RecurringRepository delegate → RecurringQueryRepository.findHistory:163 | Household rule join only, limit after no visibility filter. History contains previous/new state and linked transaction identity; current-rule visibility alone cannot sanitize older snapshots. |
| PUT `/:id` | member gate → controller before read → RecurringBaseService.updateRecurring:161 | Existing rule is household-only. New account checked only when body.accountId changes; a name-only update never checks current private account. |
| DELETE/lifecycle | controller/lifecycle controller → household-only getRecurringById then delete/pause/resume/end/skip services | Actor is used for performedBy/audit but not consistently to authorize current rule/account. Test each denied mutation in a reset scenario. |
| POST link | RecurringLinkingService.linkTransaction:121 | Locks household rule and checks transaction through visible reader, but does not check rule's own account visibility. |
| DELETE `/:id/link/:linkId` | controller passes only linkId/household/user → unlinkTransaction:265 → deleteLink | Route rule id is ignored by service; deletion resolves by linkId+household, then can update source transaction flags and log history. Bind rule id, link and visible source under locks before mutation. |

Rules have accountId but no independent owner/privacy/source-transaction column;
their source relation is recurring_transaction_links. Do not invent a copied
privacy flag. The A5 baseline is unambiguously hidden by its private account.
A private transaction on a shared account and history of an account change need
separate source-aware variants; ambiguous legacy origin is not a license to
publish its template/history. Preserve service/cron operation context explicitly
when actor-aware signatures are introduced; never use optional/missing actor as
an all-household bypass for ordinary HTTP. Scheduler/materialization authority
and recipient-specific recap queries remain separate R14/R16 integrations.

## Existing primitives and reusable fixtures

- AccountRepository.findByIdWithVisibility and findByHouseholdWithVisibility
  constrain household/deleted state plus account owner/privacy. TransactionRepository
  findByIdWithVisibility:217 checks transaction privacy then parent account privacy,
  but its parent-account query lacks an explicit household/deleted predicate and
  is a separate snapshot. It is a useful existing control, not a complete shared
  lock-aware predicate or a substitute for membership/capability.
- TransactionQueryRepository:159 and TransactionCountRepository already compose
  transaction privacy with an account subquery including household/deleted state
  when visibleToUserId is supplied. Centralize this tested shape with required
  actor context; avoid optional viewer meaning unrestricted HTTP reads.
- `core/validation/middleware.ts` supplies Zod body/query/params validation. There
  is no universal UUID param gate on the inspected routers; body UUID schemas do
  not protect path IDs. Reuse the middleware with route-specific UUID params.
- `__tests__/fixtures.ts` provides real app registration and synthetic identity
  helpers; the R01 tests demonstrate actual cookies, store/tombstone readback and
  deterministic barriers. Login accepts existing credentials; new fixtures should
  use current shared-policy passwords, not copy old fixture passwords literally.
- `tags.transactions.visibility.realdb.integration.test.ts` already asserts
  transaction privacy before pagination/count on one shared account; it does not
  create the private-account/public-transaction or full role cross-product.
  Extend it as a positive control, not evidence that ORG-002 is already closed.
- goals.realdb/projection tests and recurring.db tests provide real schema/API
  setup and mutation controls. goals.integration, household isolation security
  tests and householdGuard.property use service/repository doubles; keep those
  as unit contracts, not privacy runtime acceptance. Existing settings integration
  proves personal display/notification persistence and should remain permitted.
- Protected `testing/fixtures/fixture-context.ts` verifies the same manifest and
  per-client marker before fixture/readback SQL. completion-fixtures/golden-a are
  protected prerequisites and literal oracles, not an implemented A5 builder.

Rebuild A5 with fresh IDs/cookies: household A owner/member and B outsider,
then independent admin/view_only/Professional variants; unknown role only at a
controlled membership seam, never inserted past the real enum. PRIVATE savings
opens5000.00 and spends777.77 on2026-10-05 with transaction.isPrivate=false;
SHARED checking opens1000.00 and spends11.11. Literal owner/member balances are
5211.12/988.89 and visible expense totals788.88/11.11. Link the private expense
as spending to the shared goal; tag both; create the private-account recurring
rule. Pin/read recurrence scheduling fields independently before upcoming/tick
claims. Separate variants cover transaction-private/shared-account, mismatched
account/transaction owners, soft deletion, foreign references and changed privacy.
Never replay historical invite phases, jars, passwords, IDs or probe scripts.

## Recommended first bounded handoff

The following is proposed ownership, not an implementation claim. One owner
must own shared capability/visibility/context signatures and their adoption to
avoid competing predicates. Parent assigns precise files after R01's local gate.

1. Freeze a foundation slice: proposed `server/core/authz/capabilities.ts` and
   `visibility.ts`, middleware/householdGuard.ts and validateEntity.ts, household
   preference route policy gate, and the complete tag rows/count/metadata pilot.
   Explicitly model financial.read, financial.write, household.policy.write,
   financial.export, personal.settings, personal.export and ai.read capabilities.
   Validate all five known roles and fail unknown closed. Keep legacy requireRole
   compatibility fail-closed via explicit sets while classifying callers; never
   replace the master matrix with an ordinal ROLE_LEVELS interpretation.
2. Adopt required actor context in goal and recurring paths in separately frozen
   cohesive slices, including mutation-time reference checks. Proposed ownership:
   goals controller/extra/assignments, GoalActivityLogService, TransactionGoalLinkService,
   goal/GoalQueryService + GoalBaseService + assignment queries; recurring controller/
   lifecycle, RecurringBase/Linking services and both repositories. Coordinate
   the reverse transaction-goal endpoint and existing shared repository helpers
   under that same owner. Progress/history ambiguity needs a reviewed response
   representation before those aggregates can be accepted.
3. Retain the remainder of R04 explicitly: references/rule execution (R11), all
   account export/investment/report/AI/recipient-job readers, global reference
   writes, malformed/unknown API behavior, and the complete route/capability matrix.
   A tag pilot or passing goal activity test cannot close FIN-01/R04 globally.

Proposed tests: `middleware/__tests__/capabilities.test.ts` for the literal role
matrix, a controlled unknown-membership seam through the real guard, existing tag
visibility suite plus `modules/goals/__tests__/completion-r04.realdb.integration.test.ts`,
`modules/recurring/__tests__/recurring.privacy.realdb.integration.test.ts` and a
settings capability real-DB suite. Tests independently declare expected roles,
IDs/counts/amounts; never import implementation allowlists as the oracle.

First runtime criteria after authorization: every actor authenticates and sees
a permitted shared control; owner sees private control; member/admin/view_only/
Professional never see another person's private marker/ID/amount/count; outsider
goal activity404; private-account/public-transaction tag count excludes the row
before pagination and raw tag metadata; name-only recurring update and hidden
goal unlink404 with complete before/after row snapshots; view_only/Professional
household preference write403 without creating a missing row/audit; owner/admin
policy updates succeed; read-only roles' own display/security settings still
work. Add positive controls per route, member downgrade/removal between requests,
malformed path400 and unknown-role403. No failure at authentication, CSRF or
unrelated step-up is a proved downstream privacy denial.

No schema change is assumed for the first predicate/capability slice. If legacy
provenance/quarantine or visibility revisions require new persisted state, declare
and migrate it separately with owner assignment; do not silently backfill data.
Any later DB proof requires a separately coordinated unique protected target,
standing local authorization, immutable marker and scoped cleanup. No target was
created or contacted here. R04 implementation awaits the parent handoff.
