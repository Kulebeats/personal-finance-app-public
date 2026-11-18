# Data Dictionary

## Personal Finance Application

**Last Updated:** 2026-02-06

---

## Core Entities

### households

The top-level isolation unit. All user data belongs to a household.

| Column    | Type         | Description                 |
| --------- | ------------ | --------------------------- |
| id        | uuid         | Primary key                 |
| name      | varchar(100) | Household display name      |
| currency  | char(3)      | Default currency (ISO 4217) |
| createdAt | timestamp    | Creation timestamp          |
| ownerId   | uuid FK      | User who created household  |

---

### users

User accounts with authentication credentials.

| Column              | Type         | Description                  |
| ------------------- | ------------ | ---------------------------- |
| id                  | uuid         | Primary key                  |
| email               | varchar(255) | Unique, login identifier     |
| username            | varchar(50)  | Display name                 |
| passwordHash        | text         | bcrypt hash (12 rounds)      |
| householdId         | uuid FK      | Current household            |
| role                | enum         | owner, admin, member, viewer |
| mfaEnabled          | boolean      | MFA toggle                   |
| mfaCode             | text         | Hashed OTP (temporary)       |
| mfaCodeExpiry       | timestamp    | OTP expiration               |
| emailVerified       | boolean      | Email confirmation status    |
| lockedUntil         | timestamp    | Account lockout expiry       |
| failedLoginAttempts | integer      | Lockout counter              |
| createdAt           | timestamp    | Registration date            |

---

### accounts

Financial accounts (bank, credit, investment, etc.)

| Column       | Type          | Description                                                            |
| ------------ | ------------- | ---------------------------------------------------------------------- |
| id           | uuid          | Primary key                                                            |
| householdId  | uuid FK       | Owner household                                                        |
| name         | varchar(100)  | Account name                                                           |
| type         | enum          | checking, savings, credit, investment, loan, cash, mobile_money, other |
| balance      | decimal(19,4) | Current balance                                                        |
| currency     | char(3)       | Account currency                                                       |
| isHidden     | boolean       | Exclude from summaries                                                 |
| isClosed     | boolean       | Soft close flag                                                        |
| institution  | varchar(100)  | Bank/provider name                                                     |
| lastFour     | char(4)       | Last 4 digits (optional)                                               |
| creditLimit  | decimal(19,4) | For credit accounts                                                    |
| interestRate | decimal(5,4)  | APR for loans/credit                                                   |
| createdAt    | timestamp     | Creation date                                                          |

---

### transactions

All financial transactions across accounts.

| Column      | Type          | Description                                   |
| ----------- | ------------- | --------------------------------------------- |
| id          | uuid          | Primary key                                   |
| householdId | uuid FK       | Owner household                               |
| accountId   | uuid FK       | Source account                                |
| amount      | decimal(19,4) | Transaction amount                            |
| type        | enum          | income, expense, transfer, balance_adjustment |
| date        | date          | Transaction date                              |
| description | text          | User description                              |
| categoryId  | uuid FK       | Assigned category                             |
| merchantId  | uuid FK       | Linked merchant                               |
| isRecurring | boolean       | Recurring flag                                |
| recurringId | uuid FK       | Parent recurring template                     |
| isReviewed  | boolean       | User verified flag                            |
| notes       | text          | User notes                                    |
| createdAt   | timestamp     | Entry timestamp                               |

---

### categories

Transaction categorization hierarchy.

| Column      | Type        | Description     |
| ----------- | ----------- | --------------- |
| id          | uuid        | Primary key     |
| householdId | uuid FK     | Owner household |
| name        | varchar(50) | Category name   |
| groupId     | uuid FK     | Parent group    |
| icon        | varchar(50) | Icon identifier |
| color       | char(7)     | Hex color       |
| isSystem    | boolean     | System-provided |

---

### budgets

Monthly category budgets.

| Column      | Type          | Description                |
| ----------- | ------------- | -------------------------- |
| id          | uuid          | Primary key                |
| householdId | uuid FK       | Owner household            |
| categoryId  | uuid FK       | Target category            |
| amount      | decimal(19,4) | Budget amount              |
| period      | varchar(7)    | YYYY-MM format             |
| rollover    | boolean       | Carry unused to next month |
| spent       | decimal(19,4) | Calculated spent amount    |

---

### goals

Savings and investment goals.

| Column        | Type          | Description                   |
| ------------- | ------------- | ----------------------------- |
| id            | uuid          | Primary key                   |
| householdId   | uuid FK       | Owner household               |
| name          | varchar(100)  | Goal name                     |
| type          | enum          | save_up, pay_down, investment |
| targetAmount  | decimal(19,4) | Target value                  |
| currentAmount | decimal(19,4) | Progress value                |
| targetDate    | date          | Target completion             |
| accountId     | uuid FK       | Linked account                |
| isCompleted   | boolean       | Completion flag               |

---

### securities

Investment security definitions.

| Column       | Type          | Description                                         |
| ------------ | ------------- | --------------------------------------------------- |
| id           | uuid          | Primary key                                         |
| householdId  | uuid FK       | Owner household                                     |
| symbol       | varchar(20)   | Ticker symbol                                       |
| name         | varchar(100)  | Security name                                       |
| type         | enum          | stock, bond, etf, mutual_fund, tbill, crypto, forex |
| currency     | char(3)       | Trading currency                                    |
| currentPrice | decimal(19,4) | Last known price                                    |
| priceDate    | timestamp     | Price timestamp                                     |

---

### holdings

Investment positions in accounts.

| Column       | Type          | Description         |
| ------------ | ------------- | ------------------- |
| id           | uuid          | Primary key         |
| accountId    | uuid FK       | Investment account  |
| securityId   | uuid FK       | Security held       |
| quantity     | decimal(19,6) | Number of units     |
| costBasis    | decimal(19,4) | Total purchase cost |
| purchaseDate | date          | Acquisition date    |

---

## Audit & Security

### business_audit_log

Audit trail for financial mutations.

| Column      | Type        | Description            |
| ----------- | ----------- | ---------------------- |
| id          | uuid        | Primary key            |
| householdId | uuid FK     | Context household      |
| userId      | uuid FK     | Acting user            |
| action      | enum        | CREATE, UPDATE, DELETE |
| entityType  | varchar(50) | Table name             |
| entityId    | uuid        | Record ID              |
| oldValue    | jsonb       | Previous state         |
| newValue    | jsonb       | New state              |
| timestamp   | timestamp   | Event time             |
| ipAddress   | inet        | Client IP              |

---

### session

Express session storage.

| Column | Type         | Description     |
| ------ | ------------ | --------------- |
| sid    | varchar(255) | Session ID      |
| sess   | jsonb        | Session data    |
| expire | timestamp    | Expiration time |

---

## Naming Conventions

| Pattern    | Example        | Usage            |
| ---------- | -------------- | ---------------- |
| snake_case | user_id        | Database columns |
| camelCase  | userId         | TypeScript/JSON  |
| PascalCase | UserRepository | Classes          |
| kebab-case | user-settings  | URLs             |

---

_Created: 2026-02-06 as part of documentation re-audit (Task 3.7)_
