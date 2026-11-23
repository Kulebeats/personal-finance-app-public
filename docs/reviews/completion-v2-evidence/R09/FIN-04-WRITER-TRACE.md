# FIN-04 account import writer trace — 29 October 2026

Status: source diagnosis, protected read-only SQL reproduction, and next-test
contract; no financial repair. Canonical HEAD:
`e161afebf87856cd240ce050f1c3732ab0cc2a2b`.
The existing R20 dirty files were preserved. The separate R09 chat's latest
turn is terminal (network permission revoked); no other implementation agent
was active when this investigation started.

## Evidence and limits

The preceding protected HTTP/DB run remains **24 passed / 11 failed**. Every
valid account import returned `imported: 0`, `skipped: 1`; its logged exception
omits the underlying message/code. Those results and their candidate/target
identity are in `CSV-DATE-HANDOFF.md`. They are not a new run on canonical.

The current source establishes an incompatible key on the first writer query:

1. `server/services/account/AccountImportService.ts:125` constructs
   `csv_import:${accountId}:${row.date}:${row.merchant}:${row.amount}`.
2. It passes the string unchanged as the fourth argument to
   `transactionService.createTransaction`. The facade in
   `server/services/transaction/service.ts:135` forwards it unchanged.
3. `server/services/transaction/create.ts:46` performs the idempotency lookup
   before account validation, merchant resolution, or transaction insertion.
4. `server/repositories/TransactionRepository.ts:264` compares that parameter
   directly with `transactions.idempotencyKey`.
5. `shared/schema.ts:1315` defines that column as UUID; the baseline migration
   `migrations/0000_youthful_speed.sql:981` agrees.

After restarting only the owned disposable cluster and revalidating the exact
manifest and persisted marker, a read-only diagnostic verified the actual
column type is UUID. A prepared query with the same key/household predicates
and a synthetic `csv_import:...` parameter then failed with **SQLSTATE 22P02,
invalid input syntax for type uuid**. The expected psql exit was 3. This
reproduces the database rejection for the source-identified predicate; it does
not recover the swallowed exception from the earlier HTTP run or execute the
entire repository/service path. Raw SQL, output and exit are preserved in the
R09 author checkout at `.local/r09-csv-date/review-uuid-diagnostic.*`; log SHA-256
`295bc9da07fee214a8fdc1c5e923031334280d19c1f31f50775de9b7417c03d6`.

## Why a key-only patch is insufficient

The master R09 contract and companion R09 require one coherent import engine
after the R08 ledger contract. The current path has further visible defects:

| Source behavior | Consequence to exercise after the first blocker is removed |
| --- | --- |
| Key includes date, merchant and amount, without batch/occurrence identity | Two legitimate identical purchases collide; replacing the string with a hash of the same fields preserves the defect. |
| Negative CSV amount becomes `expense` but is forwarded unchanged | `TransactionRepository.calculateBalanceDelta` negates an expense amount, so a negative amount produces a positive asset balance delta. |
| Repository insertion always applies its delta to the account | `adjustBalance: false` does not preserve the account balance in this path. |
| Import service additionally adds its signed total when `adjustBalance` is true | Positive income is applied twice; negative expense may cancel the earlier incorrect positive delta. Neither is the specified once-only result. |
| Per-row exceptions increment the same `skipped` count used for duplicates | HTTP success cannot distinguish writer rejection from a genuine replay. |

These are source findings, not new persistence observations. Liability sign,
refunds, transfers, atomic audit/outbox, import history and shared writer
identity remain R08/R09 obligations; the date-only slice does not settle them.

## Next bounded execution

1. Preserve the original 35-case failure packet and the new isolated UUID
   diagnostic. Do not repeat the unchanged full HTTP failures. A future
   execution must revalidate the target: the owned cluster was smart-stopped
   after the negative tests and diagnostic, with no established connections.
2. Before changing posting behavior, settle the R08/R09 implementation contract
   for batch identity, row occurrence, payload conflict, both balance options
   and asset/liability signs. Do not silently widen the FIN-15 date work.
3. Use independent expected balances: opening 100, expense 10, income 20 gives
   110 with adjustment enabled, exactly once after replay; disabled adjustment
   leaves 100. Include two identical purchases, concurrent replay, negative
   expense export/reimport, changed-payload conflict, transfer intersection,
   and audit failure rollback. Preserve the supported-date cases as mandatory
   persistence assertions, never skip/xfail them to turn the suite green.

Source hashes (SHA-256):

- AccountImportService.ts: `01ef994df92a7434d6b084952f6be758e8b89cea9028af0fe26d80a8f7359094`
- transaction/create.ts: `094ed7ff4aefd3f9a3663886082f9c53b2391f6468e46cda8c9ea625671987bd`
- TransactionRepository.ts: `6a8f22fca98e6990beb2c1d2e70486ff8b6713602ba51a50d7ede6c4625a0149`
- shared/schema.ts: `e0e1a8d5340692301d6fe5f39146c2fa3f5968eeafe652e8d54996704455cbbc`

No canonical register state changed. No application launch, migration,
production/shared DB write, provider call, deployment or release occurred.
