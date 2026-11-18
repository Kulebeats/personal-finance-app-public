# Help Center (Monarch-style Job Aids)

This guide describes what each section does and how to complete common tasks.

## Dashboard
### What you can do
- View key financial summaries and quick widgets.
- Reorder widgets and toggle visibility.
### How to
- Customize widgets: click "Customize" and toggle widgets on/off.
- Reorder widgets: drag any widget to a new position.
### Notes
- Some widgets still show demo data (budget, spending, transactions, recurring, annual summary, budget status).

## Accounts
### What you can do
- Add accounts (manual setup).
- View net worth history and account grouping.
- Export account summary CSV.
### How to
- Add account: click "Add account" and complete the form.
- Filter by owner: use the owner filter on the right.
- Export summary: click "Download CSV" in the Summary card.

## Account Detail
### What you can do
- View balance history and recent transactions.
- Import or export transactions and balance history.
### How to
- Export transactions: Edit menu -> "Download transactions".
- Import transactions: Edit menu -> "Import transactions".
- Edit account: Edit menu -> "Edit account".

## Transactions
### What you can do
- Add income, expense, or transfer transactions.
- Filter by date, account, merchant, category, amount, tags, and status.
- Create recurring transactions from new entries.
### How to
- Add transaction: click "Add transaction" and complete the form.
- Add transfer: set Type to "Transfer", choose source and destination accounts.
- Create merchant inline: type a new merchant name in the Merchant field and confirm create.
- Set tags: use the Tags field in the form.
### Notes
- Attachments are captured in the UI but not uploaded yet.
- The transaction page still uses static category/tag lists for some UI elements.

## Budget
### What you can do
- Set monthly budgets by category or by group (Flex).
- Adjust budget settings and apply to future months.
- Move budget amounts between categories.
### How to
- Seed categories first: Settings -> Organization -> Categories.
- Update a budget: click a budget cell, edit the amount, then press Enter or blur.
- Change budget system: Budget -> Settings -> choose Flex or Category.
- Move money: click the Remaining pill to open the move money modal.

## Reports
### What you can do
- View spending breakdowns, trends, cash flow, and summaries.
- Filter by date range and category where available.
- Export CSV for supported report types.
### How to
- Switch report tabs and adjust filters in the top bar.
- Export report: use the Export action (transactions/cashflow CSV).

## Cash Flow
### What you can do
- View income vs expenses over time.
- Visualize flows using the Sankey chart.
### How to
- Toggle view: use the "Trends" / "Sankey" switch.
- Adjust date range: use the current year range controls in the report header.

## Recurring
### What you can do
- View recurring transactions in calendar or list view.
- See upcoming bills for the next 30 days.
### How to
- Toggle calendar/list: use the view toggle in the header.
- Navigate months: use the left/right arrows in the calendar header.

## Goals
### What you can do
- Track savings goals and progress.
### How to
- View goals: open Goals from the sidebar.
- Review progress: each card shows current vs target and target date.

## Merchants
### What you can do
- Create, edit, and delete merchants.
- Upload merchant logos.
- Merge duplicates with preview and bulk tools.
### How to
- Add merchant: Settings -> Merchants -> Add Merchant.
- Merge: select merchants -> open merge preview -> confirm target, name, and logo.
- Search: use the top bar search (Ctrl+K) to jump to merchants.

## Categories, Tags, Rules (Organization)
### Categories
- Create category groups and categories for budgeting and reporting.
### Tags
- Create tags and use them on transactions.
### Rules
- Auto-categorize or adjust transactions based on conditions.
### How to
- Settings -> Organization -> select the tab (Categories, Tags, Rules).

## Receipts
### What you can do
- Upload receipts and run OCR.
- Review extracted data and create a transaction.
### How to
- Scan receipt: Receipts -> "Scan Receipt".
- Run OCR: open a receipt -> "Run OCR Scan".
### Notes
- Creating a transaction from a receipt currently uses a placeholder account and should be updated to pick an account.
- Transaction matching UI is not yet implemented.

## Settings
### Profile
- Update your profile, contact info, and personal details.
### Display
- Adjust theme, currency, and display preferences.
### Notifications
- Configure notification preferences.
### Security
- Change password and manage sessions.
### Household / Members / Preferences
- Manage household settings, members, and preferences.

## Collaboration
### What you can do
- View a demo collaboration layout.
### Notes
- Collaboration data is currently static and not backed by API.

## Investments
### What you can do
- View a demo investment dashboard.
### Notes
- Investment data is currently static and not backed by API.

## Verify Email
### What you can do
- Verify your email using the verification link.
### How to
- Use the link sent by email or the fallback link printed to the server console.
