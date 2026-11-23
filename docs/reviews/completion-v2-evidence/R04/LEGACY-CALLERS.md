# R04.1 legacy adapter callers

Source inventory at base `ba227f1e92577e74942d6719b9f02a9d849afd96`, after the six explicitly traced inputs-only calculator gate replacements. Every remaining production `requireRole(...)` call is listed; this is not a complete capability or privacy audit. Paths are relative to repository root.

| File:line | Router declaration | Legacy allowed role set |
|---|---|---|
| server/modules/accounts/accounts.routes.ts:59 | post "/" | "member" |
| server/modules/accounts/accounts.routes.ts:64 | put "/:id" | "member" |
| server/modules/accounts/accounts.routes.ts:69 | delete "/:id" | "member" |
| server/modules/accounts/accounts.routes.ts:80 | post "/:id/adjust-balance" | "member" |
| server/modules/accounts/accounts.routes.ts:85 | post "/:id/archive" | "member" |
| server/modules/accounts/accounts.routes.ts:90 | post "/:id/unarchive" | "member" |
| server/modules/accounts/accounts.routes.ts:111 | post "/:id/balance-history/import" | "member" |
| server/modules/accounts/accounts.routes.ts:127 | post "/:id/transactions/import" | "member" |
| server/modules/accounts/accounts.routes.ts:137 | patch "/:id/settings" | "member" |
| server/modules/ai/ai.routes.ts:64 | post '/consent' | 'admin' |
| server/modules/ai/ai.routes.ts:88 | delete '/conversations/:id' | 'member' |
| server/modules/budgets/budgets.routes.ts:34 | post "/" | "member" |
| server/modules/budgets/budgets.routes.ts:37 | put "/settings" | "member" |
| server/modules/budgets/budgets.routes.ts:42 | post "/recalculate" | "member" |
| server/modules/budgets/budgets.routes.ts:45 | post "/clear" | "member" |
| server/modules/budgets/budgets.routes.ts:46 | post "/move" | "member" |
| server/modules/budgets/budgets.routes.ts:49 | put "/forecast/:id" | "member" |
| server/modules/budgets/budgets.routes.ts:57 | put "/:id" | "member" |
| server/modules/budgets/budgets.routes.ts:58 | delete "/:id" | "member" |
| server/modules/categories/categories.routes.ts:19 | post "/seed" | "admin" |
| server/modules/categories/categories.routes.ts:24 | put "/reorder" | "member" |
| server/modules/categories/categories.routes.ts:30 | post "/groups" | "member" |
| server/modules/categories/categories.routes.ts:33 | put "/groups/reorder" | "member" |
| server/modules/categories/categories.routes.ts:38 | put "/groups/:id" | "member" |
| server/modules/categories/categories.routes.ts:43 | delete "/groups/:id" | "member" |
| server/modules/categories/categories.routes.ts:48 | put "/groups/:id/restore" | "member" |
| server/modules/categories/categories.routes.ts:55 | post "/" | "member" |
| server/modules/categories/categories.routes.ts:56 | put "/:id" | "member" |
| server/modules/categories/categories.routes.ts:59 | delete "/:id" | "member" |
| server/modules/categories/categories.routes.ts:64 | patch "/:id/archive" | "member" |
| server/modules/categories/categories.routes.ts:69 | put "/:id/restore" | "member" |
| server/modules/filter-presets/filter-presets.routes.ts:23 | post "/" | "member" |
| server/modules/filter-presets/filter-presets.routes.ts:24 | patch "/:id" | "member" |
| server/modules/filter-presets/filter-presets.routes.ts:25 | delete "/:id" | "member" |
| server/modules/goals/goals.routes.ts:36 | post "/images" | "member" |
| server/modules/goals/goals.routes.ts:45 | post "/transfers" | "member" |
| server/modules/goals/goals.routes.ts:64 | post "/" | "member" |
| server/modules/goals/goals.routes.ts:66 | put "/:id" | "member" |
| server/modules/goals/goals.routes.ts:69 | delete "/:id" | "member" |
| server/modules/goals/goals.routes.ts:74 | post "/:id/complete" | "member" |
| server/modules/goals/goals.routes.ts:79 | post "/:id/archive" | "member" |
| server/modules/goals/goals.routes.ts:84 | post "/:id/unarchive" | "member" |
| server/modules/goals/goals.routes.ts:95 | post "/:id/assign-account" | "member" |
| server/modules/goals/goals.routes.ts:100 | put "/:id/accounts/:accountId" | "member" |
| server/modules/goals/goals.routes.ts:105 | delete "/:id/accounts/:accountId" | "member" |
| server/modules/goals/goals.routes.ts:119 | post "/:id/contribute" | "member" |
| server/modules/goals/goals.routes.ts:124 | post "/:id/transactions" | "member" |
| server/modules/goals/goals.routes.ts:129 | delete "/:id/transactions/:txId" | "member" |
| server/modules/goals/goals.routes.ts:135 | post "/:id/calculate-payoff" | "member" |
| server/modules/investments/investments.routes.ts:30 | post "/securities" | "member" |
| server/modules/investments/investments.routes.ts:35 | put "/securities/:id/price" | "member" |
| server/modules/investments/investments.routes.ts:46 | post "/holdings" | "member" |
| server/modules/investments/investments.routes.ts:51 | put "/holdings/:id" | "member" |
| server/modules/investments/investments.routes.ts:56 | delete "/holdings/:id" | "member" |
| server/modules/investments/investments.routes.ts:91 | post "/transactions" | "member" |
| server/modules/investments/investments.routes.ts:101 | post "/fx-rates" | "member" |
| server/modules/merchants/merchants.routes.ts:17 | post "/merge/:historyId/undo" | "member" |
| server/modules/merchants/merchants.routes.ts:18 | post "/seed" | "member" |
| server/modules/merchants/merchants.routes.ts:19 | post "/merge" | "member" |
| server/modules/merchants/merchants.routes.ts:20 | post "/:sourceId/merge" | "member" |
| server/modules/merchants/merchants.routes.ts:22 | post "/" | "member" |
| server/modules/merchants/merchants.routes.ts:23 | put "/:id" | "member" |
| server/modules/merchants/merchants.routes.ts:24 | delete "/:id" | "member" |
| server/modules/receipts/receipts.routes.ts:35 | post "/upload" | "member" |
| server/modules/receipts/receipts.routes.ts:42 | post "/:id/match" | "member" |
| server/modules/receipts/receipts.routes.ts:43 | post "/:id/ocr-results" | "member" |
| server/modules/receipts/receipts.routes.ts:44 | post "/:id/retry-match" | "member" |
| server/modules/receipts/receipts.routes.ts:45 | post "/:id/create-transaction" | "member" |
| server/modules/receipts/receipts.routes.ts:46 | delete "/:id" | "member" |
| server/modules/recurring/recurring.routes.ts:34 | post "/process" | "member" |
| server/modules/recurring/recurring.routes.ts:44 | post "/detect" | "member" |
| server/modules/recurring/recurring.routes.ts:49 | post "/confirm" | "member" |
| server/modules/recurring/recurring.routes.ts:56 | post "/" | "member" |
| server/modules/recurring/recurring.routes.ts:62 | put "/:id" | "member" |
| server/modules/recurring/recurring.routes.ts:63 | delete "/:id" | "member" |
| server/modules/recurring/recurring.routes.ts:70 | post "/:id/skip" | "member" |
| server/modules/recurring/recurring.routes.ts:71 | post "/:id/pause" | "member" |
| server/modules/recurring/recurring.routes.ts:72 | post "/:id/resume" | "member" |
| server/modules/recurring/recurring.routes.ts:73 | post "/:id/end" | "member" |
| server/modules/recurring/recurring.routes.ts:80 | post "/:id/link" | "member" |
| server/modules/recurring/recurring.routes.ts:85 | delete "/:id/link/:linkId" | "member" |
| server/modules/recurring/recurring.routes.ts:94 | post "/transaction" | "member" |
| server/modules/recurring/recurring.routes.ts:99 | post "/transaction/:transactionId" | "member" |
| server/modules/rules/rules.routes.ts:15 | put "/reorder" | "member" |
| server/modules/rules/rules.routes.ts:16 | post "/bulk-enable" | "member" |
| server/modules/rules/rules.routes.ts:17 | post "/bulk-disable" | "member" |
| server/modules/rules/rules.routes.ts:19 | post "/preview" | "member" |
| server/modules/rules/rules.routes.ts:20 | post "/:id/dry-run" | "member" |
| server/modules/rules/rules.routes.ts:22 | post "/" | "member" |
| server/modules/rules/rules.routes.ts:23 | put "/:id" | "member" |
| server/modules/rules/rules.routes.ts:24 | delete "/:id" | "member" |
| server/modules/tags/tags.routes.ts:20 | post "/merge" | "member" |
| server/modules/tags/tags.routes.ts:23 | post "/defaults" | "member" |
| server/modules/tags/tags.routes.ts:28 | post "/" | "member" |
| server/modules/tags/tags.routes.ts:29 | put "/:id" | "member" |
| server/modules/tags/tags.routes.ts:30 | delete "/:id" | "member" |
| server/modules/tags/tags.routes.ts:33 | post "/:id/archive" | "member" |
| server/modules/tags/tags.routes.ts:42 | post "/transaction/:transactionId" | "member" |
| server/modules/tags/tags.routes.ts:47 | put "/transaction/:transactionId" | "member" |
| server/modules/tags/tags.routes.ts:52 | delete "/transaction/:transactionId/:tagId" | "member" |
| server/modules/transactions/transactions.routes.ts:82 | post "/" | "member" |
| server/modules/transactions/transactions.routes.ts:98 | post "/transfer" | "member" |
| server/modules/transactions/transactions.routes.ts:114 | put "/transfer/:id" | "member" |
| server/modules/transactions/transactions.routes.ts:130 | put "/bulk-owner" | "member" |
| server/modules/transactions/transactions.routes.ts:140 | put "/bulk-category" | "member" |
| server/modules/transactions/transactions.routes.ts:150 | put "/bulk-tags" | "member" |
| server/modules/transactions/transactions.routes.ts:160 | put "/bulk-review" | "member" |
| server/modules/transactions/transactions.routes.ts:170 | delete "/bulk" | "member" |
| server/modules/transactions/transactions.routes.ts:180 | put "/:id" | "member" |
| server/modules/transactions/transactions.routes.ts:191 | delete "/:id" | "member" |
| server/modules/transactions/transactions.routes.ts:201 | put "/:id/owner" | "member" |
| server/modules/transactions/transactions.routes.ts:211 | put "/:id/review" | "member" |
| server/modules/transactions/transactions.routes.ts:257 | post "/:id/attachments" | "member" |
| server/modules/transactions/transactions.routes.ts:286 | delete "/:id/attachments/:attachmentId" | "member" |
| server/routes/grz-auctions.ts:100 | post "/auctions/results" | "admin" |
| server/routes/grz-securities.ts:76 | post "/bonds" | "member" |
| server/routes/grz-securities.ts:192 | put "/bonds/:id/sell" | "member" |
| server/routes/grz-securities.ts:343 | post "/tbills" | "member" |
| server/routes/grz-securities.ts:413 | post "/payments/:id/pay" | "member" |
| server/routes/investment-market.ts:20 | post "/refresh" | "member" |
| server/routes/investment-pension.ts:43 | post "/" | "member" |
| server/routes/investment-pension.ts:65 | post "/:id/contributions" | "member" |
| server/routes/investment-recurring.ts:47 | post "/" | "member" |
| server/routes/investment-recurring.ts:70 | delete "/:id" | "member" |

Total: 124 adapter call sites in 18 caller files.

Explicit adapter sets: owner = owner; admin = owner/admin; member = owner/admin/member; view_only = all five known roles. Unknown values have no grant. Professional no longer inherits mutation permission from an undefined ordinal lookup. No production caller currently requests view_only or owner through this adapter.

The six removed callers are POST /api/goals/debt-strategy and /api/goals/calculate-projection in modules/goals/goals.routes.ts, plus POST /api/investments/grz/calculate/{bond-price,ytm,accrued,tbill-yield} in routes/grz-calculators.ts. Their handlers and delegates consume supplied calculator inputs only; only their gates change to financial.read. No calculator body, tax convention, provider, AI consent or paid policy changed.

Classification: accounts/transactions/budgets/categories/tags/recurring/receipts/merchants/rules/investments and investment recurring/pension callers are existing financial or organizational mutation declarations; AI consent remains its existing admin-only policy boundary. AI conversation deletion and filter-preset operations retain their existing member declarations, whose correct personal/AI/shared capability classifications are unresolved. GRZ security/auction and investment-market global/reference permissions remain unresolved operator-scope obligations, not certified household authority. Rule preview/dry-run and saved-goal calculate-payoff retain their legacy member restrictions pending a source-aware, side-effect/visibility audit. The saved-goal calculation is deliberately excluded from the inputs-only exception because its stored progress can encode private sources.

Own profile/display/security/personal export routes are outside this adapter and retain existing admission. The complete registered-route/actor/visibility/export/job matrix remains OPEN for later R04 slices.
