# A4 portable reports fixture reconstruction

Status: reconstructed synthetic data contract, not a runtime pass. Read-only reconstruction on 15 October 2026 recovered the full arithmetic behind the master's historical A4 totals. No historical script was executed and no cookie, password, session state or private connection configuration was copied. The eventual versioned fixture must create fresh identities through the protected target harness.

## Source provenance and boundaries

Sources inspected in the preserved primary checkout: `.local/readiness-fable-2026-10-13/scratch-reports-consistency/{seed,fixture,expected,post,transfer,fx}.mjs` and `sec3.md`/`sec4.md`. These are historical leads, not current production proof. This document contains the complete financial inputs so acceptance need not depend on those ignored files.

The historical expected script subtracts card purchases from the stored positive card balance while separately calculating the true owed amount. Do not carry that wrong stored-sign calculation into the new oracle. The report notes also describe later cache-probe mutations and another agent's global FX insertion. Exclude those mutations; create the explicit synthetic rate series below through the authorized fixture boundary without a cross-household writer.

Use a fresh verified owner, household with base currency ZMW, actor/household timezone Africa/Lusaka, UTC server, and a fixed valuation date of 2026-10-14 through an explicit test clock/as-of seam, never today's host date. Private account ownership belongs to that owner. Additional actors and privacy assertions require separate explicit fixtures.

## Complete opening data

| Key | Type | Currency | Opening amount | Privacy |
|---|---|---|---:|---|
| CHK | checking | ZMW | 10000.00 | shared |
| SAV | savings | ZMW | 2000.00 | shared |
| USD | checking | USD | 100.00 | shared |
| CC | credit | ZMW | 500.00 owed | shared |
| PRIV | checking | ZMW | 300.00 | owner-private |

Categories: Salary in an income group; Groceries, Dining, Utilities, Transport and Entertainment in an expense group. Merchants: Shoprite, Zesco and Pizza Inn. Names are synthetic labels, not identities. Fresh generated IDs replace every historical reference.

| ID | Date | Type | Account | Amount | Category or split | Merchant |
|---|---|---|---|---:|---|---|
| T1 | 2026-09-01 | income | CHK | 15000.00 ZMW | Salary | none |
| T2 | 2026-09-05 | expense | CHK | 1234.56 ZMW | Groceries | Shoprite |
| T3 | 2026-09-12 | expense | CHK | 33.33 ZMW | Utilities | Zesco |
| T4 | 2026-09-20 | expense | CHK | 0.01 ZMW | Dining | Pizza Inn |
| T5 | 2026-09-30 | expense | CHK | 250.75 ZMW | Transport | none |
| T6 | 2026-09-15 | expense | CC | 45.50 ZMW | Dining | Pizza Inn |
| T7 | 2026-10-01 | income | CHK | 15000.00 ZMW | Salary | none |
| T8 | 2026-10-01 | expense | CHK | 99.99 ZMW | Groceries | Shoprite |
| T9 | 2026-10-07 | expense | CHK | 200.00 ZMW | Groceries 120.00 + Entertainment 80.00 | none |
| T10 | 2026-10-10 | transfer | CHK -> SAV | 1000.00 ZMW | none | none |
| T11 | 2026-10-11 | expense | USD | 25.00 USD | Entertainment | none |
| T12 | 2026-10-14 | expense | CHK | 333.33 ZMW | Utilities | Zesco |
| T13 | 2026-10-09 | expense | PRIV | 12.34 ZMW | Dining | none |

This is 12 ordinary transaction parents, one transfer operation represented by two paired transaction legs, and two split allocation rows: 14 transaction rows before any later mutation. The historical prose's loose row count must not override the enumerated input. The later 7.77 cache probe is explicitly excluded.

| Synthetic USD -> ZMW rate date | Rate |
|---|---:|
| 2026-10-01 | 25.1234 |
| 2026-10-12 | 26.5432 |
| 2026-10-13 | 26.5000 |

The October 11 expense uses the October 1 rate; valuation on October 14 uses the October 13 rate. Rates are fixture facts, not live market assertions.

## Independent arithmetic oracle

All expectations below follow the literal inputs; do not derive them from production Money/query/report helpers. Use exact decimal or integer-scaled arithmetic, with half-up monetary rounding at the declared boundary.

| Value | Independent result |
|---|---:|
| CHK: 10000 + 30000 - 1234.56 - 33.33 - 0.01 - 250.75 - 99.99 - 200 - 333.33 - 1000 | 36848.03 ZMW |
| SAV: 2000 + 1000 | 3000.00 ZMW |
| PRIV: 300 - 12.34 | 287.66 ZMW |
| USD: 100 - 25 | 75.00 USD |
| Card debt: 500 + 45.50 | 545.50 ZMW |
| USD valuation: 75 x 26.50 | 1987.50 ZMW |
| Total assets: 36848.03 + 3000 + 287.66 + 1987.50 | 42123.19 ZMW |
| Net worth: 42123.19 - 545.50 | 41577.69 ZMW |
| September expenses: 1234.56 + 33.33 + 0.01 + 250.75 + 45.50 | 1564.15 ZMW |
| October USD expense: 25 x 25.1234 = 628.085, half-up | 628.09 ZMW |
| October expenses: 99.99 + 200 + 333.33 + 12.34 + 628.09 | 1273.75 ZMW |
| Both months' expenses | 2837.90 ZMW |
| October Groceries: 99.99 + 120 | 219.99 ZMW |
| October Entertainment: 80 + 628.09 | 708.09 ZMW |
| October income minus rounded expenses: 15000 - 1273.75 | 13726.25 ZMW |

Using the latest rate for the October 11 expense produces 1308.16 instead of 1273.75. Treat this as a negative control for the rate-date boundary, not a second acceptable report total. Using a declining positive card debt produces the wrong 41668.69 net worth; the correct oracle remains 41577.69.

## Remaining implementation and acceptance

Versioned pure input builder `server/testing/fixtures/reports-a4.ts` is now committed at `85e9c0c`. It returns a fresh typed logical plan with all inputs above, without allocating database IDs, credentials, targets or monetary rows. Independent integer-scaled tests in `server/testing/__tests__/reports-a4.test.ts` verify logical ownership/category/merchant links, 14 eventual transaction rows, two allocations, deep scenario isolation, account balances, positive card debt, dated half-up FX and month/category totals. Four tests and `npm run check` passed; separate reviewer accepted source and arithmetic. The initial missing-module test failure was scaffolding, not a reproduced application defect. This is portable input consistency only, not provisioned or persisted report evidence.

Next implement protected fresh provisioning and independent persisted/API/report/export assertions. Verify exact IDs, household/account ownership, currencies, dates, paired transfer identity, split categories and parent exclusion. Monetary totals alone cannot prove those links. Replay must preserve row counts/effects, and a separate reset scenario must demonstrate edits/deletions and cache invalidation.

The reconstruction resolves the previously missing full A4 arithmetic but does not establish that current application readers or writers satisfy it. Separate reviewer `r00_final_review` independently checked the transaction/allocation counts, integer-scaled arithmetic, historical master/companion totals and both negative controls, with no arithmetic finding. The reviewer did not reopen ignored scripts or private state. R08/R11/R12 dependencies and eventual implementation review still apply. Other fixture reconstruction remains unfinished; [FIXTURE-REGISTER.md](FIXTURE-REGISTER.md) separately resolves the A2/A6 taxonomy from preserved evidence. No canonical group closes here.
