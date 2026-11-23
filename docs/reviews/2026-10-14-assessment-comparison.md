# Independent assessment comparison: Codex and Claude

> Historical snapshot. Claude revised its scope and added runtime evidence after this comparison. Read the [15 October update](2026-10-15-assessment-comparison-update.md) for current conclusions; the earlier pilot-scope and disputed-evidence statements below describe the preceding version.

Compared on 14 October 2026. Both assessments and the current checkout identify application revision **381e9439afabe7c6cf829cb1cbded91d36da44ee**. This is a comparison and source adjudication, not a new runtime certification. No application code, configuration, dependencies or databases were changed for this comparison.

## 1. Conclusion

**Use both assessments. Neither is sufficient on its own.** Claude adds stronger runtime coverage of several important financial, isolation and browser failures. Codex adds broader operations, authorization, mutation-lifecycle and full-product completion requirements. Both independently conclude that the app is **not ready for real household use** despite green automated suites.

The biggest difference in the plans is the brief: Codex's final plan follows the owner's instruction to finish the full application without a November deadline. Claude's plan still optimizes for an invited-household pilot and permits withholding several advertised features. That pilot plan does not satisfy the owner's current completion requirement.

My original assessment missed material defects. In particular, the cross-household goal-activity leak, card-liability accounting, bond payment lifecycle, and several UI-to-API failures must be added to the completion backlog. Conversely, Claude's testing does not clear the source-confirmed risks it did not exercise.

## 2. Sources and comparison rules

- [Codex assessment](2026-10-11-deep-readiness/README.md), [62-row register](2026-10-11-deep-readiness/remaining-work.csv), [completion specification](2026-10-11-deep-readiness/COMPLETION_SPEC.md), [evidence](2026-10-11-deep-readiness/EVIDENCE.md), [launch plan](2026-10-11-deep-readiness/LAUNCH_PLAN.md).
- [Claude assessment](2026-10-13-independent-readiness-fable/README.md), [gap register](2026-10-13-independent-readiness-fable/GAPS.md), [completion specification](2026-10-13-independent-readiness-fable/COMPLETION_SPEC.md), [evidence](2026-10-13-independent-readiness-fable/EVIDENCE.md), [launch plan](2026-10-13-independent-readiness-fable/LAUNCH_PLAN.md).
- Claude also wrote its own [cross-comparison](2026-10-13-independent-readiness-fable/COMPARISON-vs-2026-10-11.md) after its independent assessment. It is useful input, not independent proof of its own comparison claims. Its [skeptic report](2026-10-13-independent-readiness-fable/evidence/skeptic-pass.md) records earlier issues; several were subsequently corrected in the final package.
- [Companion crosswalk](2026-10-14-assessment-crosswalk.csv): every one of the 62 Codex register rows, counterpart or absence, and a comparison disposition. This is a relationship map, not a count of unique defects across both packages. Claude-new findings are listed separately below.

Runtime results below are attributed to the original audit that executed them. This comparison re-read selected source paths but did not re-run either audit's HTTP probes or test suites. A shared finding can have additional variants that only one assessor covered. A similar module or packet is not proof that both found the same defect.

## 3. Evidence and coverage differences

| Dimension | Codex | Claude | Meaning |
|---|---|---|---|
| Application revision | 381e9439 | 381e9439 | Differences are coverage, interpretation and scope, not intervening app fixes. |
| Runtime server | Test mode; relaxed cookies/rates and CSRF bypass | Development mode; CSRF and limiters active, SMTP sink | Claude could find fresh-browser CSRF and ordinary-use throttling that Codex's runtime environment concealed. Neither is production parity. |
| Financial fixtures | Focused successful expense journey plus targeted import/privacy/session probes | Broader account/currency/liability/GRZ fixtures; skeptic reconciled 21 accounts and 89 transactions | Claude has stronger empirical coverage of the additional money scenarios. Zero drift proves the exercised bookkeeping identity, not all financial semantics. |
| Existing suites | 2,660 server and 1,384 client tests passed; coverage measured | Same test totals passed | Agreement on existing-suite health; both found defects outside those assertions. |
| Playwright | 76 passed, 1 skipped after installing matching Chromium | Blocked at browser launch by missing expected browser build | Claude's failed launches are an environment limitation, not 71 proven app regressions. Codex's green run still includes weak/vacuous journey assertions. |
| Migration evidence | Fresh migrated isolated databases | Fresh migration plus detailed schema comparison with push-built database | Claude adds explicit schema-parity evidence. |
| Readiness register | 62 grouped findings, with explicit evidence labels and 20 packets | Eight P0 table rows/clusters, grouped P1s and long P2/P3 lists, 16 primary packets | Raw counts and severity totals are not directly comparable. |
| Deployment | Actual intended staging not established | No staging proof; package says service not provisioned | Common supported conclusion: deployment readiness is unverified. Lack of an available URL does not alone prove no deployment exists. |

Claude's “43 counterparts,” “about 25 new,” “14 severity differences,” and later “36 converging rows” are different/approximate groupings, not an auditable deduplicated total. Do not add these to 62 or use them as an assessor score. The crosswalk makes the relationships explicit instead.

## 4. Important findings Claude added

These are absent as specific findings from Codex's original register, or materially extend a related finding. Broad acceptance language in the old specification does not count as having discovered the defect.

| Claude IDs | Additional finding and consequence | Evidence in Claude package | Add to Codex packets |
|---|---|---|---|
| ISO-01 | A user in another household can read a goal's activity, including financial notes, amounts and user identifiers. This extends the original same-household private-goal leak. | HTTP with denied goal-detail control; skeptic reproduced; source rechecked here | P04, P09 |
| RC-01 | Ratios/debt add foreign balances without conversion even when FX rates exist; visibility filters also incomplete. | HTTP, independent expected calculation, skeptic repeat; source rechecked here | P04, P13 |
| GRZ-01/02 | Bond principal is posted as income; coupons and principal remain payable after the bond is sold. | HTTP + DB; source rechecked here | P06, P10 |
| RC-03/04 | A card purchase reduces positive debt owed; card spending is removed from expenses and can be labelled debt paid. A 500.00 debt plus a 45.50 purchase became 454.50 rather than 545.50. | HTTP + DB / report reconciliation | P06, P13 |
| F-AUTH-04 | Verification from a fresh browser fails CSRF validation, including the email-change verification path. | Fresh-cookie HTTP probe, active CSRF | P02, P05 |
| F-SEC-04b/c | Ordinary navigation/authentication hits rate limits; duplicated limiter application is implicated. | Browser + HTTP; Redis behavior remains a staging test | P00, P02, P18 |
| F-TXN-02 | Transaction category picker filters on a field absent from the API response and offers only Uncategorized. | Browser + source | P06, P12, P17 |
| F-REC-01 | Recurring creation from the UI omits required frequency/date fields and returns 400. | Browser/network | P11, P17 |
| F-ACC-01 | Default Shared filter hides the first owned account and shows an empty state. | Browser | P06, P17 |
| SEC-06/07 | Ownership transfer to self can leave no owner; another path creates multiple owners and allows demotion of the original owner. | HTTP + DB; transfer source rechecked here | P03, P04 |
| RC-02 / INV-06 | Global FX/security records are writable across households, affecting another household's values. | HTTP + DB | P04, P10, P13 |
| RC-05 | Split rows disappear from several report/export readers. This differs from Codex FIN-08's split-edit staleness. | HTTP with expected totals | P06, P07, P13 |
| RC-06/08 | Summary uses latest rather than dated FX; UTC-derived client month boundaries differ from local month dates. Extends the known stale summary issue. | HTTP + browser/source | P13, P17 |
| BGR-02 | Budget rollover depends on a preference the save endpoint cannot set. | HTTP + DB | P05, P08, P11 |
| IMP-02 | Dedupe can merge legitimate same-date/type/amount purchases. Distinct from overwrite deletion. | HTTP + DB | P07 |
| RCP-01/02 | Receipt-to-transaction can be repeated and accepts negative amounts, producing duplicate or reversed cash effects. | HTTP + DB | P06, P14 |
| ORG-01 | Tag merge returns 500 from UUID/text mismatch. | HTTP | P12 |
| INV-02/04/07/08, GRZ-05/06, PEN-01 | Negative sells, missing ZMW conversion, tax reporting/year-boundary defects, invalid bond inputs, zero-interest maturity failure and pension validation gaps. | Domain HTTP/DB findings | P06, P10, P13 |
| F-INV-01 | GRZ/tax/pension tabs are inaccessible without an equity holding. | Browser | P10, P17 |
| SET-02, DEL-01/02 | Offered user preferences lack their own persistence path; deletion retains session/identity material and removes shared audit history. These deepen Codex's settings/exit findings. | HTTP + DB / source | P01, P05 |
| F-DATE family, SNA-REC findings | Timestamp skew, recap setting cross-writes and historical recap display inconsistencies. | Domain/browser/DB; deployment timezone effects unverified | P05, P11, P13, P15 |

Claude also strengthened evidence for defects Codex already had: private tag/recurring leakage, recipient-unbound invitations, budget currency aggregation and historical averages, investment cost basis, and later sale failures after automated purchases. These are confirmations or extensions, not new independent backlog rows by default.

## 5. Important findings Codex adds or covers more deeply

| Codex IDs | Difference | Required treatment |
|---|---|---|
| FIN-03 | Overwrite can delete only one transfer leg. Claude confirmed the source during its later cross-read. | Retain paired-account reconciliation and rollback tests; fixing replay dedupe alone is insufficient. |
| FIN-04 | Account-detail import skips valid rows; latent sign/balance problems after repairing that path. Claude exercised the global importer. | Test both actual UI entry points through persistence. |
| FIN-08/09/13/14 | Split mutation lifecycle, goal link edit/delete/unlink, account denomination/type/opening-balance changes, swallowed portfolio valuation errors. | Retain independent edit/delete and error fixtures. Claude's skeptic explicitly says transaction edit/delete reconciliation was not exercised. |
| ORG-001/003 | Professional role fails open in role hierarchy; rule actions lack household validation for referenced entities. | Keep source-confirmed issues open; runtime role reachability and exploit effects still need focused evidence. |
| ORG-004/005 | Rule dry-run can mutate through tag/alias/split actions; split allocations can exceed parent. | Claude's set-category dry-run success does not clear other action types. |
| AH-09/10/12 | Shared preferences role gap, non-atomic one-time MFA consumption, weaker password-change policy. | Retain explicit permissions, concurrency and policy parity tests. |
| OPS-004/008 | OCR versus production CSP; push outbound-destination validation gap. | Test with deployed security headers and controlled destinations. No SSRF exploit was executed in either audit. |
| OPS-010/013 | Notification channel status/dedupe; expiring/evictable coordination without durable run identity. | Verify delivery failure/retry, two workers, restart and lease expiry. |
| ORG-007/008/009/010 | Merchant deletion/undo behavior, repeated tag-removal counts, unused saved default preset. | Keep exact mutation/read-back acceptance; generic “stale counts” is only partial overlap. |
| DEP-02, QA-01 | Runtime lifecycle target and weak browser test assertions. | Refresh implementation-time support status and require real submit/read-back tests. A green smoke run alone is insufficient. |
| P05/P14/P15/P17/P18/P19 | Complete data exit, receipt/OCR, notifications, accessibility, operations and full release acceptance. | Keep required full-product scope instead of pilot deferrals. |
| P16 / CHG-AI-01 | Claude-first/Gemini-fallback Thandi with consent and durable spend controls. | Preserve the explicit owner requirement and final provider specification. Claude's generic unavailable-state patch is smaller scope. |

## 6. Disagreements adjudicated

### Shared versus personal preferences: Codex finding remains open

The current `PUT /api/settings/preferences` route has membership authentication but no write-role check (`server/modules/settings/settings.routes.ts:110`). Its controller takes `req.householdContext.householdId` and calls the household repository (`settings.controller.ts:364`). That repository updates `householdPreferences` by household ID (`server/repositories/HouseholdRepository.ts:401`). `householdGuard` verifies membership, not permission to write.

This is a **source-confirmed shared-state write path**, not a per-user preference path. Claude's final “33 of 37 writes denied; remaining writes affect no shared financial data” claim cannot clear AH-09. Its security verifier and skeptic enumerate a different set of successful endpoints, so that test set must not be generalized to this route. A fresh view-only request with another member's read-back remains required before calling this runtime-reproduced or fixed.

### GRZ: adopt the defects, refine the accounting explanation

The pay handler checks household and already-paid state, but passes `type: "income"` for the payment without distinguishing principal (`server/routes/grz-securities.ts:444–541`). It does not reject the bond's sold state. Claude's recorded failures are consistent with that source.

Codex correctly preserved the existing record-only **creation** contract; that never certified the entire GRZ lifecycle. Codex nevertheless missed these concrete payment defects and must extend P10. Claude's phrasing that record-only creation necessarily makes every maturity receipt fabricated is too broad: an externally funded holding or manually recorded purchase may have a legitimate later cash receipt. Its own skeptic recognized this distinction.

Required contract: distinguish return of principal from income, reconcile cash and remaining asset value without duplicate purchase/settlement legs, define external/manual purchase provenance, and prevent unauthorized or duplicate post-disposal payments. Do not automatically introduce a purchase debit or blanket suppression of principal cash receipts. The accounting behavior needs an explicit product/domain decision; this comparison does not decide tax treatment.

### “Ledger core is sound”: a bounded positive result

Claude's 21-account reconciliation is useful. It confirms the stored balance equals the selected arithmetic over the exercised live transactions. It can still pass after wrong liability signs or after deleted rows disappear from the sum. It does not clear lost import data, incomplete transfer pairs, omitted report rows or untested edits. Use “tested creation/transfer paths reconcile” rather than a universal ledger certification.

### Severity: common release gates matter more than labels

| Finding | Difference | Combined treatment |
|---|---|---|
| Ineffective session revocation | Codex P0; Claude P1 | Release blocker for both pilot and full release. Trust between household members does not eliminate stolen-device/session risk. |
| Unconverted budget totals | Codex P1; Claude P0 after runtime proof | Block release wherever multi-currency is offered. Wrong read-model values need not mutate ledger rows to be material. |
| Unscheduled financial jobs | Codex P1; Claude P0 | Required functionality and operational proof gate. Source proves missing declared wiring, not absence of every possible external scheduler. |
| Professional role fail-open | Codex P0; Claude cross-read P1 due uncertain role reachability | Keep the fail-closed repair requirement and explicitly verify existing membership/creation reachability before final exposure rating. |
| Push destination validation | Codex conditional P0; Claude withholds push | Withholding can stage rollout but does not complete the user's requested push feature. Verify before enabling it. |
| MFA, logs, health, mobile, test safety | Scope-dependent P1/P2/P3 | Grade consequence and confidence separately from release obligation. All promised full-product behavior still needs completion. |

### Dry-run and reports: different cases are not contradictions

Claude exercised a category-only rule dry-run without writes; Codex traced mutating tag/alias/split branches. Both observations can hold. Likewise, correct expense classification for one fixture does not clear card-account classification, and correct dated-FX reports do not clear the separate ratios repository. The current ratios code sums raw account balances into the household currency (`server/repositories/reports/AnalyticsRatiosRepository.ts:46–81`), consistent with Claude's result even when rates are available.

## 7. Plan, effort and Thandi differences

| Scope | Codex | Claude | How to use it |
|---|---|---|---|
| Smallest pilot with major features withheld | Not the final requested scope | 27.5–41 developer-days | A separate rollout option, not a completion estimate. |
| Claude's all-P0/P1 packet plan, including investments | No identical priced subset | 44–64 developer-days | Still a smaller completion contract, especially around AI, OCR, notifications and acceptance depth. |
| Full agreed application, including dual-provider Thandi | 72–122 developer-days; approximately 87–147 with 20% reserve | No equivalently detailed full-scope estimate | Existing planning baseline, not a refreshed quote for the combined findings. |
| Rollout date | Gate-driven; November withdrawn | Retains 11 November stretch and December/January alternatives | The withdrawn November date must not govern the combined plan. |

Do not add the estimates together: many fixes overlap. Equally, do not retain 72–122 as a newly validated combined estimate. Re-estimate affected packets after deduplicating the additions, particularly P03/P04, P06/P07, P10 and P13. Claude's cross-comparison offers a rough 50–83 versus 44–64 overlapping-scope calculation, but differently scoped packets are not sufficiently interchangeable to treat that as a precise productivity comparison.

For Thandi, the owner's [final provider specification](2026-10-11-deep-readiness/THANDI_PROVIDER_SPEC.md) remains the requirement: **Claude primary → eligible Gemini fallback → clearly labelled local degraded mode**, with owner/admin-managed household consent, privacy and tool authorization, bounded attempts, and atomic shared spend reservations. Claude's WP-16 instead proposes an unavailable response without consuming quota on provider failure and defers AI in its pilot. These are materially different product contracts. App chat-quota policy must remain separate from actual/uncertain provider charges; a failed response cannot justify erasing possible external spend. No provider integration is implemented by either document.

## 8. Combined execution order and acceptance additions

Keep the full-product P00–P19 structure and carry Claude's IDs alongside Codex IDs. Do not close work merely by hiding it.

1. **Identity and isolation:** sessions/DTOs, fresh-browser verification, recipient-bound invitations, single-owner transitions, all private/cross-household alternate readers and writers, shared preferences permissions, global reference data ownership.
2. **Money integrity:** both import entry points, overwrite replay and paired transfers, legitimate duplicate purchases, card liability signs, receipt idempotence/validation, split and goal mutation lifecycles, account edit semantics, dated FX and visibility in every aggregate.
3. **Complete reachable journeys:** picker, first-account filter, recurring payload, membership forms, tag merge, merchant routes, GRZ-only navigation, persistent settings and data exit.
4. **Investment and automation lifecycle:** principal versus income, post-sale payment prevention, lots/basis, tax/report consistency, pension validation, catch-up/month boundaries, durable job identity and observed scheduling.
5. **Full integrations and user experience:** durable receipts/OCR, accurate notifications/recap, the agreed Thandi provider plan, accessible mobile journeys and trustworthy save/error states.
6. **Release evidence:** exact candidate revision, production-like CSRF/cookies/rates, configured Redis, UTC server plus Lusaka user dates, both currencies and liability/split fixtures, migration/restore/rollback, real controlled SMTP/providers, and complete owner UAT.

Add acceptance cases for foreign goal activity, view-only shared preference mutation, every rule dry-run action, self-transfer of ownership, receipt retries, zero-interest maturity, negative investment sells, card purchases, split readers, and every financial edit/delete path. Reconcile browser, API, stored rows and independently expected financial outcomes after each workflow. Expand from isolated local fixtures to staging before real-user rollout.

## 9. Enhancement differences

Both suggest guided setup, better reconciliation/understanding, clearer activity and attribution, import improvements and device usability. Claude supplies a useful 15-item ranked enhancement table, including quick-add, problem reporting with request IDs and upcoming-bill reminders. Codex prices broader optional additions separately from completion.

Several items labelled enhancements are actually completion work where already promised: correct month totals, accessible controls, MFA management, working default filters and removing misleading inert controls. Keep those in mandatory packets. New quick-add, auto-contribution, bank integrations, PDF additions, offline support and redesign remain separate product choices. Claude-first/Gemini-fallback is already an explicit owner requirement, not an optional post-launch enhancement.

## 10. What remains uncertain

Neither package proves deployed readiness, real provider success, reliable scheduling, restore/rollback, complete accessibility, or all concurrency and mutation paths. Some original Codex findings remain source-only; some Claude conclusions depend on local timezone, chosen fixtures and proposed accounting policy. Claude's raw test logs were not re-executed or independently reconstructed in this comparison.

The completed output is a reconciled assessment comparison and integration recommendation. Original assessments are preserved. The next implementation specification should retain both finding IDs, normalize severity and evidence labels, absorb the additional acceptance cases, and re-estimate the affected full-product packets before anyone promises a launch date.
