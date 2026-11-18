# Module Assessment Status Report

Generated: 2026-07-08
Total Modules: 22
Assessed (canonical assessment found): 22 (100%)

This report is generated. Do not edit it directly. Instead:
- Update `docs/reviews/module-assessments-index.json` (canonical sources)
- Update `docs/reviews/module-assessments-metadata.json` (release gate tracking)
- Run `npm run check:module-metadata` to verify canonical source and release-gate metadata consistency
- Run `npm run check:modules-report` to verify this generated report is current
- Run `npm run report:modules` to regenerate this file

---

## Executive Summary (Generated)

| Status Band | Count | Modules |
|-------------|-------|---------|
| PASS (80-100) | 22 | Accounts, AI Assistant, Auth, Budgets, Cashflow, Categories, Dashboard, Filter Presets, Goals, Health, Household, Investments, Merchants, Notifications, Receipts, Recurring, Reports, Rules, Settings, Tags, Transactions, Weekly Recap |
| Needs Fixes (65-79) | 0 | - |
| FAIL (50-64) | 0 | - |
| CRITICAL (<50) | 0 | - |
| Not Assessed | 0 | - |

Notes:
- Status bands are derived from the numeric score in each canonical module assessment.
- Final readiness is stricter: a module must be 100/100 and have zero open release-gate items.
- Canonical assessment sources are defined in `docs/reviews/module-assessments-index.json`.

## Final Readiness Gate (Generated)

A module is final-ready only when its canonical score is 100/100 and `releaseGateOpenItems` is empty.

| Metric | Current | Required For 100% Closeout |
|--------|---------|-----------------------------|
| Modules final-ready | 0/22 | 22/22 |
| Modules at 100/100 | 1/22 | 22/22 |
| Modules below 100/100 | 21 | 0 |
| Modules with open release-gate items | 22 | 0 |
| Security release-gate entries | 0 | 0 |

## Final Readiness Blockers (Generated)

This is the complete W10 closeout queue. A row drops out only when the canonical score is 100/100 and release-gate metadata has no open items.

| Priority | Module | Score | Open Release Gate Items | Blockers | Canonical Assessment |
|----------|--------|-------|--------------------------|----------|----------------------|
| 1 | Recurring | 85/100 | 2 | score 85/100; 2 open release-gate item(s) | docs/reviews/recurring/recurring-module-assessment.md |
| 2 | AI Assistant | 86/100 | 2 | score 86/100; 2 open release-gate item(s) | docs/reviews/ai-assistant/ai-assistant-module-assessment.md |
| 3 | Cashflow | 87/100 | 2 | score 87/100; 2 open release-gate item(s) | docs/reviews/cashflow/cashflow-module-assessment.md |
| 4 | Receipts | 88/100 | 2 | score 88/100; 2 open release-gate item(s) | docs/reviews/receipts-module-assessment.md |
| 5 | Transactions | 90/100 | 2 | score 90/100; 2 open release-gate item(s) | docs/reviews/transactions-module-assessment.md |
| 6 | Accounts | 92/100 | 2 | score 92/100; 2 open release-gate item(s) | docs/reviews/accounts-module-assessment.md |
| 7 | Investments | 93/100 | 2 | score 93/100; 2 open release-gate item(s) | docs/reviews/investments-module-assessment.md |
| 8 | Budgets | 96/100 | 2 | score 96/100; 2 open release-gate item(s) | docs/reviews/budget/budget-module-assessment.md |
| 9 | Categories | 96/100 | 2 | score 96/100; 2 open release-gate item(s) | docs/reviews/categories/categories-module-assessment.md |
| 10 | Dashboard | 96/100 | 2 | score 96/100; 2 open release-gate item(s) | docs/reviews/dashboard/dashboard-module-assessment.md |
| 11 | Filter Presets | 96/100 | 2 | score 96/100; 2 open release-gate item(s) | docs/reviews/filter-presets/filter-presets-module-assessment.md |
| 12 | Goals | 96/100 | 2 | score 96/100; 2 open release-gate item(s) | docs/reviews/goals-module-assessment.md |
| 13 | Health | 96/100 | 2 | score 96/100; 2 open release-gate item(s) | docs/reviews/health/health-module-assessment.md |
| 14 | Household | 96/100 | 2 | score 96/100; 2 open release-gate item(s) | docs/reviews/household/household-module-assessment.md |
| 15 | Merchants | 96/100 | 2 | score 96/100; 2 open release-gate item(s) | docs/reviews/merchants/merchants-module-assessment.md |
| 16 | Notifications | 96/100 | 2 | score 96/100; 2 open release-gate item(s) | docs/reviews/notifications/notifications-module-assessment.md |
| 17 | Reports | 96/100 | 2 | score 96/100; 2 open release-gate item(s) | docs/reviews/reports-module-assessment.md |
| 18 | Settings | 96/100 | 2 | score 96/100; 2 open release-gate item(s) | docs/reviews/settings/settings-module-assessment.md |
| 19 | Tags | 96/100 | 2 | score 96/100; 2 open release-gate item(s) | docs/reviews/tags/tags-module-assessment.md |
| 20 | Weekly Recap | 96/100 | 2 | score 96/100; 2 open release-gate item(s) | docs/reviews/weekly-recap/weekly-recap-module-assessment.md |
| 21 | Auth | 98/100 | 2 | score 98/100; 2 open release-gate item(s) | docs/reviews/auth/auth-module-assessment.md |
| 22 | Rules | 100/100 | 2 | 2 open release-gate item(s) | docs/reviews/rules/rules-module-assessment.md |

## Security Release Gate (Cross-Household Risks First)

This gate is derived from `docs/reviews/module-assessments-metadata.json` and prioritizes cross-household data exposure risks ahead of other issues.

| Priority | Module | Severity | Cross-Household Risk | Reason | Score | Status |
|----------|--------|----------|----------------------|--------|-------|--------|

## Detailed Module Scores (Canonical Assessments)

| Module | Score | Assessment Status | Release Gate Open Items | Final Gate Ready | Canonical Assessment |
|--------|-------|-------------------|--------------------------|------------------|----------------------|
| Accounts | 92/100 | PASS - Production Ready (All P1 issues resolved) | 2 | No | docs/reviews/accounts-module-assessment.md |
| AI Assistant | 86/100 | PROVISIONAL - production path materially remediated, staging Gemini smoke still required | 2 | No | docs/reviews/ai-assistant/ai-assistant-module-assessment.md |
| Auth | 98/100 | Production Ready (All Issues Resolved - 2026-01-29) | 2 | No | docs/reviews/auth/auth-module-assessment.md |
| Budgets | 96/100 | Production Ready (All Issues Resolved - 2026-01-29) | 2 | No | docs/reviews/budget/budget-module-assessment.md |
| Cashflow | 87/100 | Production Ready | 2 | No | docs/reviews/cashflow/cashflow-module-assessment.md |
| Categories | 96/100 | PASS - critical findings closed; W9/W10 evidence still required | 2 | No | docs/reviews/categories/categories-module-assessment.md |
| Dashboard | 96/100 | PASS - critical findings closed; W9/W10 evidence still required | 2 | No | docs/reviews/dashboard/dashboard-module-assessment.md |
| Filter Presets | 96/100 | PASS - critical findings closed; W9/W10 evidence still required | 2 | No | docs/reviews/filter-presets/filter-presets-module-assessment.md |
| Goals | 96/100 | PASS - critical findings closed; W9/W10 evidence still required | 2 | No | docs/reviews/goals-module-assessment.md |
| Health | 96/100 | PASS - critical findings closed; W9/W10 evidence still required | 2 | No | docs/reviews/health/health-module-assessment.md |
| Household | 96/100 | PASS - critical findings closed; W9/W10 evidence still required | 2 | No | docs/reviews/household/household-module-assessment.md |
| Investments | 93/100 | PASS - Production Ready (All Issues Resolved) | 2 | No | docs/reviews/investments-module-assessment.md |
| Merchants | 96/100 | PASS - critical findings closed; W9/W10 evidence still required | 2 | No | docs/reviews/merchants/merchants-module-assessment.md |
| Notifications | 96/100 | PASS - critical findings closed; W9/W10 evidence still required | 2 | No | docs/reviews/notifications/notifications-module-assessment.md |
| Receipts | 88/100 | PASS - Production Ready (All Critical Issues Resolved) | 2 | No | docs/reviews/receipts-module-assessment.md |
| Recurring | 85/100 | Production Ready | 2 | No | docs/reviews/recurring/recurring-module-assessment.md |
| Reports | 96/100 | PASS - critical findings closed; W9/W10 evidence still required | 2 | No | docs/reviews/reports-module-assessment.md |
| Rules | 100/100 | ✅ PERFECT | 2 | No | docs/reviews/rules/rules-module-assessment.md |
| Settings | 96/100 | PASS - critical findings closed; W9/W10 evidence still required | 2 | No | docs/reviews/settings/settings-module-assessment.md |
| Tags | 96/100 | PASS - critical findings closed; W9/W10 evidence still required | 2 | No | docs/reviews/tags/tags-module-assessment.md |
| Transactions | 90/100 | PASS - Production Ready (All Critical Issues Resolved) | 2 | No | docs/reviews/transactions-module-assessment.md |
| Weekly Recap | 96/100 | PASS - critical findings closed; W9/W10 evidence still required | 2 | No | docs/reviews/weekly-recap/weekly-recap-module-assessment.md |

## Modules Not Yet Assessed (Canonical Assessment Missing)

| Module | Module Status Evidence | Notes |
|--------|------------------------|-------|

## CLAUDE.md Compliance Matrix (From Canonical Assessments)

Legend: PASS, PARTIAL, FAIL, N/A, or "-" when not explicitly stated in the canonical assessment.

| Module | Rule 1 (Money) | Rule 9 (Audit) | Rule 12 (Rate) | Rule 17 (Tests) |
|--------|-----------------|----------------|----------------|-----------------|
| Accounts | - | - | - | - |
| AI Assistant | PASS | PASS | PASS | PASS |
| Auth | N/A | PASS | PASS | FAIL |
| Budgets | PASS | PASS | PASS | - |
| Cashflow | PASS | N/A | PASS | - |
| Categories | N/A | PASS | PASS | PASS |
| Dashboard | PASS | N/A | PASS | PASS |
| Filter Presets | N/A | PASS | PASS | PASS |
| Goals | PASS | PASS | PASS | PASS |
| Health | N/A | N/A | PASS | PASS |
| Household | N/A | PASS | PASS | PASS |
| Investments | - | - | - | - |
| Merchants | PASS | PASS | PASS | PASS |
| Notifications | N/A | PASS | PASS | PASS |
| Receipts | - | - | - | - |
| Recurring | PASS | PASS | PASS | - |
| Reports | PASS | PASS | PASS | PASS |
| Rules | - | - | - | - |
| Settings | N/A | PASS | PASS | PASS |
| Tags | N/A | PASS | PASS | PASS |
| Transactions | - | - | - | - |
| Weekly Recap | PASS | PASS | PASS | PASS |

## Machine-Readable Release Gate Tracking

Source of truth: `docs/reviews/module-assessments-metadata.json`. Update that file and re-run the generator.

| Module | Last Verified | Open Release Gate Items | Items |
|--------|---------------|-------------------------|-------|
| Accounts | 2026-01-23 | 2 | ACCOUNTS-STAGING-001: W9 staging smoke must exercise account create/update/archive/restore and private-account access denial behavior; ACCOUNTS-ASSESS-001: W10 authoritative reassessment required after staging |
| AI Assistant | 2026-07-06 | 2 | AI-STAGING-001: live Gemini provider path requires W9 staging smoke if AI is enabled; AI-ASSESS-001: W10 authoritative reassessment required after staging |
| Auth | 2026-07-07 | 2 | AUTH-STAGING-001: W9 staging smoke must exercise register/login/logout, MFA challenge/verify/resend, step-up denial/approval, session revoke, and email verification behavior; AUTH-ASSESS-001: W10 authoritative reassessment required after staging |
| Budgets | 2026-01-23 | 2 | BUDGETS-STAGING-001: W9 staging smoke must exercise budget create/update, spend calculation, and monthly period behavior; BUDGETS-ASSESS-001: W10 authoritative reassessment required after staging |
| Cashflow | 2026-01-23 | 2 | CASHFLOW-STAGING-001: W9 staging smoke must exercise cashflow report load, export, and missing-FX error behavior where practical; CASHFLOW-ASSESS-001: W10 authoritative reassessment required after staging |
| Categories | 2026-07-07 | 2 | CATEGORIES-STAGING-001: W9 staging smoke must exercise category create/update/archive/restore, category-group mutation, seed, and reorder behavior; CATEGORIES-ASSESS-001: W10 authoritative reassessment required after staging |
| Dashboard | 2026-07-07 | 2 | DASHBOARD-STAGING-001: W9 staging smoke must exercise dashboard loading, widget retry states where practical, widget visibility persistence, and dashboard preference save/load behavior; DASHBOARD-ASSESS-001: W10 authoritative reassessment required after staging |
| Filter Presets | 2026-07-07 | 2 | FILTER-PRESETS-STAGING-001: W9 staging smoke must exercise list/get/default/create/update/delete, duplicate-name conflicts, default-preset behavior, and audit-row creation; FILTER-PRESETS-ASSESS-001: W10 authoritative reassessment required after staging |
| Goals | 2026-07-07 | 2 | GOALS-STAGING-001: W9 staging smoke must exercise goal create/update/delete, contribution, assignment, image upload, and cross-household denial behavior; GOALS-ASSESS-001: W10 authoritative reassessment required after staging |
| Health | 2026-07-07 | 2 | HEALTH-STAGING-001: W9 staging smoke must exercise /health/live, /health/ready, and /health/startup on the deployed service; HEALTH-ASSESS-001: W10 authoritative reassessment required after staging |
| Household | 2026-07-07 | 2 | HOUSEHOLD-STAGING-001: W9 staging smoke must exercise household settings, member visibility, invitation status, and role-gated denial behavior; HOUSEHOLD-ASSESS-001: W10 authoritative reassessment required after staging |
| Investments | 2026-01-23 | 2 | INVESTMENTS-STAGING-001: W9 staging smoke must exercise GRZ bond/T-bill record-only creation and coupon or maturity income posting; INVESTMENTS-ASSESS-001: W10 authoritative reassessment required after staging |
| Merchants | 2026-07-07 | 2 | MERCHANTS-STAGING-001: W9 staging smoke must exercise merchant CRUD, duplicate detection, merge/undo merge, seed, autocomplete, and merchant detail currency formatting; MERCHANTS-ASSESS-001: W10 authoritative reassessment required after staging |
| Notifications | 2026-07-07 | 2 | NOTIFICATIONS-STAGING-001: W9 staging smoke must exercise notification read/archive behavior, notification preference update behavior, and push subscription save/remove behavior if browser push is enabled; NOTIFICATIONS-ASSESS-001: W10 authoritative reassessment required after staging |
| Receipts | 2026-01-20 | 2 | RECEIPTS-STAGING-001: W9 staging smoke must exercise receipt upload, authenticated read, and OCR/match/create-transaction behavior where enabled; RECEIPTS-ASSESS-001: W10 authoritative reassessment required after staging |
| Recurring | 2026-01-23 | 2 | RECURRING-STAGING-001: W9 staging smoke must exercise recurring schedule creation/update, due-item processing, and failure atomicity where practical; RECURRING-ASSESS-001: W10 authoritative reassessment required after staging |
| Reports | 2026-07-07 | 2 | REPORTS-STAGING-001: W9 staging smoke must exercise scoped reports, export audit logging, cache behavior through the live app, and missing-FX error behavior where practical; REPORTS-ASSESS-001: W10 authoritative reassessment required after staging |
| Rules | 2026-07-07 | 2 | RULES-STAGING-001: W9 staging smoke must exercise rule CRUD, preview, ordering, apply-to-past, and private-transaction exclusion behavior; RULES-ASSESS-001: W10 authoritative reassessment required after staging |
| Settings | 2026-07-07 | 2 | SETTINGS-STAGING-001: W9 staging smoke must exercise profile, display, notification, household preferences, report widget preferences, profile banner, security step-up, session revoke, password change, and account-erasure guard behavior; SETTINGS-ASSESS-001: W10 authoritative reassessment required after staging |
| Tags | 2026-07-07 | 2 | TAGS-STAGING-001: W9 staging smoke must exercise tag visibility and transaction-tag mutation behavior; TAGS-ASSESS-001: W10 authoritative reassessment required after staging |
| Transactions | 2026-01-27 | 2 | TRANSACTIONS-STAGING-001: W9 staging smoke must exercise normal transaction CRUD, transfer create/delete, CSV import success, and malformed import behavior; TRANSACTIONS-ASSESS-001: W10 authoritative reassessment required after staging |
| Weekly Recap | 2026-07-07 | 2 | WEEKLY-RECAP-STAGING-001: W9 staging smoke must exercise weekly recap load, feedback submission, settings persistence, consent-gated email behavior where practical, and generated recap behavior; WEEKLY-RECAP-ASSESS-001: W10 authoritative reassessment required after staging |

## Canonical Assessment Sources

Canonical paths are defined in `docs/reviews/module-assessments-index.json` to prevent drift between root and subfolder variants.

| Module | Canonical Assessment | Notes |
|--------|----------------------|-------|
| Accounts | docs/reviews/accounts-module-assessment.md | Canonical root assessment; avoid addendum drift by updating this file. |
| AI Assistant | docs/reviews/ai-assistant/ai-assistant-module-assessment.md | Provisional W6 canonical assessment; W10 is authoritative after staging. |
| Auth | docs/reviews/auth/auth-module-assessment.md | Canonical modular assessment. |
| Budgets | docs/reviews/budget/budget-module-assessment.md | Canonical budget assessment lives in subfolder; root variant is legacy. |
| Cashflow | docs/reviews/cashflow/cashflow-module-assessment.md | Canonical cashflow assessment lives in subfolder; root variant is legacy. |
| Categories | docs/reviews/categories/categories-module-assessment.md | Canonical categories assessment. |
| Dashboard | docs/reviews/dashboard/dashboard-module-assessment.md | Canonical dashboard assessment. |
| Filter Presets | docs/reviews/filter-presets/filter-presets-module-assessment.md | Provisional W6 canonical assessment; W10 is authoritative after staging. |
| Goals | docs/reviews/goals-module-assessment.md | Canonical root assessment. |
| Health | docs/reviews/health/health-module-assessment.md | Canonical infrastructure assessment. |
| Household | docs/reviews/household/household-module-assessment.md | Canonical security-critical assessment. |
| Investments | docs/reviews/investments-module-assessment.md | Canonical root assessment. |
| Merchants | docs/reviews/merchants/merchants-module-assessment.md | Canonical merchants assessment. |
| Notifications | docs/reviews/notifications/notifications-module-assessment.md | Canonical subfolder assessment. |
| Receipts | docs/reviews/receipts-module-assessment.md | Canonical root assessment. |
| Recurring | docs/reviews/recurring/recurring-module-assessment.md | Canonical subfolder assessment; root variant is legacy. |
| Reports | docs/reviews/reports-module-assessment.md | Canonical root assessment with addendum risks. |
| Rules | docs/reviews/rules/rules-module-assessment.md | Canonical rules assessment. |
| Settings | docs/reviews/settings/settings-module-assessment.md | Canonical subfolder assessment. |
| Tags | docs/reviews/tags/tags-module-assessment.md | Canonical security-critical assessment. |
| Transactions | docs/reviews/transactions-module-assessment.md | Canonical root assessment. |
| Weekly Recap | docs/reviews/weekly-recap/weekly-recap-module-assessment.md | Canonical subfolder assessment. |

## Priority Remediation Order (Generated)

### P0 - Security and Cross-Household Risks


### P1 - Release Gate Open Items (Non-Security Gate)

1. Accounts: ACCOUNTS-STAGING-001: W9 staging smoke must exercise account create/update/archive/restore and private-account access denial behavior
2. AI Assistant: AI-STAGING-001: live Gemini provider path requires W9 staging smoke if AI is enabled
3. Auth: AUTH-STAGING-001: W9 staging smoke must exercise register/login/logout, MFA challenge/verify/resend, step-up denial/approval, session revoke, and email verification behavior
4. Budgets: BUDGETS-STAGING-001: W9 staging smoke must exercise budget create/update, spend calculation, and monthly period behavior
5. Cashflow: CASHFLOW-STAGING-001: W9 staging smoke must exercise cashflow report load, export, and missing-FX error behavior where practical
6. Categories: CATEGORIES-STAGING-001: W9 staging smoke must exercise category create/update/archive/restore, category-group mutation, seed, and reorder behavior
7. Dashboard: DASHBOARD-STAGING-001: W9 staging smoke must exercise dashboard loading, widget retry states where practical, widget visibility persistence, and dashboard preference save/load behavior
8. Filter Presets: FILTER-PRESETS-STAGING-001: W9 staging smoke must exercise list/get/default/create/update/delete, duplicate-name conflicts, default-preset behavior, and audit-row creation
9. Goals: GOALS-STAGING-001: W9 staging smoke must exercise goal create/update/delete, contribution, assignment, image upload, and cross-household denial behavior
10. Health: HEALTH-STAGING-001: W9 staging smoke must exercise /health/live, /health/ready, and /health/startup on the deployed service
11. Household: HOUSEHOLD-STAGING-001: W9 staging smoke must exercise household settings, member visibility, invitation status, and role-gated denial behavior
12. Investments: INVESTMENTS-STAGING-001: W9 staging smoke must exercise GRZ bond/T-bill record-only creation and coupon or maturity income posting
13. Merchants: MERCHANTS-STAGING-001: W9 staging smoke must exercise merchant CRUD, duplicate detection, merge/undo merge, seed, autocomplete, and merchant detail currency formatting
14. Notifications: NOTIFICATIONS-STAGING-001: W9 staging smoke must exercise notification read/archive behavior, notification preference update behavior, and push subscription save/remove behavior if browser push is enabled
15. Receipts: RECEIPTS-STAGING-001: W9 staging smoke must exercise receipt upload, authenticated read, and OCR/match/create-transaction behavior where enabled
16. Recurring: RECURRING-STAGING-001: W9 staging smoke must exercise recurring schedule creation/update, due-item processing, and failure atomicity where practical
17. Reports: REPORTS-STAGING-001: W9 staging smoke must exercise scoped reports, export audit logging, cache behavior through the live app, and missing-FX error behavior where practical
18. Rules: RULES-STAGING-001: W9 staging smoke must exercise rule CRUD, preview, ordering, apply-to-past, and private-transaction exclusion behavior
19. Settings: SETTINGS-STAGING-001: W9 staging smoke must exercise profile, display, notification, household preferences, report widget preferences, profile banner, security step-up, session revoke, password change, and account-erasure guard behavior
20. Tags: TAGS-STAGING-001: W9 staging smoke must exercise tag visibility and transaction-tag mutation behavior
21. Transactions: TRANSACTIONS-STAGING-001: W9 staging smoke must exercise normal transaction CRUD, transfer create/delete, CSV import success, and malformed import behavior
22. Weekly Recap: WEEKLY-RECAP-STAGING-001: W9 staging smoke must exercise weekly recap load, feedback submission, settings persistence, consent-gated email behavior where practical, and generated recap behavior

### P2 - Assessment Coverage and Hygiene

1. All modules have canonical assessments.

## Conclusion

Final readiness is not achieved yet: 0/22 modules are final-ready. Remaining work is score gaps plus 22 modules with open release-gate items; update canonical assessments and metadata only when W9/W10 evidence supports closure.
