# Use Case Specification

## Personal Finance Application

**Document Version:** 1.0
**Date:** 2026-01-13
**Status:** Approved
**Standard:** UML 2.5.1

---

## Table of Contents

1. [Use Case Diagram](#1-use-case-diagram)
2. [Actor Definitions](#2-actor-definitions)
3. [Use Case Specifications](#3-use-case-specifications)
4. [Activity Diagrams](#4-activity-diagrams)
5. [Sequence Diagrams](#5-sequence-diagrams)
6. [State Diagrams](#6-state-diagrams)

---

## 1. Use Case Diagram

### 1.1 System Context Use Case Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PERSONAL FINANCE APPLICATION                          │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         AUTHENTICATION                               │    │
│  │    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │    │
│  │    │   Register   │  │    Login     │  │   Logout     │             │    │
│  │    │   Account    │  │              │  │              │             │    │
│  │    └──────────────┘  └──────────────┘  └──────────────┘             │    │
│  │    ┌──────────────┐  ┌──────────────┐                               │    │
│  │    │    Reset     │  │   Manage     │                               │    │
│  │    │   Password   │  │   Session    │                               │    │
│  │    └──────────────┘  └──────────────┘                               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         ACCOUNT MANAGEMENT                           │    │
│  │    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │    │
│  │    │    Create    │  │    View      │  │   Update     │             │    │
│  │    │   Account    │  │   Accounts   │  │   Account    │             │    │
│  │    └──────────────┘  └──────────────┘  └──────────────┘             │    │
│  │    ┌──────────────┐  ┌──────────────┐                               │    │
│  │    │   Delete     │  │    View      │                               │    │
│  │    │   Account    │  │   Balance    │                               │    │
│  │    └──────────────┘  └──────────────┘                               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                       TRANSACTION MANAGEMENT                         │    │
│  │    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │    │
│  │    │    Create    │  │    View      │  │   Categorize │             │    │
│  │    │ Transaction  │  │ Transactions │  │ Transaction  │             │    │
│  │    └──────────────┘  └──────────────┘  └──────────────┘             │    │
│  │    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │    │
│  │    │   Import     │  │   Transfer   │  │    Split     │             │    │
│  │    │    CSV       │  │   Funds      │  │ Transaction  │             │    │
│  │    └──────────────┘  └──────────────┘  └──────────────┘             │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                          GOAL MANAGEMENT                             │    │
│  │    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │    │
│  │    │   Create     │  │    View      │  │   Transfer   │             │    │
│  │    │    Goal      │  │   Progress   │  │Between Goals │             │    │
│  │    └──────────────┘  └──────────────┘  └──────────────┘             │    │
│  │    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │    │
│  │    │   Assign     │  │    Link      │  │   Complete   │             │    │
│  │    │   Account    │  │ Transaction  │  │    Goal      │             │    │
│  │    └──────────────┘  └──────────────┘  └──────────────┘             │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         BUDGET MANAGEMENT                            │    │
│  │    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │    │
│  │    │   Create     │  │    Track     │  │   Rollover   │             │    │
│  │    │   Budget     │  │   Progress   │  │   Budget     │             │    │
│  │    └──────────────┘  └──────────────┘  └──────────────┘             │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                           REPORTING                                  │    │
│  │    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │    │
│  │    │    View      │  │    View      │  │   Export     │             │    │
│  │    │  Cashflow    │  │  Net Worth   │  │   Reports    │             │    │
│  │    └──────────────┘  └──────────────┘  └──────────────┘             │    │
│  │    ┌──────────────┐  ┌──────────────┐                               │    │
│  │    │   Spending   │  │   Trends     │                               │    │
│  │    │  by Category │  │   Analysis   │                               │    │
│  │    └──────────────┘  └──────────────┘                               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
        │                    │                    │                    │
        ▼                    ▼                    ▼                    ▼
    ┌───────┐            ┌───────┐            ┌───────┐            ┌───────┐
    │ Owner │            │ Admin │            │Member │            │Viewer │
    └───────┘            └───────┘            └───────┘            └───────┘
```

### 1.2 Actor-Use Case Relationships

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ACTOR USE CASE MATRIX                                │
│                                                                              │
│                              ┌────────────────────────────────────┐         │
│                              │           USE CASES                │         │
│                              ├────┬────┬────┬────┬────┬────┬─────┤         │
│   ACTORS                     │Auth│Acct│Txn │Goal│Bud │Rpt │Admin│         │
│   ┌───────────────────────┐  ├────┼────┼────┼────┼────┼────┼─────┤         │
│   │ Owner                 │──│ ●  │ ●  │ ●  │ ●  │ ●  │ ●  │  ●  │         │
│   ├───────────────────────┤  ├────┼────┼────┼────┼────┼────┼─────┤         │
│   │ Admin                 │──│ ●  │ ●  │ ●  │ ●  │ ●  │ ●  │     │         │
│   ├───────────────────────┤  ├────┼────┼────┼────┼────┼────┼─────┤         │
│   │ Member                │──│ ●  │ ○  │ ●  │ ○  │ ○  │ ○  │     │         │
│   ├───────────────────────┤  ├────┼────┼────┼────┼────┼────┼─────┤         │
│   │ Viewer                │──│ ●  │ ○  │ ○  │ ○  │ ○  │ ○  │     │         │
│   └───────────────────────┘  └────┴────┴────┴────┴────┴────┴─────┘         │
│                                                                              │
│   Legend: ● Full Access  ○ Read-Only  (blank) No Access                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Actor Definitions

### 2.1 Primary Actors

| Actor | Description | Privileges |
|-------|-------------|------------|
| **Owner** | Household creator and primary administrator | Full system access, member management, settings |
| **Admin** | Elevated household member | Full financial access, cannot manage members |
| **Member** | Standard household participant | View and edit own transactions, limited access |
| **Viewer** | Read-only access user | View-only permissions on shared data |

### 2.2 Secondary Actors

| Actor | Description | Interaction |
|-------|-------------|-------------|
| **System** | Automated processes | Rules engine, notifications, scheduled tasks |
| **Database** | PostgreSQL | Data persistence, transaction management |
| **Email Service** | SMTP provider | Password reset, notifications |

---

## 3. Use Case Specifications

### UC-01: User Registration

| Attribute | Description |
|-----------|-------------|
| **ID** | UC-01 |
| **Name** | User Registration |
| **Actor** | Unregistered User |
| **Preconditions** | User has valid email address |
| **Postconditions** | User account created, household created |
| **Priority** | Critical |

**Main Flow:**

```
1. User navigates to registration page
2. User enters email, password, and profile information
3. System validates input data
4. System checks email uniqueness
5. System hashes password with bcrypt (cost 12)
6. System creates user record
7. System creates household with user as owner
8. System sends verification email
9. System redirects to dashboard
```

**Alternative Flows:**

| Flow | Condition | Action |
|------|-----------|--------|
| 3a | Invalid input | Display validation errors |
| 4a | Email exists | Display "email already registered" |
| 8a | Email fails | Log error, allow retry |

**Business Rules:**
- Password: minimum 8 characters, 1 uppercase, 1 number
- Email must be unique across system
- Household created automatically for new users

---

### UC-02: Create Transaction

| Attribute | Description |
|-----------|-------------|
| **ID** | UC-02 |
| **Name** | Create Transaction |
| **Actor** | Authenticated User (Owner, Admin, Member) |
| **Preconditions** | User authenticated, at least one account exists |
| **Postconditions** | Transaction recorded, account balance updated |
| **Priority** | Critical |

**Main Flow:**

```
1. User selects account
2. User enters transaction details (amount, date, description)
3. User selects category
4. System validates input with Zod schema
5. System creates Money object for amount
6. System starts database transaction
7. System inserts transaction record
8. System updates account balance atomically
9. System commits transaction
10. System applies auto-categorization rules
11. System logs to audit trail
12. System returns success response
```

**Alternative Flows:**

| Flow | Condition | Action |
|------|-----------|--------|
| 4a | Invalid input | Return validation errors |
| 6a | DB unavailable | Return 503 error |
| 8a | Balance update fails | Rollback transaction |

**Business Rules:**
- Amount must use Money class (decimal precision)
- Balance update must be atomic (same DB transaction)
- Audit log required for all financial writes

---

### UC-03: Transfer Between Goals

| Attribute | Description |
|-----------|-------------|
| **ID** | UC-03 |
| **Name** | Transfer Between Goals |
| **Actor** | Authenticated User (Owner, Admin) |
| **Preconditions** | User authenticated, two or more goals exist |
| **Postconditions** | Funds moved between goals, audit logged |
| **Priority** | High |

**Main Flow:**

```
1. User selects source goal
2. User selects destination goal
3. User enters transfer amount
4. System validates goals belong to household
5. System starts database transaction
6. System acquires FOR UPDATE lock on source goal
7. System acquires FOR UPDATE lock on destination goal
8. System reads current balances (with locks held)
9. System calculates new balances with Money class
10. System validates sufficient funds
11. System updates source goal balance
12. System updates destination goal balance
13. System creates transfer record
14. System logs to audit trail
15. System commits transaction
16. System returns success response
```

**Alternative Flows:**

| Flow | Condition | Action |
|------|-----------|--------|
| 6a | Lock timeout | Retry or return error |
| 10a | Insufficient funds | Rollback, return error |
| 15a | Commit fails | Rollback, return error |

**Business Rules:**
- FOR UPDATE locking required to prevent race conditions
- Money class required for all calculations
- Both goals must be in same household
- Source goal must have sufficient balance

---

### UC-04: Generate Report

| Attribute | Description |
|-----------|-------------|
| **ID** | UC-04 |
| **Name** | Generate Financial Report |
| **Actor** | Authenticated User (All roles) |
| **Preconditions** | User authenticated, transactions exist |
| **Postconditions** | Report data returned |
| **Priority** | High |

**Main Flow:**

```
1. User selects report type (cashflow, spending, net worth)
2. User selects date range
3. System validates date parameters
4. System queries transactions for household
5. System aggregates data using Money class
6. System formats response
7. System returns report data
```

**Report Types:**

| Type | Data Included |
|------|---------------|
| Cashflow | Income vs expenses by period |
| Spending | Expenses by category |
| Net Worth | Assets minus liabilities |
| Trends | Historical comparisons |

---

### UC-05: Import Transactions (CSV)

| Attribute | Description |
|-----------|-------------|
| **ID** | UC-05 |
| **Name** | Import Transactions from CSV |
| **Actor** | Authenticated User (Owner, Admin) |
| **Preconditions** | User authenticated, account exists |
| **Postconditions** | Transactions imported, balances updated |
| **Priority** | Medium |

**Main Flow:**

```
1. User uploads CSV file
2. System parses CSV content
3. System validates file format
4. System displays preview with mapped columns
5. User confirms column mapping
6. User selects target account
7. System validates all rows
8. System starts batch import transaction
9. For each row:
   a. Create Money object for amount
   b. Insert transaction record
   c. Apply auto-categorization rules
10. System updates account balance
11. System commits transaction
12. System logs import to audit trail
13. System returns import summary
```

**Alternative Flows:**

| Flow | Condition | Action |
|------|-----------|--------|
| 3a | Invalid format | Return format error |
| 7a | Validation fails | Show row-level errors |
| 9a | Row fails | Continue with valid rows |

---

## 4. Activity Diagrams

### 4.1 Transaction Creation Activity

```
                    ┌─────────────┐
                    │    START    │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │ User enters │
                    │ transaction │
                    │   details   │
                    └──────┬──────┘
                           │
                           ▼
                    ◇─────────────◇
                   ╱               ╲
                  ╱   Validation    ╲
                 ╱    passes?        ╲
                ◇─────────────────────◇
               │                       │
            Yes│                       │No
               ▼                       ▼
        ┌─────────────┐         ┌─────────────┐
        │Start DB TX  │         │Return error │
        └──────┬──────┘         └──────┬──────┘
               │                       │
               ▼                       ▼
        ┌─────────────┐         ┌─────────────┐
        │Create Money │         │    END      │
        │  object     │         └─────────────┘
        └──────┬──────┘
               │
               ▼
        ┌─────────────┐
        │Insert trans │
        │  record     │
        └──────┬──────┘
               │
               ▼
        ┌─────────────┐
        │Update acct  │
        │  balance    │
        └──────┬──────┘
               │
               ▼
        ┌─────────────┐
        │Commit TX    │
        └──────┬──────┘
               │
               ▼
        ┌─────────────┐
        │Apply rules  │
        └──────┬──────┘
               │
               ▼
        ┌─────────────┐
        │Audit log    │
        └──────┬──────┘
               │
               ▼
        ┌─────────────┐
        │    END      │
        └─────────────┘
```

### 4.2 Goal Transfer Activity (With Locking)

```
                    ┌─────────────┐
                    │    START    │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │User selects │
                    │src & dest   │
                    │   goals     │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │User enters  │
                    │  amount     │
                    └──────┬──────┘
                           │
                           ▼
                    ◇─────────────◇
                   ╱               ╲
                  ╱ Same household? ╲
                 ╱                   ╲
                ◇─────────────────────◇
               │                       │
            Yes│                       │No
               ▼                       ▼
        ┌─────────────┐         ┌─────────────┐
        │ Start DB TX │         │Return 403   │
        └──────┬──────┘         └──────┬──────┘
               │                       │
               ▼                       ▼
        ┌─────────────┐         ┌─────────────┐
        │ FOR UPDATE  │         │    END      │
        │ lock src    │         └─────────────┘
        └──────┬──────┘
               │
               ▼
        ┌─────────────┐
        │ FOR UPDATE  │
        │ lock dest   │
        └──────┬──────┘
               │
               ▼
        ┌─────────────┐
        │ Read locked │
        │  balances   │
        └──────┬──────┘
               │
               ▼
        ┌─────────────┐
        │Money.subtract│
        │Money.add     │
        └──────┬──────┘
               │
               ▼
                    ◇─────────────◇
                   ╱               ╲
                  ╱   Sufficient    ╲
                 ╱     funds?        ╲
                ◇─────────────────────◇
               │                       │
            Yes│                       │No
               ▼                       ▼
        ┌─────────────┐         ┌─────────────┐
        │Update both  │         │Rollback TX  │
        │  goals      │         └──────┬──────┘
        └──────┬──────┘                │
               │                       ▼
               ▼                ┌─────────────┐
        ┌─────────────┐         │Return error │
        │Create xfer  │         └──────┬──────┘
        │  record     │                │
        └──────┬──────┘                ▼
               │                ┌─────────────┐
               ▼                │    END      │
        ┌─────────────┐         └─────────────┘
        │ Audit log   │
        └──────┬──────┘
               │
               ▼
        ┌─────────────┐
        │ Commit TX   │
        └──────┬──────┘
               │
               ▼
        ┌─────────────┐
        │    END      │
        └─────────────┘
```

---

## 5. Sequence Diagrams

### 5.1 User Authentication Sequence

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│ Client  │     │ Express │     │Passport │     │ bcrypt  │     │   DB    │
└────┬────┘     └────┬────┘     └────┬────┘     └────┬────┘     └────┬────┘
     │               │               │               │               │
     │ POST /login   │               │               │               │
     │──────────────▶│               │               │               │
     │               │authenticate() │               │               │
     │               │──────────────▶│               │               │
     │               │               │ findByEmail() │               │
     │               │               │───────────────────────────────▶│
     │               │               │               │               │
     │               │               │◀──────────────────────────────│
     │               │               │  user record  │               │
     │               │               │               │               │
     │               │               │compare()      │               │
     │               │               │──────────────▶│               │
     │               │               │               │               │
     │               │               │◀──────────────│               │
     │               │               │   match       │               │
     │               │               │               │               │
     │               │◀──────────────│               │               │
     │               │   user        │               │               │
     │               │               │               │               │
     │               │ createSession │               │               │
     │               │───────────────────────────────────────────────▶│
     │               │               │               │               │
     │◀──────────────│               │               │               │
     │  session cookie               │               │               │
     │  + user data  │               │               │               │
     │               │               │               │               │
```

### 5.2 Goal Transfer Sequence (With Locking)

```
┌─────────┐  ┌───────────┐  ┌───────────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
│ Client  │  │Controller │  │GoalTransfer   │  │  Money  │  │  Audit  │  │   DB    │
│         │  │           │  │Service        │  │  Class  │  │ Service │  │         │
└────┬────┘  └─────┬─────┘  └───────┬───────┘  └────┬────┘  └────┬────┘  └────┬────┘
     │             │                │               │            │            │
     │POST /transfer               │               │            │            │
     │────────────▶│                │               │            │            │
     │             │ transfer()     │               │            │            │
     │             │───────────────▶│               │            │            │
     │             │                │               │            │            │
     │             │                │ BEGIN TX      │            │            │
     │             │                │───────────────────────────────────────▶│
     │             │                │               │            │            │
     │             │                │ SELECT...FOR UPDATE (src)  │            │
     │             │                │───────────────────────────────────────▶│
     │             │                │◀──────────────────────────────────────│
     │             │                │               │            │            │
     │             │                │ SELECT...FOR UPDATE (dest) │            │
     │             │                │───────────────────────────────────────▶│
     │             │                │◀──────────────────────────────────────│
     │             │                │               │            │            │
     │             │                │new Money(amt) │            │            │
     │             │                │──────────────▶│            │            │
     │             │                │               │            │            │
     │             │                │subtract()     │            │            │
     │             │                │──────────────▶│            │            │
     │             │                │◀──────────────│            │            │
     │             │                │               │            │            │
     │             │                │add()          │            │            │
     │             │                │──────────────▶│            │            │
     │             │                │◀──────────────│            │            │
     │             │                │               │            │            │
     │             │                │ UPDATE src    │            │            │
     │             │                │───────────────────────────────────────▶│
     │             │                │               │            │            │
     │             │                │ UPDATE dest   │            │            │
     │             │                │───────────────────────────────────────▶│
     │             │                │               │            │            │
     │             │                │ INSERT transfer record     │            │
     │             │                │───────────────────────────────────────▶│
     │             │                │               │            │            │
     │             │                │logTransfer()  │            │            │
     │             │                │───────────────────────────▶│            │
     │             │                │               │            │ INSERT     │
     │             │                │               │            │───────────▶│
     │             │                │               │            │            │
     │             │                │ COMMIT TX     │            │            │
     │             │                │───────────────────────────────────────▶│
     │             │                │               │            │            │
     │             │◀───────────────│               │            │            │
     │             │   result       │               │            │            │
     │◀────────────│                │               │            │            │
     │  200 OK     │                │               │            │            │
```

### 5.3 Report Generation Sequence

```
┌─────────┐  ┌───────────┐  ┌───────────────┐  ┌─────────┐  ┌─────────┐
│ Client  │  │Controller │  │ReportsService │  │  Money  │  │   DB    │
└────┬────┘  └─────┬─────┘  └───────┬───────┘  └────┬────┘  └────┬────┘
     │             │                │               │            │
     │GET /cashflow│                │               │            │
     │────────────▶│                │               │            │
     │             │getCashflow()   │               │            │
     │             │───────────────▶│               │            │
     │             │                │               │            │
     │             │                │query transactions          │
     │             │                │───────────────────────────▶│
     │             │                │◀──────────────────────────│
     │             │                │               │            │
     │             │                │for each txn:  │            │
     │             │                │new Money(amt) │            │
     │             │                │──────────────▶│            │
     │             │                │               │            │
     │             │                │sum.add(amt)   │            │
     │             │                │──────────────▶│            │
     │             │                │◀──────────────│            │
     │             │                │               │            │
     │             │                │               │            │
     │             │                │toNumber()     │            │
     │             │                │──────────────▶│            │
     │             │                │◀──────────────│            │
     │             │                │               │            │
     │             │◀───────────────│               │            │
     │             │{income, expenses, net}         │            │
     │◀────────────│                │               │            │
     │ JSON report │                │               │            │
```

---

## 6. State Diagrams

### 6.1 Goal State Machine

```
                                 ┌─────────────────┐
                                 │     CREATED     │
                                 │  (initial)      │
                                 └────────┬────────┘
                                          │
                                          │ assign account
                                          ▼
                                 ┌─────────────────┐
                      ┌─────────│     ACTIVE      │◀────────┐
                      │         │  (in progress)  │         │
                      │         └────────┬────────┘         │
                      │                  │                  │
                      │                  │ contributions    │
                      │                  │                  │
                      │                  ▼                  │
                      │         ┌─────────────────┐         │
                      │         │   PROGRESSING   │         │
                      │         │ (0% < x < 100%) │         │
                      │         └────────┬────────┘         │
                      │                  │                  │
           pause      │                  │ reach target     │ resume
                      │                  ▼                  │
                      │         ┌─────────────────┐         │
                      │         │   COMPLETED     │         │
                      │         │  (100% reached) │         │
                      │         └────────┬────────┘         │
                      │                  │                  │
                      ▼                  │ reopen          │
             ┌─────────────────┐         │                  │
             │     PAUSED      │─────────┴──────────────────┘
             │  (on hold)      │
             └────────┬────────┘
                      │
                      │ delete
                      ▼
             ┌─────────────────┐
             │    ARCHIVED     │
             │  (soft delete)  │
             └─────────────────┘
```

### 6.2 Transaction State Machine

```
             ┌─────────────────┐
             │     PENDING     │◀──────────────────┐
             │  (imported)     │                   │
             └────────┬────────┘                   │
                      │                            │
                      │ review                     │ unreview
                      ▼                            │
             ┌─────────────────┐                   │
             │    REVIEWED     │───────────────────┘
             │  (confirmed)    │
             └────────┬────────┘
                      │
                      │ delete
                      ▼
             ┌─────────────────┐
             │    DELETED      │
             │  (soft delete)  │
             └─────────────────┘
```

### 6.3 Budget Period State Machine

```
                                 ┌─────────────────┐
                                 │     PLANNED     │
                                 │  (future month) │
                                 └────────┬────────┘
                                          │
                                          │ month starts
                                          ▼
             ┌─────────────────┐  ┌─────────────────┐
             │   UNDER BUDGET  │◀─│     ACTIVE      │
             │   (< 80% used)  │  │ (current month) │
             └────────┬────────┘  └────────┬────────┘
                      │                    │
                      │ spending increases │
                      ▼                    ▼
             ┌─────────────────┐  ┌─────────────────┐
             │   AT LIMIT      │  │  OVER BUDGET    │
             │  (80-100% used) │─▶│   (> 100%)      │
             └────────┬────────┘  └────────┬────────┘
                      │                    │
                      │ month ends         │ month ends
                      ▼                    ▼
             ┌─────────────────┐  ┌─────────────────┐
             │    CLOSED       │  │  CLOSED (OVER)  │
             │  (historical)   │  │  (historical)   │
             └─────────────────┘  └─────────────────┘
                      │                    │
                      │ rollover enabled   │
                      ▼                    ▼
             ┌─────────────────┐  ┌─────────────────┐
             │ ROLLOVER CREDIT │  │  ROLLOVER DEBT  │
             │ (unused → next) │  │  (over → next)  │
             └─────────────────┘  └─────────────────┘
```

---

## Appendix A: Use Case Summary Matrix

| UC ID | Name | Actors | Priority | Status |
|-------|------|--------|----------|--------|
| UC-01 | User Registration | Unregistered User | Critical | Implemented |
| UC-02 | Create Transaction | Owner, Admin, Member | Critical | Implemented |
| UC-03 | Transfer Between Goals | Owner, Admin | High | Implemented |
| UC-04 | Generate Report | All Roles | High | Implemented |
| UC-05 | Import CSV | Owner, Admin | Medium | Implemented |
| UC-06 | Create Budget | Owner, Admin | High | Implemented |
| UC-07 | Track Investment | Owner, Admin | Medium | Implemented |
| UC-08 | Manage Household | Owner | Medium | Implemented |

## Appendix B: Change History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-13 | Engineering | Initial release |
