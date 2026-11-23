<!-- Subagent inventory report saved verbatim by the lead (bold markers removed). Source: code-explorer agent, read-only, 2026-10-13, HEAD 381e943. -->

## SERVER SURFACE INVENTORY

Notation:
- RA = `requireAuth` (`server/auth.ts:20`): session userId present, user row exists, sets `req.user`. 401 if not.
- HG = `householdGuard` (`server/middleware/householdGuard.ts:41`): 401 if no `session.userId`, 404 `HOUSEHOLD_NOT_FOUND` if no household, 403 if not a member. Sets `req.householdContext`. Does NOT check the user row exists and does NOT set `req.user`.
- RR(x) = `requireRole(x)` (`middleware/validateEntity.ts:263`; hierarchy owner > admin > member > view_only). Needs HG first (500 otherwise). Endpoints without RR are readable and, where noted, writable by `view_only`.
- G = `generalLimiter` (100/min, user-or-IP key). A30 = `analyticsLimiter` (30/min). X10 = `expensiveAnalyticsLimiter` (10/min). S5 = `strictLimiter` (5/min, IP key). AU10 = `authLimiter` (10/min). IP5 = `ipAuthLimiter` (5/min, IP key). U20h = `uploadLimiter` (20/hour). Defined in `middleware/rateLimit.ts:148-240`. All skipped when NODE_ENV=test. Redis store when `REDIS_URL` is set, otherwise in-memory (`rateLimit.ts:42-66`).
- Z = a Zod `safeParse` or `.parse` appears in the handler. A = a `businessAuditService`/`auditService` call appears in the handler. A(s) = audit lives in the service layer (file-level grep). `-` = none found in the handler. Z/A come from a regex scan per handler; "-" on A means "not in the handler", not "provably unaudited".
- Unless the "Lim" column says otherwise, every `/api/*` route also passes the global G (`routes.ts:95`).

## 1. Mount table (registration order)

`server/app.ts` (before routes): trust proxy `app.ts:37-51` (`TRUST_PROXY`; defaults to 1 hop in production); helmet `app.ts:56` (CSP and HSTS only in production); cors `app.ts:112` (origin `CLIENT_URL` or `http://localhost:5000`, credentials true); json/urlencoded `app.ts:132,139` (default 100kb limit); session `app.ts:147` (connect-pg-simple); sessionSanity `app.ts:167`; cookieParser `app.ts:170`; CSRF `app.ts:195`; attachUser `app.ts:219`; requestId `app.ts:222`; `GET /uploads/*` `app.ts:229` (RA, HG, `serveUpload`, no limiter); request logger `app.ts:231`.

`server/routes.ts` (`registerRoutes`):

| # | Base path | file:line | Mount-time middleware |
|---|---|---|---|
| 1 | `/health` | `routes.ts:77` → `modules/health/health.routes.ts` | G; no auth |
| 2 | `GET /api/csrf-token` | `routes.ts:80` | none (registered BEFORE the limiter, so no rate limit) |
| 3 | `GET /api/health/routes` | `routes.ts:86` | none: no auth, no limiter |
| 4 | `/api` | `routes.ts:95` | `generalLimiter` (global) |
| 5 | `/api` | `routes.ts:99` | `legacyApiRedirect`: only sets Deprecation/Sunset/Link headers |
| 6 | `/api/v1` | `routes.ts:103` | Dead alias (see F1) |
| 7 | `/api/auth` | `routes.ts:112` | IP5, then AU10, then authRoutes |
| 8 | `/api/settings/security` | `routes.ts:115` | securityRoutes (G + RA inside, except `/email/verify`) |
| 9 | `/api/settings` | `routes.ts:118` | settings router: G, RA |
| 10 | `/api/household` | `routes.ts:121` | RA, G |
| 11 | `/api/accounts` | `routes.ts:124` | HG |
| 12 | `/api/import` | `routes.ts:127` | RA, HG, U20h |
| 13 | `/api/categories` | `routes.ts:130` | HG, G |
| 14 | `/api/merchants` | `routes.ts:133` | G, HG |
| 15 | `/api/tags` | `routes.ts:136` | HG, G |
| 16 | `/api/rules` | `routes.ts:139` | G, HG |
| 17 | `/api/reports` | `routes.ts:142` | A30 at mount, then HG, then A30 again |
| 18 | `/api/transactions` | `routes.ts:145` | HG, G |
| 19 | `/api/budgets` | `routes.ts:148` | HG, G |
| 20 | `/api/goals` | `routes.ts:151` | HG, G |
| 21 | `/api/recurring` | `routes.ts:154` | HG, G |
| 22 | `/api/receipts` | `routes.ts:157` | RA, HG, G |
| 23 | `/api/notifications` | `routes.ts:160` | RA (no HG) |
| 24 | `/api/investments/notifications` | `routes.ts:163` | RA, G (no HG) |
| 25 | `/api/investments/tax` | `routes.ts:164` | RA, HG, A30 |
| 26 | `/api/investments/pension` | `routes.ts:165` | RA, G, HG |
| 27 | `/api/investments/recurring` | `routes.ts:166` | RA, G, HG |
| 28 | `/api/investments/market` | `routes.ts:167` | A30 |
| 29 | `/api/investments/grz/calculate` | `routes.ts:168` | RA, G, HG |
| 30 | `/api/investments/grz` | `routes.ts:169` | RA, G, HG |
| 31 | `/api/investments` | `routes.ts:172` | HG, G |
| 32 | `/api/grz` | `routes.ts:175` | RA, G, HG |
| 33 | `/api/investments/analytics` | `routes.ts:178` | RA, A30, HG |
| 34 | `/api/weekly-recap` | `routes.ts:181` | A30 at mount, then RA |
| 35 | `/api/ai` | `routes.ts:184` | RA, HG (custom per-household cap) |
| 36 | `/api/filter-presets` | `routes.ts:187` | HG; global G only |
| 37 | `/api/cron` | `routes.ts:190` | S5, then `verifyCronSecret` |
| 38 | `/api/admin` | `routes.ts:193` | G, RA, `requireAnySystemRole()` |

After routes (`app.ts`): `GET /healthz` (`app.ts:256`): no auth, no limiter. `apiErrorMiddleware` (`app.ts:265`), fallback error handler (`app.ts:268`). Then `setup(app)`: dev (`index-dev.ts:36-70`) Vite middleware plus a catch-all that skips `/api/`; prod (`index-prod.ts:15-20`) `express.static(dist/public)` plus `app.use("*")` returning index.html, so unknown `/api/*` paths return the HTML SPA with 200 in prod.

Unmounted code: `modules/auth/auth.routes.v1.ts` is imported nowhere. Google OAuth (`auth/strategies/oauth.google.ts`), `webauthn.ts` and `magic-link.ts` have no mounted routes.

## 2. Endpoint table

### /api/auth (`modules/auth/auth.routes.ts`; IP5 + AU10 at mount)
CSRF exempt (`app.ts:203-211`): login, mfa/verify, mfa/resend, resend-verification, forgot-password, reset-password, register, logout. Audit goes through the auth services (A(s)).

| Endpoint | Line | Guards | Lim | Z | A |
|---|---|---|---|---|---|
| POST /register | :20 | public | AU10 | Z | A(s) |
| POST /login | :21 | public | AU10 | Z | A(s) |
| POST /mfa/verify | :22 | public | AU10 | Z | A(s) |
| POST /mfa/resend | :23 | public | AU10 | - | A(s) |
| POST /verify-email | :24 | public | AU10 | Z | A(s) |
| POST /resend-verification | :25 | public | AU10 | Z | A(s) |
| POST /forgot-password | :32 | public | S5 | Z | A(s) |
| POST /reset-password | :37 | public | S5 | Z | A(s) |
| POST /logout | :40 | RA | | - | A(s) |
| GET /me | :41 | RA | | - | - |

### /api/settings/security (`routes/security.ts`; G ×2, RA)

| Endpoint | Line | Guards | Lim | Z | A |
|---|---|---|---|---|---|
| POST /email/verify | `security.email.ts:32` | NO auth (token-based) | S5 | Z | - |
| POST /email/change | :111 | RA | | Z | - |
| POST /email/resend | :219 | RA | | - | - |
| POST /email/cancel | :273 | RA | | - | - |
| GET / | `security.ts:42` | RA | | - | - |
| PUT /password | `security.ts:94` | RA, step-up SETTINGS | | Z | A |
| GET /sessions | `security.sessions.ts:27` | RA | | - | - |
| DELETE /sessions/:id | :64 | RA, step-up SETTINGS | | - | A |
| DELETE /sessions | :103 | RA, step-up SETTINGS | | - | A |
| GET /sessions/login-history | :143 | RA | | - | - |
| GET /sessions/login-history/export | :186 | RA | | - | A |
| GET /login-history | `security.ts:104` | RA (forwards) | | - | - |
| POST /mfa/enable | `security.mfa.auth.ts:34` | RA | S5 | Z | A |
| POST /mfa/disable | :86 | RA | S5 | Z | A |
| GET /mfa/status | :146 | RA | S5 | - | - |
| POST /mfa/send-code | `security.mfa.login.ts:42` | RA (deprecated) | S5 | Z | - |
| POST /mfa/verify-code | :114 | RA (deprecated) | S5 | Z | - |
| POST /mfa/verify-backup | :201 | RA (deprecated) | S5 | Z | - |
| POST /mfa/step-up | `security.mfa.stepup.ts:39` | RA | S5 + AU10 | Z | A |
| GET /mfa/step-up/status | :210 | RA | S5 | - | - |
| POST /step-up | `security.ts:113` | alias | S5 | Z | A |
| GET /step-up/status | `security.ts:118` | alias | S5 | - | - |

### /api/settings (`modules/settings/settings.routes.ts`; G, RA)

| Endpoint | Line | Guards | Lim | Z | A |
|---|---|---|---|---|---|
| GET/PATCH /report-widgets | `settings.report-widgets.ts:49,119` | RA | | PATCH Z | PATCH A |
| GET /profile | :39 | RA | | - | - |
| PUT /profile | :40 | RA | | Z | A |
| POST /profile/picture | :44 | RA, HG | U20h | - | A |
| DELETE /profile/picture | :51 | RA, HG | | - | A |
| POST /profile/banner | :59 | RA, HG | U20h | - | A |
| DELETE /profile/banner | :66 | RA, HG | | - | A |
| GET /display | :75 | RA | | - | - |
| PUT /display | :76 | RA | | Z | A |
| POST /account/delete | :90 | RA, step-up DESTRUCTIVE | | - | A(s) (`settings.account-deletion.service.ts:35`) |
| POST /account/export | :95 | RA, step-up SETTINGS | | - | - (handler is a placeholder returning a fake `exportId`, `settings.account.controller.ts:92-98`) |
| GET /notifications | :104 | RA | | - | - |
| PUT /notifications | :105 | RA | | Z | A |
| GET /preferences | :110 | RA, HG | | - | - |
| PUT /preferences | :111 | RA, HG | | Z | A |

### /api/household (`household.routes.ts`; RA, G; NO HG, controllers resolve membership themselves)

GET /general :15 (-, -); POST / :16 (Z, A); PUT /general :17 (Z, A); GET /members :20; PUT /members/:userId/role :21 (Z, A); DELETE /members/:userId :22 (A); POST /invite :25 (Z, A); POST /invite/accept :26 (Z, A); POST /invitations/:inviteId/resend :27 (A); GET /invitations :28; DELETE /invitations/:inviteId :29 (A); POST /transfer-ownership :32 (Z, A); POST /leave :33 (A).

### HG-scoped finance modules ("RR m" = `requireRole("member")`)

/api/accounts (`accounts.routes.ts`; HG at :24): GET / :30 (G, Z); GET /summary :31 (A30); GET /summary/export :36 (A30, no audit in handler); GET /summary/history :41 (A30, Z); GET /net-worth/history :47 (A30, Z); GET /:id :57 (G); POST / :58 (RR m, Z, A); PUT /:id :64 (RR m, Z, A); DELETE /:id :70 (RR m, step-up DESTRUCTIVE, A); POST /:id/adjust-balance :82 (RR m, Z, A); POST /:id/archive :88 (A); POST /:id/unarchive :94 (A); GET /:id/balance-history :105 (A30, Z); GET /:id/balance-history/export :110 (A30, no audit in handler); POST /:id/balance-history/import :115 (U20h, RR m, Z, A(s) via `AccountImportService`); GET /:id/transactions/export :126 (A30, Z, A(s) `AccountExportService`); POST /:id/transactions/import :131 (U20h, RR m, Z, A(s)); PATCH /:id/settings :142 (RR m, Z, A).

/api/categories (`categories.routes.ts`; HG, G): POST /seed :21 (RR admin, A); PUT /reorder :24 (Z, A); GET /groups :31; POST /groups :32 (Z, A); PUT /groups/reorder :33 (Z, A); PUT /groups/:id :38 (Z, A); DELETE /groups/:id :43 (A); PUT /groups/:id/restore :48 (A); GET / :55; GET /:id :56; POST / :57 (Z, A); PUT /:id :58 (Z, A); DELETE /:id :59 (A); PATCH /:id/archive :64 (A); PUT /:id/restore :69 (A).

/api/merchants (`merchants.routes.ts`; G, HG): GET / :15; GET /autocomplete :16; GET /duplicates :17; GET /merge/history :18; POST /merge/:historyId/undo :19 (RR m, Z, A); POST /seed :20 (RR m, no Z, no A); POST /merge :21 (Z, A); POST /:sourceId/merge :22 (Z, A); GET /:id :23; POST / :24 (Z, A); PUT /:id :25 (Z, A); DELETE /:id :26 (A).

/api/tags (`tags.routes.ts`; HG, G): GET /analytics :16; GET /suggest :19; POST /merge :22 (RR m, A); POST /defaults :25 (A); GET / :28; GET /:id :29; POST / :30 (Z, A); PUT /:id :31 (Z, A); DELETE /:id :32 (A); POST /:id/archive :35 (A); GET /:id/transactions :38 (Z); GET /transaction/:transactionId :41; POST /transaction/:transactionId :42 (Z, A); PUT /transaction/:transactionId :47 (Z, A); DELETE /transaction/:transactionId/:tagId :52 (A).

/api/rules (`rules.routes.ts`; G, HG): GET / :15; PUT /reorder :16 (RR m, no Z: `req.body.rules` only `Array.isArray`-checked, `rules.controller.ts:207-216`; A); POST /bulk-enable :17 (Z, A); POST /bulk-disable :18 (Z, A); POST /preview :20 (A30, Z); POST /:id/dry-run :21 (RR m, no Z, no A); GET /:id :22; POST / :23 (Z, A); PUT /:id :24 (Z, A); DELETE /:id :25 (A).

/api/reports (`reports.routes.ts`; HG; A30 ×2; no RR on anything): GET /annual :35; /cashflow :40; /cashflow/budget :41; /income :42; /savings-rate :43; /spending/breakdown :48; /spending/trend :52; /net-worth :57; /net-worth/changes :58; /sankey :63 (X10); /ratios :68; /financial-ratios :69; /debt :70; /forecast :72 (X10); /transactions :81; /expenses/classification :82; /goals/progress :86; /spending/subcategory :87; GET /custom :92 (X10); POST /custom :97 (X10); GET /exports :106; POST /exports :107 (Z, A; `reports.exports.controller.ts:38`); GET /exports/:id :108. All report handlers have Z on query. `downloadExport` (`reports.exports.controller.ts:100`) is called from `getExport` at :91.

/api/transactions (`transactions.routes.ts`; HG at :42, G at :45): GET / :55 (validateEntity, Z); GET /summary :65 (Z); GET /:id :71; GET /:id/goals :77; POST / :83 (RR m, validateEntity, Z, A); POST /transfer :99 (RR m, step-up FINANCIAL, Z, A); PUT /transfer/:id :115 (same); PUT /bulk-owner :131 (Z, A); PUT /bulk-category :141 (no Z, hand-checked; A); PUT /bulk-tags :151 (no Z, A); PUT /bulk-review :161 (no Z, A); DELETE /bulk :171 (no Z, A); PUT /:id :181 (Z, A); DELETE /:id :192 (A); PUT /:id/owner :202 (Z, A); PUT /:id/review :212 (Z, A); POST /:id/attachments :258 (RR m, multer disk to `uploads/temp`, no U20h, no Z, no A); GET /:id/attachments :269; GET /:id/attachments/:attachmentId/download :278; DELETE /:id/attachments/:attachmentId :287 (RR m, no A). Bulk edits and deletes of up to 100 transactions have no step-up.

/api/budgets (`budgets.routes.ts`; HG, G): GET / :26 (Z); GET /progress :27 (Z); GET /alerts :28 (Z); GET /settings :29; GET /forecast :30 (A30, Z); POST / :35 (Z, A); PUT /settings :36 (Z, no A); POST /recalculate :41 (Z, A); POST /clear :46 (Z, A); POST /move :47 (Z, A); PUT /forecast/:id :48 (Z, A); GET /:id :57; PUT /:id :58 (Z, A); DELETE /:id :59 (A).

/api/goals (`goals.routes.ts`; HG, G): GET /summary :33; GET /images :34; POST /images :35 (RR m, multer memory, no U20h, no Z, no A); GET /available-funds :41 (A30); GET /assignments :42 (A30); GET /transfers :43; POST /transfers :44 (Z, A); POST /debt-strategy :49 (Z); POST /calculate-projection :54 (Z); GET / :64 (Z); POST / :65 (Z, A); GET /:id :66; PUT /:id :67 (Z, A); DELETE /:id :68 (A); POST /:id/complete :73 (A); POST /:id/archive :78 (A); POST /:id/unarchive :83 (A); GET /:id/assignments :93; POST /:id/assign-account :94 (Z, A); PUT /:id/accounts/:accountId :99 (Z, A); DELETE /:id/accounts/:accountId :104 (A); GET /:id/transfers :114; GET /:id/transactions :115; GET /:id/projection :116; GET /:id/contributions :117; POST /:id/contribute :118 (Z, A); POST /:id/transactions :123 (Z, A); DELETE /:id/transactions/:txId :128 (A); GET /:id/payoff-scenarios :133; POST /:id/calculate-payoff :134 (Z); GET /:id/activity :144.

/api/recurring (`recurring.routes.ts`; HG, G): GET / :26 (Z); GET /upcoming :27 (Z); GET /summary :28 (A30); POST /process :33 (A30, RR m, Z, A); POST /detect :43 (A30, Z); POST /confirm :49 (Z, A); POST / :58 (Z, A); GET /:id :63; PUT /:id :64 (Z, A); DELETE /:id :65 (A); GET /:id/history :66 (Z); GET /:id/transactions :67; POST /:id/skip :72 (A); POST /:id/pause :73 (A); POST /:id/resume :74 (A); POST /:id/end :75 (Z, A); POST /:id/link :80 (Z, A); DELETE /:id/link/:linkId :85 (A); POST /transaction :94 (Z, A); POST /transaction/:transactionId :99 (Z, A).

/api/investments (`investments.routes.ts`; HG, G): GET /securities :26 (Z); GET /securities/:id :27; GET /securities/:id/prices :28 (Z); POST /securities :29 (RR m, Z, A); PUT /securities/:id/price :34 (Z, A); GET /holdings :43 (Z); GET /holdings/:id :44; POST /holdings :45 (Z, A); PUT /holdings/:id :50 (Z, A); DELETE /holdings/:id :55 (A); GET /portfolio :64 (A30); GET /portfolio/summary :69 (A30); GET /portfolio/allocation :74 (A30); GET /performance :79 (A30); GET /transactions :88 (Z); GET /tax-lots :89 (Z); POST /transactions :90 (Z, A); GET /fx-rates :99 (Z); POST /fx-rates :100 (Z, A); GET /analytics/fx-historical :105 (A30, Z).

/api/receipts (`receipts.routes.ts`; RA, HG, G): GET /:id/thumbnail :26; GET /:id/ocr-image :27; GET / :30 (Z); GET /:id :31; POST /upload :34 (RR m, U20h, multer memory 10MB, no Z, A); POST /:id/match :43 (Z, A); POST /:id/ocr-results :44 (Z, A); POST /:id/retry-match :45 (no Z, no A); POST /:id/create-transaction :46 (Z, A); DELETE /:id :47 (A).

/api/filter-presets (`filter-presets.routes.ts`; HG only; global G only): GET / :20; GET /default/:context :21; GET /:id :22; POST / :23 (Z, A); PATCH /:id :24 (Z, A); DELETE /:id :25 (A).

/api/weekly-recap (`weekly-recap.routes.ts`; RA, A30 at mount): GET / :14 (HG, A30); POST /feedback :20 (HG, G, Z, A); GET /history :23 (HG, A30, Z); POST /generate :24 (HG, A30, Z, A); GET /settings :27 (G, no HG); PATCH /settings :28 (G, no HG, Z, A).

/api/notifications (`notifications.routes.ts`; RA, G per route; NO HG; user-scoped): GET / :19 (Z); GET /unread-count :20; GET /:id :21 (Z); PUT /batch-read :28 (Z, A); DELETE /batch-archive :29 (Z, A); PUT /read-all :30 (A); PUT /:id/read :33 (Z, A); DELETE /:id :34 (Z, A); POST /push/subscribe :40 (A); DELETE /push/unsubscribe :41 (A); GET /push/vapid-key :42.

/api/ai (`ai.routes.ts`; RA + HG; custom per-household cap in `ai.middleware.ts`, 50 per household per day): POST /chat :37 (consentCheck + rateLimit; Z; A in service); GET /status :45; GET /consent :53; POST /consent :64 (RR admin, Z, A); GET /conversations :74 (Z); GET /conversations/:id :80 (Z); DELETE /conversations/:id :88 (RR m, Z).

### routes/*.ts (inline handlers)

/api/import (RA, HG, U20h at mount): POST /parse `import.ts:55` (multer; no Z, no A; parse only); POST /execute :96 (Z, A). No `requireRole`, so `view_only` can import transactions.

/api/grz (RA, G, HG): GET /bonds `grz-securities.ts:58`; POST /bonds :76 (RR m, Z, A); GET /tbills :177; PUT /bonds/:id/sell :192 (Z, A); POST /tbills :343 (Z, A); POST /payments/:id/pay :413 (RR m, no Z, A).

/api/investments/grz (RA, G, HG): GET /auctions/results `grz-auctions.ts:71` (Z); POST /auctions/results :102 (RR admin, Z, A); GET /auctions/calendar :149 (Z); GET /yields/current :175.

/api/investments/grz/calculate (RA, G, HG, RR m on each): POST /bond-price `grz-calculators.ts:55`; /ytm :75; /accrued :94; /tbill-yield :113 (all Z).

Other investment routers: GET /api/investments/analytics/fx-attribution `investment-analytics.ts:28`; GET .../fx-attribution/:holdingId :47 (Z); GET .../performance :85 (Z) (RA, A30, HG). POST /api/investments/market/refresh `investment-market.ts:16` (A30, RA, HG, RR m, no Z, no A). GET/PUT /api/investments/notifications/preferences `investment-notifications.ts:30,84` (RA, G, no HG; PUT Z and A). GET /api/investments/pension :19; GET /:id/contributions :30; POST / :45 (RR m, Z, no A); POST /:id/contributions :67 (Z, no A). GET /api/investments/recurring :38; POST / :49 (Z, no A); DELETE /:id :72 (no A). GET /api/investments/tax/summary `investment-tax.ts:19`; GET .../tax/zra-export :37 (A).

/api/admin (G, RA, `requireAnySystemRole`; no HG): GET /calculation-shadow-status `admin.ts:24`; GET /system-roles :87; GET /users :111; POST /users/:id/roles :165 (requireSuperAdmin, Z, no A found); DELETE /users/:id/roles/:roleId :243 (requireSuperAdmin, no Z, no A found); GET /audit-logs :311; POST /users/:id/unlock :421 (requireSuperAdmin, Z, A).

/api/cron (S5, then `verifyCronSecret` `cron.ts:29-52`; CSRF-exempt; header `x-cron-secret`; all POST; no Z; no A): /snapshots :60, /recurring :83, /recurring-reminders :129, /budget-rollover :204, /budget-alerts :257, /goals-status :335, /goals-weekly :360, /goals-deadlines :385, /market-data :410, /investment-automation :443. When `CRON_SECRET` is unset: production returns 403, non-production allows all (`cron.ts:33-42`). Secret compared with `!==` (`cron.ts:44`). `/recurring` and `/budget-rollover` write ledger data with no audit row in the route.

/health (G, no auth): GET /health/live :11; /health/ready :12; /health/startup :13. `ready` runs `SELECT 1` and a cache check; 503 when unhealthy. GET /healthz `app.ts:256`: no limiter.

## 3. Global middleware chain (`server/app.ts`)

- Env validation: `validateEnvOrThrow()` at import (`app.ts:28`).
- Trust proxy: `TRUST_PROXY` (`app.ts:37-51`); production defaults to 1 hop; `render.yaml` sets 1.
- helmet `app.ts:56`: CSP and HSTS disabled in dev. In prod `scriptSrc 'self'`, `styleSrc 'self' 'unsafe-inline'`, `connectSrc 'self'`. `CSP_REPORT_URI` optional.
- CORS: single origin (`CLIENT_URL`), `app.ts:107-124`; production throws if `CLIENT_URL` is missing.
- Body parsing: `express.json` default 100kb with `rawBody` capture; `urlencoded` `extended: false`.
- Session `app.ts:142-164`: `SESSION_SECRET` required; PgSession with `createTableIfMissing`; cookie `httpOnly`, `sameSite lax`, `secure` in production, 30-day maxAge; `resave` false, `saveUninitialized` false; no explicit cookie name or `rolling`.
- CSRF (`csrf-csrf` double submit, `app.ts:173-216`): secret `SESSION_SECRET || "dev-secret"`; cookie `__Host-csrf` in production; header `x-csrf-token`; skipped when NODE_ENV=test, for GET/HEAD/OPTIONS, `/api/csrf-token`, `/healthz*`, `/api/cron*`, and the pre-auth auth paths. Skip list includes `/api/auth/verify-mfa`, which does not exist as a route; it does NOT include `/api/auth/verify-email` or `/api/settings/security/email/verify`, so those need CSRF. Exact-match path checks mean `/api/v1/...` would not be exempt.
- attachUser `app.ts:219`: one DB lookup per request on every route, including public ones.
- /uploads `app.ts:229`: NOT unauthenticated; RA, HG, then `serveUpload` (`uploadsAuth.ts:76`); blocks traversal, allows only `goals|receipts|banners|profile-pictures/{householdId}/...`; no rate limit. Transaction attachments are not served via `/uploads` (403); they use the authenticated API download route.
- Graceful shutdown: SIGTERM/SIGINT, `SHUTDOWN_TIMEOUT_MS` (default 10000), then `pool.end()` (`app.ts:337-394`).

## 4. Background jobs

A. In-process `node-cron` (`scheduler.ts`; started from `initializeServices` → `startup.ts:40`, called from `runApp` `app.ts:251`): daily-security-report `0 8 * * *` (:123) emails ALL users; notification-cleanup `0 2 * * *` (:135); weekly-recap `0 9 * * 1` (:148). All through `runScheduledJob` → `withRedisLock` (`scheduler.ts:99-117`, `config/redis.ts:146-160`), 600s TTL, SET NX EX with owner-token release; production fails closed on lock error; with no `REDIS_URL` runs directly. Cron timezone is the server's local time. The daily security report iterates every user serially in one run.

B. HTTP cron endpoints (`/api/cron/*`): workers `jobs/snapshotWorker.ts`, `goalStatusWorker.ts`, `goalReminderWorker.ts`, `recurringService.processRecurring`, `budgetService.processBudgetRollover`, `MarketDataService`, `PriceAlertService`, `investmentAutomationService`. No trigger exists in the repo: `render.yaml` has no cron service, workflows have no `schedule:`, `CRON_SECRET` is only a commented hint (`render.yaml:49`) and a dummy in `ci.yml:52,122`. So snapshots, recurring processing, budget rollover, budget alerts, goal status, market data and investment automation never run unless an external scheduler is configured out-of-band. No distributed lock on these HTTP endpoints.

C. Dead or never-started loops (no non-test caller of `startProcessor(`/`startRunner(`/`startReceiptMatchingJob(`): `jobs/receiptMatcher.ts:17`; `core/events/processor.ts:128`; `core/jobs/runner.ts:70`. Events ARE published to the outbox by `services/budget/BudgetCoreService.ts` and `services/import/sideEffects.ts`, so published outbox events would never be processed.

D. Housekeeping timers: `core/cache/store.ts:374`; `ai/ai.cache.ts:304`; `ai/ai.middleware.ts:223`.

## 5. Integrations

| Integration | Module (file:line) | Env | When unconfigured |
|---|---|---|---|
| Email (SMTP, nodemailer) | `services/emailService.ts:30-110` | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` (all required), `SMTP_PORT` (587), `SMTP_SECURE`, `SMTP_FROM` (required at send time), `APP_URL` for links | Not a boot error. `sendEmail` returns `false`: dev warns; prod logs an error and returns false, so callers must handle it (:79-92). Missing `SMTP_FROM` also returns false. `GET /api/settings/security` exposes `emailServiceConfigured`. |
| Gemini AI | `modules/ai/ai.gemini.ts:350` | `GEMINI_API_KEY` (optional), `AI_REQUEST_TOKEN_BUDGET`, `AI_CONTEXT_MAX_MESSAGES` (`ai.guardrails.ts:69,83`) | Warns and disables AI features (graceful). |
| Claude/Anthropic AI | none | n/a | No Anthropic SDK or env in server code. |
| OCR | tesseract.js dependency (`package.json:146`); no server-side import | n/a | Server only stores client-produced OCR results and serves a thumbnail / OCR image via `sharp`. OCR runs client-side. |
| Web Push (VAPID) | `services/notification/push.ts:30-50` | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Warns once, push off; graceful. |
| FX rates | `services/MarketDataService.ts:4,81`, `startup.ts:25-35` | none | Yahoo Finance via `yahoo-finance2`, then `https://api.exchangerate-api.com/v4/latest/USD`; failure returns `{success:false}`. Driven only by `POST /api/cron/market-data`, so rates go stale without a trigger. In-process FX service: base USD, 5-minute cache, 30-day fallback. |
| Redis (ioredis) | `config/redis.ts:8-26` | `REDIS_URL` | Dev/test: "caching disabled", in-memory limiters, jobs run without a lock, in-memory AI counter. Prod: required by `validateEnv`. |
| Postgres | `db.ts:7-19`, `dbSsl.ts` | `DATABASE_URL`; `DATABASE_SSL*` | Throws without `DATABASE_URL`. SSL cert verification staging-gated. |
| File storage | local disk `process.cwd()/uploads` | none | Nothing in `render.yaml` provisions a persistent disk. |
| PostHog (AI tracking) | `modules/ai/ai.tracking.ts:96-105` | `AI_TRACKING_ENABLED`, `POSTHOG_API_KEY`, `POSTHOG_HOST` | Optional telemetry. |
| Google OAuth / WebAuthn / magic link | `auth/strategies/*` | `GOOGLE_*`, `WEBAUTHN_*` | No mounted routes. |
| Geo anomaly | `auth/strategies/geo-anomaly.ts:13` | `GEO_ANOMALY_ENABLED` | Used by `auth.security.monitor.ts:15`. |

## 6. Env toggles (`process.env.*` outside tests; defaults)

Core: `NODE_ENV` (many sites), `PORT` ("5000", `app.ts:323`), `HOST` ("0.0.0.0"), `SHUTDOWN_TIMEOUT_MS` ("10000"), `TRUST_PROXY`, `LOG_DIRECTORY` ("logs", `config/logging.ts:74`). Required: `SESSION_SECRET`, `DATABASE_URL`, `CLIENT_URL` (prod). Security: `CSP_REPORT_URI`, `CRON_SECRET`. Redis: `REDIS_URL`. DB SSL: `DATABASE_SSL`, `DATABASE_SSL_REJECT_UNAUTHORIZED`, `DATABASE_SSL_CA_CERT`, `DATABASE_SSL_CA_FILE`. Email: `SMTP_*`, `APP_URL` (read in `auth.email.service.ts:86,119`, `invitations.controller.ts:28`, `security.email.ts:178`, `emailService.ts:142,203`, `notification/email.ts:52`, `notification/service.ts:456`, `weekly-recap.email.service.ts:215,223`, `magic-link.ts:38`). Push: `VAPID_*`. AI: `GEMINI_API_KEY`, `AI_CONTEXT_MAX_MESSAGES`, `AI_REQUEST_TOKEN_BUDGET`, `AI_TRACKING_ENABLED`, `POSTHOG_*`. Auth strategies (not mounted): `GOOGLE_*`, `WEBAUTHN_*`, `GEO_ANOMALY_ENABLED`. Jobs: `GOAL_DEADLINE_REMINDER_DAYS` (7). Test only: `TEST_DATABASE_URL`.

## 7. Deduplicated server API path list

```
/health/live /health/ready /health/startup /healthz /uploads/*
/api/csrf-token /api/health/routes
/api/auth/{register,login,logout,me,verify-email,resend-verification,forgot-password,reset-password}
/api/auth/mfa/{verify,resend}
/api/settings/{profile,profile/picture,profile/banner,display,notifications,preferences,report-widgets,account/delete,account/export}
/api/settings/security  /api/settings/security/{password,login-history,step-up,step-up/status}
/api/settings/security/email/{verify,change,resend,cancel}
/api/settings/security/sessions  /api/settings/security/sessions/{:id,login-history,login-history/export}
/api/settings/security/mfa/{enable,disable,status,send-code,verify-code,verify-backup,step-up,step-up/status}
/api/household  /api/household/{general,members,members/:userId,members/:userId/role,invite,invite/accept,invitations,invitations/:inviteId,invitations/:inviteId/resend,transfer-ownership,leave}
/api/accounts  /api/accounts/{summary,summary/export,summary/history,net-worth/history,:id,:id/adjust-balance,:id/archive,:id/unarchive,:id/balance-history,:id/balance-history/export,:id/balance-history/import,:id/transactions/export,:id/transactions/import,:id/settings}
/api/import/{parse,execute}
/api/categories  /api/categories/{seed,reorder,groups,groups/reorder,groups/:id,groups/:id/restore,:id,:id/archive,:id/restore}
/api/merchants  /api/merchants/{autocomplete,duplicates,merge,merge/history,merge/:historyId/undo,seed,:sourceId/merge,:id}
/api/tags  /api/tags/{analytics,suggest,merge,defaults,:id,:id/archive,:id/transactions,transaction/:transactionId,transaction/:transactionId/:tagId}
/api/rules  /api/rules/{reorder,bulk-enable,bulk-disable,preview,:id/dry-run,:id}
/api/reports/{annual,cashflow,cashflow/budget,income,savings-rate,spending/breakdown,spending/trend,spending/subcategory,net-worth,net-worth/changes,sankey,ratios,financial-ratios,debt,forecast,transactions,expenses/classification,goals/progress,custom,exports,exports/:id}
/api/transactions  /api/transactions/{summary,transfer,transfer/:id,bulk-owner,bulk-category,bulk-tags,bulk-review,bulk,:id,:id/goals,:id/owner,:id/review,:id/attachments,:id/attachments/:attachmentId,:id/attachments/:attachmentId/download}
/api/budgets  /api/budgets/{progress,alerts,settings,forecast,forecast/:id,recalculate,clear,move,:id}
/api/goals  /api/goals/{summary,images,available-funds,assignments,transfers,debt-strategy,calculate-projection,:id,:id/complete,:id/archive,:id/unarchive,:id/assignments,:id/assign-account,:id/accounts/:accountId,:id/transfers,:id/transactions,:id/transactions/:txId,:id/projection,:id/contributions,:id/contribute,:id/payoff-scenarios,:id/calculate-payoff,:id/activity}
/api/recurring  /api/recurring/{upcoming,summary,process,detect,confirm,transaction,transaction/:transactionId,:id,:id/history,:id/transactions,:id/skip,:id/pause,:id/resume,:id/end,:id/link,:id/link/:linkId}
/api/receipts  /api/receipts/{upload,:id,:id/thumbnail,:id/ocr-image,:id/match,:id/ocr-results,:id/retry-match,:id/create-transaction}
/api/notifications  /api/notifications/{unread-count,batch-read,batch-archive,read-all,:id,:id/read,push/subscribe,push/unsubscribe,push/vapid-key}
/api/investments/{securities,securities/:id,securities/:id/prices,securities/:id/price,holdings,holdings/:id,portfolio,portfolio/summary,portfolio/allocation,performance,transactions,tax-lots,fx-rates,analytics/fx-historical}
/api/investments/notifications/preferences
/api/investments/tax/{summary,zra-export}
/api/investments/pension  /api/investments/pension/:id/contributions
/api/investments/recurring  /api/investments/recurring/:id
/api/investments/market/refresh
/api/investments/grz/calculate/{bond-price,ytm,accrued,tbill-yield}
/api/investments/grz/{auctions/results,auctions/calendar,yields/current}
/api/investments/analytics/{fx-attribution,fx-attribution/:holdingId,performance}
/api/grz/{bonds,bonds/:id/sell,tbills,payments/:id/pay}
/api/weekly-recap  /api/weekly-recap/{feedback,history,generate,settings}
/api/ai/{chat,status,consent,conversations,conversations/:id}
/api/filter-presets  /api/filter-presets/{default/:context,:id}
/api/cron/{snapshots,recurring,recurring-reminders,budget-rollover,budget-alerts,goals-status,goals-weekly,goals-deadlines,market-data,investment-automation}
/api/admin/{calculation-shadow-status,system-roles,users,users/:id/roles,users/:id/roles/:roleId,users/:id/unlock,audit-logs}
```

## Findings worth the lead's attention

- F1: `/api/v1/*` alias is a no-op. `routes.ts:103-107` only does `req.url = req.url || "/"` and `next()`. `legacyApiRedirect` (`apiVersion.ts:36`) advertises `Link: </api/v1...>; rel="successor-version"`. A client using `/api/v1/...` would 404, or in prod get index.html with 200. Static reading only.
- F2: `ipAuthLimiter` (5/min per IP) covers ALL `/api/auth/*`, including `GET /me` and `/logout` (`routes.ts:112`). A session-restore call to `/me` plus a few logins from one IP (NAT/shared) can 429. Runtime not tested.
- F3: Likely double/triple counting of `generalLimiter`: mounted globally (`routes.ts:95`) and again via `router.use(generalLimiter)` inside most module routers, with per-route `generalLimiter` in accounts and notifications. Same for A30 on `/api/reports`. Needs a runtime test.
- F4: Missing audit on money-moving or sensitive writes (handler-level): POST /api/investments/pension and /:id/contributions; POST and DELETE /api/investments/recurring; POST /api/investments/market/refresh; PUT /api/budgets/settings; transaction attachment upload and delete; admin role grant and revoke; `/api/cron/recurring` and `/api/cron/budget-rollover`; GET /api/accounts/summary/export and GET /api/accounts/:id/balance-history/export. Some may be audited in services; not traced.
- F5: Mutations without Zod in the handler: POST /api/import/parse; POST /api/grz/payments/:id/pay; POST /api/receipts/:id/retry-match; POST /api/merchants/seed; PUT /api/rules/reorder; transactions bulk-category, bulk-tags, bulk-review, bulk delete; DELETE /api/admin/users/:id/roles/:roleId; POST /api/settings/security/email/{resend,cancel}.
- F6: `view_only` role can reach writes: POST /api/import/execute has no `requireRole`; POST /api/reports/exports and POST /api/reports/custom have no `requireRole`; weekly-recap `generate` and `feedback` have no `requireRole`; household POST / is not scoped.
- F7: `uploadLimiter` absent from POST /api/goals/images and POST /api/transactions/:id/attachments.
- F8: The HTTP cron set has no scheduler in the repo. The outbox processor, job runner and receipt matcher are never started.
- F9: `POST /api/settings/account/export` is a stub returning a fabricated `exportId` (`settings.account.controller.ts:92-98`) while sitting behind step-up.
- F10: Prod SPA catch-all returns index.html with 200 for unknown `/api/*` paths (`index-prod.ts:20`).
- F11: `/uploads` served from local disk, no persistent disk in `render.yaml`.

## 8. Unverified items

- Handler-level A/Z are regex results; per-service audit not traced except by file-level grep. Files with audit refs outside controllers: `services/transaction/service.ts`, `repositories/TransactionRepository.ts`, `TransactionTransferRepository.ts`, `services/account/*`, `services/ImportService.ts`, `services/investment/processDueInvestments.ts` and `processTBillMaturities.ts`. `services/AttachmentService.ts` is not on the list.
- Auth module internals not read for which audit tables they write or whether SMTP failure blocks flows.
- Whether `view_only` is blocked inside controllers where `requireRole` is absent.
- `reports.exports.controller.ts:91-100` hand-off not read.
- `MarketDataService.ts` after line 130, `PriceAlertService`, `InvestmentAutomationService` not read.
- Runtime rate-limit counting (F2, F3) and `/api/v1` behaviour (F1) not executed.
- `core/events/outbox.ts` consumer not checked.
- `utils/validateEnv.ts` beyond ~line 200 not read.
- Client call diff not done by this agent.
