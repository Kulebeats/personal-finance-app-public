# Categories Section Requirements (Monarch-aligned)

Status: Ready for implementation  
Version: 1.0  
Last updated: 2025-12-20

This document defines the functional and UI requirements for Categories management (Settings > Categories), aligned to Monarch Help Center guidance and the current codebase. It covers default categories, custom categories and groups, budgeting integration, and transaction usage.

Related:

- `docs/transactions-section-requirements.md`
- `docs/architecture/architecture-requirements.md`
- `shared/schema.ts` (category_groups, categories)
- `server/routes/categories.ts`
- `client/src/pages/settings/sections/CategoriesSection/index.tsx`

## Scope

### In scope (v1)

- Settings > Categories page (search, filter, sort, archived toggle, stats)
- Default categories seed and deactivation (archive) behavior
- Create/edit categories (icon, color, name, group)
- Create/edit category groups (Income, Expenses, Transfers)
- Include/exclude categories from budget
- Category reorder and display order persistence
- Transfer categories (Transfer, Credit Card Payment, Balance Adjustments)
- Category usage across Transactions (add/edit/bulk edit) and Filters
- Group budgeting behavior (by category vs by group)
- Rollover settings for categories and groups (budget integration)
- CommandK category search support (web)

### Planned enhancements (Phase 1.1+)

- Group reorder and group archive/restore
- Category merge and duplicate detection
- Investment sync auto-category creation (Buy/Sell/Dividends)
- Category icon library and per-household icon packs
- Category analytics (trend history, month-over-month deltas)

### Out of scope (v1)

- ML auto-categorization engine improvements
- Full budget UI design (covered in Budget requirements)

## Current code baseline (as of 2025-12-20)

- `shared/schema.ts` defines `category_groups` and `categories` with `includeInBudget`, `isArchived`, `displayOrder`.
- `server/routes/categories.ts` exposes:
  - `GET /api/categories`, `POST /api/categories`, `PUT /api/categories/:id`
  - `DELETE /api/categories/:id` (archives category)
  - `PUT /api/categories/reorder`
  - `POST /api/categories/seed`
  - `GET /api/categories/groups`, `POST /api/categories/groups`
- `server/seed.ts` seeds a Zambian-specific category set (non-Monarch).
- `client/src/pages/settings/sections/CategoriesSection` uses mock data only.
- `client/src/hooks/use-settings.ts` implements real Categories API hooks but is not wired to UI.
- `client/src/hooks/use-finance-data.ts` uses a stub category list (with `type` field) for Transactions filters and Add Transaction, which does not match the DB model (type is on group).
- `CategoryRepository` supports archive/unarchive and atomic reorder, but routes do not expose unarchive or group operations.
- Category list UI expects `budget`, `spent`, and `transactionCount` fields that are not in the schema and must be aggregated.

## Canonical invariants (must not be violated)

1. Category hierarchy is 3 layers: Type -> Group -> Category. Type is Income, Expenses, or Transfers and is not user-editable.
2. Categories and groups are household-scoped; all reads and writes must filter by `household_id`.
3. Each transaction has 0..1 category; tags are multi-select and are not a replacement for categories.
4. Transfer categories (Transfer, Credit Card Payment, Balance Adjustments, Buy/Sell) are excluded from budgets and cash flow totals.
5. Default categories can be deactivated (archived) but not deleted; they remain visible in Settings for re-enable.
6. Archiving a category must not delete historical transactions or their category links.
7. Category order in Settings defines the order in other lists when using category budgeting.

## Functional requirements

### FR-1: List categories and groups (Settings > Categories)

- Display categories grouped by Group and Type (Income, Expenses, Transfers).
- Hide archived categories by default; show with a "Show archived" toggle.
- Provide search by category name and group name.
- Provide sort options: name, spent, budget, transaction count.

### FR-2: Category stats and rollups

- Show totals for: total categories, total budget, total spent, and filtered results count.
- Show group-level stats (count, budget, spent) when filtering by group.
- Category stats must be derived from budgets and transactions for the selected month.

### FR-3: Default categories and seeding

- If no categories exist for a household, seed default categories.
- Default categories are editable (rename, icon, color) but not deletable.
- Default categories can be deactivated (archived) and reactivated later.

### FR-4: Create custom categories

- Create category from Settings > Categories.
- Required: name, group.
- Optional: icon/emoji, color, include in budget toggle.
- Optional: monthly rollover toggle and starting balance (budget integration).
- Category should appear immediately in Transactions selectors and Filters.

### FR-5: Create custom groups

- Allow creating custom groups under Income or Expenses (Transfers optional).
- Required: group name, type (Income/Expenses/Transfers).
- Group supports budgeting mode: "By category" or "By group".
- Users can move existing categories into the new group.

### FR-6: Edit categories and groups

- Edit category: name, icon, color, group, includeInBudget, rollover settings.
- Edit group: name, type (if allowed), budgeting mode.
- Moving a category between groups updates its effective type.

### FR-7: Archive and restore categories

- Archive (deactivate) categories from Settings.
- Archived categories are hidden in selectors and budgets by default.
- Provide a "Restore" action in Settings for archived categories.

### FR-8: Delete categories (custom only)

- Allow deletion only when no transactions reference the category.
- If transactions exist, require recategorization or fallback to archive.
- Deleting a category removes any attached budgets for that category.

### FR-9: Reorder categories

- Support drag-and-drop reorder within a group.
- Persist `displayOrder` and use it across all category lists.

### FR-10: Group budgeting

- Group budgeting can be enabled per group ("By group").
- When enabled, categories within the group no longer have individual budget items.
- Group actuals equal the sum of category actuals in the group.

### FR-11: Exclude categories from budget

- Toggle "Exclude this category from the budget".
- Excluded categories and their transactions are hidden from the budget.
- Excluded categories still appear in cash flow and spending totals.

### FR-12: Rollover budgets

- Rollovers can be enabled per category or group.
- Support starting balance for rollover categories.
- Rollover formula must match Monarch guidance:
  - Prior rollover + planned budget - actuals = new rollover.

### FR-13: Move money between categories (budget adjustment)

- Allow moving budget amounts between categories when overspending.
- Triggered from the red/green remaining pill on a category.
- In flex budgeting, only the top-level flex bucket supports moves.

### FR-14: Transfer categories and credit card payments

- Transfers are categorized under Transfers type and excluded from budgets.
- Credit card payment is a transfer category, not an expense.
- Investment Buy/Sell should be transfer categories (if investment transactions exist).

### FR-15: Transaction and Rules integration

- Category selector in Add Transaction groups categories by type.
- Recategorizing a transaction should offer a "Create rule" shortcut.
- Bulk edit supports changing category for multiple transactions.
- Rules can set categories and run only on non-pending transactions.

### FR-16: CommandK search

- CommandK search should include categories and take users to Settings > Categories.
- CommandK does not search transactions by amount/date.

## UI/UX requirements

### Settings > Categories layout

- Search input with placeholder "Search categories..."
- Group filter dropdown with "All Groups"
- Sort dropdown: Name, Spent, Budget, Transactions
- "Show archived" toggle button
- "Add Category" primary button
- Summary cards: total categories, total budget, total spent, filtered results

### Category item display

- Icon/emoji in a colored square, fallback to first letter.
- Category name, group badge, and "Archived" badge when applicable.
- Spent, budget, and transaction count with icons.
- Budget progress bar with over-budget indicator.
- Actions menu: Edit, Archive/Delete.

### Group management UI

- Group headers show name, type, and budget mode.
- "Create group" action in Settings > Categories header.
- Drag categories to reorder or move between groups.

### Create/Edit Category modal

- Fields: Name, Icon/Emoji, Color, Group
- Toggles: Include in budget, Monthly rollover
- Optional: Starting balance (rollover)
- Footer buttons: Cancel, Save

### Archived behavior

- Archived categories appear greyed out in Settings.
- Archived categories are not shown in selectors unless explicitly included.

### Mobile behavior (parity)

- Settings > Categories shows the same group and category structure.
- Add/edit category and group via mobile-friendly sheets.

## API and data contract requirements

### Envelope shape

```
{ "success": true, "data": ... }
{ "success": false, "error": { "code": string, "message": string, "details"?: any } }
```

### Required endpoints

- `GET /api/categories`
  - Returns `{ categories, groups }`
  - Each category should include `groupName`, `groupType`, and optional stats.
- `GET /api/categories/groups`
  - Returns category groups for the household.
- `POST /api/categories`
  - Create category (groupId, name, icon, color, includeInBudget, rollover settings).
- `PUT /api/categories/:id`
  - Update category.
- `DELETE /api/categories/:id`
  - Archive category; delete only when safe.
- `PUT /api/categories/reorder`
  - Reorder categories by displayOrder.
- `POST /api/categories/seed`
  - Seed default categories if none exist.

### Missing endpoints to add (for parity)

- `PUT /api/categories/:id/restore` (or `PUT /api/categories/:id` with `isArchived=false`)
- `PUT /api/categories/groups/:id` (rename/update group)
- `DELETE /api/categories/groups/:id` (archive group)
- `PUT /api/categories/groups/reorder` (group ordering)
- `POST /api/categories/move` (move categories between groups, if needed)

### Recommended `GET /api/categories` query parameters

- `includeArchived` (boolean)
- `includeStats` (boolean)
- `month`, `year` (for budget/spent totals)
- `type` (income|expenses|transfers)

### Security and validation

- Validate all IDs belong to the household before writes.
- Enforce name length (<= 100), icon length (<= 50), color format (#RRGGBB).
- Ensure group type is one of: income, expenses, transfers.
- Ensure default categories cannot be deleted.

## Design and implementation approach

### Milestone C0: Decisions (0.5 day)

- Confirm final seed list (use the proposed Zambia-aligned defaults below unless overridden).
- Decide how to represent group budgeting mode (group-level setting vs budgets table).
- Decide how rollover settings are stored (budget table vs category metadata).

### Milestone C1: Backend gaps (1-3 days)

- Add group update/delete/reorder endpoints.
- Add archive/restore endpoints for categories.
- Add aggregation for spent/budget/transactionCount in `GET /api/categories`.
- Enforce delete constraints when categories have transactions.

### Milestone C2: Frontend integration (1-3 days)

- Replace mock categories in Settings with `useCategories` hook.
- Add create/edit/archival modals.
- Wire drag-and-drop reorder to API.
- Ensure Add Transaction and Filters use API categories with group type.

### Milestone C3: Budget integration (2-4 days)

- Hook includeInBudget toggle to budget exclusion.
- Implement group budgeting mode and rollovers.
- Add "move money between categories" flow in Budget UI.

### Milestone C4: QA and tests (1-2 days)

- Unit tests for category CRUD and reorder.
- Integration tests for archive/restore and budget exclusion.
- UI tests for Settings > Categories workflows.

## Detailed task list

### Decisions and alignment

- [ ] Confirm final seed list, group names, and whether Business & Side Hustle is seeded by default.
- [ ] Decide whether "Credit Card Payments" exists only as a transfer-type category (recommended) or also under Financial.
- [ ] Decide where to store group budget mode and rollover settings (category_groups table vs budgets table).
- [ ] Define the exact meaning of includeInBudget at category vs transaction level and how it affects budget calculations.
- [ ] Confirm whether transfers are excluded from cash flow in all reports and summary endpoints.

### Database and migrations

- [ ] Add group-level fields needed for budgeting: budgetMode (by_category/by_group) and rolloverEnabled (if stored on group).
- [ ] Add category-level fields for rollover (enabled, startingBalance) if not stored elsewhere.
- [ ] Add indexes needed for category stats aggregation (category_id, date, household_id).
- [ ] Create and run migration scripts for any new columns.

### Seed data

- [ ] Update `server/seed.ts` to use the Zambia-aligned default categories listed in this doc.
- [ ] Ensure transfer categories are seeded with includeInBudget=false and correct group type.
- [ ] Add seed logic for group displayOrder and category displayOrder to match desired UI ordering.
- [ ] Ensure seed is idempotent and respects household scoping.

### Backend API

- [ ] Extend `GET /api/categories` to return groupName and groupType per category.
- [ ] Add `includeArchived` and `includeStats` query parameters to `GET /api/categories`.
- [ ] Implement stats aggregation (budget, spent, transactionCount) for the selected month.
- [ ] Add `PUT /api/categories/:id/restore` (or allow `isArchived=false` on update).
- [ ] Implement safe delete: block category deletion if transactions exist, otherwise delete or archive.
- [ ] Add group endpoints: update, archive/restore, reorder.
- [ ] Add endpoint to move categories between groups (if not covered by update).

### Storage and repositories

- [ ] Add storage methods for group update, archive/restore, reorder.
- [ ] Add repository methods to count transactions by category for safe delete checks.
- [ ] Ensure all category and group operations enforce household scoping.

### Frontend - Settings > Categories

- [ ] Replace mock data in `client/src/pages/settings/sections/CategoriesSection/index.tsx` with `useCategories` (from `client/src/hooks/use-settings.ts`).
- [ ] Add create/edit category modal with name, icon, color, group, includeInBudget, rollover settings.
- [ ] Add create/edit group modal with name and type, plus budget mode toggle.
- [ ] Implement archive/restore actions in the category action menu.
- [ ] Implement drag-and-drop reorder and persist via `PUT /api/categories/reorder`.
- [ ] Display group stats and category stats from API aggregation.
- [ ] Add show archived toggle wired to `includeArchived`.

### Frontend - Transactions integration

- [ ] Replace stub categories in `client/src/hooks/use-finance-data.ts` with API categories plus groupType.
- [ ] Update `client/src/components/transactions/AddTransactionModal.tsx` to group categories by groupType (income/expense/transfer).
- [ ] Update `client/src/components/transactions/FiltersModal.tsx` to use API categories and include "Uncategorized".
- [ ] Ensure category changes in transactions can launch "Create rule" flow.

### Budget integration

- [ ] Ensure category includeInBudget is reflected in budget calculations (and not only per-transaction flags).
- [ ] Implement group budgeting mode and rollup calculation when group is set to by_group.
- [ ] Add rollover logic (per category or group) and starting balance support.
- [ ] Implement "move money between categories" flow in Budget UI.

### CommandK search

- [ ] Include categories in CommandK search data and navigation.

### Tests and QA

- [ ] Add API tests for category CRUD, archive/restore, reorder, and safe delete.
- [ ] Add integration tests for category stats aggregation and budget exclusion.
- [ ] Add UI tests for Settings > Categories create/edit/archive/reorder.
- [ ] Add regression tests for Add Transaction and Filters category behavior.

### Docs and cleanup

- [ ] Update any references to the old seed list in `docs/architecture/architecture-requirements.md` if needed.
- [ ] Document the seed list and constraints in `server/seed.ts` comments.

## Acceptance criteria (must pass)

- Categories page lists groups and categories with correct counts and stats.
- Default categories can be deactivated and reactivated; not deleted.
- Custom categories can be created, edited, reordered, archived, and deleted (when safe).
- Category order persists and is reflected in selectors and lists.
- Transfers and credit card payments are excluded from budgets and cash flow.
- Excluding a category hides it from budgets but keeps it in cash flow totals.
- Group budgeting mode correctly rolls up category actuals.
- CommandK search returns categories (web only).

## Default categories (seed proposal - Zambia aligned)

Seed groups and categories below as default. Users can later rename, add, disable, or re-group.

Income:

- Salary - Primary Job
- Salary - Secondary Job / Contract
- Business Income
- Consultancy / Freelance
- Interest & Dividends
- Rent Received
- Allowances & Per Diems
- Bonuses & Gratuities
- Cashback & Rewards
- Other Income

Housing & Home (Group: Housing & Utilities):

- Rent / Mortgage
- Maid / Domestic Worker
- Gardener / Security Guard
- Waste Collection
- Electricity / Power
- Water
- Home Internet & TV
- Home Improvement & Renovation
- Home Repairs & Maintenance (Plumbing, Electrical, etc.)
- Gas / Cooking Fuel

Food & Groceries:

- Groceries (Home Food)
- Takeaway / Fast Food
- Restaurants & Dining Out
- Work Lunch / Daily Lunch
- Other Food & Snacks

Transport & Vehicles:

- Fuel
- Public Transport (Bus, Minibus, Train)
- Taxi & Ride Hailing (Uber/Bolt/Yango)
- Car Insurance
- Car Maintenance & Repairs
- Parking & Tolls
- Other Transport Costs

Kids & Education (Group: Children & Education):

- School Fees - Child 1
- School Fees - Child 2
- School Materials & Uniforms
- Extra Lessons & Tuition
- Kids Clothing & Shoes
- Kids Entertainment & Activities
- Diapers & Baby Supplies
- Kids Health & Pharmacy

Personal & Family Support (Group: Personal & Family):

- Family Support (Remittances to Relatives)
- Friend Support / Gifts to Friends
- Clothing & Shoes (Adult)
- Toiletries & Personal Care
- Laundry & Cleaning Services
- Pharmacy / Medical (Personal)
- Hair & Grooming (Adult)
- Drinks & Nightlife
- Personal Miscellaneous

Entertainment & Subscriptions:

- Streaming Services (Netflix, Spotify, Apple Music, etc.)
- Software & Online Tools (ChatGPT, Quillbot, Kiro, Manus, Google storage, etc.)
- Entertainment & Recreation (Movies, Events, Outings)
- Hobbies & Fun Money

Shopping & Purchases:

- Household Items (Cleaning, Kitchen, Small Appliances)
- Electronics & Gadgets
- Furniture & Homeware
- Non-Electronic Purchases (Clothes, Books, Misc)
- Post Office & Delivery Costs

Health, Insurance & Financial:

- Health & Medical (Clinics, Hospitals, Lab)
- Insurance Premiums (Health, Life, Other)
- Loan Repayments
- Credit Card Payments
- Bank Charges & Fees
- Taxes & Statutory Payments
- Financial Services & Legal Fees

Savings & Investments:

- Emergency / General Savings
- Holiday / Goal-based Savings
- Building Project / Construction
- Bonds & Investments
- Other Investments

Business & Side Hustle (optional group - Business Expenses):

- Advertising & Marketing
- Business Travel & Meals
- Business Utilities & Internet
- Office Supplies & Postage
- Employee Wages / Contract Labour
- Business Auto Expenses
- Business Rent
- Business Insurance

Transfers & Adjustments:

- Transfer Between Own Accounts
- Credit Card Payment (Transfer)
- Balance Adjustments & Corrections

Other & Unbudgeted:

- Unbudgeted / Unexpected Expenses
- Miscellaneous
- Uncategorized (for imports not yet reviewed)

1## Open questions

- Credit Card Payments appears in both the Financial group and Transfers & Adjustments in the proposed seed list. Should it exist only as a transfer-type category under Transfers & Adjustments to avoid budget double-counting?
- Business & Side Hustle is marked optional. Should it be seeded by default or created only when a user enables business tracking?

## Sources (Monarch Help Center)

- <https://help.monarch.com/hc/en-us/articles/360048883851-Default-Categories>
- <https://help.monarch.com/hc/en-us/articles/360048883771-Creating-Custom-Categories-and-Groups>
- <https://help.monarch.com/hc/en-us/articles/360048883591-Moving-Money-Between-Categories-to-Accommodate-Overspending>
- <https://help.monarch.com/hc/en-us/articles/18345219809940-Group-Budgeting>
- <https://help.monarch.com/hc/en-us/articles/360048883631-Creating-Your-Budget-in-Monarch>
- <https://help.monarch.com/hc/en-us/articles/32125337244052-Using-Flex-Budgeting>
- <https://help.monarch.com/hc/en-us/articles/4411119762196-Rollover-Budgets>
- <https://help.monarch.com/hc/en-us/articles/360048393292-Transfers-and-Credit-Card-Payments>
- <https://help.monarch.com/hc/en-us/articles/360048393372-Creating-Transaction-Rules>
- <https://help.monarch.com/hc/en-us/articles/4402645984916-Editing-Multiple-Transactions>
- <https://help.monarch.com/hc/en-us/articles/4409690120596-Organizing-Transactions-with-Tags>
- <https://help.monarch.com/hc/en-us/articles/38610714553108-CommandK-Search-Bar-and-Shortcuts>
