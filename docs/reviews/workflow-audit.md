# Workflow + Code Audit
Date: 2025-12-23

## Scope
- Frontend pages and components under `client/src`.
- API routes and services under `server/routes` and `server/services`.
- Focus: confirm UI -> hook -> API wiring and note placeholders or missing links.

## Summary
- Core finance flows (accounts, transactions, budget, reports, merchants) are wired to APIs.
- Several dashboard and ancillary sections still use mock/demo data.
- Receipts, imports, and rules have specific gaps that block full functionality.
- Tests are present but the full suite has not completed due to memory/time limits.

## Workflow Map (UI -> Hooks -> API)

### Dashboard
- UI: `client/src/pages/Dashboard.tsx`
- Widgets
  - Net Worth: `client/src/components/dashboard/NetWorthWidget.tsx` -> `useAccounts` -> `server/routes/accounts.ts` (chart uses derived mock series)
  - Top Merchants: `client/src/components/dashboard/TopMerchantsWidget.tsx` -> `useReportsSpendingBreakdown` -> `server/routes/reports.ts`
  - Accounts: `client/src/components/dashboard/AccountsWidget.tsx` -> `useAccounts` -> `server/routes/accounts.ts`
  - Budget Summary: `client/src/components/dashboard/DashboardBudgetWidget.tsx` (static)
  - Spending Trend: `client/src/components/dashboard/DashboardSpendingWidget.tsx` (static)
  - Transactions: `client/src/components/dashboard/DashboardTransactionsWidget.tsx` (static)
  - Budget Status: `client/src/components/dashboard/BudgetStatusWidget.tsx` (static)
  - Recurring: `client/src/components/dashboard/RecurringExpensesWidget.tsx` (static)
  - Annual Summary: `client/src/components/dashboard/AnnualSummaryWidget.tsx` (static)

### Accounts
- UI: `client/src/pages/Accounts.tsx`
- Hooks: `useAccounts`, `useNetWorthSummary`, `useNetWorthHistory`, `useExportAccountsSummary`
- API: `server/routes/accounts.ts`, `server/routes/reports.ts` (net worth history)

### Account Detail
- UI: `client/src/pages/AccountDetail.tsx`
- Hooks: `useAccount`, `useAccountBalanceHistory`, `useTransactions`, `useExportTransactions`, `useExportBalanceHistory`
- API: `server/routes/accounts.ts`, `server/routes/transactions.ts`, `server/routes/reports.ts` (exports)

### Transactions
- UI: `client/src/pages/Transactions.tsx`
- Hooks: `useInfiniteTransactions`, `useTransactionSummary`, `useUpdateTransaction`
- API: `server/routes/transactions.ts`
- Add/Edit/Transfer modal: `client/src/components/transactions/AddTransactionModal.tsx`
  - Hooks: `useCreateTransaction`, `useCreateTransfer`, `useUpdateTransfer`, `useUpdateTransaction`, `useDeleteTransaction`
  - Merchants: `useCreateMerchant`, `useUpdateMerchant`
  - Categories: `useCategories`
  - Tags: `useTransactionTags`, `useSetTransactionTags`

### Budget
- UI: `client/src/pages/Budget.tsx`
- Hooks: `useBudgetProgress`, `useBudgetSettings`, `useUpdateBudgetSettings`, `useRecalculateBudgets`, `useClearBudgets`, `useUpdateBudget`, `useCreateBudget`, `useBudgetForecast`, `useUpdateBudgetForecast`, `useMoveBudgetAmount`, `useCategories`, `useGoals`
- API: `server/routes/budgets.ts`, `server/routes/categories.ts`, `server/routes/goals.ts`

### Reports
- UI: `client/src/pages/Reports.tsx`
- Hooks: `useReports*` (spending breakdown, spending trend, cashflow, annual, net worth, income, savings rate)
- API: `server/routes/reports.ts`

### Cash Flow
- UI: `client/src/pages/CashFlow.tsx`
- Hooks: `useReportsCashflow`, `useReportsSankey`
- API: `server/routes/reports.ts`

### Recurring
- UI: `client/src/pages/Recurring.tsx`
- Hooks: `useRecurring`, `useUpcomingBills`
- API: `server/routes/recurring.ts`

### Goals
- UI: `client/src/pages/Goals.tsx`
- Hooks: `useGoals`
- API: `server/routes/goals.ts`

### Merchants
- UI: `client/src/pages/settings/sections/MerchantsSection/index.tsx`
- Hooks: `useMerchants`, `useCreateMerchant`, `useUpdateMerchant`, `useDeleteMerchant`, `useMergeMerchants`, `useMerchantAutocomplete`
- API: `server/routes/merchants.ts`
- Global search: `client/src/components/merchants/GlobalMerchantSearch.tsx`

### Categories / Tags / Rules (Organization)
- UI: `client/src/pages/settings/sections/OrganizationSection/index.tsx`
  - Categories: `client/src/pages/settings/sections/CategoriesSection/*`
  - Tags: `client/src/components/tags/*`
  - Rules: `client/src/pages/settings/sections/RulesSection/index.tsx`
- API: `server/routes/categories.ts`, `server/routes/tags.ts`, `server/routes/rules.ts`
- Rules engine: `server/services/RuleService.ts`

### Receipts
- UI: `client/src/pages/Receipts.tsx`, `client/src/components/receipts/*`
- Hooks: `useReceipts`, `useReceipt`, `useStoreOcrResults`, `useCreateTransactionFromReceipt`
- API: `server/routes/receipts.ts`

### Import Wizard
- UI: `client/src/components/import/*`, `client/src/components/import/ImportWizard.tsx`
- API: `server/routes/import.ts`

### Collaboration
- UI: `client/src/pages/Collaboration.tsx` (demo data only)

### Investments
- UI: `client/src/pages/Investments.tsx` (demo data only)

## Findings (by severity)

### High
- Receipts can attempt to create a transaction with a placeholder account ID, which will fail validation or create invalid data. `client/src/components/receipts/ReceiptDetailModal.tsx:117`
- Import execution falls back to a hard-coded household ID, which can attach imports to the wrong household. `server/routes/import.ts:66`
- Rule action `add_tags` is defined but not implemented, so rules that add tags silently do nothing. `server/services/RuleService.ts:284`

### Medium
- Rules do not implement `conditionLogic` (all vs any), so rules configured for ANY still behave as ALL. `server/services/RuleService.ts:139`
- Transactions page uses static `budgetCategories` and `budgetTags` for category/tag UI, which can drift from DB categories/tags. `client/src/pages/Transactions.tsx:69`
- Dashboard widgets for spending, budget, transactions, recurring, and annual summary are static and do not reflect real data. `client/src/components/dashboard/DashboardSpendingWidget.tsx:6`, `client/src/components/dashboard/DashboardTransactionsWidget.tsx:16`, `client/src/components/dashboard/DashboardBudgetWidget.tsx`, `client/src/components/dashboard/RecurringExpensesWidget.tsx`, `client/src/components/dashboard/AnnualSummaryWidget.tsx`, `client/src/components/dashboard/BudgetStatusWidget.tsx`

### Low
- Attachments in Add Transaction are collected but never uploaded. `client/src/components/transactions/AddTransactionModal.tsx:616`
- The sidebar "Advice" link points to `/advice`, but no route exists, resulting in Not Found. `client/src/components/Layout.tsx:165`, `client/src/App.tsx`
- Breadcrumbs show a hard-coded account label for account detail pages. `client/src/components/Layout.tsx:136`
- Investments and Collaboration pages are demo-only (static data). `client/src/pages/Investments.tsx:24`, `client/src/pages/Collaboration.tsx`
- `initialTransactions` mock list is still defined in Transactions page. `client/src/pages/Transactions.tsx:74`

## Test Status
- The full test suite was not completed; the last run hit a Node.js heap OOM and timed out. See `npm run test:run` output.

## Notes
- Many core APIs are in place; remaining work is focused on replacing placeholders/mocks, completing receipts and import workflows, and wiring dashboard widgets to real analytics.
