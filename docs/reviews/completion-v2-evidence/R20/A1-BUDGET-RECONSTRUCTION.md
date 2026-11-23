# A1 budget scenarios: portable source reconstruction

Status: synthetic input contract only, 15 October 2026. No budget endpoint,
database, report or scheduler was executed. The master specification governs
expected behavior; historical responses are evidence of the old implementation.
This document completes the budget input slice of A1, not its goal/recurring
scenarios or a portable fixture implementation.

## Sources and reset boundaries

Read-only sources: preserved
[domain-budgets-goals-recurring.md](../../2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md)
sections 1.1–1.3, and primary-checkout historical
`.local/readiness-fable-2026-10-13/scratch-budgets-goals-recurring/b1.mjs`,
`b2.mjs`, `b3.mjs`. No historical script, cookie jar, password, stored identity,
connection configuration or final mutated state was executed or reused.

The first script's exact Groceries name lookup failed to match the seeded
category; the second selected Groceries (Home Food) explicitly and repeated
postings against existing state. b1 uses October13 for its 230.25 posting;
b2 uses October14. The narrative's Dining200 includes an earlier split plus
b2's split. A fresh fixture must not merge these attempts. The clean budget
baseline below takes b2's seven enumerated expense parents once, including
exactly one300.00 split parent and its two allocations. Dining is100.00.

Each scenario starts from independently rebuilt, fresh synthetic identities.
Never run base → overspend → FX → refund → recalculation as a single acceptance
fixture and then compare later values with an earlier baseline.

## Fresh identity and opening data

Create one verified owner and one household, base currency ZMW. Use UTC server
and Africa/Lusaka actor/household. Generate fresh logical-reference IDs through
the protected fixture boundary; verify account/category/household ownership.
Do not depend on a fixed total count or ambiguous regex lookup of seeded categories.

| Logical account | Type | Currency | Opening |
|---|---|---|---:|
| CHECKING | checking | ZMW | 10000.00 |
| SAVINGS | savings | ZMW | 5000.00 |
| USD | checking | USD | 1000.00 |

All accounts are shared and owner-created in this budget-only baseline. Privacy
variants require independent actors and explicit account/transaction facts.
Categories: Groceries (Home Food) and Restaurants & Dining Out in an expense
group. Budgets: Groceries1000.00ZMW and Dining500.00ZMW. Groceries' per-budget
rollover flag is true as in the source, but baseline household rollover is
explicitly disabled; the separate rollover scenario enables it deliberately.
These are synthetic inputs, not approved production policy defaults.

## Scenario B1: ordinary monthly spend and split boundary

Pin as-of to2026-11-02 for this fresh scenario, so every listed posting is in
the past. This is a new explicit test convention, not a recovered historical
clock. Set/read back posted status and non-pending state. A month selector
chooses September, October or November; the host's current date is irrelevant.

| Key | Date | Checking expense | Category/allocation |
|---|---|---:|---|
| SEP_FIRST | 2026-09-01 | 150.00 | Groceries |
| SEP_LAST | 2026-09-30 | 400.00 | Groceries |
| OCT_FIRST | 2026-10-01 | 120.50 | Groceries |
| OCT_MIDDLE | 2026-10-14 | 230.25 | Groceries |
| OCT_LAST | 2026-10-31 | 99.99 | Groceries |
| NOV_FIRST | 2026-11-01 | 77.77 | Groceries |
| SPLIT | 2026-10-10 | 300.00 | Groceries200.00 + Dining100.00 |

Independent integer-cent reconstruction:

| Observation | Expected |
|---|---:|
| September Groceries spent / remaining | 550.00 / 450.00 |
| October Groceries spent / remaining | 650.74 / 349.26 |
| October Groceries percent used, two decimals | 65.07% |
| October Dining spent / remaining | 100.00 / 400.00 |
| November Groceries spent / remaining | 77.77 / 922.23 |
| All seven parent expenses | 1378.51ZMW |
| Checking closing balance | 8621.49ZMW |

Savings remains5000.00ZMW and USD remains1000.00USD. Do not invent an FX rate
or aggregate them into one net-worth currency. SQL must show seven parents,
exactly two split rows on SPLIT, and no duplicate earlier attempt. A split
parent counts once in account effects; its allocations replace the parent
category for budget spend. Pending/planned variants must separately prove
exclusion from actual spend without changing this baseline.

## Independent scenario variants

- **B2 overspend:** B1 plus one posted Checking Groceries expense500.00 dated
  2026-10-20. October Groceries1150.74, remaining-150.74, percent115.07;
  Checking8121.49. The source comment says pending, but its payload has no
  pending field. Do not adopt that comment as proof of pending behavior.
- **B3 missing FX:** B1 plus USD50.00 Groceries dated2026-10-05, and no applicable
  rate. The report must expose missing conversion and must never add50.00ZMW.
  A successful-rate variant needs a separately explicit dated synthetic rate
  and independently computed expected amount; none is recovered from these files.
- **B4 historical suggestion:** reset to the two September expenses only;
  pin as-of2026-10-01 and include elapsed July/August/September. July0 + August0
  + September550.00 divided by3 gives183.33 at two decimals. Preview preserves
  manual Dining500.00 and creates no zero-history budgets. Applying an accepted
  preview needs its own version/conflict and atomic audit controls. Exclude
  future months; never treat the observed historical sum550 as the average.
- **B5 rollover:** reset to September spend550.00 and Groceries budget1000.00;
  explicitly enable synthetic household rollover100% plus the per-budget flag.
  At the October boundary carry450.00 once, with durable period identity and
  replay/concurrency checks. Do not reuse periods created by budget-move probes.
- **B6 moves:** reset unmodified October period amounts1000.00/500.00. Move100.00
  Groceries→Dining for October only:900.00/600.00, November unchanged. Three
  concurrent10.00 reverse moves yield930.00/570.00. Over-budget and self-move
  denials must leave periods/audit unchanged; version expectations depend on
  the explicitly declared initial persisted version, not historical row numbers.

The historical25.00 income named Grocery refund has no explicit link to its
original expense. It cannot define the master's refund/reversal contract.
Rebuild a separate typed/source-linked refund scenario when the posting contract
exists; do not silently relabel this income or use it as accepted net-spend proof.

Goals and recurring share the historical scratch household but require their own
reset inputs and clocks. Their later mutated cash, million-unit contribution,
assignment and scheduler states are deliberately excluded from these budget
oracles. Full A1, R10/R12/R14 and J08 acceptance remain OPEN.

Separate reviewer accepted documentation `050cfda` after checking the historical
source literals, phase boundaries and independent integer-cent arithmetic.

## Pure input builder

`server/testing/fixtures/budgets-a1.ts` implements fresh typed input plans for
base, overspend, missing-FX, average and rollover scenarios. Cleared/non-pending
is the current schema representation of posted input; no nonexistent posted
enum value is sent. It includes no credentials, runtime targets, generated IDs,
DB writer or expected-result fields. Move/refund, goal and recurring builders
remain open. Four independent BigInt tests check monthly allocation, account
effects, missing-rate refusal in the independent oracle, elapsed zero months,
isolated policy/clock values and nested-copy independence. These checks validate
input consistency, not application spend/rollover execution. Separate reviewer
accepted code `71f8d5bf5a91bdcc9485e52f530c829c1bb05e0e`; focused protected tests
passed4/4 in703ms and fresh `npm run check` passed, exit0. Logs:
`.local/r20-golden/a1-inputs.log` and `a1-static.log`. The full server candidate
`3a1cf5c` preceded this pure fixture addition; its count is not relabeled as a
full-suite run of this later source.
