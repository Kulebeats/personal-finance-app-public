# User Stories

## Personal Finance Application

**Document Version:** 1.0
**Date:** 2026-01-13
**Status:** Approved
**Format:** Agile User Story Standard

---

## Table of Contents

1. [Story Format](#1-story-format)
2. [Epic Overview](#2-epic-overview)
3. [Authentication Stories](#3-authentication-stories)
4. [Account Management Stories](#4-account-management-stories)
5. [Transaction Stories](#5-transaction-stories)
6. [Goal Stories](#6-goal-stories)
7. [Budget Stories](#7-budget-stories)
8. [Reporting Stories](#8-reporting-stories)
9. [Investment Stories](#9-investment-stories)
10. [Household Stories](#10-household-stories)
11. [Story Map](#11-story-map)

---

## 1. Story Format

All user stories follow the standard format:

```
As a [role]
I want [feature/capability]
So that [benefit/value]
```

**Acceptance Criteria Format:**

```
Given [precondition]
When [action]
Then [expected result]
```

**Story Point Scale:** Fibonacci (1, 2, 3, 5, 8, 13, 21)

**Priority Levels:**
- **P0 (Critical):** Must have for MVP
- **P1 (High):** Important for full functionality
- **P2 (Medium):** Enhances user experience
- **P3 (Low):** Nice to have

---

## 2. Epic Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              EPIC HIERARCHY                                  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                           E1: AUTHENTICATION                          │  │
│  │    ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐        │  │
│  │    │US-001  │  │US-002  │  │US-003  │  │US-004  │  │US-005  │        │  │
│  │    │Register│  │Login   │  │Logout  │  │Reset   │  │Session │        │  │
│  │    └────────┘  └────────┘  └────────┘  └────────┘  └────────┘        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                           E2: ACCOUNTS                                │  │
│  │    ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐        │  │
│  │    │US-010  │  │US-011  │  │US-012  │  │US-013  │  │US-014  │        │  │
│  │    │Create  │  │View    │  │Update  │  │Delete  │  │Balance │        │  │
│  │    └────────┘  └────────┘  └────────┘  └────────┘  └────────┘        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                          E3: TRANSACTIONS                             │  │
│  │    ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐        │  │
│  │    │US-020  │  │US-021  │  │US-022  │  │US-023  │  │US-024  │        │  │
│  │    │Create  │  │View    │  │Category│  │Import  │  │Transfer│        │  │
│  │    └────────┘  └────────┘  └────────┘  └────────┘  └────────┘        │  │
│  │    ┌────────┐  ┌────────┐                                            │  │
│  │    │US-025  │  │US-026  │                                            │  │
│  │    │Split   │  │Rules   │                                            │  │
│  │    └────────┘  └────────┘                                            │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                             E4: GOALS                                 │  │
│  │    ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐        │  │
│  │    │US-030  │  │US-031  │  │US-032  │  │US-033  │  │US-034  │        │  │
│  │    │Create  │  │Progress│  │Transfer│  │Assign  │  │Link Txn│        │  │
│  │    └────────┘  └────────┘  └────────┘  └────────┘  └────────┘        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                            E5: BUDGETS                                │  │
│  │    ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐                    │  │
│  │    │US-040  │  │US-041  │  │US-042  │  │US-043  │                    │  │
│  │    │Create  │  │Track   │  │Rollover│  │Alerts  │                    │  │
│  │    └────────┘  └────────┘  └────────┘  └────────┘                    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                            E6: REPORTS                                │  │
│  │    ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐                    │  │
│  │    │US-050  │  │US-051  │  │US-052  │  │US-053  │                    │  │
│  │    │Cashflow│  │Spending│  │NetWorth│  │Export  │                    │  │
│  │    └────────┘  └────────┘  └────────┘  └────────┘                    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Authentication Stories

### US-001: User Registration

| Attribute | Value |
|-----------|-------|
| **ID** | US-001 |
| **Epic** | E1: Authentication |
| **Priority** | P0 (Critical) |
| **Points** | 5 |
| **Status** | Done |

**Story:**
```
As a new user
I want to register for an account
So that I can start tracking my finances
```

**Acceptance Criteria:**

```
AC1: Registration Form
Given I am on the registration page
When I enter valid email, password, and name
Then I should be able to submit the form

AC2: Password Validation
Given I am filling out registration
When I enter a password less than 8 characters
Then I should see a validation error

AC3: Password Complexity
Given I am filling out registration
When I enter a password without uppercase or numbers
Then I should see a complexity requirement error

AC4: Email Uniqueness
Given email "test@example.com" is already registered
When I try to register with "test@example.com"
Then I should see "Email already registered" error

AC5: Household Creation
Given I complete registration successfully
When my account is created
Then a new household should be created with me as owner

AC6: Secure Password Storage
Given I submit registration
When my password is stored
Then it must be hashed with bcrypt (cost factor 12)
```

**Technical Notes:**
- Password: bcrypt with cost 12
- Validation: Zod schema
- Auto-create household on registration

---

### US-002: User Login

| Attribute | Value |
|-----------|-------|
| **ID** | US-002 |
| **Epic** | E1: Authentication |
| **Priority** | P0 (Critical) |
| **Points** | 3 |
| **Status** | Done |

**Story:**
```
As a registered user
I want to log into my account
So that I can access my financial data
```

**Acceptance Criteria:**

```
AC1: Successful Login
Given I have valid credentials
When I submit login form
Then I should be redirected to dashboard
And receive a session cookie

AC2: Invalid Credentials
Given I enter wrong password
When I submit login form
Then I should see "Invalid credentials" error
And not be logged in

AC3: Session Cookie Security
Given I login successfully
When session cookie is set
Then it must have HttpOnly, Secure, SameSite flags
```

---

### US-003: User Logout

| Attribute | Value |
|-----------|-------|
| **ID** | US-003 |
| **Epic** | E1: Authentication |
| **Priority** | P0 (Critical) |
| **Points** | 2 |
| **Status** | Done |

**Story:**
```
As a logged-in user
I want to log out of my account
So that my session is terminated securely
```

**Acceptance Criteria:**

```
AC1: Session Termination
Given I am logged in
When I click logout
Then my session should be destroyed
And I should be redirected to login page

AC2: Cookie Removal
Given I logout
When session is destroyed
Then session cookie should be removed
```

---

### US-004: Password Reset

| Attribute | Value |
|-----------|-------|
| **ID** | US-004 |
| **Epic** | E1: Authentication |
| **Priority** | P1 (High) |
| **Points** | 5 |
| **Status** | Done |

**Story:**
```
As a user who forgot my password
I want to reset it via email
So that I can regain access to my account
```

**Acceptance Criteria:**

```
AC1: Reset Request
Given I enter my registered email
When I request password reset
Then I should receive an email with reset link

AC2: Token Expiry
Given I receive reset email
When I wait more than 1 hour
Then the reset link should be invalid

AC3: Password Update
Given I have valid reset token
When I submit new password
Then my password should be updated
And I should be able to login with new password
```

---

## 4. Account Management Stories

### US-010: Create Account

| Attribute | Value |
|-----------|-------|
| **ID** | US-010 |
| **Epic** | E2: Accounts |
| **Priority** | P0 (Critical) |
| **Points** | 3 |
| **Status** | Done |

**Story:**
```
As a household member
I want to add a new financial account
So that I can track its balance and transactions
```

**Acceptance Criteria:**

```
AC1: Account Types
Given I am creating an account
When I select account type
Then I should see options: checking, savings, credit, loan, investment, cash, mobile_money

AC2: Required Fields
Given I am creating an account
When I submit without name
Then I should see validation error

AC3: Initial Balance
Given I create account with initial balance "1000.50"
When account is created
Then balance should be stored with decimal precision

AC4: Household Association
Given I create an account
When it is saved
Then it must be associated with my household
```

---

### US-011: View Account List

| Attribute | Value |
|-----------|-------|
| **ID** | US-011 |
| **Epic** | E2: Accounts |
| **Priority** | P0 (Critical) |
| **Points** | 2 |
| **Status** | Done |

**Story:**
```
As a household member
I want to view all my accounts
So that I can see my complete financial picture
```

**Acceptance Criteria:**

```
AC1: Account List Display
Given I have 5 accounts
When I view accounts page
Then I should see all 5 accounts with names and balances

AC2: Household Isolation
Given another household has accounts
When I view my accounts
Then I should NOT see other household's accounts

AC3: Balance Accuracy
Given account balance is "1234.56"
When displayed
Then it should show exactly "1234.56" (not rounded)
```

---

### US-014: View Net Worth

| Attribute | Value |
|-----------|-------|
| **ID** | US-014 |
| **Epic** | E2: Accounts |
| **Priority** | P1 (High) |
| **Points** | 3 |
| **Status** | Done |

**Story:**
```
As a household member
I want to see my total net worth
So that I understand my overall financial position
```

**Acceptance Criteria:**

```
AC1: Net Worth Calculation
Given I have assets totaling $50,000
And liabilities totaling $20,000
When I view net worth
Then it should show $30,000

AC2: Precision
Given multiple accounts with decimal amounts
When net worth is calculated
Then Money class must be used for precision

AC3: Account Types
Given checking/savings/investment are assets
And credit/loan are liabilities
When calculating net worth
Then assets minus liabilities should equal net worth
```

**Technical Notes:**
- Uses Money class for all arithmetic
- Implemented in AccountReportingService

---

## 5. Transaction Stories

### US-020: Create Transaction

| Attribute | Value |
|-----------|-------|
| **ID** | US-020 |
| **Epic** | E3: Transactions |
| **Priority** | P0 (Critical) |
| **Points** | 5 |
| **Status** | Done |

**Story:**
```
As a household member
I want to record a financial transaction
So that I can track my income and expenses
```

**Acceptance Criteria:**

```
AC1: Transaction Types
Given I am creating a transaction
When I select type
Then options should be: income, expense, transfer, balance_adjustment

AC2: Amount Precision
Given I enter amount "123.456"
When transaction is saved
Then Money class must be used for storage

AC3: Balance Update
Given account balance is "$1000"
When I add expense of "$150"
Then balance should atomically update to "$850"

AC4: Atomic Operation
Given I create a transaction
When database updates occur
Then transaction insert AND balance update must be in same DB transaction

AC5: Audit Logging
Given I create a transaction
When it is saved
Then it must be logged to audit trail
```

**Technical Notes:**
- Money class required
- DB transaction required
- BusinessAuditService logging

---

### US-023: Import Transactions (CSV)

| Attribute | Value |
|-----------|-------|
| **ID** | US-023 |
| **Epic** | E3: Transactions |
| **Priority** | P1 (High) |
| **Points** | 8 |
| **Status** | Done |

**Story:**
```
As a household member
I want to import transactions from CSV
So that I can bulk-load my financial history
```

**Acceptance Criteria:**

```
AC1: File Upload
Given I have a CSV file
When I upload it
Then system should parse and preview contents

AC2: Column Mapping
Given CSV has different column names
When I view preview
Then I should be able to map columns to fields

AC3: Validation
Given some rows have invalid data
When I review import
Then invalid rows should be highlighted with errors

AC4: Batch Import
Given 100 valid transactions
When I confirm import
Then all should be imported in single DB transaction

AC5: Balance Update
Given I import transactions
When import completes
Then account balance should be updated accurately
```

---

### US-024: Transfer Between Accounts

| Attribute | Value |
|-----------|-------|
| **ID** | US-024 |
| **Epic** | E3: Transactions |
| **Priority** | P0 (Critical) |
| **Points** | 5 |
| **Status** | Done |

**Story:**
```
As a household member
I want to transfer money between accounts
So that I can track internal fund movements
```

**Acceptance Criteria:**

```
AC1: Transfer Creation
Given I have checking and savings accounts
When I transfer $500 from checking to savings
Then checking decreases by $500
And savings increases by $500

AC2: Atomic Update
Given I create a transfer
When both balances update
Then updates must be in same DB transaction

AC3: Linked Transactions
Given a transfer is created
When I view transactions
Then I should see linked transactions in both accounts
```

---

### US-026: Auto-Categorization Rules

| Attribute | Value |
|-----------|-------|
| **ID** | US-026 |
| **Epic** | E3: Transactions |
| **Priority** | P1 (High) |
| **Points** | 8 |
| **Status** | Done |

**Story:**
```
As a household member
I want to create categorization rules
So that new transactions are automatically categorized
```

**Acceptance Criteria:**

```
AC1: Rule Conditions
Given I create a rule
When I set conditions
Then I should be able to match on: amount, description, merchant, category, date, account

AC2: Rule Actions
Given a rule matches
When applied
Then actions can be: rename_merchant, categorize, add_tags, hide, mark_reviewed

AC3: Priority Order
Given multiple rules match
When applied
Then they should execute in priority order

AC4: New Transaction Application
Given I have active rules
When new transaction is created
Then matching rules should be applied automatically
```

---

## 6. Goal Stories

### US-030: Create Goal

| Attribute | Value |
|-----------|-------|
| **ID** | US-030 |
| **Epic** | E4: Goals |
| **Priority** | P0 (Critical) |
| **Points** | 5 |
| **Status** | Done |

**Story:**
```
As a household member
I want to create a financial goal
So that I can track progress toward my target
```

**Acceptance Criteria:**

```
AC1: Goal Types
Given I create a goal
When I select type
Then options should be: save_up, pay_down, investment

AC2: Target Amount
Given I set target of "$10,000"
When goal is created
Then target should be stored with decimal precision

AC3: Currency Support
Given I create goal with currency "USD"
When goal calculations occur
Then Money class must use correct currency
```

---

### US-031: View Goal Progress

| Attribute | Value |
|-----------|-------|
| **ID** | US-031 |
| **Epic** | E4: Goals |
| **Priority** | P1 (High) |
| **Points** | 3 |
| **Status** | Done |

**Story:**
```
As a household member
I want to see my goal progress
So that I know how close I am to achieving it
```

**Acceptance Criteria:**

```
AC1: Progress Percentage
Given goal target is "$10,000"
And current amount is "$7,500"
When I view progress
Then it should show 75%

AC2: Visual Indicator
Given goal progress
When displayed
Then I should see a progress bar

AC3: Remaining Amount
Given target is "$10,000" and current is "$7,500"
When I view goal
Then remaining should show "$2,500"
```

---

### US-032: Transfer Between Goals

| Attribute | Value |
|-----------|-------|
| **ID** | US-032 |
| **Epic** | E4: Goals |
| **Priority** | P1 (High) |
| **Points** | 8 |
| **Status** | Done |

**Story:**
```
As a household member
I want to transfer funds between goals
So that I can reallocate my savings
```

**Acceptance Criteria:**

```
AC1: Transfer Execution
Given goal A has $5,000 and goal B has $2,000
When I transfer $1,000 from A to B
Then A should have $4,000 and B should have $3,000

AC2: Concurrent Safety
Given two users transfer from same goal simultaneously
When transfers execute
Then FOR UPDATE locking must prevent race condition

AC3: Insufficient Funds
Given goal has $500
When I try to transfer $1,000
Then I should see "Insufficient funds" error
And no money should be moved

AC4: Money Class Usage
Given transfer amount is "$1,234.56"
When calculations occur
Then Money class must be used (not floating point)

AC5: Audit Trail
Given a transfer is made
When it completes
Then it must be logged to audit trail
```

**Technical Notes:**
- FOR UPDATE row locking required
- Money class for all calculations
- BusinessAuditService logging
- Single database transaction

---

### US-033: Assign Account to Goal

| Attribute | Value |
|-----------|-------|
| **ID** | US-033 |
| **Epic** | E4: Goals |
| **Priority** | P1 (High) |
| **Points** | 5 |
| **Status** | Done |

**Story:**
```
As a household member
I want to assign an account to a goal
So that the account balance contributes to goal progress
```

**Acceptance Criteria:**

```
AC1: Assignment Creation
Given I have a savings account and a goal
When I assign account to goal
Then assignment should be created

AC2: Multiple Assignments
Given an account has $10,000
When I assign 60% to goal A and 40% to goal B
Then A gets $6,000 credit and B gets $4,000 credit

AC3: Balance Sync
Given account balance changes
When goal progress is calculated
Then it should reflect latest account balance
```

---

### US-034: Link Transaction to Goal

| Attribute | Value |
|-----------|-------|
| **ID** | US-034 |
| **Epic** | E4: Goals |
| **Priority** | P2 (Medium) |
| **Points** | 3 |
| **Status** | Done |

**Story:**
```
As a household member
I want to link a transaction to a goal
So that I can track contributions
```

**Acceptance Criteria:**

```
AC1: Link Transaction
Given I have a deposit transaction
When I link it to a savings goal
Then the transaction amount contributes to goal progress

AC2: Unlink Transaction
Given a linked transaction
When I unlink it
Then goal progress should decrease by that amount
```

---

## 7. Budget Stories

### US-040: Create Budget

| Attribute | Value |
|-----------|-------|
| **ID** | US-040 |
| **Epic** | E5: Budgets |
| **Priority** | P0 (Critical) |
| **Points** | 5 |
| **Status** | Done |

**Story:**
```
As a household member
I want to create a monthly budget for a category
So that I can control my spending
```

**Acceptance Criteria:**

```
AC1: Category Budget
Given I have category "Groceries"
When I set budget of "$500/month"
Then budget should track spending against this limit

AC2: Budget Period
Given I create a budget
When it is saved
Then it should be associated with specific month/year

AC3: Household Scope
Given I create a budget
When it is saved
Then it applies to entire household spending
```

---

### US-041: Track Budget Progress

| Attribute | Value |
|-----------|-------|
| **ID** | US-041 |
| **Epic** | E5: Budgets |
| **Priority** | P0 (Critical) |
| **Points** | 3 |
| **Status** | Done |

**Story:**
```
As a household member
I want to see how much I've spent against my budget
So that I can adjust my spending
```

**Acceptance Criteria:**

```
AC1: Spent Amount
Given budget is $500 and I've spent $350
When I view budget
Then it should show $350 spent, $150 remaining

AC2: Over Budget Warning
Given budget is $500 and I've spent $550
When I view budget
Then it should show over-budget indicator

AC3: Real-time Update
Given I add a new expense
When I view budget
Then spent amount should include new expense
```

---

### US-042: Budget Rollover

| Attribute | Value |
|-----------|-------|
| **ID** | US-042 |
| **Epic** | E5: Budgets |
| **Priority** | P2 (Medium) |
| **Points** | 5 |
| **Status** | Done |

**Story:**
```
As a household member
I want unused budget to roll over to next month
So that I don't lose unspent allocation
```

**Acceptance Criteria:**

```
AC1: Rollover Calculation
Given January budget is $500 and I spent $400
When February starts
Then February budget should include $100 rollover

AC2: Rollover Toggle
Given I have a budget
When I enable rollover
Then unused amounts carry forward

AC3: Over-budget Rollover
Given I overspent by $50 in January
When February starts
Then February budget should be reduced by $50
```

---

## 8. Reporting Stories

### US-050: View Cashflow Report

| Attribute | Value |
|-----------|-------|
| **ID** | US-050 |
| **Epic** | E6: Reports |
| **Priority** | P0 (Critical) |
| **Points** | 5 |
| **Status** | Done |

**Story:**
```
As a household member
I want to see a cashflow report
So that I understand my income versus expenses
```

**Acceptance Criteria:**

```
AC1: Income Total
Given I have income transactions
When I view cashflow report
Then total income should be calculated accurately

AC2: Expense Total
Given I have expense transactions
When I view cashflow report
Then total expenses should be calculated accurately

AC3: Net Cashflow
Given income is $5,000 and expenses are $4,000
When I view report
Then net cashflow should show $1,000

AC4: Date Range Filter
Given I select "Last 30 days"
When report generates
Then only transactions in that range are included

AC5: Money Class Precision
Given many transactions with decimal amounts
When totals are calculated
Then Money class must be used for accuracy
```

---

### US-051: View Spending by Category

| Attribute | Value |
|-----------|-------|
| **ID** | US-051 |
| **Epic** | E6: Reports |
| **Priority** | P0 (Critical) |
| **Points** | 5 |
| **Status** | Done |

**Story:**
```
As a household member
I want to see spending broken down by category
So that I understand where my money goes
```

**Acceptance Criteria:**

```
AC1: Category Breakdown
Given I have expenses in 5 categories
When I view spending report
Then I should see total for each category

AC2: Percentage Display
Given total spending is $1,000
And "Groceries" is $300
When I view report
Then Groceries should show 30%

AC3: Visualization
Given spending data exists
When displayed
Then I should see a chart (pie/bar)
```

---

### US-052: View Net Worth Over Time

| Attribute | Value |
|-----------|-------|
| **ID** | US-052 |
| **Epic** | E6: Reports |
| **Priority** | P1 (High) |
| **Points** | 5 |
| **Status** | Done |

**Story:**
```
As a household member
I want to see my net worth trend
So that I can track my wealth growth
```

**Acceptance Criteria:**

```
AC1: Current Net Worth
Given assets total $100,000 and liabilities total $30,000
When I view net worth
Then current should show $70,000

AC2: Historical Trend
Given I select "Last 12 months"
When I view trend
Then I should see monthly net worth values

AC3: Trend Visualization
Given net worth data over time
When displayed
Then I should see a line chart
```

---

### US-053: Export Transactions

| Attribute | Value |
|-----------|-------|
| **ID** | US-053 |
| **Epic** | E6: Reports |
| **Priority** | P1 (High) |
| **Points** | 3 |
| **Status** | Done |

**Story:**
```
As a household member
I want to export my transactions to CSV
So that I can use them in other tools
```

**Acceptance Criteria:**

```
AC1: CSV Export
Given I have 100 transactions
When I click "Export to CSV"
Then I should download a CSV file with all transactions

AC2: Date Range Filter
Given I select specific date range
When I export
Then only transactions in that range are included

AC3: Column Headers
Given I export to CSV
When I open file
Then columns should be: Date, Description, Amount, Category, Account
```

---

## 9. Investment Stories

### US-060: Track Investment Holdings

| Attribute | Value |
|-----------|-------|
| **ID** | US-060 |
| **Epic** | E7: Investments |
| **Priority** | P1 (High) |
| **Points** | 8 |
| **Status** | Done |

**Story:**
```
As an investor
I want to track my investment holdings
So that I can monitor my portfolio
```

**Acceptance Criteria:**

```
AC1: Add Holding
Given I have investment account
When I add holding (security, quantity, cost basis)
Then holding should be tracked

AC2: Security Types
Given I add holding
When I select security type
Then options should include: stock, bond, etf, mutual_fund, unit_trust, term_deposit, tbill, forex, crypto

AC3: Cost Basis
Given I add holding with quantity 100 at $50 each
When holding is saved
Then cost basis should be $5,000
```

---

### US-061: View Portfolio Summary

| Attribute | Value |
|-----------|-------|
| **ID** | US-061 |
| **Epic** | E7: Investments |
| **Priority** | P1 (High) |
| **Points** | 5 |
| **Status** | Done |

**Story:**
```
As an investor
I want to see a portfolio summary
So that I understand my investment allocation
```

**Acceptance Criteria:**

```
AC1: Total Value
Given I have multiple holdings
When I view portfolio
Then total market value should be calculated

AC2: Allocation Breakdown
Given holdings across different securities
When I view portfolio
Then I should see allocation percentages

AC3: Gain/Loss
Given cost basis and current value
When I view portfolio
Then I should see unrealized gain/loss
```

---

## 10. Household Stories

### US-070: Invite Household Member

| Attribute | Value |
|-----------|-------|
| **ID** | US-070 |
| **Epic** | E8: Household |
| **Priority** | P2 (Medium) |
| **Points** | 5 |
| **Status** | Done |

**Story:**
```
As a household owner
I want to invite family members
So that we can share financial data
```

**Acceptance Criteria:**

```
AC1: Send Invitation
Given I am household owner
When I enter email and select role
Then invitation should be sent

AC2: Role Assignment
Given I invite someone
When I select role
Then options should be: Admin, Member, Viewer

AC3: Accept Invitation
Given I receive invitation
When I click accept and register/login
Then I should be added to the household
```

---

### US-071: Manage Member Roles

| Attribute | Value |
|-----------|-------|
| **ID** | US-071 |
| **Epic** | E8: Household |
| **Priority** | P2 (Medium) |
| **Points** | 3 |
| **Status** | Done |

**Story:**
```
As a household owner
I want to change member roles
So that I can control access levels
```

**Acceptance Criteria:**

```
AC1: Change Role
Given member is "Viewer"
When I change to "Member"
Then their permissions should update

AC2: Owner Protection
Given I am the only owner
When I try to change my role
Then I should see error (cannot remove last owner)
```

---

## 11. Story Map

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    USER STORY MAP                                        │
│                                                                                          │
│  USER JOURNEY ──────────────────────────────────────────────────────────────────────▶   │
│                                                                                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐          │
│  │DISCOVER │  │  SETUP  │  │  TRACK  │  │  PLAN   │  │ ANALYZE │  │  GROW   │          │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘          │
│       │            │            │            │            │            │                 │
│  ─────┼────────────┼────────────┼────────────┼────────────┼────────────┼─────── MVP    │
│       │            │            │            │            │            │                 │
│       ▼            ▼            ▼            ▼            ▼            ▼                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐          │
│  │US-001   │  │US-010   │  │US-020   │  │US-040   │  │US-050   │  │US-030   │          │
│  │Register │  │Create   │  │Create   │  │Create   │  │View     │  │Create   │          │
│  │         │  │Account  │  │Trans    │  │Budget   │  │Cashflow │  │Goal     │          │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘          │
│       │            │            │            │            │            │                 │
│       ▼            ▼            ▼            ▼            ▼            ▼                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐          │
│  │US-002   │  │US-011   │  │US-021   │  │US-041   │  │US-051   │  │US-031   │          │
│  │Login    │  │View     │  │View     │  │Track    │  │Spending │  │Progress │          │
│  │         │  │Accounts │  │Trans    │  │Progress │  │Category │  │         │          │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘          │
│       │            │            │            │            │            │                 │
│  ─────┼────────────┼────────────┼────────────┼────────────┼────────────┼─────── V1.1   │
│       │            │            │            │            │            │                 │
│       ▼            ▼            ▼            ▼            ▼            ▼                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐          │
│  │US-003   │  │US-014   │  │US-022   │  │US-042   │  │US-052   │  │US-032   │          │
│  │Logout   │  │Net Worth│  │Category │  │Rollover │  │Net Worth│  │Transfer │          │
│  │         │  │         │  │         │  │         │  │Trend    │  │         │          │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘          │
│       │            │            │            │            │            │                 │
│       ▼            ▼            ▼            ▼            ▼            ▼                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐          │
│  │US-004   │  │         │  │US-023   │  │         │  │US-053   │  │US-033   │          │
│  │Reset PW │  │         │  │Import   │  │         │  │Export   │  │Assign   │          │
│  │         │  │         │  │CSV      │  │         │  │         │  │Account  │          │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘          │
│       │            │            │            │            │            │                 │
│  ─────┼────────────┼────────────┼────────────┼────────────┼────────────┼─────── V1.2   │
│       │            │            │            │            │            │                 │
│       ▼            ▼            ▼            ▼            ▼            ▼                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐          │
│  │US-005   │  │         │  │US-024   │  │US-043   │  │         │  │US-034   │          │
│  │Session  │  │         │  │Transfer │  │Alerts   │  │         │  │Link Txn │          │
│  │         │  │         │  │         │  │         │  │         │  │         │          │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘          │
│       │            │            │            │            │            │                 │
│       ▼            ▼            ▼            ▼            ▼            ▼                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐          │
│  │         │  │         │  │US-025   │  │         │  │         │  │         │          │
│  │         │  │         │  │Split    │  │         │  │         │  │         │          │
│  │         │  │         │  │Trans    │  │         │  │         │  │         │          │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘          │
│       │            │            │            │            │            │                 │
│       ▼            ▼            ▼            ▼            ▼            ▼                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐          │
│  │         │  │         │  │US-026   │  │         │  │         │  │         │          │
│  │         │  │         │  │Rules    │  │         │  │         │  │         │          │
│  │         │  │         │  │         │  │         │  │         │  │         │          │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘          │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Appendix A: Story Status Summary

| Status | Count | Percentage |
|--------|-------|------------|
| Done | 45 | 100% |
| In Progress | 0 | 0% |
| To Do | 0 | 0% |

## Appendix B: Velocity Tracking

| Sprint | Planned | Completed | Velocity |
|--------|---------|-----------|----------|
| Sprint 1 | 21 | 21 | 21 |
| Sprint 2 | 34 | 34 | 34 |
| Sprint 3 | 28 | 28 | 28 |
| Sprint 4 | 25 | 25 | 25 |

**Average Velocity:** 27 story points/sprint

## Appendix C: Change History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-13 | Product Team | Initial release |
