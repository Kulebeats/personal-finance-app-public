# Normal transaction pointer-create reference checkpoint

Prepared from `90a3addec9975394d6ecc0b49d4037bb92f261b6` in
`capital-r04-transaction-create-refs/personal-finance-app`, branch
`codex/r04-transaction-create-refs`. This bounded candidate concerns initial
normal transaction creation with an existing recurring pointer, plus uppercase
account UUID lookup. The separate replay author owns idempotency disclosure.
No R04/R08 closure, production acceptance or source integration is claimed.

## Existing protection and reproduced gap

`server/modules/transactions/transactions.routes.ts` applies `requireRole("member")`
and `validateEntity` for account, category and merchant before the create
controller. `server/middleware/validateEntity.ts` rejects already foreign,
deleted or absent categories and foreign/absent merchants. Six signed negative
body-only controls passed before this repair. The initial service-only trace
missed this middleware; these denials are existing protection, not newly repaired
body-only leaks.

The guard selects `params > query > body`, whereas this POST controller writes
the parsed body. Test-only `0f3fe38e4ce30b102d4be822c63d4e5376049824` adds
two signed cases with a visible query category/merchant masking a foreign body
reference. Their independent baseline run is pending with the coordinator.
The candidate validates the actual posting references; it does not change the
shared guard's behavior on unrelated routes.

The preflight reads are outside the posting transaction. The real competing
category soft-delete and merchant household-change tests showed that initial
creation did not wait on those rows. A separate deterministic case commits a
merchant household change after middleware, immediately before the real merchant
lookup: recognition substitutes another local merchant and learns an alias.
That request returned201 before this repair, where404 with no posting or alias
effect is required.

The account row lock returns PostgreSQL's canonical lowercase UUID. Its Map
lookup used the caller's original spelling, so uppercase account IDs produced500
for both pointer and pointer-free initial creates. Normalize that lookup; do not
reinterpret currency, amount, balance or posting policy.

## Candidate boundary

- `TransactionCreateBoundary.ts` validates the submitted category, resolved
  merchant, original explicit merchant and learned-alias merchant under the
  existing pointer-create posting transaction, before alias insertion. Category
  checks include `deletedAt IS NULL`; merchant checks use the same household.
  Selected rows use SHARE locks; merchant IDs are normalized, deduplicated and
  ordered. Missing or inaccessible references deny the entire operation.
- `create.ts` carries the original explicit merchant in pointer-only repository
  options, so successful fallback recognition cannot discard that reference.
  Both idempotency lookup/return blocks are unchanged.
- `TransactionRepository.ts` passes the actual posting references into this
  boundary and uses lowercase for the locked-account Map lookup. Existing
  posting, audit and account-lock transactions remain in place.

Pointer-free recognition/alias policy is unchanged. Its valid signed create and
one-audit controls remain required. The new reference lock checks apply to the
named recurring-parent path; they do not certify all pointer-free races, split
references, R08 monetary effects or every producer.

## Preserved RED evidence and oracle correction

Test-only `5d8f9f45d16451c77df916856e70350da5d94501` produced five failures and
seven passes. Four failures were the two real concurrency gaps and two uppercase
UUID errors. One was a fixture expectation error: merchant recognition already
treats `reference` as a noise word, so `Reference Local` learns `Local`, not the
unmodified raw name. The product's recognition policy was not changed to satisfy
the test. Original log:
`.local/r04-txn-createrefred03n/server.log`, SHA256
`B194429836A9F46C3DAC0C1264F594F876151BB8E909004F96A410E10DFF328D`.

Test-only `fee0ac2b8204a0fad72d8a189a1b1e1804760496` fixes that literal oracle
and adds the post-middleware merchant-move case. The parent protected run failed
five and passed eight, all failures matching the product gaps above. Log:
`.local/r04-txn-refretry03p/server.log`, SHA256
`2E416621CAB4F8D24AF9E443210E2D2B8C974768C447DDE8AA0A5D3E6CD40EE6`.

The worker ran syntax transpilation and whitespace checks only. Protected GREEN,
broader caller checks and independent source review belong to the coordinator.
No database/browser/native run, external delivery, schema change, merge or push
was performed by this worker. The separate user-owned R08 worktrees were read
only and left untouched.
