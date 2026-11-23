<!-- Subagent inventory report saved verbatim by the lead (bold markers removed). Source: code-explorer agent, read-only, 2026-10-13, HEAD 381e943. API verbs are heuristic where marked; paths are exact. -->

# Client Surface Inventory (derived from current wiring)

Scope: `client/src`. Router is wouter ^3.3.5 (package.json:150). Nothing under docs/reviews/ was read. Paths are relative to `client/src` unless noted.

Method caveat for API verbs: API calls were extracted with a script that scans the client source. `apiCall` paths are relative to `/api`. Where the script could not see an explicit method it printed GET. Treat verbs as heuristic, paths as exact.

## 1. Route table (`App.tsx:85-112`)

There is no route guard component. Every route is a plain `<Route>`. Authenticated pages protect themselves in two ways:
- Each page wraps itself in `components/Layout.tsx`. `Layout.tsx:25` calls `useProfile()`, and `Layout.tsx:63-68` does `setLocation("/login")` when the profile error status is 401.
- `lib/queryClient.ts:50-57` (`handleAuthExpired`), called from the global QueryCache/MutationCache `onError` at `queryClient.ts:185` and `:202`, redirects any 401 to `/login`. Skipped on `PUBLIC_PATHS` (`queryClient.ts:20-25`: `/login`, `/forgot-password`, `/reset-password`, `/verify-email`).
- Every route is wrapped in `routeWithBoundary` (`App.tsx:32-48`), an error boundary only.
- No role gating at route level. Role gating exists only inside the Members settings section.

| Path | Component (`App.tsx` line) | Public or authenticated | Lazy? |
|---|---|---|---|
| `/login` | `pages/Login` (`:88`) | Public. No redirect-if-already-authenticated seen; `pages/Login/index.tsx` only calls `setLocation("/")` after a successful login (`:122,150,174`). | No |
| `/` | `pages/Dashboard.tsx` (`:89`) | Authenticated via Layout | Yes |
| `/reports` | `pages/Reports.tsx` (`:90`) | Authenticated via Layout | Yes |
| `/cash-flow` | `pages/CashFlow.tsx` (`:91`) | Authenticated via Layout | Yes |
| `/advice` | `pages/Advice.tsx` (Thandi) (`:92`) | Authenticated via Layout | Yes |
| `/budget` | `pages/Budget.tsx` (`:93`) | Authenticated via Layout | Yes |
| `/investments` | `pages/Investments.tsx` (`:94`) | Authenticated via Layout | Yes |
| `/recurring` | `pages/Recurring.tsx` (`:95`) | Authenticated via Layout | Yes |
| `/goals`, `/goals/:id` | `pages/Goals.tsx` (`:96-97`) | Authenticated via Layout | Yes |
| `/accounts` | `pages/Accounts.tsx` (`:98`) | Authenticated via Layout | Yes |
| `/accounts/:id` | `pages/AccountDetail.tsx` (`:99`) | Authenticated via Layout | Yes |
| `/transactions` | `pages/Transactions/index.tsx` (`:100`) | Authenticated via Layout | Yes |
| `/profile`, `/settings`, `/settings/:section`, `/settings/:section/:subsection` | `pages/settings/index.tsx` (`:101-104`) | Authenticated via `SettingsLayout` (`pages/settings/SettingsLayout.tsx:113`) | Yes |
| `/receipts` | `pages/Receipts.tsx` (`:105`) | Authenticated via Layout | Yes |
| `/verify-email` | `pages/VerifyEmail.tsx` (`:106`) | Public; no Layout | Yes |
| `/forgot-password` | `pages/ForgotPassword.tsx` (`:107`) | Public | Yes |
| `/reset-password` | `pages/ResetPassword.tsx` (`:108`) | Public | Yes |
| `*` | `pages/not-found.tsx` (`:109`) | Public | No |

Global overlays outside the router (`App.tsx:128-133`): `ImportWizard`, `CommandPalette`, `StepUpProvider`.

Settings URL handling (`pages/settings/index.tsx:50-76`): section ids `profile`, `display`, `notifications`, `security`, `household`, `members`, `preferences`, `organization`, `merchants`, `weekly-recap` (`features/settings/constants/sectionNames.ts:1-12`). Legacy `/settings/categories`, `/settings/rules` and `/settings/tags` redirect to `/settings/organization/<x>` (`index.tsx:57-63`). An unknown section silently falls back to Profile (`index.tsx:75`).

## 2. Navigation

Sidebar (`components/layout/constants.ts:41-64`, rendered by `components/layout/Sidebar.tsx:74-115`): Track: Dashboard `/`, Accounts, Transactions, Receipts, Cash Flow, Reports. Plan: Budget, Recurring, Goals, Investments, Advice, Settings `/profile`. Footer profile link `/profile` (`Sidebar.tsx:119`). Active-link matching is exact (`Sidebar.tsx:83`), so `/accounts/:id` and `/goals/:id` do not highlight their parent.

Top bar (`components/layout/TopBar.tsx`): command palette button (`:36-46`), theme toggle, notification bell (`NotificationBell.tsx`; settings link `/settings/notifications` at `:296`), profile menu. Dead control: the "Mine / Joint View / Partner" radiogroup (`TopBar.tsx:50-81`) has no `onClick` or state; "Mine" is hardcoded `aria-checked="true"`. Profile menu (`ProfileMenu.tsx`): three links all to `/profile` (`:104,115,124`) plus Sign out (`:136-149`, POST `/api/auth/logout`). Settings sidebar (`SettingsLayout.tsx:60-96`) lists all 10 sections plus Logout; mobile version is a Sheet (`:128-146`).

Command palette (`components/CommandPalette.tsx`): navigation items for accounts, budget, dashboard, goals, investments, recurring, reports, transactions, cash-flow, receipts (`:154-215`); dynamic groups Accounts (`:226-236`), Categories (`:245-257`), Saved Filters (`:266-306`), Settings (`:313-333`); `g`+key shortcuts (`:103-119`). Keyboard shortcuts in `Layout.tsx:45-53`: Ctrl+Shift+M → `/settings/merchants`, Ctrl+Shift+R → `/settings/rules`. `Layout.tsx:38-43` focuses `searchInputRef`, which is never attached to any element.

Orphan and unlinked routes: `/profile` is an alias of `/settings`. `/goals/:id` is reachable only from the dashboard GoalsWidget (`components/dashboard/GoalsWidget.tsx:325`). `/verify-email` and `/reset-password` are reachable only via emailed links; `/forgot-password` is linked from the login form (`LoginForm.tsx:115`). Broken link: `features/reports/components/IncomeSection.tsx:55` links to `/investments/tax`, which is not a route (NotFound); the real tax view is the "tax" tab inside `/investments`. Deep-link query params consumed: `/recurring?ruleId=` (`pages/Recurring.tsx:54-68`), `/transactions?action=add` (`pages/Transactions/index.tsx:71-75`).

Unused components: `components/settings/SettingsSidebar.tsx` (legacy 15-section sidebar with `billing`, `referrals`, `data`, `institutions`) has zero importers; `features/transactions/components/TransactionFiltersPanel.tsx` is only re-exported from `features/transactions/index.ts:20`; `components/transactions/FiltersModal.tsx` is not rendered by any page traced.

## 3. Settings (`pages/settings/sections/*`)

| Section | Component | What it saves and endpoint (hook file:line) |
|---|---|---|
| Profile | `ProfileSection/` | GET/PUT `/api/settings/profile` (`hooks/use-settings.ts:133,155`); POST/DELETE `/api/settings/profile/picture` (`:168,175`); POST/DELETE `/api/settings/profile/banner` (`BannerUpload.tsx:27,35`). Removal uses `window.confirm`. |
| Display | `DisplaySection/DisplayForm.tsx` | GET/PUT `/api/settings/display` (`use-settings.ts:183,199`). Same endpoint persists dashboard widget order and visibility (`hooks/useDashboardWidgets.ts:4,68`). |
| Notifications | `NotificationsSection/` | GET/PUT `/api/settings/notifications` (`:321,339`); GET `/api/notifications/push/vapid-key` (`PushNotificationSetup.tsx:77`); POST/DELETE push subscribe/unsubscribe (`:14,21`). |
| Security | `SecuritySection/` (`EmailPasswordCard`, `SessionsCard`, `LoginHistoryCard`, `MfaWarningBanner`) | GET `/api/settings/security` (`hooks/useSecurity.ts:48`); GET `/mfa/status` (`:76`); POST `/security/email/{change,verify,resend,cancel}` (`:113,144,167,184`); PUT `/security/password` (`lib/api.ts:1457`); GET `/sessions` (`useSecurity.ts:204`); DELETE `/sessions/:id` and `/sessions` (`lib/api.ts:1436,1445`); GET `/login-history` (`:267`); POST `/security/step-up` (`lib/api.ts:1424`). |
| Household | `HouseholdSection/` (`CreateHouseholdForm`, `EditHouseholdForm`) | GET `/api/household/general` (`index.tsx:21`); POST `/api/household` (`CreateHouseholdForm.tsx:24`); PUT `/api/household/general` (`EditHouseholdForm.tsx:25`). |
| Members | `MembersSection/` (`AddMemberDialog`, `MemberList`, `RolePermissions`) | GET `/api/household/members` (`use-settings.ts:574`); POST add by email or username + role (`:700`); PUT `/members/:id/role` (`:591`); DELETE `/members/:id` (`:599`). Role gating client-side: `canManageRoles = owner or admin` (`MembersSection/index.tsx:19-21`); owner row and own row cannot be edited or removed (`MemberList.tsx:180-181`). |
| Preferences | `PreferencesSection/` (`AIFeaturesCard`, `ImportBehaviorCard`, `ReceiptScanningCard`, `TransactionEntryCard`) | GET/PUT `/api/settings/preferences` (`:1947,1963`); AI consent via `/api/ai/consent` (GET `:2024`, POST `:2030`). |
| Organization | tabs Categories, Tags, Rules (`index.tsx:87-120`) | Categories: `/api/categories` CRUD (`:818,829,837`), `/reorder` (`:843`), `/seed` (`:924`), `/groups` (`:953-990`). Tags: `/api/tags` CRUD (`lib/api.ts:1028,1039,1050`), `/:id/archive` (`:1174`), `/merge` (`:1157`). Rules: `/api/rules` CRUD (`:1735-1765`); `/rules/:id/test` (`:1769`); `/rules/reorder` (`:1777`); `/rules/preview` (`:1802`). |
| Merchants | `MerchantsSection/` | `/api/merchants` CRUD (`:1165-1285`); aliases (`:1241,1252`); `/merge` (`:1385`); `/merge/:id/undo` (`:1411`); `/merge/history` (`:1397`); `/duplicates` (`:1224`); `/logo` (`:1368,1375`); `/seed` (`:1905`). |
| Weekly Recap | `WeeklyRecapSection.tsx` | GET/PATCH `/api/weekly-recap/settings` (`:49`, `:25`); fields `enabled`, `emailEnabled`. |

Not present as settings UI: MFA enrollment or disable, backup-code regeneration, data export of personal data, account deletion or erasure, and household invitations (only direct add-by-email or username). Grep for `mfa/(setup|enable|disable|enroll|backup)`, `erase`, `delete-account`, `gdpr`, `data-export`, `invit` found no hits in non-test client code. The only MFA UI is the login-time verify (`pages/Login/components/MfaVerifyForm.tsx`) and a low-backup-codes warning banner.

## 4. Consequential controls (UI to endpoint)

Auth (`pages/Login/useAuthHandlers.ts`): login `:59`; register `:96`; MFA verify `:121`; MFA resend `:149`; forgot-password `:169`; reset-password `:197`; resend-verification `:222`. Logout POST `/api/auth/logout` (`lib/api.ts:467`).

Dashboard (`pages/Dashboard.tsx`): "Add Account" (`AddAccountModal`); "Customize" opens `CustomizeDashboardModal` with drag-and-drop reorder (`:280-310`) saved via PUT `/api/settings/display`; WeeklyRecapWidget opens `WeeklyRecapWizard` (`:316`); no-household state links to `/settings/household` (`:222`); greeting hardcoded "Good morning," (`:255`). Widgets (`:98-114`): weekly-recap, budget-summary, transactions-list, spending-trend, top-merchants, net-worth, annual-summary, recent-transactions, cash-flow, recurring, spending-category, accounts, goals, budget-status, investments.

Accounts (`pages/Accounts.tsx`, `features/accounts/`): Create via `AddAccountModal` → POST `/api/accounts` (`lib/api.ts:521`). Net-worth summary export → GET `/api/accounts/summary/export` (`:705`). Detail page edit dropdown (`AccountDetailHeader.tsx:86-135`): Edit account, Download transactions GET `/api/accounts/:id/transactions/export` (`:629`), Import transactions POST (`:675`), Download balance history GET (`:643`), Import balance history POST (`:657`). `EditAccountModal`: save PUT `/api/accounts/:id`, PATCH `/settings`, Archive/Restore (`:176-180`), Delete with inline confirm (`:171`). Stub: "Copy balance history" only shows a toast "Feature moved" (`AccountDetailHeader.tsx:112-121`). Removed, left as TODO: "Transfer data" (`:110`, TODO-042), "Edit balance history" (`:135`, TODO-043), "Edit multiple" (`AccountTransactions.tsx:34`, TODO-033). No UI path for balance adjustment: `useAdjustBalance` (`hooks/useAccounts.ts:179`) and `POST /api/accounts/:id/adjust-balance` (`lib/api.ts:555`) have no consumer.

Transactions (`pages/Transactions/index.tsx`, `TransactionsHeader.tsx`, `TransactionsModals.tsx`): Add/edit/transfer via `AddTransactionModal` (POST `/api/transactions` `lib/api.ts:811`, POST `/transfer` `:831`, PUT `/transfer/:id` `:849`; `useTransactionForm.ts:107-108,212,272`). Transfers are created only from the Add Transaction modal's transfer type. Detail modal: edit PUT `/:id` (`:862`), mark reviewed (`:876`), add/remove tags (`:1103,1120,1137`), duplicate, create rule (`RuleCreationModal` → POST `/api/rules`), create recurring (POST `/api/recurring/transaction/:id`, `useRecurring.ts:601`), split (`SplitTransactionModal` → PUT `/:id` with `{splits}`, `TransactionsModals.tsx:119-132`). Attachments: GET/POST `/:id/attachments` (`useAttachments.ts:38,94`); DELETE (`:133`); download. Goal linking: `GoalLinkingSection.tsx` → POST/DELETE `/api/goals/:id/transactions` (`useGoals.ts:1070,1114,1160`). Bulk: review, category, tags, delete (`useTransactionMutations.ts:16-51`); bulk delete uses a bare `confirm()` (`index.tsx:144`). No single-transaction delete control found in `TransactionDetailModal.tsx`; `useDeleteTransaction` hook is not used by any component found. Import: "Import" opens the global `ImportWizard` (`index.tsx:214`), POST `/api/import/parse` and `/execute` (`importApi.ts:31,40`); `.csv` only (`UploadStep.tsx:46-47`). Export is client-side only: `exportTransactionsToCSV` (`features/transactions/utils/export.ts:23`) builds a CSV from loaded rows; no API call, no server-side audit. Filter presets: reads via GET; create and delete UI (`FilterPresetSelector`) is reachable only through `TransactionFiltersPanel`, which no page imports, so POST/PATCH/DELETE `/api/filter-presets` (`useFilterPresets.ts:99,130,162`) look unreachable from the UI.

Budget (`pages/Budget.tsx`, `hooks/useBudgets.ts`): POST `/api/budgets` `:338`, PUT `/:id` `:373`; forecast PUT `/forecast/:id` `:217`; move POST `/move` `:312`; `BudgetSettingsModal`: PUT `/settings` `:159`; Recalculate POST `:246` and Clear POST `:275` behind `window.confirm` (`BudgetSettingsModal.tsx:66,73`). No UI path to `useDeleteBudget` (DELETE `/api/budgets/:id`, `:402`) or `useBudgetAlerts`.

Goals (`pages/Goals.tsx`, `hooks/useGoals.ts`): create wizard POST `:643`, edit PUT `:672,:707`, contribute POST `/:id/contribute` `:743`, transfer POST `/api/goals/transfers` `:1022`, assign/unassign accounts (`:778-984`), link transactions `:1070`, complete `:1202`, archive `:1231`, images POST `:539`, payoff/debt tools (`:1285,:1301,:1313`), priority bulk update. No UI for delete goal (`useDeleteGoal` unused; DELETE at `:1261`).

Recurring (`pages/Recurring.tsx`, `hooks/useRecurring.ts`): item menu (`RecurringItemActions.tsx:53-75`): Skip `:684`; Pause/Resume `:717`; Edit PUT `:651`; Delete (AlertDialog, `Recurring.tsx:226-246`) `:816`. `RecurringPatternsModal` → POST `/detect` `:346` then `/confirm` `:386`. Create from transaction `:601`. No UI path: `useEndRecurring`, `useProcessRecurring`, `useCreateRecurring`, `useRecurringHistory`, `useRecurringLinks`, `useRecurringSummary`.

Receipts / OCR (`pages/Receipts.tsx`, `hooks/useReceipts.ts`): Scan opens `ReceiptScanModal` → multipart POST `/api/receipts/upload` (`:74`, `x-idempotency-key` header). `ReceiptDetailModal`: ocr-results `:119`, match `:145`, create-transaction `:181`, delete `:227`. `useRetryMatch` (`:208`) has no UI consumer. OCR runs client-side via `hooks/useOcrProcessor.ts` and `lib/receiptParser.ts`. `TransactionDetailModal.tsx:56` has a TODO that it cannot show a linked receipt.

Investments (`pages/Investments.tsx`, `hooks/investments/*`, `hooks/useGrzSecurities.ts`): tabs holdings, performance, allocation, grz, fx-impact, tax, pension, recurring (`:125-172`). Dead end: when `holdings.length === 0` the page returns the "Add Your First Holding" empty state (`:83-107`) before rendering any tabs, so GRZ, Tax, Pension and Recurring tabs are unreachable until a holding exists. Add holding: `AddHoldingModal` → POST `/securities` `:61` then POST `/holdings` `:55`. Record transaction: POST `/api/investments/transactions`. Recurring plan: POST `/api/investments/recurring`. Market refresh: POST `/market/refresh` (`usePortfolio.ts:92`). GRZ: `GRZSecurities.tsx` dropdown opens `AddGrzBondModal` (POST `/api/grz/bonds` `useGrzSecurities.ts:83`) and `AddGrzTBillModal` (POST `/tbills` `:164`); `BondScheduleDialog` POST `/api/grz/payments/:id/pay` (`:118`). Tax: `TaxReport.tsx:41` uses `window.open("/api/investments/tax/zra-export?year=&format=csv")`. No UI to edit or delete a holding: `HoldingsList.tsx` has no buttons; `useUpdateHolding`, `useDeleteHolding`, `useUpdateSecurityPrice`, `useCreateFxRate`, `useFxRates` unused.

Cash Flow (`pages/CashFlow.tsx`): views bar, sankey, budget, forecast (`:27`). Export (`:85-112`) → POST `/api/reports/exports` then download `/api/reports/exports/:id?download=true`; forecast intentionally not exported (`:81-84`).

Reports (`pages/Reports.tsx`): tabs cash-flow, spending, income, net-worth, savings, merchants, annual. Export (`:195-228`) → POST `/api/reports/exports` (`use-reports.ts:849-861`). Export History → GET `/api/reports/exports` (`ExportHistory.tsx:105`). `useExportStatus.ts:17,28` polls. Annual-tab widget layout PATCH `/api/settings/report-widgets` (`use-report-widget-preferences.ts:60`). Custom charts GET `/api/reports/custom` (`:1095`). `WidgetGalleryModal` footer "Reset Defaults" is hard `disabled` (`WidgetGalleryModal.tsx:231-238`).

AI / Thandi (`pages/Advice.tsx`, `features/ai/api.ts`): POST `/api/ai/chat` `:18`; GET `/status` `:25`; GET `/conversations` `:32`; GET `/conversations/:id` `:38`; DELETE `:51`. `ConsentGate.tsx` → POST `/api/ai/consent`; composer disabled when quota exhausted (`AdviceChat.tsx:148,155`). Intro dismissal in localStorage (`Advice.tsx:12,28`).

Notifications: `NotificationBell.tsx` (list, unread-count, mark read, read-all, delete). `useArchiveNotification` unused.

Weekly recap: dashboard widget plus 6-step wizard; GET `/api/weekly-recap` (`useWeeklyRecapData.ts:16`), POST `/feedback` (`:33`), GET `/history` (`WeeklyRecapHistory.tsx:39`). No manual "send email" button.

Step-up: `lib/api.ts:429-441` handles 401 `STEP_UP_REQUIRED` by prompting through `components/security/StepUpDialog.tsx` (password only) and retrying.

Account deletion, personal data export, MFA enrollment: not present anywhere in the client.

## 5. Placeholders and dead ends

- Dead UI: TopBar Mine/Joint/Partner radios (`TopBar.tsx:50-81`); `WidgetGalleryModal` "Reset Defaults" hard disabled (`:231-238`); "Copy balance history" toast-only stub (`AccountDetailHeader.tsx:112-121`); `/investments/tax` link → NotFound (`IncomeSection.tsx:55`); `Layout.tsx:29-42` search-focus shortcut targets an unattached ref.
- Removed features left as TODO: TODO-042, TODO-043 (`AccountDetailHeader.tsx:110,135`), TODO-033 (`AccountTransactions.tsx:34`), TODO-022 comments in `AddAccountModal.tsx` and `AccountDetailsForm.tsx`.
- Other TODOs: `TransactionDetailModal.tsx:56` no linked-receipt display; `CommandPalette.tsx:280` saved-filter date ranges dropped, so a preset's date range is lost when applied from the palette; `hooks/use-finance-data.ts:488` stale "Stub" comment.
- Flag and mock data in production code: `lib/mockReportsData.ts:12-14` `USE_MOCK_DATA = import.meta.env?.VITE_USE_MOCK_REPORTS_DATA === "true"`; 8 report hooks branch on it (`use-reports.ts:446-451, 881-885, 907-911, 936-940, 965-969, 994-998, 1023-1027, 1054-1058`). With the env var set at build time, Reports would show fake data. Only `VITE_` variable the client reads.
- UI-unreachable server capabilities (hooks exist, no component calls them): useAdjustBalance, useDeleteBudget, useDeleteGoal, useEndRecurring, useProcessRecurring, useCreateRecurring, useUpdateHolding, useDeleteHolding, useUpdateSecurityPrice, useCreateFxRate, useRetryMatch, useArchiveNotification, useCreateHousehold and useUpdateHousehold (the Household section uses its own `apiCall`), useReorderCategoryGroups (unverified), useReportsExport.
- Other dead ends: Investments empty-state gate; filter-preset create/delete unreachable; hardcoded "Good morning"; unknown `/settings/<x>` silently shows Profile.
- No `featureFlag`, `isEnabled` or "coming soon" strings in client source.
- Native `confirm()` used for destructive actions: bulk transaction delete (`Transactions/index.tsx:144`), budget recalc and clear (`BudgetSettingsModal.tsx:66,73`), profile picture and banner removal.

## 6. Client API path list (union of literal and resolved `apiCall` paths; `:p` = template substitution)

```
/api/csrf-token
/api/auth/{login,logout,register,mfa/verify,mfa/resend,forgot-password,reset-password,resend-verification}
/api/accounts  /api/accounts/:p  /api/accounts/:p/{adjust-balance,archive,unarchive,settings,balance-history,balance-history/export,balance-history/import,transactions/export,transactions/import}
/api/accounts/summary  /api/accounts/summary/export  /api/accounts/net-worth/history
/api/transactions  /api/transactions/:p  /api/transactions/:p/{review,attachments,attachments/:p,attachments/:p/download,goals}
/api/transactions/{summary,bulk,bulk-category,bulk-review,bulk-tags,transfer,transfer/:p}
/api/tags  /api/tags/:p  /api/tags/:p/archive  /api/tags/merge  /api/tags/transaction/:p  /api/tags/transaction/:p/:p
/api/categories  /api/categories/:p  /api/categories/{seed,reorder,groups,groups/:p,groups/:p/restore,groups/reorder}
/api/merchants  /api/merchants/:p  /api/merchants/:p/{aliases,aliases/:p,analytics,logo,merge,transactions}
/api/merchants/{autocomplete,duplicates,seed,merge/history,merge/:p/undo}
/api/rules  /api/rules/:p  /api/rules/:p/test  /api/rules/{preview,reorder}
/api/recurring  /api/recurring/:p  /api/recurring/:p/{:p(skip|pause|resume),end,link,link/:p,skip,history,transactions}
/api/recurring/{detect,confirm,process,summary,upcoming,transaction/:p}
/api/budgets  /api/budgets/:p  /api/budgets/{alerts,clear,forecast,forecast/:p,move,progress,recalculate,settings}
/api/goals  /api/goals/:p  /api/goals/:p/{:p(action),accounts/:p,activity,assign-account,assignments,calculate-payoff,complete,contribute,contributions,payoff-scenarios,projection,transactions,transactions/:p,transfers}
/api/goals/{assignments,available-funds,calculate-projection,debt-strategy,images,summary,transfers}
/api/investments/{holdings,holdings/:p,securities,securities/:p,securities/:p/price,transactions,recurring,pension,pension/:p/contributions,portfolio/summary,market/refresh,fx-rates,tax/summary,tax/zra-export,analytics/{fx-attribution,fx-historical,performance}}
/api/grz/{bonds,tbills,payments/:p/pay}
/api/receipts  /api/receipts/:p  /api/receipts/:p/{ocr-results,match,retry-match,create-transaction,ocr-image,thumbnail}  /api/receipts/upload
/api/reports/{annual,cashflow,cashflow/budget,sankey,spending/breakdown,spending/trend,spending/subcategory,income,net-worth,net-worth/changes,savings-rate,transactions,ratios,debt,expenses/classification,goals/progress,forecast,custom,exports,exports/:p}
/api/import/{parse,execute}
/api/notifications  /api/notifications/:p  /api/notifications/:p/read  /api/notifications/{read-all,unread-count,push/subscribe,push/unsubscribe,push/vapid-key}
/api/weekly-recap  /api/weekly-recap/{feedback,history,settings}
/api/filter-presets  /api/filter-presets/:p  /api/filter-presets/default/:p
/api/household  /api/household/general  /api/household/members  /api/household/members/:p  /api/household/members/:p/role
/api/settings/{profile,profile/picture,profile/banner,display,notifications,preferences,report-widgets,security}
/api/settings/security/{password,sessions,sessions/:p,login-history,mfa/status,step-up,email/change,email/verify,email/resend,email/cancel}
/api/ai/{chat,status,consent,conversations,conversations/:p}
```

Client paths with no matching server route (lead's diff against the server inventory): `/api/rules/:id/test` (server has `/api/rules/:id/dry-run` and `/preview`), `/api/merchants/:id/aliases`, `/api/merchants/:id/analytics`, `/api/merchants/:id/logo`, `/api/merchants/:id/transactions`, `/api/investments/analytics/fx-historical` (server mounts it under `/api/investments/analytics/fx-historical`, present). See EVIDENCE.md for the runtime check of each.

Server paths the client never calls: household invite/accept/resend/transfer-ownership/leave, MFA enable/disable, account delete and export, `/api/accounts/:id/adjust-balance` (hook only), `/api/budgets/:id` DELETE, `/api/goals/:id` DELETE, investments holdings PUT/DELETE, `/api/cron/*`, `/api/admin/*`, `/api/investments/grz/*` auctions and calculators, `/api/investments/tax/summary` partially.

## 7. Unverified items

- Single-transaction delete: no UI control found; `AddTransactionModal.tsx` edit mode and `useTransactionForm.ts` were not fully read.
- Cancelled step-up may bounce to login: `lib/api.ts:429-452` throws a 401 with code `STEP_UP_REQUIRED` if the user cancels; global `MutationCache.onError` (`queryClient.ts:200-203`) treats any 401 as an expired session and calls `window.location.assign("/login")`. Not confirmed at runtime.
- Login page when already authenticated: only partially read.
- Global search shortcut: where `searchInputRef` is meant to attach is unknown.
- Categories reorder UI: `useReorderCategoryGroups` appears unused; `CategoriesSection` may call reorder through another path.
- Whether `AdvancedFilterPopover` renders filter presets, and whether `FiltersModal.tsx` is mounted anywhere.
- OCR engine used by `useOcrProcessor` / `lib/receiptParser.ts` not examined.
- Whether `VITE_USE_MOCK_REPORTS_DATA` is set in deployment config.
- Dashboard widget sub-actions and the internals of `BudgetDetailModal`, `GoalCreationWizard`, `ImportWizard` steps and `CategoriesSection` dialogs inventoried at hook and endpoint level only.
