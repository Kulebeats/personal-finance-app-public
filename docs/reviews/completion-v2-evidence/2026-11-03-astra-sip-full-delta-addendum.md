# Astra full SIP delta review and integration hold — 3 November 2026

This addendum supersedes any broad reading of the SIP approval in [the three-candidate review](2026-11-03-astra-three-candidate-review.md), preservation commit `af5784882b6794d85cc6ac2b4903d6e254c5aae1`. That review approved isolated local composition and the narrow original-FX guard. It did not resolve all issues in the historical held SIP lot-posting lineage. The full SIP delta remains HELD for canonical integration.

The owner restored Astra review/orchestration in this chat. This follow-up independently inspected the complete canonical `0a9ca999c56b025622ed722e1cdc57fc11d2cce9` to SIP `ab290d5811435fbc82d681313e19dba19414d2fd` product delta, its changed and existing test callers, current schema and governing master/CAMPAIGN requirements. It also read `.local/composition-nov03/HANDOFF.md` at clean isolated composition `6195e1e37c58d8db3947876eb6673f384fc84638`, in `C:/Users/USER/.codex/worktrees/capital-reviewed-composition-nov03/personal-finance-app`. The five SIP product files are byte-equivalent in that composition. No runtime/DB commands or canonical edits were performed by this reviewer.

## HIGH: accepted private-owner plans cannot execute

File: `server/services/investment/recordSipPurchase.ts:21`.

The new executor unconditionally rejects `account.isPrivate`. The unchanged signed POST `/api/investments/recurring` still accepts a private account belonging to the household: `server/services/InvestmentAutomationService.ts:49` checks household account membership only and stores the plan without the actual authorizing actor. A legitimate private owner can receive success for a plan that repeatedly fails and never advances.

This is an unresolved issue inherited from the held lot-posting candidate, not a regression introduced by the final two-file FX guard. It is nevertheless part of the full canonical-to-SIP product delta. Canonical CAMPAIGN explicitly recorded this blocker when holding `7d90fd8f`; passing later guard tests does not close it.

The test at `server/routes/__tests__/completion-r13.sip-sale.realdb.integration.test.ts` labels directly seeded private custody an invalid plan. That is a valid conservative-denial check but does not exercise or satisfy the supported private owner's signed plan journey. Removing the refusal alone would not establish background authorization and is not an approved repair.

Required disposition: retain the full SIP integration hold until actual actor authorization/private execution is designed within its approval boundary and verified. Do not narrow the product to shared accounts or treat rejection of every private plan as completion.

## Assessment of the complete five-file delta

| File | Review conclusion |
|---|---|
| `server/modules/investments/investmentTradeHistory.ts` | Shared `recordPurchaseLot` derives quantity, native/base cost, rate and date from the persisted BUY and retains recorded-disposal checks. No additional actionable defect found. |
| `server/modules/investments/investments.service.ts` | Manual BUY delegates to that helper while preserving source locks, remaining-basis reconciliation and the audit transaction. No additional actionable defect found. |
| `server/services/investment/processDueInvestments.ts` | Household-before-plan locking, locked-plan checks, nonadvancing-schedule rollback and surviving-parent failure logging are coherent within their scope. They do not establish a durable mandate, actor-erasure authorization or catch-up policy. |
| `server/services/investment/recordSipPurchase.ts` | Shared-custody purchase representability, first-position serialization, lot/audit atomicity and unknown-basis preservation have inspected regression coverage. Private-owner support remains held as above. |
| `server/services/investment/sipHoldingFxSource.ts` | Original-source admission remains acceptable under the narrow previously reviewed contract. Historical authorship is evidence, not current automation authority. |

The previously recorded stale-remaining-cost, unsupported-original-quantity and foreign-evidence issues have explicit composed source/test coverage. Their repair does not clear the remaining private-plan issue. No additional high-confidence defect was found in the five-file delta.

## What the evidence establishes

The independently inspected historical `sol-sip-source-green38v` receipt at `ab290d58` contains 86 passes: 22 legacy-FX cases, 14 purchase/sale cases, three composition cases, two existing automation concurrency cases, 12 manual FIFO-money cases and 33 FIFO source-access cases. The three composition cases exercise actual signed shared-plan creation, remaining cost after an ordinary sale, unsupported original quantity and preservation of original foreign evidence. The legacy-FX suite uses actual signed shared-plan creation and actual source-lock probes.

Several purchase/concurrency fixtures seed plans directly. They prove financial execution and locking behavior, not signed mandate authorization. The household-anchor erasure test removes a plan under a household lock; it does not demonstrate authorization withdrawal for an erased individual whose household survives. Manual FIFO source-access tests do not supply the missing SIP actor identity.

Coordinator-reported later evidence, NOT independently inspected in this follow-up: exact composition `6195e1e3`, packet `.local/astra-composition-server39a`, reportedly completed 504/504 across 25 complete files, exit 0, 28 migrations, target OID `1810458`, all six primary and nine scope counters zero. Preserve and independently inspect its raw receipts. Even if verified, those passing cases do not resolve the untested private-owner authorization contract.

## Settled boundary versus unresolved design

The full private-plan repair contract is NOT yet settled. The master establishes supported private-owner access, current capability/source privacy, truthful attribution and prevention of new effects after authorization withdrawal. It does not approve a specific new SIP mandate schema or actor-erasure retention design. The held repair plan explicitly says only narrow Slice A was approved and that mandate/schema/scheduler proposals remain unapproved.

Current source limitations are concrete. `shared/schema.ts:3311` stores plan household/account/security, type, frequency, amount/currency, next execution date, active state and timestamps. It contains no authorizing user, immutable mandate/version or actor-erasure disposition. `recurringExecutionLog` links to the plan and stores status/date/amount/result/error, but cannot recover missing authorization. Account ownership, household ownership, old purchase authorship and a retained audit are not substitutes for a real plan authorization action.

Requirements already justified by the governing scope:

- A legitimate private owner remains a supported actor; peers must not gain private-source access.
- Attribute authorization to actual signed user action, never an inferred owner, historical BUY author or invented SID.
- Erased/revoked identity must not authorize new effects. Preserved historical attribution does not create continuing authority.
- Automated execution is a system action. Do not falsely name a human as executor to obtain an audit audience.
- Do not invent acquisition dates or prices when considering overdue execution.

The precise mandate representation/versioning, treatment of unattributed legacy plans, private system-audit audience, actor-erasure retention/disposition and overdue booking/quote semantics still require design adjudication. This review does not approve them. Engineering can prepare the concrete contract and test-only evidence under existing authorization; no user decision is required merely to establish that the present private-owner journey fails. If the proposed contract changes owner-held privacy/retention behavior or introduces a product-policy choice, bring that specific concrete decision to the owner. Do not ask the user to approve an unspecified mandate policy, infer it from the opening-receipt erasure decision, or silently implement one.

Minimum next SIP evidence: a test-only actual signed private-owner POST followed by the real executor, paired with peer denial; preserve its actual result. Then review the concrete authorization contract before product/schema changes. After an authorized implementation, prove persisted positive execution, current grant/source withdrawal, actor erasure in a surviving household, and atomic effect/audit behavior without DB-seeded actor attestations. An ordinary session ending and a durable authorization being revoked must not be conflated; their exact mandate semantics belong in the reviewed contract.

## Independent R12/R08 disposition

R12 and R08 can proceed without SIP. Existing pre-SIP composition `1ab00412b67e5c752cbe6e9d51254b871058bec6` contains those disjoint candidates. Root will stage that independent target; no such integration was performed by this reviewer.

Freeze and verify its exact identity with the nine client files, 21 server files (the R12/R08 union plus the changed pure split-allocation test), full project/build checks and the three browser specs. The 25-file `6195e1e3` result contains SIP changes and cannot substitute for the SIP-excluded target's verification. Earlier source-equivalent R12 browser evidence retains the limits recorded in the original review. Preserve every existing failed and passing packet.

## Review Summary

| Severity | Count | Status |
|---|---|---|
| CRITICAL | 0 | pass |
| HIGH | 1 | warn |
| MEDIUM | 0 | pass |
| LOW | 0 | pass |

Verdict: WARNING — full SIP delta HELD for canonical integration. R12/R08 remain eligible for separate exact-candidate verification and integration. No mandate, overdue policy, full packet closure or release approval is granted.
