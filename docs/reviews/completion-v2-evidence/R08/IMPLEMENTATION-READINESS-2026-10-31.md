# R08 implementation readiness while candidate reviews are held

31 October 2026. Source inspected at canonical
`0f49b9bf9633cb2605c084f23d43e9f863b1481f`. User explicitly requested useful work
while awaiting review. This is read-only implementation preparation: no application
source, tests, schema, database or candidate branch was changed. No test was run.
No R08 requirement is closed, and this is not independent acceptance review.

Authority: master completion specification, R08 and Golden fixture A. The older
money-class-remediation-plan.md concerns arithmetic-library adoption and does not
replace the current ledger contract. No canonical R08 evidence directory or
R08-named local branch was present before this preparation.

The full R08 scope remains FIN-05, FIN-08, FIN-13, FIN-17, ORG-005, FIN-16,
NEW-05, NEW-28, NEW-32 and NEW-35, with supporting NEW-03, NEW-18 and NEW-24.
The first oracle below deliberately establishes a starting point, not a smaller
definition of campaign completion.

## First implementation slice

Extend the existing signed HTTP/real-DB transaction fixture at
server/modules/transactions/__tests__/transactions.realdb.integration.test.ts.
Write a table-driven expense create -> edit -> delete oracle before repairing
production code. Use literal expectations and independent SQL reads, never the
production balance helper to compute expected values:

| Account class | Opening | Expense 45.50 | Edit expense to 60.00 | Delete |
| --- | --- | --- | --- | --- |
| Asset | 1000.00 | 954.50 | 940.00 | 1000.00 |
| Liability, positive debt | 500.00 | 545.50 | 560.00 | 500.00 |

Assert persisted denomination, transaction amount, account balance and deletion
state after each action. Preserve existing auth, visibility and HTTP boundaries.
This is the first bounded behavioral RED oracle, not the whole R08.1 suite.

**Do not preserve an obsolete test expectation as the financial oracle.** The
current real-DB test at transactions.realdb.integration.test.ts:456 expects credit
spending to produce -30.00. TransferService.concurrency.test.ts:165 expects a
credit-funded transfer to produce -100.00. These assert the old convention and
must be corrected against the approved positive-debt contract with meaningful
before/after evidence. A green old suite cannot establish the new convention.

R04 is the completion dependency. Before dispatching implementation, admit the
required R04 boundary evidence and re-pin the current integrated source. The
Shared-owner repair alone does not complete R04. Keep the four existing review
candidates ahead of a new source lane, and retain C2/R09 ownership boundaries.

## Existing core and gaps to preserve in the test design

The Sol Extra High explorer traced actual controllers, service delegates and
repository methods. These are source observations, not runtime reproductions.

| Area | Existing path / useful boundary | Missing contract or test obligation |
| --- | --- | --- |
| Manual posting | transaction/create.ts -> TransactionRepository.create -> createWithTx | TransactionRepository.ts:105 calculates expense as negative without account economic class; create/edit/delete share it |
| Denomination | create.ts:58 validates an unlocked visible account; repository locks later at TransactionRepository.ts:287 | Derive and validate denomination from the locked account; prevent stale pre-lock currency from being inserted unchanged |
| Manual create/delete | Parent, supplied splits, balance and supplied audit already share a transaction | Preserve this behavior; add outbox and other dependent effects to the verified atomic boundary rather than rebuilding it blindly |
| Manual edit | TransactionRepository.update already locks and has an optional timestamp check | service.ts:290 audits after repository commit; parent amount edits do not replace/revalidate splits; direct repository moves need the same contract |
| Splits | create.ts:97 validates the initial total | TransactionRepository.ts:461 update does not reconcile children; addSplits at697 replaces children without a parent lock/total check |
| Explicit goal links | shared/schema.ts:1890 stores a separate contribution amount | No atomic link reconciliation in inspected edit/soft-delete paths; FK hard-delete cascading does not establish soft-delete reversal |
| Transfers | TransactionTransferRepository creates both legs and balances atomically; TransferService updates both in a transaction | Source subtraction/destination addition at TransactionTransferRepository.ts:220 assumes assets; repayment must reduce positive debt |
| Entity locks | Account locks are ordered at TransactionRepository.ts:138; transfer update orders pair rows at TransferService.ts:289 | Pair deletion at TransactionTransferRepository.ts:287 omits pair-row ordering; deadlock behavior remains untested |
| Retry/version | Manual and transfer create have existing idempotency paths | Manual create.ts:45 replays a key without comparing economic payload; transfer update uses pre-lock defaults and has no version guard; disjoint-account key races and soft-deleted replay need controls |
| Audit/outbox | CREATE/DELETE repository audit support exists; outbox.ts:87 supports publish(event, tx) | Manual update and transfer create/update audits are outside financial commit; manual events publish afterward; transfer delete returns before ordinary delete publication |
| Goal synchronization | Repository post-commit sync already updates account-tracking goals | assignment.sync.ts:28 writes separately, activity uses tx undefined, and debt sync at150 masks signs with abs(); failure currently cannot roll back the financial write |

Shorthand locations: create.ts, service.ts and delete.ts are under
server/services/transaction/; the two Transaction repositories are under
server/repositories/; TransferService.ts is under server/services/;
assignment.sync.ts is under server/services/goal/; outbox.ts is under
server/core/events/. Re-resolve lines after integrations; pin source, not lines.

## Existing producers that must use the same posting contract

The coordinator traced the other writer entrypoints. This inventory identifies
the inspected boundaries and does not claim a complete financial-writer census.

| Caller | Current source evidence | Required R08 caller regression / boundary |
| --- | --- | --- |
| Global CSV | server/services/ImportService.ts:198 uses createWithinTransaction inside the batch transaction, with audit context but no currency field | Persist locked-account denomination; preserve existing batch rollback/audit; overwrite reversal at321 uses the same account-class-blind delta helper |
| Account CSV | server/services/account/AccountImportService.ts:150 invokes transactionService per row;201-209 separately adds totalAmount to account balance when adjustBalance is set | One posting effect per accepted row; explicit tests for both adjustBalance modes; retain raw input/date work owned by R09 |
| Recurring processing | server/services/recurring/RecurringProcessingService.ts:187 calls createWithinTransaction with occurrence identity and audit, omitting currency | Keep existing occurrence serialization/replay while adding denomination, liability and dependent-effect proof |
| Create transaction plus recurring rule | server/services/recurring/RecurringCreationService.ts:252 calls createWithinTransaction without audit options | One atomic ledger/rule/link operation with the required audit/outbox; do not infer coverage from scheduled materialization tests |
| Receipt conversion | server/services/receipt/transaction.service.ts:212 posts and marks receipt within a transaction, omitting currency and audit options | Denomination, one conversion/replay and failure rollback; C2 owns pending tag-writer fixes in this file, so integrate/coordinate before editing |
| Rule split action | server/services/rule/actions.ts:148-207 assigns last remainder and drops nonpositive children; rule/service.ts:48 already wraps rule application | Reject invalid allocations rather than hiding invalid remainder; test parent edits and total preservation; retain existing whole-rule rollback |
| Investment transaction | server/modules/investments/investments.service.ts:481-548 writes investmentTransactions in its own transaction using request currency; SELL holding lock is present | Define and verify cash-posting linkage and denomination under R08/R13; preserve existing no-oversell behavior, do not treat an investment row as cash settlement proof |
| GRZ coupon payment | server/routes/grz-securities.ts:480 posts through transactionService before the separate payment-status transaction at503 | Single atomic claim/post/status/audit result; payment status lock alone does not encompass the earlier ledger commit |
| T-bill maturity | server/services/investment/processTBillMaturities.ts:103 inserts investment maturity;124 posts only positive net interest through the ordinary repository | Test the approved principal/cash/holding/income distinction with R13; interest-only posting is not proof of full maturity cash settlement |

## Ordered acceptance work after the first oracle

1. Complete R08.1 with income, liability repayment and paired transfers; split
   100=60+40, invalid allocations, parent replacement edits, exact reversal and
   concurrent writers. Read persisted rows independently. Golden fixture A's
   cash-only steps must retain A1074.50, then A974.50/B100; the card purchase gives
   debt545.50 and combined expense171.00. The full fixture includes FX/report
   obligations; a cash-only subset does not close it.
2. R08.2 uses the existing posting seam to implement account-class-aware effects,
   locked denomination, deterministic entity/account locking, and atomic parent,
   split, goal-link, balance, audit and outbox changes. Retain existing correct
   create/delete/transfer transaction boundaries. Exercise every producer above.
3. Inject a late audit/outbox/dependent-write failure and prove no partial commit.
   Replay the same identity after a lost response: one effect and one action
   audit. Same identity with changed economic input must conflict, not silently
   return an unrelated previous result. Race edit/delete and opposite transfers.
4. R08.3 freezes posted account denomination/economic class/opening balance;
   preserves original history; implements the specified previewed reconciliation
   path; and verifies after-commit cache revision/invalidation. C2's summary
   freshness repair is a dependency to preserve, not full FIN-17 closure.
5. Keep R12 FX/report and R13 investment/GRZ acceptance explicit. Never backfill
   ambiguous null currencies or recompute legacy balances by guessing. Require
   reviewed provenance, empty/populated migration evidence and independent review
   before acceptance of any resulting data/schema changes.

## Reuse these tests; inspect their oracles first

- server/modules/transactions/__tests__/transactions.realdb.integration.test.ts:
  real HTTP and account fixtures, including the obsolete liability expectation.
- server/services/transaction/__tests__/p6a-create-delete-audit.realdb.integration.test.ts:
  direct-service and HTTP one-audit assertions.
- server/services/transaction/__tests__/p8b-update-audit.realdb.integration.test.ts:
  direct-service and HTTP UPDATE audit presence; extend with insertion failure
  and rollback, because presence alone cannot prove atomicity.
- server/services/__tests__/TransferService.concurrency.test.ts and
  TransactionDeletion.concurrency.test.ts: transfer retries and financial races;
  revise only expectations contradicted by the settled financial contract.
- server/core/events/__tests__/outbox.transactional.db.integration.test.ts:
  transactional event commit/rollback patterns.
- server/routes/__tests__/import.execute.realdb.integration.test.ts and
  server/services/recurring/__tests__/processRecurring.materialization.realdb.integration.test.ts:
  existing caller fixtures for import balance pipeline and recurring replay.
- server/services/rule/__tests__/applyRulesAtomic.test.ts and
  server/modules/investments/__tests__/investments.sell-overdraft.realdb.integration.test.ts:
  preserve whole-rule rollback and concurrent SELL protection.

transactionAtomicity.property.test.ts mocks the transaction mechanism and cannot
replace persisted failure/rollback evidence. No test results are claimed here.

## Dispatch and resumption boundary

The first author owns the bounded manual/repository oracle slice and agreed
posting seam after a review slot opens. The coordinator retains canonical
integration, shared schema/migration allocation and serialized runtime windows.
No worker may independently repair C2-owned or R09-owned files. An implementer
and a distinct reviewer must agree on affected-caller coverage before changes
expand to all producers. Keep each unfinished candidate locally committed.

Independent Astra review remains unavailable at this checkpoint, and the prior
owned-database startup command was rejected by automatic approval review. This
preparation neither retries that command nor substitutes unit mocks for real-DB
acceptance. A restored runtime window must use the existing protected target
wrapper, fresh marked disposable database and pinned Node. No production/shared
database, real external delivery, provider spending, push, PR or release action
is authorized by this document.
