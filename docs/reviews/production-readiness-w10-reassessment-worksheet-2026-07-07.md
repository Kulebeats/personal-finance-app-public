# W10 Authoritative Reassessment Worksheet - 2026-07-07

This is a preparation worksheet, not W10 evidence. W10 can start only after W9 is complete: deployed Render URL verified, live smoke checklist recorded, database TLS connectivity proven, the `DATABASE_SSL_REJECT_UNAUTHORIZED=true` flip approved and re-smoked, rollback evidence recorded, and main CI green on the release SHA.

The module matrix in this worksheet is checked by `npm run check:w10-worksheet`. That validator confirms every module in `docs/reviews/module-assessments-index.json` appears here with the same canonical assessment path, current canonical score, and W10 ASSESS gate ID from `docs/reviews/module-assessments-metadata.json`.

## Current Blocking State

- W9 is still open because the known Render host does not serve the app health routes.
- `https://personal-finance-app.onrender.com/` returns the generic `Welcome!` response.
- `/healthz`, `/api/health`, `/health/live`, `/health/ready`, and `/health/startup` return HTTP 404 on that host.
- Do not mark any module 100/100 from local-only evidence. The final metric requires live post-staging reassessment.

## W10 Entry Criteria

Before editing canonical module assessments for W10:

1. `GET /healthz` or the documented `/health/*` endpoints return HTTP 200 on the real deployed URL.
2. W9 smoke checklist has recorded results for auth/session, account, transaction, transfer, CSV import, private-account rejection, tag visibility, GRZ holding plus coupon, receipt upload plus authenticated upload read, weekly recap consent, and rollback.
3. Database TLS baseline connectivity is proven, the TLS verification flip has explicit approval, and smoke is rerun after the flip.
4. `npm audit --omit=dev` reports zero high/critical production findings.
5. Main CI and Amplify are green on the release SHA being assessed.

## Final Gate Commands

Run these on the final SHA after W9 is complete and before claiming W10 or the final gate:

```powershell
npm audit --omit=dev
npm run check
npm run build
npm run test:run:split
npm run test:server:run
npm run deploy:verify
npm run report:modules
npm run check:modules-final
gh run list --repo Kulebeats/personal-finance-app --branch main --limit 5
```

The generated module report must show all 22 modules at `100/100`, and `npm run check:modules-final` must exit 0. If any module remains below 100 or has an open release-gate item, create a new remediation packet instead of marking W10 done.

## Module Reassessment Matrix

| Module | Current Score | Canonical Assessment | W10 Gate ID | W10 Evidence Required |
|---|---:|---|---|---|
| Accounts | 92/100 | `docs/reviews/accounts-module-assessment.md` | ACCOUNTS-ASSESS-001 | Confirm account create/update/archive/restore and balance-sensitive flows in W9 smoke; verify no stale account release-gate items remain before raising to 100. |
| AI Assistant | 86/100 | `docs/reviews/ai-assistant/ai-assistant-module-assessment.md` | AI-ASSESS-001 | If AI is enabled, prove live Gemini provider path, sanitizer coverage, persistence, rate limiting, and failure handling in staging; if disabled, record accepted feature-off state. |
| Auth | 98/100 | `docs/reviews/auth/auth-module-assessment.md` | AUTH-ASSESS-001 | Prove register/login/logout, MFA challenge/verify/resend, step-up denial/approval, session revoke, and email verification behavior on staging. |
| Budgets | 96/100 | `docs/reviews/budget/budget-module-assessment.md` | BUDGETS-ASSESS-001 | Reconfirm budget CRUD, budget-period contract, rollover behavior, and spend calculations against staging data and current tests. |
| Cashflow | 87/100 | `docs/reviews/cashflow/cashflow-module-assessment.md` | CASHFLOW-ASSESS-001 | Reconfirm report accuracy, missing-FX fail-closed behavior, lazy-loaded chart surface, export behavior, and cache behavior after staging smoke. |
| Categories | 96/100 | `docs/reviews/categories/categories-module-assessment.md` | CATEGORIES-ASSESS-001 | Prove category create/update/archive/restore, category-group mutation, seed, reorder behavior, and audit coverage on staging. |
| Dashboard | 96/100 | `docs/reviews/dashboard/dashboard-module-assessment.md` | DASHBOARD-ASSESS-001 | Prove dashboard loading, widget retry states where practical, widget visibility persistence, and dashboard preference save/load behavior. |
| Filter Presets | 96/100 | `docs/reviews/filter-presets/filter-presets-module-assessment.md` | FILTER-PRESETS-ASSESS-001 | Prove list/get/default/create/update/delete, duplicate-name conflicts, default behavior, and audit-row creation. |
| Goals | 96/100 | `docs/reviews/goals-module-assessment.md` | GOALS-ASSESS-001 | Prove goal create/update/delete, contribution, assignment, image upload, and cross-household denial behavior. |
| Health | 96/100 | `docs/reviews/health/health-module-assessment.md` | HEALTH-ASSESS-001 | Prove `/healthz`, `/health/live`, `/health/ready`, and `/health/startup` on the deployed service, including expected dependency state. |
| Household | 96/100 | `docs/reviews/household/household-module-assessment.md` | HOUSEHOLD-ASSESS-001 | Prove household settings, member visibility, invitation status, and role-gated denial behavior. |
| Investments | 93/100 | `docs/reviews/investments-module-assessment.md` | INVESTMENTS-ASSESS-001 | Reconfirm GRZ record-only holding invariant, coupon income path, investment read/write authorization, and no cash mutation on holding creation. |
| Merchants | 96/100 | `docs/reviews/merchants/merchants-module-assessment.md` | MERCHANTS-ASSESS-001 | Prove merchant CRUD, duplicate detection, merge/undo merge, seed, autocomplete, and detail currency formatting. |
| Notifications | 96/100 | `docs/reviews/notifications/notifications-module-assessment.md` | NOTIFICATIONS-ASSESS-001 | Prove notification read/archive behavior, preference update behavior, and push subscription save/remove behavior if browser push is enabled. |
| Receipts | 88/100 | `docs/reviews/receipts-module-assessment.md` | RECEIPTS-ASSESS-001 | Prove receipt upload, OCR/match paths if enabled, authenticated upload read, hostile filename handling, and cleanup behavior. |
| Recurring | 85/100 | `docs/reviews/recurring/recurring-module-assessment.md` | RECURRING-ASSESS-001 | Reconfirm recurring schedule processing, atomic transaction generation, failure handling, and audit behavior. |
| Reports | 96/100 | `docs/reviews/reports-module-assessment.md` | REPORTS-ASSESS-001 | Prove scoped reports, export audit logging, cache behavior through the live app, and missing-FX error behavior where practical. |
| Rules | 100/100 | `docs/reviews/rules/rules-module-assessment.md` | RULES-ASSESS-001 | Keep at 100 only if staging proves rule CRUD, preview, ordering, apply-to-past, and private-transaction exclusion behavior. |
| Settings | 96/100 | `docs/reviews/settings/settings-module-assessment.md` | SETTINGS-ASSESS-001 | Prove profile, display, notification, household preferences, report widget preferences, profile banner, security step-up, session revoke, password change, and erasure guard behavior. |
| Tags | 96/100 | `docs/reviews/tags/tags-module-assessment.md` | TAGS-ASSESS-001 | Prove tag visibility and transaction-tag mutation behavior, including private transaction exclusion and pagination expectations. |
| Transactions | 90/100 | `docs/reviews/transactions-module-assessment.md` | TRANSACTIONS-ASSESS-001 | Prove transaction CRUD, transfer, CSV import effects, balance updates, private-account denial, attachment behavior, and audit/idempotency coverage. |
| Weekly Recap | 96/100 | `docs/reviews/weekly-recap/weekly-recap-module-assessment.md` | WEEKLY-RECAP-ASSESS-001 | Prove weekly recap load, feedback submission, settings persistence, consent-gated email behavior where practical, and generated recap behavior. |

## W10 Update Procedure

For each module:

1. Read the canonical assessment file from the matrix.
2. Match every open release-gate item in `docs/reviews/module-assessments-metadata.json` to W9 evidence.
3. Update the canonical assessment score, status, and evidence references only when staging evidence supports the change.
4. Update `docs/reviews/module-assessments-metadata.json` to remove closed W9/W10 release-gate items.
5. Run `npm run report:modules` and inspect `docs/reviews/module-assessment-status-report.md`.
6. Run `npm run check:modules-final`; it is expected to fail until all 22 module scores are 100/100 and all release-gate items are closed with W9/W10 evidence.
7. If the module cannot reach 100/100, write a named finding and route it back into a new remediation packet.

## Do Not Claim Yet

- Do not set W10 to done from this worksheet.
- Do not remove W9/W10 release-gate metadata until staging evidence exists.
- Do not enable strict database certificate verification until baseline Render connectivity is proven and the user explicitly approves the flip.
