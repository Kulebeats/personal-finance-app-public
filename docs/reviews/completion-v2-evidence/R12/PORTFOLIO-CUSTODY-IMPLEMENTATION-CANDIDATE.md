# R12 portfolio custody implementation candidate — unverified

Author tree:
`C:/Users/USER/.codex/worktrees/capital-r12-portfolio-custody-fix-nov03/personal-finance-app`,
branch `codex/r12-portfolio-custody-fix-nov03`.
Application base is canonical `bb0c0b98`; parent fixture pin is
`30c7679315b2eb2979df12103178d3f2b233e7a4`.
Expanded **test-only** pin, committed before production edits:
`939277cec4ad54112e203dc506f96861a89975d2`.

## Evidence and review order

1. Canonical master117–118/132–136: all financial readers receive shared custody
   plus their own private custody; owner/admin cannot override peer privacy.
2. Frozen original `f3503f33` and `39g` preserve the immutable-receipt cleanup
   failure. It is not a valid product RED and its target remains untouched.
3. Corrected fixture `30c76793`, independently reviewed by Astra, then exact
   `39h` in the fixture tree. Author read its raw JSON/logs:5 controls passed,
   18 intended summary/late cases failed, zero skips, all6 primary and9 scope
   postflight counters zero. Root reports independent Astra adjudication.
4. Expanded test-only `939277ce`:41 cases, retaining the original23 assertions.
   Root reports fresh `39i` baseline5 passed/36 failed with clean postflight.
   Author has not run any test, database connection, install, typecheck,
   build or browser action for this implementation candidate.
5. Review the source delta and mocked controller seam below before scheduling
   root's protected GREEN and complete affected caller suites.

## Source change

- `investmentReadAuthority.ts` extracts the accepted holdings membership,
  credential and actual persisted-SID checks. `investmentHoldingRead.ts` keeps
  its existing precondition timing, READ COMMITTED transaction, source query,
  ordering, retry, comparison and error behavior. Only its authority block and
  session type move to the shared helper.
- `investmentPortfolioRead.ts` locks that same current signed authority and
  captures holdings/security, active T-bills and pensions in **one SQL SELECT**.
  Each source positively joins its containing account through
  `visibleAccountPredicate`, and source/parent households must agree. Holdings
  retain their existing hidden-account exclusion; alternative eligibility and
  face-value/balance arithmetic stay as before. Unattributed source rows cannot
  establish the containing-account visibility predicate.
- The capture uses ordered JSONB arrays and explicit `numeric::text` casts,
  retaining exact stored quantities/costs/prices. It includes every input used
  by current valuation plus account privacy/owner bindings. It holds no source
  transaction open across FX conversion or other valuation awaits.
- `ValuationReadContext.source` lets all three existing valuation methods use
  this captured source. Existing calls without it keep their original query,
  transaction, `accountIds` and `currentValueOnly` behavior. AccountSummaryRead
  and snapshotWorker source files remain untouched.
- The wrapper captures current signed authority and source again after all
  returned legs finish, including a caught valuation failure. Changed source
  returns409; withdrawn membership403; revoked credential/SID401, as established
  by the existing holdings boundary. It does not republish a retired error's
  denomination and introduces no new422 or incomplete-valuation policy.
- Portfolio summary and its alias preserve selector normalization, alias,
  default, metadata and response shape. Allocation uses the same boundary for
  its existing holdings-only leg and does not acquire alternative semantics.

## Tests and compatibility

The signed41-case file contains5 existing list controls,10 original summary
privacy cases and8 original late custody/membership/SID/generation cases.
It adds10 alternative-custody cases,6 actual amount changes during the genuine
FX await (holdings, T-bills and pensions through both aliases), and2 witnessed
actual missing-FX failures with late membership withdrawal. Native alternative
rows are synthetic read fixtures, not GRZ or pension writer acceptance.

Finance snapshots now also include the alternative source rows. Owned unposted
T-bill UUIDs are removed before household deletion because their household FK
uses NO ACTION. Both receipt families still use the independently reviewed
household cascade. There is no trigger bypass or schema change.

`investments.integration.test.ts` isolates the new reader boundary only for its
existing mocked controller transport tests. It verifies that actor and the
actual captured credential reach that boundary, and allocation requests only
the holdings leg. The signed database file supplies actual authorization,
source and monetary evidence; the mocked seam does not establish it.

Root should run the complete signed41-case file, existing currency alias/default
suite, holdings privacy/session-touch suites, existing investment database and
mocked callers, affected account summary/capture and snapshot/recap callers,
FX fail-closed tests and full project check. Do not borrow prior passes for
this candidate. Static `git diff --check` is the only author check so far.

## Remaining scope and authority

This candidate addresses containing-account custody for the returned portfolio
legs. It does not settle a visible shared holding's cost basis derived from
private underlying activity, redesign a DTO, change missing/stale FX policy,
or establish portfolio performance/history correctness. Those requirements,
full R12 and the campaign remain OPEN. No shared schema, migration, SIP,
canonical status, shared/production DB, external provider, push, PR, main merge,
deployment or release change is part of this candidate.
