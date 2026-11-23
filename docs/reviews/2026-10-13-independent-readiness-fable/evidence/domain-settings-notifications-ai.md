# Domain evidence: settings, notifications, weekly recap, AI, export, deletion (`settings-notifications-ai`)

Revision main @ 381e943. Audit server http://localhost:5055, DB `finance_app_audit_fable_20261013`. Fixtures: jar `a6` (audit_a6_settings, user `aa063752-…`, household `aaf0db38-…` "A6 Settings Household Renamed"), jar `a6del` (audit_a6_delete, user `e48f10b2-…`, household `ae8f692c-…`). Commands below assume `A="node .local/readiness-fable-2026-10-13/api.mjs"`, `Q="node .local/readiness-fable-2026-10-13/q.mjs finance_app_audit_fable_20261013"`, `MSYS_NO_PATHCONV=1`. Scratch scripts: `.local/readiness-fable-2026-10-13/scratch-settings-notifications-ai/`.

Legend: Impl = PRESENT / PARTIAL / MISSING; Verif = SRC / TEST / HTTP / DB.

## 1. Settings persistence

### Findings

| ID | Surface | Expected (source) | Observed | Impact | Sev | Conf | Impl / Verif |
|---|---|---|---|---|---|---|---|
| SET-01 | `PUT /api/settings/profile` | Every field the profile form edits persists. Client sends gender, phoneNumberMobile/Work/Home, address, occupation, nrc, socialLinks, birthdayHideYear, annualIncome, incomeFrequency, employmentStatus, investmentGoal, riskTolerance (`client/src/pages/settings/sections/ProfileSection/useProfileForm.ts:170-272`, `client/src/hooks/use-settings.ts:68-96`) | `updateProfileSchema` (`server/modules/settings/settings.validation.ts:3-12`) is a non-strict `z.object` with only fullName/firstName/lastName/displayName/birthday/timezone/language/bio, so Zod strips the rest. PUT of the full UI payload returned **200 "Profile updated successfully"**; DB read-back: `gender null, phone_number_mobile null, phone_number_work null, phone_number_home null, occupation null, nrc null, social_links null, address null, annual_income null, income_frequency null, employment_status null, investment_goal null, risk_tolerance null, birthday_hide_year false` (sent `true`). Only full/first/last/display name, birthday, timezone, bio persisted. | 14 of ~22 profile fields silently discarded with a success toast; profile-completeness widget can never reach 100 %. | **P1** | High | PARTIAL / HTTP+DB |
| SET-02 | `PUT /api/settings/preferences` (Settings → Preferences section) | Client sends **user** preferences rememberLastAccount, rememberLastCategoryPerMerchant, defaultTransactionType, autoFillTodayDate, skipDuplicateImports, autoAssignCategoriesFromRules, autoCreateFromReceipt, requireOcrReview, ocrConfidenceThreshold (`client/src/hooks/use-settings.ts:1934-1969`, `PreferencesSection/index.tsx:16-18`) into table `user_preferences` (`shared/schema.ts:454`) | Route is wired to **household** preferences (`settings.controller.ts` updatePreferences → `householdRepository.updatePreferences` with `updatePreferencesSchema` theme/dateFormat/currency/weekStartDay/…). PUT `{"rememberLastAccount":false}` and PUT `{"defaultTransactionType":"income","ocrConfidenceThreshold":50,"showPendingTransactions":false}` both **200 "Preferences updated"**; `select … from user_preferences where user_id=<a6>` → `[]` (no row ever). GET returns the household_preferences row, so the UI form reads fields that do not exist. No server route writes `user_preferences` (grep: only `household.controller.ts:59,90` read it). Side effect: `showPendingTransactions` (a household-level flag) is accepted from this user-scoped form. | Entire Preferences section is a no-op that claims success; `ReceiptDetailModal.tsx:83` always falls back to threshold 80. | **P1** | High | MISSING / HTTP+DB+SRC |
| SET-03 | `GET /api/settings/profile` | Return profile fields only (`getProfile` strips only `passwordHash`, `settings.controller.ts`) | Response includes `emailVerificationToken, emailVerificationExpiry, mfaCode, mfaCodeExpiry, mfaBackupCodes, failedLoginAttempts, lockedUntil, salaryRangeEncrypted` (keys observed in HTTP body). See SEC section for whether mfaCode/backup codes are stored hashed. | Over-exposure of security-internal columns to the client/browser cache. | P3 (downgraded: `mfaCode` and backup codes are stored hashed, `verifyHash` in `security.mfa.stepup.ts` and `hashPassword` in `security.mfa.auth.ts`; the email token is stored as SHA-256, `security.email.ts:44-47`) | High | PRESENT / HTTP+SRC |
| SET-04 | `PUT /api/settings/notifications` partial update | Omitted field = unchanged | `prefData.thresholdAmount` is forced to `null` when not sent (`settings.controller.ts` updateNotificationPreferences). PUT `budget_alert` threshold `"250.50"` → DB `250.50`; then PUT `{"preferences":[{"notificationType":"budget_alert","emailEnabled":false}]}` → DB `threshold_amount null`. The shipped UI always sends the whole array with thresholds (`NotificationsForm.tsx:63-77`), so UI users are not hit. `notificationType` is `z.string()` — any string creates a row. | API-level data loss on partial update. | P3 | High | PARTIAL / HTTP+DB |

### What works (settings)

| Surface | Evidence |
|---|---|
| `PUT /api/settings/display` all 10 fields | PUT theme dark, currency USD, locale fr-FR, timezone Europe/London, numberFormat EU, dateFormat DD/MM/YYYY, currencyPosition after, firstDayOfWeek Monday, viewMode compact, dashboardWidgets → `user_display_settings` row matches exactly (HTTP+DB). |
| `PUT /api/settings/notifications` full array | in_app/email/push toggles and thresholds read back from `user_notification_preferences` (12 types) (HTTP+DB). Audit row per pref (`logCreate/logUpdate`, SRC). |

### Household general and currency

| ID | Surface | Expected (source) | Observed | Impact | Sev | Conf | Impl / Verif |
|---|---|---|---|---|---|---|---|
| SET-05 | `PUT /api/household/general` currency change with existing ledger | A base-currency change either converts, warns, or is refused while ledger rows exist in the old currency; reports degrade with a clear error (CLAUDE.md Rule 1 "FX silent fallback": a missing rate must be a logged, surfaced error). | Household a6 has 4 ZMW transactions and no `fx_rates` rows (`select count(*) from fx_rates` → 0). `PUT {"currency":"USD"}` → **200**, no guard (`household.controller.ts` updateGeneral only checks role). Afterwards `GET /api/reports/cashflow?...` → **500 INTERNAL_ERROR "Unexpected error"** (debug "Exchange rate unavailable for ZMW -> USD") — fail-closed but as an opaque 500; `GET /api/weekly-recap` → **200 with netWorth.current 0, spending.total 0, hasData false** (before the change: 2469.75 / 150.25). Root cause for recap: `weekly-recap.service.ts:209-212` and `:262-265` catch every analytics error and return zero. Reverted to ZMW afterwards. | One click silently zeroes the recap (and the emailed recap) and turns reports into 500s; user gets no warning that the ledger is in another currency. | **P2** | High | PARTIAL / HTTP+DB+SRC |
| SET-06 | Fiscal-year start month | Persists | `PUT {"fiscalYearStartMonth":4}` → DB `fiscal_year_start_month 4` (controller-local schema `household.controller.ts:40`). Works. Role guard owner/admin present (SRC). | — | works | High | PRESENT / HTTP+DB |

### Weekly-recap settings

| ID | Surface | Expected | Observed | Impact | Sev | Conf | Impl / Verif |
|---|---|---|---|---|---|---|---|
| REC-01 | `PATCH /api/weekly-recap/settings` storage | Recap settings stored independently of unrelated display settings. | PATCH `{"enabled":true,"emailEnabled":true,"dayOfWeek":3,"includeGoals":false,"includeRecurring":false}` → 200 and GET echoes it, but storage is overloaded: `dayOfWeek` is written to `user_display_settings.first_day_of_week` (DB: `"Wednesday"`, was `"Monday"` from the display PUT), and includeGoals/includeRecurring live inside `user_display_settings.dashboard_widgets.weeklyRecap`. A subsequent `PUT /api/settings/display {"dashboardWidgets":{…}}` (what the dashboard customiser sends) removed the `weeklyRecap` key; GET recap settings then returned `includeGoals:true, includeRecurring:true` (reverted silently). | Choosing a recap day silently changes the user's calendar week start everywhere; customising dashboard widgets silently resets recap content toggles. | **P2** | High | PARTIAL / HTTP+DB |
| REC-02 | Week window | 7-day window | `getWeekDates`/`formatDate` (`weekly-recap.controller.ts:82-118`) build local-midnight Dates then format with `toISOString()` (UTC). With server TZ = Africa/Lusaka the current week came back `weekStart 2026-10-13 … weekEnd 2026-10-20` (8 calendar days, starting Tuesday although first day = Wednesday); the comparison window is from-7..from-1 (7 days). The 2026-10-13 Pick N transaction (150.25) was counted in both the recap generated on 10-13 (week 10-06..10-13, total 530.25) and the current one (150.25). On a UTC server the off-by-one disappears. | Day double-counting between consecutive recaps on non-UTC hosts. | P3 | Medium | PARTIAL / HTTP+SRC |

### What works (recap content)
Ledger (DB): initial 1000 + income 2000 − 80 − 300 − 150.25 = **2469.75**; recap netWorth.current 2469.75 ✓. Week 10-13..10-20 expense = 150.25 ✓; previous-week (10-06..10-12) = 380, so changePercent (150.25−380)/380 = **−60.46 %** ✓ (matches HTTP).

## 2. AI assistant (provider unconfigured)

| ID | Surface | Expected | Observed | Impact | Sev | Conf | Impl / Verif |
|---|---|---|---|---|---|---|---|
| AI-01 | `POST /api/ai/chat` fallback content | When the provider is unavailable the user is told so, or gets a relevant deterministic answer with an empty-state. | Replies (HTTP 200): "Hello, who are you?" → spending-by-category dump (irrelevant); "What are my goals?" (no goals) → `"Based on your financial data:\n\nYour goals:"` (empty list); "Show my upcoming bills" (none) → `"Based on your financial data:"` and nothing else. No mention that the assistant is degraded (status endpoint does say `degraded:true`). | Confusing/empty answers presented as the assistant's reply. | P2 | High | PARTIAL / HTTP |
| AI-02 | Quota headers on `/api/ai/chat` | Consistent quota semantics | `ratelimit-limit: 50`, `ratelimit-remaining: 49`, `ratelimit-reset: 86400` but `ratelimit-policy: 100;w=60` (policy advertises 100/minute while the real cap is 50/day). Body `remainingQueries: 49` is correct. | Client/proxy reading the policy header is misled. | P3 | High | PARTIAL / HTTP |
| AI-03 | Provenance / audit metadata | Accurate | Fallback for "this month" spending reports `provenance.dataWindow {start:"2026-10-13", end:"2026-10-13"}` (a single day) while the figure (530.25 = 80+300+150.25) is month-to-date; audit row records `token_count: 41` although `used_gemini:false, provider_attempted:false` (no tokens were consumed). | Misleading compliance/provenance metadata. | P3 | Medium | PARTIAL / HTTP+DB |
| AI-04 | Timestamps | Consistent UTC | Conversation list: `createdAt "2026-10-14T00:20:25.845Z"` vs `updatedAt "2026-10-13T22:20:25.851Z"` for the same write (createdAt is local wall-clock mislabelled `Z`, +2 h in the future). Same pattern on `households` (`createdAt 22:58Z` > `updatedAt 20:58Z`). Likely `timestamp without time zone` columns with mixed `defaultNow()` vs JS `new Date()` writers. | Ordering/"x minutes ago" glitches; cross-cutting. | P3 | Medium | PARTIAL / HTTP |

### What works (AI)

| Check | Evidence |
|---|---|
| Status | `GET /api/ai/status` → 200 `{available:true, degraded:true, rateLimit:{remaining:50,…}}` |
| Consent gate | Chat before consent → **403 FORBIDDEN "AI features require consent…"**; `POST /api/ai/consent {"consentGiven":true}` (owner) → 200; DB `ai_consent_given true, ai_consent_version v1.0`; `ai_consent` audit row written. Route guarded `requireRole('admin')` (`ai.routes.ts:64`, SRC). |
| Fallback figures | Groceries month-to-date ZMW 530.25 = hand sum of the 3 expense rows ✓ |
| Conversation persistence | Chat created conversation `7ced902b…` with 2 messages in `ai_conversations`/`ai_messages`; list and get return it; `DELETE` → 204; get → 404; `ai_messages` for it → 0 rows (hard delete, cascades). Unknown id → 404. |
| `ai_query` audit row | `audit_logs` CREATE `ai_query` with query, tools_used, response_summary, `used_gemini:false`, `provider_attempted:false`, `data_sanitized:true`. |
| Sanitiser coverage (SRC) | `ai.sanitizer.ts:386-449` registers all 12 tools; `ai.service.ts:546-560` fails closed (data withheld, `sanitized:false`) for any tool without a sanitiser; `dataSanitized` is derived from per-tool results (`ai.service.ts:180,261,325,339`), not hardcoded. |

Not exercised: the real-provider path and provider-failure fallback with a configured key (no external AI calls allowed).

## 3. Weekly recap: endpoints and email

| ID | Surface | Expected | Observed | Impact | Sev | Conf | Impl / Verif |
|---|---|---|---|---|---|---|---|
| REC-03 | Recap email currency label | Amounts labelled in the ledger/household currency | `sendWeeklyRecapEmail` uses `user_display_settings.currency` (`weekly-recap.email.service.ts` "Get user settings for currency") — a6's display currency is USD while the household and every transaction are ZMW. Email delivered to the sink rendered `Spending $80.00 / Groceries $80.00` (the 80.00 is ZMW, unconverted). | Financial digest shows wrong currency symbol on unconverted figures. | **P2** | High | PARTIAL / sink+DB |
| REC-04 | `GET /api/weekly-recap/history` | Per-week historical figures | 8 weeks returned (computed live, nothing persisted). `netWorth.current` = 2469.75 for **every** week back to 2026-08-19, although the 2000 income was booked 2026-10-12 (ledger-derived net worth before 10-06 would be 1000). Windows are 8 days and overlap (`2026-10-07..10-14`, `2026-09-30..10-07`). Spending per window matches the ledger (450.25 = 300+150.25; 80 = Spar). | History shows constant current net worth, change always 0. | P2 | Medium | PARTIAL / HTTP+DB |
| REC-05 | `POST /api/weekly-recap/feedback` | Persisted for analytics | 200 `{recorded:true}`; stored only as a logger line plus an `audit_logs` row (`entityType "user"`, `details.action weekly_recap_feedback`) — comment in code: "could store in DB for analytics later". | Feature is log-only. | P3 | High | PARTIAL / HTTP+SRC |

What works:

| Check | Evidence |
|---|---|
| `POST /api/weekly-recap/generate {"weekOf":"2026-10-07"}` | 200, spending 530.25 = 80+300+150.25 ✓; `audit_logs` row `weekly_recap_generated`. |
| Email sent when `emailEnabled` true + consent | Ran the real batch `processWeeklyRecapEmails(1)` (tsx script `scratch…/recap-batch.ts` with the audit-server env, audit DB + sink) → `{"sent":1,"failed":0,"skipped":0}`; message to `audit-a6@audit.invalid`, subject "Your Weekly Financial Recap (2026-10-04 to 2026-10-10)"; `audit_logs` `PROCESS data_export` egress row written. (Only a6 was eligible: checked beforehand that no other audit user had recap email enabled.) Note: net worth showed $0.00 in this run because the standalone script does not call `setGlobalFXService()` ("FX service not initialized"); this is a harness artefact, not counted as a finding, but it demonstrates that any analytics error yields a silent $0 net worth (SET-05 mechanism). |
| NOT sent when `emailEnabled` false | PATCH `{"emailEnabled":false}` → batch `{"sent":0,"failed":0,"skipped":0}`, sink byte count unchanged (77526 → 77526). |
| DPA consent gate | Consent revoked + emailEnabled true → batch `{"sent":0,"failed":0,"skipped":1}`, sink unchanged; consent restored afterwards. |
| Trigger | Only `node-cron` `0 9 * * 1` in `server/scheduler.ts:148` wrapped in a Redis lock; no HTTP cron door for recap. |

## 4. Notifications

| ID | Surface | Expected | Observed | Impact | Sev | Conf | Impl / Verif |
|---|---|---|---|---|---|---|---|
| NOT-01 | `GET /api/notifications/push/vapid-key` without VAPID | Graceful "not configured" (503/404 + message) | **500 INTERNAL_ERROR** "An internal error occurred" (`notifications.controller.ts:410-414` throws a plain `Error`). Push settings UI (`PushNotificationSetup.tsx:77`) gets a generic failure. | Misleading error, noise in error monitoring. | P3 | High | PARTIAL / HTTP |
| NOT-02 | Quiet hours | Configurable if enforced | Table `user_quiet_hours` exists and is read by `server/services/notification/service.ts:412-427`, but no route or client screen writes it (grep: only schema + service). | Quiet hours can never be enabled; dead feature (not advertised in UI, so no false claim). | P3 | High | MISSING / SRC |
| NOT-03 | `POST /api/cron/budget-alerts` counters | Report what was created | Second run reported `notificationsSent: 2` although dedupe created no new row. | Misleading ops metric. | P3 | High | PARTIAL / HTTP+DB |

What works:

| Check | Evidence |
|---|---|
| Trigger + row | Created budget "Groceries Budget" 100.00 ZMW on Groceries (spent 530.25) → `POST /api/cron/budget-alerts` → one `notifications` row: type `budget_exceeded`, body "You are at 530% of your budget" (530.25/100 ✓), dedupe_key `budget:<id>:2026-10:exceeded:user:<uid>`. |
| Dedupe | Second cron run → still exactly 1 row for a6. |
| List / unread / read | list shows it; unread-count 1 → `PUT /:id/read` → 0; `PUT /read-all` → `Marked 0`; `PUT /batch-read {"notificationIds":[…]}` → 200 count 1 (body key must be `notificationIds`; `ids` → 400); `DELETE /batch-archive` → DB `is_archived true`, list `[]`. |
| Cross-user isolation | Another household's owner (`a5owner`) GET / PUT read / DELETE on a6's notification id → **404** each; row unchanged. |
| Push subscribe (no VAPID) | `POST /push/subscribe {"subscription":{endpoint,keys}}` → 200 saved; unsubscribe → 200; malformed (no `subscription` wrapper) → 400. Audit stores only an endpoint hash (SRC). |
| Investment notification prefs | `PUT /api/investments/notifications/preferences {maturity_reminder, inApp false, email false, push true, threshold 500}` → DB matches (`500.00`). |
| Report widgets | `PATCH /api/settings/report-widgets` (coreWidgets.cashFlow, customCharts, hasCompletedWidgetSetup) → `user_display_settings.report_widget_preferences` matches; merge keeps untouched widgets. |

## 5. Security settings (email, password, MFA, sessions)

| ID | Surface | Expected | Observed | Impact | Sev | Conf | Impl / Verif |
|---|---|---|---|---|---|---|---|
| SEC-01 | `POST /api/settings/security/email/verify` from the emailed link in a fresh browser | The link (`http://localhost:5055/verify-email?token=…`) works on any device; the route is deliberately mounted before `requireAuth` (`server/routes/security.ts:35-39`). | Fresh cookie jar (api.mjs fetches `/api/csrf-token` first, like the client `apiCall`) → **403 CSRF_INVALID "Invalid or expired security token"**. Same token from the logged-in a6 session → 200 "Email address updated successfully"; DB `email audit-a6-new@audit.invalid, pending_email null`. Anonymous `POST /email/change` also gets 403 CSRF_INVALID. | Email change only completes if the link is opened in the same logged-in browser. | **P2** | High | PARTIAL / HTTP+DB |
| SEC-02 | Email-change and password-change trail and notices | Security-relevant changes audit-logged and the user notified (pref `password_changed` email=true exists). | Email change: no `audit_logs` row, no `security_audit_logs` event (latest stayed `MFA_VERIFIED, LOGIN_SUCCESS, REGISTER`); one mail only, to the NEW address; no notice to the old address. Password change: `audit_logs` `{action:"password_change", otherSessionsRevoked:true}` present, but no `security_audit_logs` event, no notification row, no email in the sink. | Account-takeover steps leave no trail and no alert to the owner. | **P2** | High | PARTIAL / DB+sink |
| SEC-03 | `POST /api/settings/security/mfa/enable` | Enabling a factor proves channel possession and/or requires step-up. | One call, no step-up, no code check → 200 with 8 backup codes; `mfa/status` `mfaEnabled:true, backupCodesRemaining:8`; `MFA_ENABLED` logged. Disable needs only the password (→ 200, `MFA_DISABLED` logged). | Wrong/unreachable email can lock the user out; hijacked session can toggle MFA with the password. | P3 | High | PARTIAL / HTTP+DB+SRC |
| SEC-04 | `GET …/security/sessions`, `/login-history` envelope | V7 `{success, data}` (CLAUDE.md Rule 6) | Body `{"data":{"sessions":[…]}}`, no `success` field. | Contract drift. | P3 | High | PARTIAL / HTTP |

What works: password change is gated (`PUT /password` without step-up → **401 STEP_UP_REQUIRED level SETTINGS**; after `POST /step-up {password}` → 200 `expiresIn 900` → change 200, current session survives; other-session revocation in the same transaction, SRC). Login-history export → 200 attachment `login-history-2026-10-13.json` (2 records) **and** an `audit_logs` `data_export` row `exportType login_history`. Sessions list returns the current session. The a6 test password after this change is in `scratch-settings-notifications-ai/a6-test-password.txt`.

Not exercised: MFA login code via the sink (needs a fresh `/api/auth/*` login, excluded by the limiter rule) and step-up via MFA code.

## 6. Profile picture and banner uploads (all works: HTTP + disk + DB)

| Check | Evidence |
|---|---|
| Extension from mimetype | PNG bytes named `x.html` sent as `image/png` → stored `/uploads/profile-pictures/<hh>/1e2a21a3-….png`. |
| Type allow-list | `text/html` part → 400 "Invalid file type… Allowed types: image/jpeg, image/png, image/gif, image/webp". |
| `/uploads` auth | owner GET → 200 `image/png` + `nosniff`; anonymous → **401**; other household's owner (`a5owner`) → **403**. |
| Replace/delete clean disk | Second upload leaves only the new file; `DELETE /profile/picture` → dir empty, `profile_picture_url null`. Banner upload created `uploads/banners/<hh>/ba84….png`; DELETE → file gone, `banner_url null`, audit row `banner_delete`. |

## 7. Data export and account deletion

| ID | Surface | Expected | Observed | Impact | Sev | Conf | Impl / Verif |
|---|---|---|---|---|---|---|---|
| DATA-01 | `POST /api/settings/account/export` (DPA right of access) | Produce a downloadable export, record it (`dataExports`, CLAUDE.md schema anchors), audit it. | Stub: `settings.account.controller.ts` `exportData` only calls `findById` and returns `{exportId: "export_" + Date.now()}`. HTTP (after step-up) → 200 `{"exportId":"export_1791930753980"}` "Data export initiated"; `data_exports` rows for a6 → **0**; no new `audit_logs` row; no file; no email. No UI calls it; `client/src/hooks/use-finance-data.ts:829-835` `useDataManagement().exportData` returns `JSON.stringify({})`. | A data subject cannot obtain their data while the API claims an export started. | **P1** | High | MISSING / HTTP+DB+SRC |
| DEL-01 | Account deletion: other sessions | All of the user's sessions die. | After delete the **current** cookie is dead (GET profile → 401) and `user_sessions` → 0, but the express `session` store still holds sid `whWiqB2L…` with `sess.userId = e48f10b2…` (expires 2026-11-12) from an earlier login. `eraseAccount` deletes `userSessions` only (`settings.account-deletion.service.ts:319`) and never runs the `DELETE FROM "session" WHERE sess->>'userId' = …` that `server/services/session-revocation.ts:48,62` already provides. Because the `users` row is kept as a tombstone, `requireAuth` (`server/auth.ts:20-60`, only checks the user row exists) would accept that cookie. | Another device or stolen cookie stays authenticated after erasure. | **P1** | Medium-High (leftover cookie not available to replay; DB+SRC) | PARTIAL / DB+SRC |
| DEL-02 | Account deletion: PII retained | PII removed/pseudonymised unless a stated legal basis retains it. | `security_audit_logs` REGISTER row keeps `details {"email":"audit-a6-delete@audit.invalid"}` and IP `127.0.0.1` on 3 rows; the `users` tombstone keeps a non-null `password_hash`. No document states a retention basis. | Raw email and IPs survive "Account permanently deleted". | **P1** (P2 if a documented legal basis is adopted and the email pseudonymised) | High | PARTIAL / DB |

Deletion, removed vs retained (a6del: 1 account, 2 transactions, profile picture, 1 transaction attachment; single-member household):

| Object | Before | After |
|---|---|---|
| step-up gate | without step-up → 401 STEP_UP_REQUIRED level DESTRUCTIVE | after password step-up → 200 "Account permanently deleted" |
| `users` | row | tombstone: username/email → `deleted_<uuid>@deleted.invalid`; names/bio/birthday/phones/nrc/address/picture null; tz UTC; `email_verified false`; **password_hash kept** |
| `households` / `household_members` | 1 / 1 | 0 / 0 |
| `accounts` / `transactions` / `transaction_attachments` | 1 / 2 / 1 | 0 / 0 / 0 |
| `audit_logs` by user / by household | 6 / 6 | 1 (`DELETE user_account`, right_to_erasure, householdId null) / 0 (prior household audit rows deleted) |
| `security_audit_logs` | 2 | 3 (REGISTER with raw email, LOGIN_SUCCESS, MFA_VERIFIED) |
| `user_sessions` / `session` store | 2 / 2 | 0 / **1** |
| files on disk | picture + attachment | 0 files (empty dirs remain) |

Deleting the household's own `audit_logs` history on erasure is itself a retention decision to confirm against Zambia DPA guidance.

## 8. Filter presets (all works: HTTP+DB)

Create → 201; a second `isDefault:true` preset in the same context flips the first to `is_default false`; `GET /default/transactions` returns the current default; duplicate name in the same context → **409 CONFLICT** (unique index `filter_presets_name_unique_per_scope`, `shared/schema.ts:973`); PATCH rename + make default swaps defaults; DELETE → 204; another household's owner GET/DELETE → 404, row survives. Cosmetic P3: doubled NotFound messages ("Filter preset not found not found", "Conversation not found not found").

## 9. State left in the audit DB by this agent

a6: email `audit-a6-new@audit.invalid`; password changed (scratch file); display currency USD, locale fr-FR, first day Wednesday; AI consent true; recap email enabled; budget "Groceries Budget" (100 ZMW); one archived notification; filter preset "Big spends v2". a6del: erased.

## 10. Severity roll-up

| Sev | IDs |
|---|---|
| P1 | SET-01 profile fields dropped; SET-02 Preferences section no-op; DATA-01 export stub; DEL-01 sessions survive erasure; DEL-02 PII retained after erasure |
| P2 | SET-05 unguarded currency change → recap silently zero, reports 500; REC-01 recap settings overwrite week start / wiped by widget save; REC-03 recap email wrong currency symbol; REC-04 history net worth constant; AI-01 empty/irrelevant fallback replies; SEC-01 verify link fails outside logged-in browser; SEC-02 no audit/alert for email or password change |
| P3 | SET-03, SET-04, REC-02, REC-05, AI-02, AI-03, AI-04, NOT-01, NOT-02, NOT-03, SEC-03, SEC-04, doubled NotFound messages |
