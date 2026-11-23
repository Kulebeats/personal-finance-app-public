# Source finding coverage and disambiguation

15 October 2026. This table maps every individually identified table finding read from Claude's six domain reports, including repeated IDs whose meanings differ by report. Summary rows are deduplicated by source file and ID. SET-06 is an explicit positive finding, retained as a regression check rather than invented remaining work. Original 62 Codex rows map1:1 by preserved ID in REMAINING_WORK.csv; lead F-* findings map through the register aliases. This mapping does not turn source-only evidence into a runtime result.

**129 distinct domain ID entries mapped; 128 map to required closure groups; one positive retained.** Lower-priority details are included in packet acceptance, not silently deferred. Source report rows may contain multiple variants; read the named row when implementing its mapped group.

| Source report | ID | Topic | Consolidated closure group |
|---|---|---|---|
| [domain-budgets-goals-recurring.md](../2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | BGR-01 | `GET /api/budgets/progress` | FIN-06 |
| [domain-budgets-goals-recurring.md](../2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | BGR-02 | Rollover (progress + `POST /api/cron/budget-rollover`) | NEW-16 |
| [domain-budgets-goals-recurring.md](../2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | BGR-03 | `POST /api/budgets/recalculate` | FIN-07 |
| [domain-budgets-goals-recurring.md](../2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | BGR-04 | Recalculate/clear audit | NEW-32 |
| [domain-budgets-goals-recurring.md](../2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | BGR-07 | Refunds in budget spend | FIN-06 |
| [domain-budgets-goals-recurring.md](../2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | BGR-08 | Move to same budget | NEW-32 |
| [domain-budgets-goals-recurring.md](../2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | GOAL-01 | Manual contributions | NEW-29 |
| [domain-budgets-goals-recurring.md](../2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | GOAL-02 | `GET /api/goals/summary`, `GET /:id/contributions` | NEW-35 |
| [domain-budgets-goals-recurring.md](../2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | GOAL-03 | `POST /:id/assign-account` | FIN-09 |
| [domain-budgets-goals-recurring.md](../2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | GOAL-04 | Projection dates | NEW-15 |
| [domain-budgets-goals-recurring.md](../2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | REC-01 | Create-rule UI vs API | NEW-10 |
| [domain-budgets-goals-recurring.md](../2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | REC-02 | `calculateNextDate` monthly | NEW-30 |
| [domain-budgets-goals-recurring.md](../2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | REC-03 | Catch-up | NEW-30 |
| [domain-budgets-goals-recurring.md](../2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | REC-04 | `POST /api/recurring/process` `asOfDate` | NEW-30 |
| [domain-budgets-goals-recurring.md](../2026-10-13-independent-readiness-fable/evidence/domain-budgets-goals-recurring.md) | REC-05 | "Today" for due-ness | NEW-15 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | IMP-01 | `prioritize_csv` re-import of an already-imported file. Impl PRESENT, Verif HTTP+DB | FIN-02 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | IMP-02 | Same-day same-amount distinct transactions. Impl PRESENT (by design), Verif HTTP+DB | NEW-17 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | IMP-03 | Invalid date `2026-02-30`. Verif HTTP+DB | FIN-15 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | IMP-04 | Ambiguous slash dates. Verif HTTP+DB | FIN-15 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | IMP-05 | Notes column mapping. Verif HTTP+DB+SRC | NEW-17 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | IMP-06 | Per-row errors in UI. Verif SRC | NEW-17 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | IMP-07 | `data_imports` history | NEW-17 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | RCP-01 | `POST /api/receipts/:id/create-transaction` retried. Impl PRESENT, Verif HTTP+DB | NEW-18 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | RCP-02 | create-transaction with negative amount. Verif HTTP+DB | NEW-18 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | RCP-03 | Receipt detail payload | NEW-39 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | RUL-01 | "Test rule" button. Impl MISSING server route, Verif HTTP+SRC | ORG-006 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | RUL-02 | Action references not validated; apply-to-past fails silently. Verif HTTP+DB+SRC | NEW-36 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | RUL-03 | Cross-household tag id in a rule (SRC only, not exercised) | ORG-003 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | RUL-04 | Audit for rule-driven transaction edits. Verif DB | NEW-32 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | RUL-05 | dry-run completeness | ORG-004 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | RUL-06 | reorder input | NEW-36 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | ORG-01 | Tag merge (client `lib/api.ts:1163`). Impl PRESENT but broken, Verif HTTP+DB+EXPLAIN | NEW-19 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | ORG-02 | Merchant detail endpoints used by `components/merchants/detail/useMerchantDetailState.ts` and MerchantsSection handlers (hooks at `use-settings.ts:1241-1375`). Impl MISSING, Verif HTTP | ORG-006 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | ORG-03 | Tag name uniqueness | NEW-36 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | ORG-04 | Counters | ORG-009 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | CAT-01 | Archive group | NEW-36 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | CAT-02 | `includeArchived=false` | NEW-36 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | X-01 | Imported transactions are stored with `currency = NULL` (import passes no currency; receipt path likewise), so any per-currency logic must fall back to the account currency | FIN-05 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | X-02 | `POST /api/accounts` writes two `account CREATE` audit rows per account | NEW-32 |
| [domain-import-receipts-organization.md](../2026-10-13-independent-readiness-fable/evidence/domain-import-receipts-organization.md) | X-03 | Timestamps written from JS `new Date()` (e.g. `deleted_at`, account `updatedAt`) are 2 h behind `defaultNow()` columns on this Lusaka-time server (e.g. account `createdAt 22:58Z`, `updatedAt 21:00Z`; transaction `created_at 21:00:09`, `deleted_at 19:00:09`) - suggests `timestamp without time zone` mixed with session-TZ defaults | NEW-15 |
| [domain-investments-grz.md](../2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | GRZ-01 | `POST /grz/payments/:id/pay` on a **principal** row | NEW-03 |
| [domain-investments-grz.md](../2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | GRZ-02 | pay after sell | NEW-04 |
| [domain-investments-grz.md](../2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | GRZ-03 | `PUT /bonds/:id/sell` money effects | NEW-03 |
| [domain-investments-grz.md](../2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | GRZ-04 | pay before due date / any account | NEW-04 |
| [domain-investments-grz.md](../2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | GRZ-05 | `POST /grz/bonds` validation | NEW-23 |
| [domain-investments-grz.md](../2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | GRZ-06 | maturity cron, `Money.isPositive()` | NEW-23 |
| [domain-investments-grz.md](../2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | GRZ-07 | schedule vs stored rate | NEW-23 |
| [domain-investments-grz.md](../2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | GRZ-08 | yield day count | NEW-23 |
| [domain-investments-grz.md](../2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | GRZ-09 | `POST /grz/tbills` | NEW-23 |
| [domain-investments-grz.md](../2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | INV-01 | manual buy/sell → `holdings.cost_basis` | FIN-10 |
| [domain-investments-grz.md](../2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | INV-02 | sell with negative quantity | NEW-20 |
| [domain-investments-grz.md](../2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | INV-03 | sell of holding opened via `POST /holdings` or SIP | FIN-11 |
| [domain-investments-grz.md](../2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | INV-04 | FX on investment txns | NEW-21 |
| [domain-investments-grz.md](../2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | INV-05 | fees | NEW-35 |
| [domain-investments-grz.md](../2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | INV-06 | global securities / FX | NEW-13 |
| [domain-investments-grz.md](../2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | INV-07 | tax summary / ZRA export coverage | NEW-22 |
| [domain-investments-grz.md](../2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | INV-08 | tax-year window | NEW-22 |
| [domain-investments-grz.md](../2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | INV-09 | SIP buy / plan create audit | NEW-32 |
| [domain-investments-grz.md](../2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | INV-10 | past-due SIP | FIN-12 |
| [domain-investments-grz.md](../2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | PEN-01 | pension contributions | NEW-24 |
| [domain-investments-grz.md](../2026-10-13-independent-readiness-fable/evidence/domain-investments-grz.md) | PEN-02 | pension audit/atomicity | NEW-24 |
| [domain-reports-consistency.md](../2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-01 | `GET /api/reports/ratios` (`liquidAssets`, `currentLiabilities`, emergency fund, burn rate, liquidity) and `/reports/debt` | NEW-02 |
| [domain-reports-consistency.md](../2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-02 | `fx_rates` is global; `POST /api/investments/fx-rates` (role `member`) | NEW-13 |
| [domain-reports-consistency.md](../2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-03 | Liability accounts (credit/loan/mortgage) balance sign | NEW-05 |
| [domain-reports-consistency.md](../2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-04 | Cash-flow family: `/reports/cashflow`, `/income`, `/savings-rate`, `/spending/trend`, `/annual`, dashboard CashFlowWidget | NEW-06 |
| [domain-reports-consistency.md](../2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-05 | Split transactions in `/reports/cashflow/budget`, `/reports/transactions`, `/reports/sankey`, transactions CSV, budget CSV | NEW-14 |
| [domain-reports-consistency.md](../2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-06 | `GET /api/transactions/summary` FX policy and cache | FIN-17 |
| [domain-reports-consistency.md](../2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-07 | `GET /api/weekly-recap` when a read model throws | OPS-006 |
| [domain-reports-consistency.md](../2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-08 | Dashboard date ranges (`useCurrentMonthRange`, `useLastNMonthsRange`, `client/src/hooks/use-reports.ts:1118-1180`, 23 call sites) | NEW-15 |
| [domain-reports-consistency.md](../2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-09 | Weekly recap window, net-worth snapshot date | NEW-31 |
| [domain-reports-consistency.md](../2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-10 | Missing-rate error shape | NEW-34 |
| [domain-reports-consistency.md](../2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-11 | Rounding / footing | NEW-34 |
| [domain-reports-consistency.md](../2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-12 | Merchant breakdown `total` | NEW-34 |
| [domain-reports-consistency.md](../2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-13 | `GET /api/accounts/summary/export`, `/api/accounts/:id/transactions/export` | NEW-32 |
| [domain-reports-consistency.md](../2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-14 | Net-worth history / changes | NEW-34 |
| [domain-reports-consistency.md](../2026-10-13-independent-readiness-fable/evidence/domain-reports-consistency.md) | RC-15 | Report CSV money format | NEW-35 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SEC-01 | `POST /api/household/invite/accept` | AH-06 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SEC-02 | Invite email link | AH-05 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SEC-03 | `PUT /api/household/members/not-a-uuid/role` | NEW-33 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SEC-04 | Timestamps (cross-cutting) | NEW-15 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | PRIV-01 | `GET /api/goals/:id/transactions`, `GET /api/goals/:id/activity`, `GET /api/goals/summary` | FIN-01 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | PRIV-02 | `GET /api/tags/:id/transactions` | ORG-002 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | PRIV-03 | `GET /api/recurring`, `/recurring/:id`, `/recurring/:id/transactions`, `/recurring/:id/history` | OPS-005 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | PRIV-04 | `PUT /api/recurring/:id` (rule on private account), `DELETE /api/goals/:goalId/transactions/:privTxnId` | FIN-01 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | PRIV-05 | Root cause (cross-cutting) | FIN-01 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | PRIV-06 | `GET /api/recurring/detect` | NEW-33 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | PRIV-07 | Export metadata exposes `recordCount: 2` (DB `data_exports.record_count=2`) to an admin whose CSV has 1 row, so it discloses that hidden rows exist. Low impact. | FIN-01 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | ISO-01 | `GET /api/goals/:id/activity` | NEW-01 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | ISO-02 | `GET /api/transactions/:id/goals`, `GET /api/recurring/:id/history`, `GET /api/recurring/:id/transactions` | NEW-33 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | ISO-03 | `GET /api/transactions/:id/attachments` (foreign id) | NEW-33 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | ISO-04 | `GET/PUT /api/merchants/undefined` (malformed id) | NEW-33 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SES-01 | `DELETE /api/settings/security/sessions/:id` and `DELETE /api/settings/security/sessions` (revoke-all) | AH-01 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SES-02 | Session list | NEW-38 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SES-03 | `DELETE /sessions/<random uuid>` | NEW-33 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SES-04 | `GET /health/ready` (unauthenticated) | NEW-39 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SES-05 | `/api/reports/*` limiter | NEW-08 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | VAL-01 | Invitation email HTML (`invitations.controller.ts:47-70`) | OPS-009 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | VAL-02 | Path ids `GET /api/{transactions,goals,accounts,budgets,recurring,tags,rules}/not-a-uuid`, `PUT /household/members/not-a-uuid/role`, `POST /transactions {accountId:"not-a-uuid"}` | NEW-33 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | VAL-03 | `POST /api/filter-presets` without `context` | NEW-33 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | VAL-04 | Far-future dates | NEW-33 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SEC-06 | `POST /api/household/transfer-ownership {newOwnerId: <caller's own id>}` | NEW-12 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SEC-07 | `PUT /api/household/members/:id/role {role:"owner"}` | NEW-12 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SEC-08 | Lockout message | NEW-08 |
| [domain-security-privacy.md](../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md) | SEC-09 | `/api/auth/*` limiter | NEW-08 |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | SET-01 | `PUT /api/settings/profile` | AH-07 |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | SET-02 | `PUT /api/settings/preferences` (Settings → Preferences section) | NEW-26 |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | SET-03 | `GET /api/settings/profile` | AH-02 |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | SET-04 | `PUT /api/settings/notifications` partial update | NEW-26 |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | SET-05 | `PUT /api/household/general` currency change with existing ledger | NEW-26 |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | SET-06 | Fiscal-year start month | Already worked in audit; preserve in R05/J03 regression |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | REC-01 | `PATCH /api/weekly-recap/settings` storage | NEW-31 |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | REC-02 | Week window | NEW-31 |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | AI-01 | `POST /api/ai/chat` fallback content | OPS-012 |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | AI-02 | Quota headers on `/api/ai/chat` | OPS-012 |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | AI-03 | Provenance / audit metadata | OPS-012 |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | AI-04 | Timestamps | NEW-15 |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | REC-03 | Recap email currency label | OPS-006 |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | REC-04 | `GET /api/weekly-recap/history` | NEW-31 |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | REC-05 | `POST /api/weekly-recap/feedback` | NEW-31 |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | NOT-01 | `GET /api/notifications/push/vapid-key` without VAPID | OPS-010 |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | NOT-02 | Quiet hours | OPS-010 |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | NOT-03 | `POST /api/cron/budget-alerts` counters | OPS-010 |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | SEC-01 | `POST /api/settings/security/email/verify` from the emailed link in a fresh browser | NEW-07 |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | SEC-02 | Email-change and password-change trail and notices | NEW-38 |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | SEC-03 | `POST /api/settings/security/mfa/enable` | AH-11 |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | SEC-04 | `GET …/security/sessions`, `/login-history` envelope | NEW-37 |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | DATA-01 | `POST /api/settings/account/export` (DPA right of access) | AH-08 |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | DEL-01 | Account deletion: other sessions | AH-01 |
| [domain-settings-notifications-ai.md](../2026-10-13-independent-readiness-fable/evidence/domain-settings-notifications-ai.md) | DEL-02 | Account deletion: PII retained | AH-08 |

## Lead findings and verification notes

All 48 individually labelled lead rows are cross-referenced below. Positive schema parity/password-reset observations are preserved as regression evidence, not newly counted defects. The blocked Playwright launch is an environment limitation; it does not represent71 failed app journeys.

| Lead ID | Topic | Closure group or positive disposition |
|---|---|---|
| F-AUTH-01 | Auth / onboarding | AH-03 |
| F-AUTH-02 | Auth / privacy | AH-02 |
| F-AUTH-03 | Auth / onboarding | AH-04 |
| F-ACC-01 | Accounts (functionality) | NEW-11 |
| F-ACC-02 | Accounts / audit | NEW-32 |
| F-HH-01 | Household (functionality) | AH-05 |
| F-ONB-01 | Onboarding | UX-01/NEW-27 |
| F-UX-01 | Login page | UX-01 |
| F-OPS-01 | Operations (functionality) | OPS-003 |
| F-OPS-02 | Operations | OPS-001/NEW-39 |
| F-OPS-03 | Operations | OPS-002 |
| F-OPS-04 | Operations | OPS-014 |
| F-OPS-05 | Operations | OPS-003 |
| F-OPS-06 | Operations | OPS-015 |
| F-OPS-07 | Operations | QA-02 |
| F-SEC-01 | Security / roles | AH-09 |
| F-SEC-02 | Security | AH-08 |
| F-SEC-03 | Security | NEW-33 |
| F-SEC-04 | Security | NEW-08 |
| F-DATA-01 | Data model | NEW-39 |
| F-DATA-02 | Data model | POSITIVE schema parity |
| F-CLIENT-01 | Client ↔ API | ORG-006 |
| F-CLIENT-02 | Client | AH-05/AH-08/AH-11/NEW-25/NEW-37/ORG-010 |
| F-TXN-01 | Transactions (functionality) | FIN-17 |
| F-TXN-02 | Transactions (functionality) | NEW-09 |
| F-TXN-03 | Transactions / privacy semantics | NEW-28 |
| F-TXN-04 | Transfers (UX) | NEW-37 |
| F-DATE-01 | Dates / timezone | NEW-15 |
| F-UX-02 | Client caching | FIN-17 |
| F-DEP-01 | Dependencies | DEP-01 |
| F-AUTH-04 | Auth / onboarding | NEW-07 |
| F-AI-01 | AI assistant | OPS-012 |
| F-E2E-01 | Verification | QA-01 (environment blocker, not71 app defects) |
| F-SEC-04b | Rate limiting | NEW-08 |
| F-REC-01 | Recurring (functionality) | NEW-10 |
| F-INV-01 | Investments (functionality) | NEW-25 |
| F-REP-01 | Reports | FIN-18 |
| F-GOAL-UX-01 | Goals | NEW-37 |
| F-HH-02 | Household / trust | AH-13 |
| F-HH-03 | Household (display) | AH-05 |
| F-CF-01 | Cash flow | NEW-34 |
| F-SEC-05 | Security settings (functionality) | AH-11 |
| F-DATE-01b | Dates / timezone | NEW-15 |
| F-AUTH-05 | Auth / recovery | POSITIVE reset journey |
| F-MOB-01 | Mobile layout (functionality) | UX-02 |
| F-SEC-04c | Rate limiting (functionality) | NEW-08 |
| F-DATE-01c | Notifications | NEW-15 |
| F-TEST-01 | Verification | OPS-011 |

Source: [Claude findings draft](../2026-10-13-independent-readiness-fable/evidence/findings-draft.md).

