# Transactions Section Requirements (Monarch-aligned)

Status: Ready for implementation  
Version: 1.0  
Last updated: 2025-12-17

This document defines the functional and UI requirements for the Transactions section, aligned to the provided Monarch Transactions screenshots (toolbar, popovers/modals, and empty state). It also includes an implementation plan, design outline, and task breakdown.

Related:

- `docs/implementation-plan-v7-final.md` (canonical invariants)
- `docs/architecture/architecture-requirements.md`
- `docs/analytics-reporting-architecture.md` (transactions are upstream of analytics)

## Why Transactions First

Transactions are the daily workflow in a finance app: users review activity, add items, correct categorization, and reconcile. Most other features (budgets, cashflow, net worth, reports, goals) depend on transactions being correct, searchable, and quickly manageable.

## Scope

### In scope (v1)

- Transactions page list view (read)
- Summary panel (right sidebar) with toggle icon
- Search popover (Apply/Cancel/Clear behavior)
- Date range popover (presets + custom range)
- Filters modal (Categories, Merchants, Accounts, Tags, Goals, Amount, Other)
- View selector dropdown (defaults to "All transactions")
- Add transaction modal (Debit/Credit) for income/expense
- Recurring transaction option in Add transaction modal (creates recurring rule)
- Edit/delete transaction flow (required for day-to-day usability)
- Transfer display handling (read-only display in v1; creation can remain separate)

### Planned enhancements (Phase 1.1+)

- Bulk actions for multi-select editing
- Receipt attachments (images/PDFs) on transactions
- Split transactions UI (parent/child)
- Transfer creation flow (separate from Add transaction)
- Transaction history/audit log in detail view
- Power-user keyboard shortcuts and mobile gestures

### Explicitly out of scope (v1)

- Analytics pages (Reports, Sankey, etc.)
- Offline-first analytics (Transactions offline is covered elsewhere)

## Canonical invariants (must not be violated)

These are non-negotiable system rules referenced from `docs/implementation-plan-v7-final.md`.

1. Amount storage is always positive `decimal(15,2)`; display sign is derived from type (income adds, expense subtracts).
2. Transfers are represented as two linked rows (pair), with identical amount and currency, and `is_transfer_in` indicating direction.
3. Household scoping: all reads/writes must filter by `household_id` first, before any other condition.
4. Privacy: a transaction is visible only if the transaction is visible AND the referenced account is visible for the viewer.
5. Idempotency: mutations support `idempotency_key` (UUID v4) to prevent duplicates.
6. Optimistic concurrency: updates must include an `updated_at` version check.
7. Date range cap: reject ranges > 730 days.
8. List `limit` cap: max 200 (transactions list and similar list endpoints).

## Screenshot alignment (parity targets)

The following must match the screenshots exactly (copy and interaction semantics), unless noted as an open question.

### Page chrome and toolbar

- Page title: "Transactions"
- View selector: dropdown labeled "All transactions" (default)
- Toolbar buttons (right side, left-to-right):
  - Search
  - Date
  - Filters
  - Edit rules
  - Add transaction (primary, orange)
  - Summary panel toggle icon (shows/hides the right sidebar)

### Empty state

- Headline: "No transactions yet"
- Subtext: "Add an account and start tracking your transactions."
- Button: "Clear filters" (resets all applied filters/search/date/view)

### Summary panel (right sidebar)

- Title: "Summary"
- Toggle: the toolbar "Summary panel toggle icon" shows/hides this panel.
- Empty state (when there are no transactions matching applied filters):
  - Headline: "No transactions yet"
  - Subtext: "Add an account and start tracking your transactions."
  - Button: "Clear filters"

### Search popover

- Title: "Search"
- Input placeholder: "Enter a search term..."
- Helper text: "We'll match your search term to merchant names, categories, original statements, amounts, and notes."
- Footer buttons: "Clear", "Cancel", "Apply"
- Behavior: changes are not applied until "Apply" is clicked.

### Date range popover

- Title: "Date Range"
- Presets (left column):
  - Last 7 days
  - Last 14 days
  - Last 30 days
  - This month
  - Last month
  - This year
  - Last year
- Start date + End date inputs with placeholder `MM/DD/YYYY` and calendar icon
- Per-field "Clear" link on the right of each date input
- Footer buttons: "Clear", "Cancel", "Apply"
- Behavior: changes are not applied until "Apply" is clicked.

### Filters modal

- Title: "Filters"
- Left navigation sections:
  - Categories
  - Merchants
  - Accounts
  - Tags
  - Goals
  - Amount
  - Other
- Middle panel: selectable list with checkboxes and "Select all"
- Right panel: selected filter summary with count (e.g., "0 filters selected")
- Footer buttons: "Clear", "Cancel", "Apply" (Apply is primary/orange)
- Behavior: changes are not applied until "Apply" is clicked.

### Add transaction modal

- Title: "Add transaction"
- Toggle: "DEBIT" (expense) and "CREDIT" (income)
- Fields (in order):
  - Amount
  - Merchant
  - Date
  - Account
  - Category
  - Goal
  - Recurring Transaction (optional section)
  - Notes
  - Tags
  - Attachments (optional)
- Footer buttons: "Cancel" and "Add transaction"

## Functional requirements

### FR-1: List transactions (read)

- The transactions list shows all visible transactions for the current household, respecting privacy rules.
- Default sort: newest first (date desc; stable tie-breaker by id desc).
- Supports pagination and large datasets without UI freezing.
- Must support filtering and search (see FR-2 to FR-5).

### FR-2: Search

- Search is applied from the Search popover only after clicking Apply.
- Search semantics (case-insensitive):
  - Transaction name
  - Merchant name (if present)
  - Category name (if present)
  - `original_name` (if present)
  - Notes (if present)
  - Amount text (e.g., searching "250" matches 250.00)

### FR-3: Date range filter

- Presets set start/end dates and require Apply to commit.
- Custom ranges (start/end) must validate:
  - start <= end
  - (end - start) <= 730 days (hard cap; block Apply if violated)
- Default behavior with no date range applied: show all time (bounded by pagination).

### FR-4: Advanced filters (Filters modal)

All filter changes are staged in the modal and only committed on Apply.

- Categories: multi-select categories; include "Uncategorized" option (category_id is null).
- Merchants: multi-select merchants; include "No merchant" option (merchant_id is null).
- Accounts: multi-select accounts; include private accounts only if viewer has visibility.
- Tags: multi-select tags (see FR-11 for tag system).
- Goals: multi-select goals (active by default; optional include archived).
- Amount: min/max amount (positive). Display filter should consider derived signed amount:
  - For expenses, signed amount is negative for display; filter should apply to absolute stored amount, unless explicitly filtering on signed value.
- Other (recommended set for v1):
  - Type: income, expense, transfer, balance_adjustment
  - Status: pending/cleared/reconciled
  - Reviewed: reviewed / needs review
  - Exclusions: excluded from reports, excluded from budget
  - Privacy: private only / shared only
  - Source: manual/recurring/csv_import/whatsapp/receipt_scan

### FR-5: View selector ("All transactions")

- Default is "All transactions".
- The view selector is a convenience filter preset that updates applied filters.
- Minimum required views:
  - All transactions
  - Income
  - Expenses
  - Transfers
  - Needs review
  - Uncategorized

### FR-6: Add transaction (income/expense)

Debit/Credit toggle maps to transaction types:

- DEBIT -> `type = "expense"`
- CREDIT -> `type = "income"`

Rules:

- Amount entered is always positive; UI displays sign based on DEBIT/CREDIT.
- Required fields (recommended): amount, merchant/name, date, account.
- Category is optional at API level but should be strongly encouraged; allow "Uncategorized".
- On submit:
  - Send `idempotency_key` (UUID v4)
  - Show loading state on "Add transaction"
  - On success, close modal and refresh list without losing applied filters
  - If API returns duplicate (idempotency hit), treat as success and show a subtle notice (no double-insert)

### FR-7: Summary panel

- Summary panel is shown/hidden via the toolbar "Summary panel toggle icon".
- The summary must reflect the currently applied filters (view, search, date range, and advanced filters), not a different global scope.
- When there are no results for the applied filters, show the Summary empty state copy (see screenshot alignment section).
- When there are results, show at minimum:
  - Total transactions (count)
  - Total income (sum of income)
  - Total spending (sum of expense)
  - Net flow (income - spending)
  - Largest transaction (by absolute amount, excluding transfers)
  - Largest income (by amount)
  - Largest expense (by amount)
  - Average transaction amount (recommended: absolute, excludes transfers)
  - First transaction date (min)
  - Last transaction date (max)
- Provide a "Download CSV" action from the summary panel for the currently applied filters.
- Optional (if available): Top categories and top merchants (top 10 by total).

### FR-8: Recurring transaction (Add transaction modal)

The Add transaction modal supports creating a recurring rule tied to the Recurring system.

- Control: checkbox labeled "Recurring Transaction" (default off).
- When enabled, reveal:
  - Frequency (dropdown): daily, weekly, biweekly, monthly, quarterly, yearly
  - End Date (Optional): date picker; blank means no end date
  - Create Rule toggle (optional): "Automatically categorize future transactions" (ties into Rules; see FR-12)
- Submission semantics (recommended for correctness):
  - Create the one-off transaction for the selected date.
  - Create a recurring rule using the same core fields (account, type, amount, name, optional category/merchant/notes).
  - Set the recurring rule `startDate` to the transaction date.
  - Set the recurring rule `nextDueDate` to the next occurrence AFTER the transaction date (prevents the scheduler from duplicating the transaction you just created).
  - Link the created transaction to the recurring rule via `recurringTransactionId` and set `isRecurring=true`.
- Recurring-generated transactions (created later by scheduler/job) must:
  - Use `source="recurring"`
  - Set `recurringTransactionId` to the rule id
  - Respect account visibility, household scoping, and balance update invariants

### FR-9: Edit and delete transaction

- Clicking a transaction row opens a detail view (drawer or modal) that supports:
  - View all fields
  - Enter edit mode
  - Save (PUT) with optimistic concurrency (`updated_at` check)
  - Delete (soft delete) with confirmation dialog
- Errors:
  - 409 conflict: show "This transaction changed since you opened it" with actions to reload or overwrite (policy decision; default reload).
  - 403/404: show a safe error and refresh list.

### FR-10: Transfer display (read)

Data model is two linked rows; UI should avoid double-counting in the list display.

Preferred v1 behavior:

- Render a transfer pair as a single logical row in the list:
  - Show "Transfer" as name (or the stored name if set)
  - Show "From Account -> To Account" subtext
  - Amount shown once
- Detail view for transfer shows both legs and forbids splitting.

If backend cannot provide collapsed pairs initially:

- Client may collapse transfer pairs by grouping on `transfer_transaction_id`/`is_transfer_in`, but must handle missing pairs gracefully.

### FR-10b: Transfer creation (v2)

- Provide a separate "Add transfer" flow (not the debit/credit toggle).
- Required fields: From account, To account, Amount, Date; optional notes/name.
- Amount is positive; no sign toggle.
- Create both linked transfer transactions atomically via `POST /api/transactions/transfer`.
- Ensure idempotency behavior matches standard transaction creation.
- Transfers are not splittable.

### FR-11: Tags (needed for screenshot parity)

Tags must be first-class, household-scoped entities.

- Tag picker supports search and multi-select.
- Allow creating new tags from the picker (optional for v1; recommended).
- Transactions can have 0..N tags.

### FR-12: Rules entry point

- "Edit rules" button navigates to or opens the rules management UI.
- Transaction flows should support rule application:
  - `original_name` preserved
  - `name` updated by rule
  - Rule application is observable (audit-friendly) but must not log PII.

### FR-13: Bulk actions (Phase 1.1)

- Multi-select transactions with checkboxes.
- Bulk categorize (assign same category to N transactions).
- Bulk tag (add/remove tags).
- Bulk review (mark as reviewed).
- Bulk delete with confirmation: "Delete N transactions?"
- Selection persists across pagination (or clearly indicates selection scope).

### FR-14: Receipt attachments (Phase 1.1)

- Transaction detail allows attaching 1+ receipt images/documents.
- Supported formats: JPEG, PNG, PDF (max 5MB each).
- Attachments stored securely and referenced by transaction.
- View attachments in a lightbox or viewer; allow removal.
- Receipt uploads must not expose private URLs without auth.

### FR-15: Split transactions UI (Phase 1+)

- Parent transaction shows "Split" badge.
- Expanding shows child splits with individual category/merchant/amount.
- Edit flow enforces split invariant: sum(children) = parent.
- Removal of splits restores the parent to a single transaction.

### FR-16: Transaction history (recommended)

- Transaction detail shows an edit history timeline.
- Fields shown: who changed, when, and what changed.
- History must be household-scoped and visible only to permitted users.

## UI/UX requirements (detailed)

### Transactions list view layout (recommended)

Even though the screenshot shows an empty state, the target list layout should match the existing app style and common Monarch behavior:

- Sticky date headers while scrolling (e.g., "November 22, 2025")
- Transaction rows:
  - Left: category icon / merchant logo (round)
  - Middle: merchant/name (primary), category/account/tags (secondary)
  - Right: amount (monospace), color:
    - Income: green and prefixed with "+"
    - Expense: default text and prefixed with "-"
    - Transfer: neutral (no +/-) or a distinct transfer style
  - Hover: row highlight; optional quick actions (edit/delete)

### Apply/Cancel/Clear semantics (critical)

All three controls (Search, Date, Filters) must share the same interaction model:

- Draft state while popover/modal is open
- "Apply" commits draft -> applied and refetches list
- "Cancel" closes without committing draft changes
- "Clear" resets draft selections (does not apply until Apply is pressed), except the Empty State "Clear filters" which resets and applies immediately

### Summary panel behavior (UI)

- Desktop/tablet: summary appears as a right sidebar panel.
- Toggle icon (top right) shows/hides the panel and expands/contracts the list area.
- Persist the open/closed state per-user (local storage is acceptable for v1).
- Mobile: summary opens as a drawer/sheet (not a permanently visible sidebar).

### Mobile UX requirements (recommended)

- Swipe gestures on transaction rows:
  - Swipe left: quick delete (with undo toast)
  - Swipe right: mark as reviewed
- Add Transaction opens as a bottom sheet or full-screen modal.
- Pull-to-refresh on the list.
- Filters accessible via a floating action button or bottom sheet.

## API and data contract requirements

This section defines what the Transactions UI needs from the backend. If current APIs do not support these fields/filters, they must be added (see implementation tasks).

### Envelope shape

All endpoints used by Transactions must return:

```
{ "success": true, "data": ... }
{ "success": false, "error": { "code": string, "message": string, "details"?: any } }
```

### Required endpoints

- `GET /api/transactions`
  - Must support: pagination, date range, account/category/merchant filters, search, and sorting.
  - Must enforce: `limit <= 200`, date range <= 730 days.
  - Must return enough denormalized fields for the list:
    - account name
    - category name/icon/color (optional)
    - merchant name/logo (optional)
    - tags (optional in v1 if tags not shipped)
- `POST /api/transactions`
  - Create income/expense; accepts `idempotency_key`
- `PUT /api/transactions/:id`
  - Update; supports optimistic concurrency via `updated_at`
- `DELETE /api/transactions/:id`
  - Soft delete
- `POST /api/transactions/:id/attachments`
  - Upload receipt/attachment and associate to transaction
- `GET /api/transactions/:id/attachments`
  - List attachments for a transaction
- `DELETE /api/transactions/:id/attachments/:attachmentId`
  - Remove an attachment
- `GET /api/accounts`, `GET /api/categories`, `GET /api/merchants`, `GET /api/goals`
  - Provide filter options and selectors
- `GET /api/transactions/summary` (or an equivalent `GET /api/transactions/stats`)

  - Returns Summary panel metrics for the currently applied filters and date range.
  - Must exclude transfers from income/spending calculations.
  - Recommended response shape:

    ```json
    {
      "totalCount": number,
      "totalIncome": number,
      "totalExpense": number,
      "netFlow": number,
      "largestIncome": { "id": string, "amount": number, "name": string, "date": string },
      "largestExpense": { "id": string, "amount": number, "name": string, "date": string },
      "avgAmount": number,
      "dateRange": { "first": string, "last": string },
      "byCategory": Array<{ "categoryId": string, "name": string, "total": number, "count": number }>,
      "byMerchant": Array<{ "merchantId": string, "name": string, "total": number, "count": number }>
    }
    ```

  - `largestTransaction` can be derived from `largestIncome` and `largestExpense` if needed.

- `GET /api/recurring`, `POST /api/recurring`
  - Create/list recurring rules so Add Transaction can create a rule and the Recurring page can display it.
- `GET /api/tags` and `POST /api/tags` (to be implemented if missing)

### Recommended `GET /api/transactions` query parameters

Minimum:

- `limit` (1..200)
- `cursor` (preferred) or `offset` (fallback)
- `startDate`, `endDate` (YYYY-MM-DD)
- `accountId[]`
- `categoryId[]`
- `merchantId[]`
- `tagId[]`
- `goalId[]` (if goal-filtering is required)
- `type[]`
- `status[]`
- `isPending` (boolean)
- `isPrivate` (boolean or enum: any/private/shared)
- `isExcludedFromReports` (boolean)
- `isExcludedFromBudget` (boolean)
- `reviewState` (enum: any/reviewed/needs_review)
- `search` (string)
- `sort` (enum: date_desc,date_asc,amount_desc,amount_asc,merchant_asc,category_asc)

Security:

- Validate referenced IDs belong to household before executing heavy queries.
- Always apply `WHERE household_id = ? AND deleted_at IS NULL` first.
- Enforce account visibility (join accounts and apply its privacy rules).

## Design and implementation approach

### Frontend architecture

- Applied filter state should live in the URL query string for shareable links and refresh persistence.
- Draft filter state lives in component state inside popovers/modals and is only promoted on Apply.
- Data fetching uses TanStack Query; query key includes the normalized applied filter object.
- List rendering should support:
  - Initial load skeleton
  - Empty state (no results OR no transactions)
  - Error state with retry
  - Infinite scrolling or explicit "Load more"

### Performance and scalability

- Prefer cursor-based pagination for large datasets (avoids offset scan).
- Add list virtualization if rendering > ~200 rows at once.
- Debounce typeahead queries inside selectors (merchant/category/tag) but do not auto-apply list search (search uses Apply).

### Accessibility

- All popovers/modals trap focus and return focus to trigger on close.
- Keyboard:
  - Esc closes and cancels draft changes
  - Enter in Search applies
- Keyboard shortcuts (recommended):
  - n: New transaction
  - e: Edit selected transaction
  - c: Quick categorize selected
  - r: Mark as reviewed
  - /: Focus search
  - j/k: Navigate up/down in list
  - x: Toggle selection for bulk actions
- Buttons and inputs have accessible labels and predictable tab order.

## Implementation plan (milestones)

### Milestone T0: Confirm UX decisions (0.5 day)

- Decide transfer display (collapsed pair vs two rows) for v1.
- Decide Summary panel math scope (see FR-7 and Open Questions).
- Decide Goal field semantics in Add transaction:
  - Option A (recommended): selecting a goal creates a goal contribution linked to the created transaction.
  - Option B: Goal is only a UI label (requires new data model).
- Decide recurring creation semantics (single server call vs two calls) and nextDueDate rule (see FR-8).
- Confirm required fields in Add transaction (merchant/name and account required).

### Milestone T1: Backend gaps for Transactions UI (2-4 days)

- Add missing list filters and search to `GET /api/transactions`.
- Raise list limit max to 200 and enforce date range cap (<= 730 days).
- Implement secure account visibility join (transaction + account privacy).
- Add tags API (if not present):
  - `GET /api/tags`, `POST /api/tags`
  - Transaction tag attach/detach on create/update
- Add search strategy:
  - v1: `ILIKE` across joined fields (acceptable for small datasets)
  - v1.1: full-text index (tsvector + GIN) for scale

### Milestone T2: Frontend toolbar parity (1-2 days)

- Replace current inline search with Search button + popover (per screenshots).
- Implement Date popover with presets and start/end inputs.
- Implement Filters modal with left nav + selected summary.
- Add view selector dropdown labeled "All transactions".
- Add Summary panel toggle icon and right sidebar panel container (with empty state parity).

### Milestone T3: Data integration and list view (1-3 days)

- Remove mock data from `client/src/pages/Transactions.tsx` and fetch real data.
- Add loading/empty/error states with screenshot copy.
- Implement pagination (infinite scroll or Load more) honoring limit and range caps.
- Implement transfer collapsing behavior (if chosen).

### Milestone T4: Add transaction modal parity and API integration (1-3 days)

- Implement DEBIT/CREDIT toggle labels and field order per screenshots.
- Use a validated form (React Hook Form + Zod) with:
  - Amount formatting and validation
  - Date picker
  - Account/category/merchant selectors (searchable)
  - Goal selector (if enabled)
  - Recurring Transaction section (frequency + end date + create rule toggle)
  - Tags multi-select (if enabled)
- Generate and send `idempotency_key` for create.
- Refresh list on success without losing filters.

### Milestone T5: Edit/delete flows (1-3 days)

- Implement transaction detail view with edit mode and delete confirmation.
- Implement optimistic concurrency conflict handling (409).
- Ensure transfers delete both legs (if editing/deleting transfers is supported).

### Milestone T6: QA, tests, and release checklist (1-2 days)

- Add unit tests for filter state transitions (draft vs applied).
- Add integration tests for:
  - Search Apply/Cancel/Clear behavior
  - Date presets and custom range validation
  - Filters modal Apply/Cancel/Clear behavior
  - Add transaction happy path + validation errors
- Add API tests for:
  - household scoping
  - account privacy enforcement
  - search correctness
  - date range cap rejection
- Manual QA checklist:
  - Keyboard navigation through all controls
  - Empty state copy and Clear filters behavior
  - Large list performance (1k+ transactions)

### Milestone T7: Phase 1.1 parity enhancements (1-2 weeks)

- Bulk actions:
  - Multi-select across pagination and bulk edit API endpoints.
- Receipt attachments:
  - Attachment upload endpoints and secure file serving.
  - Detail view attachment gallery and delete flow.
- Split transactions UI:
  - Split editor, open splits, remove splits, and split badge.
- Transfer creation flow:
  - Dedicated Add Transfer modal and API integration.
- Transaction history:
  - Persist edit history and expose in detail view.
- Extended summary stats:
  - Implement summary endpoint response shape with top categories/merchants.
- Keyboard shortcuts and mobile gestures:
  - Power-user shortcuts and swipe actions with undo.

## Acceptance criteria (must pass)

- UI parity: toolbar buttons, popovers/modals, and empty state match screenshots (labels + Apply/Cancel/Clear semantics).
- Summary parity: right sidebar Summary panel toggles via icon and matches empty state copy; metrics update with applied filters.
- Security: no cross-household reads; account privacy is enforced in transaction visibility.
- Correctness: adding/editing/deleting transactions updates list immediately and preserves applied filters.
- Constraints enforced:
  - `limit <= 200`
  - date range <= 730 days
  - amount is non-negative and stored as positive (display sign derived)
- Reliability:
  - idempotency prevents duplicate creates on retries
  - optimistic concurrency prevents silent overwrites
- Recurring: enabling "Recurring Transaction" creates a recurring rule visible in Recurring and does not duplicate the created transaction on the next scheduler run.
- Phase 1.1 parity (when enabled): bulk actions, attachments, split UI, transfer creation, audit history, keyboard shortcuts, and mobile gestures.

## Decisions (final)

1. "All transactions" includes transfers by default; transfers are visually differentiated.
2. Goal field creates a goal contribution record for CREDIT only (savings targets).
3. Amount filters use absolute stored amounts.
4. Pagination is cursor-based immediately.
5. Summary math uses absolute amounts; separate income/expense averages if needed.
6. Recurring creation is a single atomic call; recurring-generated transactions default to `pending`, manual creation defaults to `cleared`.
