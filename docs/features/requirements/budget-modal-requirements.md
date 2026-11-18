# Budget Modal Requirements (Monarch-aligned)

Status: Draft  
Version: 0.1  
Last updated: 2025-12-20

This document defines requirements for the Budget Settings modal and related Budget and Forecast experiences. It is aligned to Monarch Help Center guidance and the provided UI screenshots.

Related:

- `docs/categories-section-requirements.md`
- `docs/transactions-section-requirements.md`
- `shared/schema.ts` (budgets, budget_periods, category_groups, categories)
- `server/routes/budgets.ts`
- `client/src/pages/Budget.tsx`

## Scope

### In scope (v1)

- Budget Settings modal behavior and preferences
- Budget system selection (Flex vs Category)
- Default apply-scope for budget edits (this month vs all future months)
- Budget Forecast tab (desktop only)
- Group budgeting behaviors and recalculation
- Rollover settings and starting balance
- Move money between categories flow
- Budget page and summary panel UI references from screenshots

### Out of scope (v1)

- Full Budget page redesign beyond modal and forecast behaviors
- Automated budget recommendations beyond "Recalculate defaults"
- ML forecasting or income prediction
- Mobile Forecast view (desktop-only for Forecast)

## UI reference (Monarch screenshots)

### Budget page layout (desktop)

- Top bar: month/year selector, Budget and Forecast tabs, left/right month arrows, Today button, timeframe toggle (Monthly/Yearly), Settings button.
- Left navigation: Dashboard, Accounts, Transactions, Cash Flow, Reports, Budget, Recurring, Goals, Investments.
- Main content: sections for Income and Expenses with group rows (Fixed, Flexible, Non-Monthly) and totals. Each row shows Budget, Actual, Remaining.
- Right panel summary: Left to budget, tabs (Summary, Income, Expenses) with totals and progress bars.

### Budget Forecast tab (desktop only)

- Same left nav and top controls.
- Grid view with months across the top (e.g., May 2025 to Dec 2025).
- Section headers for Income and Expenses, with group rows (Fixed, Flexible, Non-Monthly).
- Each cell shows budget amount for that month and group/category.
- Toggle to show unbudgeted items under each section.

### Budget Settings modal

- Title: "Budget Settings" with close icon.
- Section: System
  - Radio card: Flex Budget (Recommended) with description.
  - Radio card: Category Budget with description.
- Section: "By default, apply budget changes to"
  - Radio card: This month only (description about single month changes).
  - Radio card: All future months (description about applying to current + future).
- Section: More options
  - Row: Recalculate default budgets, with "Recalculate" action button.
  - Row: Clear all budget values, with "Clear all" action button.
  - Row: Budget walkthrough, with "Start setup" action button.

## Functional requirements

### FR-BM-1: Open Budget Settings modal

- Modal opens from Budget page Settings button.
- Modal is household-scoped (settings are shared for the household).
- Closing modal does not apply changes unless explicitly saved (if required by settings type).

### FR-BM-2: Budget system selection (Flex vs Category)

- Budget system is a household-level preference.
- Flex Budget is the default and recommended option.
- Switching systems updates Budget and Forecast views:
  - Flex: Expenses grouped into Fixed, Flexible, Non-Monthly.
  - Category: Each category is budgeted individually.
- Switching systems does not delete existing budget entries.

### FR-BM-3: Default apply-scope for budget changes

- User chooses a default apply-scope:
  - This month only
  - All future months
- Apply-scope preference is used as the default for new edits.
- User can override apply-scope per edit in the edit UI (not in modal).

### FR-BM-4: Recalculate default budgets

- Action recalculates budget amounts using historical averages.
- Recalculate overrides existing budget amounts for all categories/groups.
- Action prompts confirmation because it replaces values.
- If no transaction history exists, show a non-blocking warning.

### FR-BM-5: Clear all budget values

- Action clears all budget amounts for the current budget system.
- Clear includes category and group budgets.
- Action prompts confirmation because it is destructive.

### FR-BM-6: Budget walkthrough

- Starts a guided setup flow (Budget onboarding).
- Includes steps for choosing budget system, setting fixed costs, and flexible amount.
- Flow can be exited without saving.

### FR-BM-7: Budget Forecast (desktop only)

- Forecast tab is visible only on desktop viewports.
- Forecast shows monthly columns for the selected timeframe.
- Budget amounts can be set for any future month.
- Budgets for past months are read-only.
- "All future months" applies changes to selected month and future months.
- "This month only" applies changes to the selected month only.

### FR-BM-8: Group budgeting

- Category groups can be set to budget by group or by category.
- Group budget can be adjusted at any time; totals recalculate immediately.
- Turning group budgeting off returns budgets to categories in the group.
- Group-level totals are the sum of category actuals.

### FR-BM-9: Rollover budgets

- Rollover can be enabled per category or per group.
- Rollover starting balance is supported on first enable.
- Formula: prior rollover + planned budget - actuals = new rollover.
- Rollover setting changes apply to future periods only unless explicitly overridden.

### FR-BM-10: Flex budgeting behavior

- Flex budgeting focuses on the flexible expense number rather than every category.
- Fixed and Non-Monthly groups show category lines; Flexible shows a top-level budget.
- "Left to budget" summary reflects the flexible budget remaining.

### FR-BM-11: Move money between categories

- Users can move money between categories to accommodate overspending.
- Triggered from a "remaining" pill or context action on a category.
- When Flex budgeting is enabled, moves are allowed only from the top-level flexible bucket.

### FR-BM-12: Goals integration

- Save Up Goals appear under a Contributions section in Budget and Forecast.
- Pay Down Goals are tracked in a separate debt view but can show in Budget context.
- Goal contributions can be set for future months in Forecast.

## Data and settings requirements

- Settings stored per household:
  - budgetSystem: "flex" | "category"
  - defaultApplyScope: "this_month" | "all_future"
- Budget entries reference category or category group (mutually exclusive).
- Rollover settings stored at category/group level and used in budget calculations.
- Forecast uses budget periods keyed by month and year.

## UI requirements (Budget Settings modal)

- Use card-style radio rows with title, description, and optional "Recommended" badge.
- Section headers: "System", "By default, apply budget changes to", "More options".
- Action rows use a left description and right-aligned button.
- Buttons use concise labels: "Recalculate", "Clear all", "Start setup".
- Modal width matches screenshot proportions and centers on desktop.
- Background page should be dimmed when modal is open.

## Detailed task list

### Decisions and alignment

- [ ] Confirm budget system preference storage (household-level flag for flex vs category).
- [ ] Confirm default apply-scope storage and how overrides are captured per edit.
- [ ] Confirm Forecast visibility rule (desktop-only breakpoint).
- [ ] Confirm how group budgeting toggles map to category group types and Budget UI grouping.

### Data model and migrations

- [ ] Add or validate household preferences fields: `budgetSystem`, `defaultApplyScope`.
- [ ] Add or validate budget period storage for Forecast (month/year keyed data).
- [ ] Ensure rollover starting balance storage on categories/groups is used in budget periods.
- [ ] Add indexes needed for forecast queries (household_id, month, year).

### Backend API

- [ ] Add `GET/PUT /api/budget/settings` to read/write budget system and default apply-scope.
- [ ] Add `POST /api/budgets/recalculate` to recompute default budgets from history.
- [ ] Add `POST /api/budgets/clear` to clear all budget values for the household.
- [ ] Add forecast endpoints (list/update budget amounts by month and scope).
- [ ] Add move-money endpoint to transfer budget amounts between categories/groups.

### Budget calculations and rules

- [ ] Enforce budget system rules in calculations (flex vs category).
- [ ] Respect group budgeting mode for group-level totals and editing.
- [ ] Implement rollover math per period (prior rollover + budget - actuals).
- [ ] Enforce transfer category exclusion and category `includeInBudget`.

### Frontend - Budget Settings modal

- [ ] Build modal UI matching screenshot layout and copy.
- [ ] Wire system selection to settings API and update budget view mode.
- [ ] Wire default apply-scope selection to settings API.
- [ ] Implement "Recalculate", "Clear all", and "Start setup" actions with confirmations.

### Frontend - Budget page

- [ ] Implement Budget and Forecast tabs with shared top controls (month nav, timeframe).
- [ ] Render Forecast grid view with monthly columns and group/category rows.
- [ ] Add "Show unbudgeted" toggle per section in Budget and Forecast.
- [ ] Implement right summary panel tabs (Summary/Income/Expenses).

### Move money flow

- [ ] Add UI affordance from remaining pill or context menu.
- [ ] Implement modal to select source and destination categories and amount.
- [ ] Enforce flex budgeting restrictions (moves only from flex bucket).

### Tests and QA

- [ ] API tests for settings, recalculate, clear, forecast, and move-money endpoints.
- [ ] Budget calculation tests for flex vs category and group budgeting rules.
- [ ] UI tests for Settings modal, Forecast grid, and move-money flow.

## Acceptance criteria

- Settings modal matches the UI structure shown in screenshots.
- Budget system toggles between Flex and Category without data loss.
- Default apply-scope is persisted and used in edit flows.
- Forecast tab appears on desktop only and supports future-month editing.
- Group budgets recalc immediately when edited.
- Rollover behavior and starting balance are supported.
- Move money flow respects Flex budgeting constraints.

## Sources (Monarch Help Center)

- <https://help.monarch.com/hc/en-us/articles/12398848658708-Budget-Forecast>
- <https://help.monarch.com/hc/en-us/articles/18345219809940-Group-Budgeting>
- <https://help.monarch.com/hc/en-us/articles/4411119762196-Rollover-Budgets>
- <https://help.monarch.com/hc/en-us/articles/32125337244052-Using-Flex-Budgeting>
- <https://help.monarch.com/hc/en-us/articles/360048883631-Creating-Your-Budget-in-Monarch>
- <https://help.monarch.com/hc/en-us/articles/360048883591-Moving-Money-Between-Categories-to-Accommodate-Overspending>
- <https://help.monarch.com/hc/en-us/articles/360048393132-Getting-Started-with-Monarch>
- <https://help.monarch.com/hc/en-us/articles/17502951187988-Using-Pay-Down-Goals>
- <https://help.monarch.com/hc/en-us/articles/115000072583-Using-Save-Up-Goals>
