# Data Export

## Supported Formats
- CSV for reports and analytics exports
- UTF-8 encoding with header row

## Exported Data Types
- Transactions
- Merchant spending summaries
- Category and budget summaries
- Goal progress snapshots

## Access Control
- Exports require authenticated sessions and household scope
- Rate limiting applies to export endpoints
- Exports are logged to the audit trail

## Export Schema (Common Fields)

Transactions:
- id
- date
- amount
- currency
- account
- category
- merchant
- notes
- tags
- createdAt

Budgets:
- periodStart
- periodEnd
- category
- budgeted
- spent
- remaining

Merchants:
- name
- totalSpend
- transactionCount
- lastActivityDate

Goals:
- name
- targetAmount
- currentAmount
- dueDate
- status

## Export Lifecycle
- Exports are generated on demand from current data
- Large exports may be paginated or created asynchronously
- Files are stored temporarily and expire per retention policy (30 days)

## Audit Logging
- Record userId, householdId, export type, filters, and result
- Store only metadata, not raw exported data
- See `docs/security/export-audit-logging-spec.md`

## Data Portability Notes
- CSVs are designed for spreadsheet tools
- Currency amounts are decimal strings
- Date fields are ISO 8601
