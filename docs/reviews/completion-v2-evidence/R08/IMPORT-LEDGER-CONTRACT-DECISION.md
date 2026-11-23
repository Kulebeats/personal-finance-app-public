# R08/R09 import ledger contract checkpoint

31 October 2026. Source inspected at canonical
`42e21c8f8ad675e8c5647bf0cb2a30b20a94b279`. Documentation only; no implementation,
schema allocation, tests, runtime, database action or integration authorized.

**Decision:** batch/occurrence identity, once-only effects and account-class signs
are settled requirements. On 31 October 2026 the owner selected history-only
effects through later edits and deletions: the example balance stays 100.
This settles the policy question below; it does not authorize inference of
historical baseline dates or bypass implementation dependencies. A UUID-only
repair cannot satisfy FIN-04.

## Authority and reusable seams

The master, `docs/plans/2026-10-15-master-completion-spec.md:156-182,202,1103-1167`,
requires immutable denomination, frozen opening balances after activity,
auditable reconciliation, exact reversal, both import balance modes and honest
history. Its companion `docs/reviews/2026-10-15-unified-completion-spec/FINAL_COMPLETION_SPEC.md:530-536`
provides the asset 100 - 10 + 20 = 110 replay oracle. This document does not amend
either. Existing `R08/IMPLEMENTATION-READINESS-2026-10-31.md` and
`R09/FIN-04-WRITER-TRACE.md` retain the wider implementation and acceptance scope.

| Inspected source | Repair implication |
| --- | --- |
| `client/src/components/accounts/ImportTransactionsModal.tsx:42,94-101,219-226`; `server/modules/accounts/accounts.validation.ts:201-214` | Default false promises unchanged balance initially; request lacks durable batch/snapshot identity. UI does not define later deletion. |
| `server/services/account/AccountImportService.ts:125,149-165,198-210,234-247` | Invalid UUID key, ordinary posting then optional second balance addition; flag only recorded in later audit. |
| `server/services/ImportService.ts:104,197-225,317-350`; `server/services/import/dedupe.ts:27-70` | Reuse transactional writer/audit boundary; replace value-only dedupe and ordinary-only overwrite reversal without discarding legacy key provenance. |
| `server/repositories/TransactionRepository.ts:105-122,288-302,488-515,637-653` | Create/edit/move/delete must share durable effect semantics; a create-only bypass fails later reversal. |
| `shared/schema.ts:946-958,1323-1339` | Existing `data_imports` has no server reader/writer found and lacks scoped batch/options/row outcomes. UUID/source/externalId alone are insufficient. |
| `server/services/account/AccountCoreService.ts:304-355`; `AccountReportingService.ts:388-429`; `AccountExportService.ts:129-159` | Adjustment writer and separate snapshot history are useful seams, not the required reconciliation workflow or event-complete reconstruction. |

## Settled identity and execution contract

- Bind preview/execute to immutable raw source/rows, order and occurrences,
  mapping/version, date format, sign convention, account/currency, Notes/category
  choices, mode, strategy and reviewed resolutions. Fingerprint the interpreted
  payload without mutating raw date cells aliased to Notes/name. Changed input
  requires re-preview.
- Separate request identity from batch/source and row occurrence identity. Scope
  genuine provider references to their source/account; otherwise use normalized
  file/batch fingerprint, mapping version and ordinal/occurrence. Two identical
  purchases survive. A fresh UUID cannot bypass exact-batch replay. Different
  overlapping files or changed interpretations require reviewed candidates.
- Same authorized request/payload returns its recorded outcome without new
  effects/action audits; changed amount, mode or options under that key returns
  409. Durable uniqueness and R08 ordered locks must resolve concurrent claims.
  Hashing date/merchant/amount into a UUID still loses legitimate occurrences.
- Commit accepted rows, replacement reversals, dependencies, balances, row
  outcomes, audit and outbox atomically. Validation/exclusions have explicit
  outcomes; unexpected writer/audit failure rolls back, never becomes a
  “duplicate” skip. Preserve honest created/updated/skipped/rejected reasons.
- Replay after edit/delete must not resurrect or overwrite later work. Retain
  original outcomes/tombstones; intentional replacement is a distinct versioned
  operation. Repeated overwrite stays stable, reversing actual old effects.
  Reject transfer intersections until a reviewed pair-preserving resolution.

Durable mode/effect/revision provenance is necessary; exact columns or linked
records are implementation choices for later schema review. Prefer extending
existing import/transaction seams. A transient boolean or analytics-exclusion
flag is insufficient; no new generic framework is requested.

## Balance policy and reconstruction

**Required:** true applies each accepted economic effect once through R08, with
no second batch-total update. False leaves current balance unchanged on import.
Neither rewrites frozen opening balance/class/currency. Use decimal strings,
locked-account denomination and positive magnitudes with explicit economic
direction. Asset purchases decrease assets; liability purchases/borrowing
increase positive debt; repayments reduce debt. Tracked-account repayment is a
paired transfer, not another expense. Refunds retain original category/link
semantics. A CSV sign alone cannot distinguish refund, repayment and income;
resolve ambiguity in preview, not by hiding inconsistent signs with `abs()`.

**Owner-approved history-only policy:** false means already-accounted-for history with
zero account effect through ordinary edits, delete/restore and validated moves.
True-mode revisions reverse old effects and apply new ones. Changing mode needs
explicit previewed, versioned, audited reconciliation. Mixed-mode overwrite
cannot silently refund a previously posted expense. Neutral rows remain actual
historical activity for applicable reports/budgets; they are not pending or
automatically excluded. Reconcile splits/links on edit/delete; account-tracking
progress changes only when account balance changes. R10/R12 reader policy remains.

Reconstruct only from a proven opening or explicitly reconciled baseline and
its effective boundary, plus recorded effects/corrections, including zero effects.
Do not sum every visible import row or silently change opening balance. Preserve
immutable original and before/after provenance. Unknown opening dates, missing
effects or legacy modes require reconciliation and snapshot-only/incomplete
labels; a neutral import does not establish historical balances. This checkpoint
does not choose an unsupported historical baseline date.

## Independent future oracles

The owner selected history-only lifecycle semantics. These are acceptance
oracles, not executed results; they still need persisted readback, provenance,
dependencies and actual audit/outbox checks.

| Scenario | Enabled | Disabled | Authority |
| --- | --- | --- | --- |
| Asset 100; expense 10 + income 20; concurrent/lost-response replay | 110 once | 100 | Required |
| Two identical expense-10 occurrences; asset 100 | Two rows; 80 | Two rows; 100 | Required |
| Asset 100; expense 10 -> edit 15 -> delete | 90 -> 85 -> 100 | 100 -> 100 -> 100 | Owner-approved neutral lifecycle |
| Debt 100; purchase 10 -> edit 15 -> delete | 110 -> 115 -> 100 | 100 -> 100 -> 100 | Owner-approved neutral lifecycle |
| Cash 100/debt 100; paired repayment 20 | 80/80; reversal 100/100 | Already-accounted-for pair stays 100/100, otherwise refuse unresolved pair | Pair safety required; neutral effect approved, representation still needs design |
| Changed payload under same key | 409; no writes | Same | Required |
| Replay after edit/delete; repeated overwrite; audit failure | No resurrection; stable replacement; complete rollback | Same, using persisted actual effects | Required; mode change needs reconciliation |
| Rebuild from proven baseline | Exact recorded effects | Includes zero effects; no invented prior history | Provenance required; owner-approved neutral lifecycle |

## Dependency and recorded owner decision

Retain R04 acceptance before R08 implementation and R08 before R09 financial
integration. Existing R08 manual oracles remain valid. The policy answer does not
waive C2/R09 ownership, schema review, protected runtime or independent
acceptance gates. No new R20 tooling is needed. No tests were run.

The unselected alternative was ordinary posting plus an explicit initial offset: expense
10 and offset +10 leave asset 100; editing expense to 15 gives 95; deleting it
while retaining the offset gives 110. That requires a separately approved offset
date/baseline and lifecycle policy, never a hidden opening-balance rewrite.
History-only avoids those balance changes but requires reconciliation when the
user actually intends a cash correction.

**Owner answer, 31 October 2026:** "Stay at 100 (Recommended): imported history
remains balance-neutral through edits and deletions."

The answer was received directly in this chat and recorded at 15:06 UTC. The
100-to-110 alternative was not selected. No hidden opening-balance rewrite or
initial offset is authorized by this answer. Historical baseline/date provenance
requirements and the explicit reconciliation boundary for changing effects
remain intact. No implementation, migration or test result follows from approval.
