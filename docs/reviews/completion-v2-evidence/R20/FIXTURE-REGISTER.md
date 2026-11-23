# Historical A1–A6 fixture register

Status: read-only source reconciliation, 15 October 2026. This resolves fixture names, not runtime acceptance. The historical evidence files already preserved in the checkout establish the mappings below. Rebuild with fresh synthetic identities; never reuse their jars, passwords, database names, scripts that load credentials, or final mutated audit state.

Separate reviewer `r00_final_review` checked the source headers, linked evidence, phase boundaries and literal A1/A2/A6 arithmetic without running historical scripts or accessing private state. No arithmetic, provenance or scope finding remained. This is documentation acceptance only.

| Name | Historical scope | Preserved source | Reconstruction state |
|---|---|---|---|
| A1 | Budgets, goals, recurring | [A1-BUDGET-RECONSTRUCTION.md](A1-BUDGET-RECONSTRUCTION.md), based on [domain-budgets-goals-recurring.md](../../2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | Budget reconstruction `050cfda` and five pure scenario plans `71f8d5b` accepted; four arithmetic tests/static pass. Move/refund/goal/recurring builders, protected provisioning and runtime remain open |
| A2 | Imports, receipts and organization | [domain-import-receipts-organization.md](../../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | Mapping recovered from the source header; import expectations need the current master contract, not historical dedupe assumptions |
| A3 | Investments and GRZ | [domain-investments-grz.md](../../2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | Source distinguishes earlier A3 and later F2 fixtures; do not combine their holdings or cash |
| A4 | Reports consistency | [A4-RECONSTRUCTION.md](A4-RECONSTRUCTION.md) | Complete typed pure input plan `85e9c0c` and four independent arithmetic tests accepted; protected provisioning and runtime/report assertions remain required |
| A5 | Identity, roles, household privacy | [A5-RECONSTRUCTION.md](A5-RECONSTRUCTION.md), based on [domain-security-privacy.md](../../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | Source-backed dates/accounts/link setup and independent amounts accepted at `538bc47`; fresh provisioning, full recurrence scheduling fields and current privacy runtime assertions remain open |
| A6 | Settings, notifications, recap and AI; separate deletion actor | [domain-settings-notifications-ai.md](../../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | Mapping recovered from the source header; deletion must use a separate fresh identity/household |

The A2/A6 mapping was absent from the abbreviated completion fixture table, but it is present in the preserved domain evidence. Their taxonomy no longer requires an external answer. Complete portable input contracts and implementation remain unfinished.

## A1 phase boundary

Read-only inspection of historical `scratch-budgets-goals-recurring/b1.mjs`, `b2.mjs` and `b3.mjs` shows retries and subsequent mutations, including a category-name lookup correction, later overspend, USD expense, refund, budget moves, recalculation and rollover. Do not execute these scripts sequentially as a portable baseline.

The minimal base Groceries oracle is October 120.50 + 230.25 + 99.99 + 200.00 split allocation = 650.74; budget 1000.00 leaves 349.26 and 65.07% used. The same split includes 100.00 Dining, while the parent is 300.00 and must not be counted again. September Groceries is 150.00 + 400.00 = 550.00. The 550/3 = 183.33 suggestion, manual Dining 500.00 preservation and 450.00 rollover each need their own declared clock, period inputs and reset scenario. These arithmetic values do not authorize combining later probe mutations with the baseline.

## A2 historical assumption that must not be imported

The historical CSV contains two identical Pick n Pay rows without a source transaction identity, distinct Cafe A/Cafe B purchases at the same date/amount, an impossible date, an ambiguous slash date, and an invalid amount. Its narrative calls one identical row a duplicate to skip, and its count is not internally consistent with that statement. The governing master instead preserves legitimate identical purchases with occurrence-aware identity and makes exact replay idempotent. Therefore retain both occurrences unless an actual source identity establishes duplication; do not silently adopt the historical recommendation to drop one or to clear soft-deleted idempotency keys.

For a fresh account opening 500.00 with a manual 60.00 expense, the starting balance is 440.00. The six valid ISO-date CSV occurrences have net 1000 - 100 - 40.50 - 40.50 - 25 - 25 = 769.00, yielding 1209.00. Test the slash-date 7.00 expense separately with explicit day/month mapping and expected date 2026-08-05, yielding 1202.00 if then added. Impossible date and invalid amount must produce row errors with no writes. Replay, manual-row preservation, account scoping and atomic replace/correction each need separate retained evidence. These are reconstructed expectations under the master, not claims about the current importer.

## A6 isolation and clock requirements

The historical settings actor's simple financial oracle is 1000 + 2000 - 80 - 300 - 150.25 = 2469.75; total expenses are 530.25. Recover exact dates and category/account identities before implementing recap windows. Historical eight-day windows and current-value history were reproduced defects, not expected behavior. Use seven household-local calendar dates and explicit test time; do not reuse the final renamed/currency-mutated household as a baseline.

Mail/push/provider checks remain owned synthetic transports. Configured historical sink delivery does not confer permission for real messages, providers or credentials. The separate deletion actor must never be the source of another fixture's credentials or household state.
