# R12 portfolio custody privacy — test-only candidate, unverified

Fixture repair prepared from test-only `f3503f3392660dbf45161dfef88c7d72aad413ce`
(application base canonical `bb0c0b98dfa60256f94c555b88cf83c4d9924472`) in
`C:/Users/USER/.codex/worktrees/capital-r12-portfolio-custody-fixture-nov03/personal-finance-app`,
branch `codex/r12-portfolio-custody-fixture-nov03`.
The original `capital-r12-portfolio-custody-canonical-nov03/personal-finance-app`
test pin and its failed `astra-portfolio-custody-red39g` packet are preserved.
The pre-existing `capital-r12-portfolio-custody-nov03/personal-finance-app`
tree at `242a35d1` was preserved unchanged. No dependency installation,
test, database connection, browser, build or typecheck was run for this pin.

Read the canonical master lines117–118/132–136, then
`server/routes/__tests__/completion-r12.portfolio-custody-privacy.realdb.integration.test.ts`.
The settled rule permits shared accounts and the current actor's own private
accounts. Household owner/admin status cannot reveal a peer's private custody.
This pin makes no product, schema, acquisition-basis or mandate policy change.

## Independent native-ZMW oracle

All three positions are established through the signed opening POST with their
actual authorized actor. Each uses a separate security quoted at ZMW10.
The signed GETs use the real initialized database-backed FX service and actual
valuation. There are no monetary-result or exchange-rate stubs.

| Custody | Native value | Native original cost | Type |
|---|---:|---:|---|
| Shared, opened by member |100 |80 |stock |
| Member-owned private |60 |45 |etf |
| Owner-owned private |40 |30 |bond |

| Reader | Value | Cost | Gain | Gain percent | Count | Exact type amounts |
|---|---:|---:|---:|---:|---:|---|
| Member |160 |125 |35 |28 |2 |stock100, etf60 |
| Owner |140 |110 |30 |27.27272727 approximately |2 |stock100, bond40 |
| Admin, view-only, professional |100 |80 |20 |25 |1 |stock100 |

Each list checks the exact visible row count and IDs, values, cost, gain,
currency and security type. Both portfolio aliases check the independent
totals, exact type keys/values, count and alternatives0. All readers exclude
invisible holding/account/security IDs and markers.

## Frozen test inventory and expected RED

There are **23 cases**, split explicitly into:

- **5 independent positive controls:** `/holdings` for each of the five roles.
- **10 summary regressions:** five roles through `/portfolio` and
  `/portfolio/summary` separately.
- **8 late-withdrawal regressions:** both summary routes with custody,
  membership, selected actual SID and global credential-generation withdrawal.

Late probes wrap the existing awaited `getLatestFxRates`, await its genuine
result and commit the authoritative change before returning that result. They
witness the persisted custody/membership change or actual SID/generation
revocation. Expected status follows the existing holdings boundary:409 for
changed custody,403 for withdrawn membership and401 for revoked credentials.
No new422 or private-underlying-acquisition policy is asserted.

Expected source gap: portfolio controller currently drops the actor and calls
household-only valuation methods. The ten summary and eight late probes are
expected RED; the five list controls are expected to retain existing behavior.
These are predictions, not observed run results or acceptance evidence.

Every GET compares persisted holdings, investment activity, lots/disposals,
cash, accounts/balance snapshots, securities, opening/deletion receipts,
business/security audits and household outbox rows. Late custody probes allow
only their exact deliberate account privacy change. Session expiry touches are
outside the financial snapshot. Setup witnesses all three actual opening
activities, lots and receipts and six corresponding business audits.

Cleanup is limited to this file's UUID household, actors, accounts and securities.
Both receipt families remain immutable during each case. Cleanup removes scoped
business audits and owned outbox rows, then deletes the actual fixture household.
Its accepted ON DELETE CASCADE removes receipts and financial descendants;
owned securities are removed only after their holdings have gone. Before the
next opening, the household and all memberships are recreated. Users/cookies
remain intact except actual revocations, which use a real replacement login.
Actor-scoped business/security audits are deleted before final user deletion
can erase their user ownership. Changed cookies are registered before revocation
and only the affected member's sessions/devices are removed and signed in again.

## Preserved failed fixture run and repair

Root's `39g` run at exact original `f3503f33` reported23 failed/0 passed. Raw
`server.log`/`vitest.json` show the first owner list reached HTTP200, then its
afterEach failed at the direct opening-receipt DELETE with SQL23514. Every later
beforeEach and final cleanup encountered the same immutable evidence guard.
This is a fixture failure, not18 demonstrated product failures or5 passed
controls. The failed target and its residue remain untouched.

Migrations0026 and0027 expressly allow receipt deletion during actual parent
household deletion. The repair follows the existing
`completion-r13.opening-erasure.realdb.integration.test.ts` lifecycle precedent,
removing both direct receipt DELETEs and the unnecessary descendant purges.
All23 test assertions and their source/credential withdrawal controls are
unchanged. No trigger bypass, trigger/schema change, erased-user flag or manual
old-target purge is used. This repair requires independent review and a fresh
protected target/run; it has not been executed.

## Next action and boundaries

Root owns independent oracle/source review and the serialized protected RED
window. Run the complete new file on the marked disposable target, retaining
failure output and postflight counters. Review genuine failures before any
production edit. This preparation has only a static `git diff --check` result.

The later repair must retain existing selector aliases/defaults and callers,
holdings privacy, AccountSummaryRead and snapshot semantics. A stale one-off
account-ID list is insufficient for late custody/authority withdrawal. No
shared or production database, provider, external message, push, PR, main merge,
deployment or release action is authorized by this pin. R12 and the campaign
remain OPEN.
