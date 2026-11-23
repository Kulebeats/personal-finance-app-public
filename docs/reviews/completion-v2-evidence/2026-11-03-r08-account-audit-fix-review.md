# R08 account-audit candidate independent review

Reviewed by independent Astra against exact base `f5223ed563f5cf583adeede77a4c5602fac56968`; candidate `d0a6bf241c2b937bed3fccbab2f41c08b603ac76` in `C:/Users/USER/.codex/worktrees/capital-r08-account-audit-fix-nov03`. Root verified that candidate HEAD and clean tracked state. This is source review only; no candidate runtime acceptance.

## Required correction — MEDIUM

`server/repositories/AccountTransactionExport.ts:42` uses `inArray` over every exported transaction ID to lock source rows. That emits one bind parameter per ID, but export size is unbounded. Exports above65,535 rows can now exceed PostgreSQL's parameter limit. Replace this with one bound UUID array and ANY, preserving sorted locks, repeatable-read transaction scope and mandatory audit. A regression can assert parameter cardinality for more than65,535 input IDs without populating that many database rows. [PostgreSQL18 limits](https://www.postgresql.org/docs/18/limits.html).

No CRITICAL/HIGH source finding was identified. The reviewer cleared bounded diagnostics, not final compatibility acceptance. The account CREATE/audit transaction, removal of controller duplicate audit, final locked membership/assignment checks, sanitized req.ip, export publication/audit coupling and actor-only private audit audience were otherwise consistent with the reviewed scope. The three privacy expectation changes strengthen R04 rather than weakening cardinality/failure assertions.

## Root-owned validation queue

Preserve original24 baseline cases and two new IP cases. Run the full26-case account-audit contract file together with existing account export-readback, shared-owner real-DB and account integration regressions; run accountService and shared-owner unit callers and the exact project check. Root owns the serialized protected target window. The original39r failure,39s project pass and39t validRED remain unchanged.

The separate R08 chat retains implementation ownership. The owner subsequently directly authorized sending this review and requesting the fix. The chat tool accepted delivery to R08 chat01a19964-735a-79a3-933d-0c15a738616d. No implementation response or acceptance is inferred from delivery. No source change, canonical integration, push, PR, main merge, shared/production database or release action occurred.

