# Module-Specific Functionality Checklists

Reference file for `/review-functionality`. Load when reviewing specific modules.

## Table of Contents

- [Investments Module](#investments-module)
- [Goals Module](#goals-module)
- [Recurring Module](#recurring-module)
- [Reports Module](#reports-module)
- [Receipts Module](#receipts-module)
- [Budgets Module](#budgets-module)
- [Accounts Module](#accounts-module)
- [Transactions Module](#transactions-module)

---

## Investments Module

- [ ] BUY transactions increase holding quantity
- [ ] SELL transactions decrease holding quantity
- [ ] SELL rejects if quantity > owned shares (overdraft protection)
- [ ] DIVIDEND/INCOME transactions do not affect quantity
- [ ] Portfolio valuation uses correct FX rates (not fallback to 1.0)
- [ ] updateHolding/deleteHolding check householdId (security)
- [ ] Tax lot tracking works for cost basis (if implemented)

## Goals Module

- [ ] Assignment constraints enforced (only one full_balance per account)
- [ ] Progress percent calculated from assigned accounts (not transaction links)
- [ ] Contributions update currentAmount correctly
- [ ] Transfers between goals maintain total balance
- [ ] Debt goals track principal vs interest correctly
- [ ] Monthly projections use Money class arithmetic

## Recurring Module

- [ ] Pattern detection finds actual recurring transactions
- [ ] Linking respects transaction visibility (private transactions)
- [ ] Calendar items show correct next due dates
- [ ] Skip/pause/resume/end lifecycle operations work
- [ ] Amount variance tolerance applied correctly
- [ ] Auto-link does not create duplicates (race condition protected)

## Reports Module

- [ ] Sankey diagram data flows correctly (income -> categories -> expenses)
- [ ] Date range filters apply to all calculations
- [ ] Export generates valid CSV/PDF (all columns present)
- [ ] Net worth shows assets minus liabilities correctly
- [ ] Spending breakdown matches transaction totals
- [ ] Currency conversions use Money class

## Receipts Module

- [ ] Upload stores file and creates receipt record
- [ ] OCR results parsed and stored correctly
- [ ] Match finds best transaction candidates (scored)
- [ ] Create transaction from receipt is atomic (all-or-nothing)
- [ ] Delete removes receipt and unlinks transaction

## Budgets Module

- [ ] Period rollovers carry correct amounts
- [ ] Spent calculations match transaction sums
- [ ] Move amount between budgets is atomic
- [ ] Alert thresholds respect household preferences
- [ ] Archived categories rejected for new budgets

## Accounts Module

- [ ] Balance reflects all transaction amounts
- [ ] Account types classified correctly (asset vs liability)
- [ ] Owner filtering shows only owned accounts
- [ ] Delete cascades or blocks if transactions exist

## Transactions Module

- [ ] Pagination returns correct total count
- [ ] All filters actually filter (search, tags, amount range, owner)
- [ ] Sorting works on all sortable columns
- [ ] Bulk edit updates all selected transactions
- [ ] Split maintains original total amount

---

## End-to-End Integration Scenarios

### Scenario 1: Transaction Lifecycle

1. User creates transaction in Account A (-$100)
   - Account A balance decreases by $100
   - Budget category "Groceries" spent increases by $100
   - Recurring detection runs (async)
   - Reports include new transaction

2. User edits transaction amount to -$150
   - Account A balance adjusts (-$50 more)
   - Budget spent adjusts (+$50)
   - Reports reflect updated amount

3. User deletes transaction
   - Account A balance restored (+$150)
   - Budget spent restored (-$150)
   - Receipt links removed
   - Recurring links removed

### Scenario 2: Goal Assignment Flow

1. User assigns Account A (balance $5000) to Goal X
   - Goal X progress updates based on account balance
   - Goal X currentAmount reflects assigned portion

2. Transaction added to Account A (+$500)
   - Account A balance = $5500
   - Goal X progress recalculates automatically

3. User removes assignment
   - Goal X progress recalculates without Account A

### Scenario 3: Recurring Detection and Linking

1. System detects recurring pattern (Netflix $15/month)
   - Creates recurring rule
   - Links historical matching transactions

2. New transaction matches pattern
   - Auto-links to recurring rule
   - Calendar shows upcoming due date

3. User confirms/skips occurrence
   - Recurring status updates
   - Next due date advances

### Scenario 4: Receipt and Transaction Flow

1. User uploads receipt image
   - OCR extracts amount, date, merchant
   - System finds candidate transactions to match

2. User confirms match or creates new transaction
   - Receipt linked to transaction
   - Transaction categorized based on receipt data

3. User deletes receipt
   - Link removed, transaction unchanged

---

## Cross-Module Impact Matrix

| Action | Accounts | Budgets | Goals | Recurring | Reports | Receipts |
|--------|----------|---------|-------|-----------|---------|----------|
| Create Transaction | Always | Always | Conditional | Conditional | Always | Conditional |
| Update Transaction | Always | Always | Conditional | Conditional | Always | None |
| Delete Transaction | Always | Always | Conditional | Conditional | Always | Conditional |
| Create Account | None | None | Conditional | None | Always | None |
| Delete Account | None | Block if used | Unassign | None | Always | None |
| Create Budget | None | None | Conditional | None | Always | None |
| Create Goal | None | Conditional | None | None | Always | None |
| Link Receipt | None | None | None | None | None | Always |

Legend:
- Always = must update every time
- Conditional = depends on links or rules
- Block if used = prevent delete or require cleanup
- None = no direct impact
