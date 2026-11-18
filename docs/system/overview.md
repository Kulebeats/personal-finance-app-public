# System Overview

## Personal Finance Application

**Document Version:** 2.0  
**Last Updated:** 2026-02-06  
**Status:** Active

---

## 1. Executive Summary

The Personal Finance Application is a full-stack web application enabling households to track, budget, and analyze their finances. It supports multi-user households with role-based access, comprehensive transaction management, budgeting with rollover, investment tracking, and financial reporting.

### Key Metrics

| Metric          | Value                  |
| --------------- | ---------------------- |
| Primary Modules | 19                     |
| Database Tables | 40+                    |
| API Endpoints   | 150+                   |
| Test Coverage   | 80%+ target            |
| Target Users    | Households/Individuals |

---

## 2. Purpose & Vision

### 2.1 Business Problem

Many individuals and households struggle with:

- Tracking expenses across multiple accounts
- Understanding spending patterns
- Setting and maintaining budgets
- Coordinating finances between household members
- Tracking investments and net worth over time

### 2.2 Solution

The application provides a unified platform for:

- Aggregating all financial accounts in one view
- Categorizing transactions automatically via rules engine
- Setting category-based budgets with rollover support
- Goal tracking for savings and debt payoff
- Investment portfolio performance tracking
- Comprehensive reporting and trend analysis

### 2.3 Vision Statement

_"Empower every household to achieve financial clarity and control through intuitive, secure, and comprehensive personal finance management."_

---

## 3. Stakeholders

| Role                    | Interests                                | Communication                     |
| ----------------------- | ---------------------------------------- | --------------------------------- |
| **End Users**           | Easy UX, data security, accurate reports | Product feedback, support tickets |
| **Household Members**   | Shared access, privacy controls          | App notifications                 |
| **Product Team**        | Feature requirements, roadmap            | Sprint planning, PRDs             |
| **Engineering Team**    | Technical design, code quality           | Architecture docs, ADRs           |
| **Security/Compliance** | Data protection, audit readiness         | Security reviews, policies        |
| **QA Team**             | Test coverage, bug tracking              | Test plans, defect reports        |
| **Operations**          | System health, incident response         | Runbooks, monitoring              |
| **Leadership**          | ROI, user growth, risk                   | Executive summaries               |

---

## 4. Target Audience

### 4.1 Primary Users

- **Individuals** managing personal finances
- **Couples** coordinating household budgets
- **Families** with shared financial responsibilities
- **Small households** (2-6 members)

### 4.2 User Personas

#### Alex - The Budget Tracker

- Age: 30, single professional
- Goal: Track spending, save for travel
- Pain Point: Spreadsheets are tedious

#### Jordan & Sam - The Couple

- Ages: 28 and 32, dual income
- Goal: Coordinate shared expenses, save for house
- Pain Point: Multiple bank accounts, visibility issues

#### The Banda Family

- Parents + 2 children
- Goal: Track household expenses, teach kids about money
- Pain Point: Need role-based access for different members

---

## 5. Core Capabilities

### 5.1 Financial Tracking

| Feature                  | Description                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| **Account Management**   | 8+ account types: checking, savings, credit, investment, loan, cash, mobile_money, other |
| **Transaction Tracking** | Manual entry, bulk import (CSV), split transactions                                      |
| **Transfers**            | Inter-account transfers with atomic balance updates                                      |
| **Balance History**      | Track account balances over time                                                         |

### 5.2 Budgeting

| Feature               | Description                          |
| --------------------- | ------------------------------------ |
| **Category Budgets**  | Monthly budgets per category         |
| **Rollover**          | Unused budget carries to next period |
| **Progress Tracking** | Real-time budget utilization         |
| **Alerts**            | Overspending notifications           |

### 5.3 Goals

| Feature                | Description                         |
| ---------------------- | ----------------------------------- |
| **Savings Goals**      | Track progress toward target amount |
| **Debt Payoff**        | Track loan/credit reduction         |
| **Investment Goals**   | Link to investment accounts         |
| **Account Assignment** | Link goals to specific accounts     |

### 5.4 Investments

| Feature               | Description                                          |
| --------------------- | ---------------------------------------------------- |
| **Holdings Tracking** | Quantity, cost basis, current value                  |
| **Security Types**    | Stock, bond, ETF, mutual fund, T-bill, crypto, forex |
| **Performance**       | Returns calculation, gain/loss reporting             |
| **Tax Lots**          | FIFO/LIFO tracking for tax reporting                 |

### 5.5 Reporting

| Report                | Description                    |
| --------------------- | ------------------------------ |
| **Cashflow**          | Income vs expenses over time   |
| **Net Worth**         | Assets minus liabilities trend |
| **Spending Analysis** | By category, merchant, tag     |
| **Trends**            | Month-over-month comparisons   |
| **Export**            | CSV/PDF report generation      |

### 5.6 Automation

| Feature                    | Description                         |
| -------------------------- | ----------------------------------- |
| **Rules Engine**           | Auto-categorize based on conditions |
| **Recurring Transactions** | Scheduled transaction templates     |
| **Merchant Matching**      | Auto-map merchants to transactions  |
| **Notifications**          | Weekly recap, goal reminders        |

---

## 6. Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Layer                              │
│  React 18 + TypeScript + TanStack Query + Radix UI + Tailwind   │
└─────────────────────────────────────────────────────────────────┘
                              │ HTTPS
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        API Layer                                 │
│  Express.js + Session Auth + CSRF Protection + Rate Limiting    │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  Controllers  │    │   Services    │    │ Repositories  │
│  (HTTP only)  │───▶│ (Business)    │───▶│ (Data Access) │
└───────────────┘    └───────────────┘    └───────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PostgreSQL Database                         │
│  Drizzle ORM + Transactions + Row-Level Locking                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key Patterns:**

- 3-layer separation (Controller → Service → Repository)
- Household-based multi-tenancy
- Session-based authentication (no JWTs)
- CSRF double-submit cookie pattern

---

## 7. Design Principles

1. **Security First**: All financial data protected by household isolation, CSRF, rate limiting
2. **Precision**: Money class prevents floating-point errors in all calculations
3. **Auditability**: BusinessAuditService logs all financial mutations
4. **Consistency**: FOR UPDATE locking prevents race conditions
5. **Simplicity**: Prefer explicit over magic; avoid over-engineering
6. **Testability**: All modules have unit and integration tests

---

## 8. Data Classification

| Class         | Examples                         | Protection Level                 |
| ------------- | -------------------------------- | -------------------------------- |
| **PII**       | Names, email, profile            | Encrypted at rest, access logged |
| **Financial** | Accounts, transactions, balances | Household-isolated, audit logged |
| **Security**  | Sessions, MFA codes, audit logs  | Hashed, time-limited             |
| **Media**     | Receipts, logos, profiles        | Authenticated access only        |

---

## 9. Scope Boundaries

### In Scope

- Manual account and transaction management
- Internal analytics and reporting
- Investment tracking (manual entry)
- Household multi-tenancy
- CSV import/export

### Out of Scope

- Direct bank integrations (Plaid, Open Banking)
- Payment processing (card transactions)
- Tax filing automation
- Mobile native apps (web responsive only)
- Third-party API access

---

## 10. Assumptions

- TLS termination handled by reverse proxy in production
- PostgreSQL database availability
- Single household per database instance (no cross-household sharing)
- UTC timezone for all server-side timestamps
- English-only UI (i18n planned for future)

---

## 11. Versioning

| Component       | Current Version    | Versioning Strategy                     |
| --------------- | ------------------ | --------------------------------------- |
| API             | v1                 | URL path versioning (/api/v1/\*)        |
| Database Schema | Drizzle migrations | Sequential numbered migrations          |
| Documentation   | Living docs        | Date-stamped major revisions            |
| Application     | 0.3.0              | Semantic versioning (MAJOR.MINOR.PATCH) |

---

## 12. Related Documentation

| Document                                                      | Purpose                    |
| ------------------------------------------------------------- | -------------------------- |
| [Architecture](architecture.md)                               | Technical component design |
| [Data Flows](data-flows.md)                                   | Request/response patterns  |
| [SRS](../specifications/srs.md)                               | Detailed requirements      |
| [SDD](../specifications/sdd.md)                               | System design document     |
| [Security Architecture](../security/security-architecture.md) | Security controls          |
| [CHANGELOG](../../CHANGELOG.md)                               | Release history            |

---

_Document expanded: 2026-02-06 as part of documentation re-audit (Task 3.1)_
