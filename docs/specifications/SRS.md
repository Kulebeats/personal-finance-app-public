# Software Requirements Specification (SRS)

## Personal Finance Application

**Document Version:** 2.1
**Date:** 2026-02-06
**Status:** Approved
**Standard:** IEEE 830-1998

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Overall Description](#2-overall-description)
3. [Specific Requirements](#3-specific-requirements)
4. [External Interface Requirements](#4-external-interface-requirements)
5. [Non-Functional Requirements](#5-non-functional-requirements)
6. [Appendices](#6-appendices)

---

## 1. Introduction

### 1.1 Purpose

This Software Requirements Specification (SRS) defines the functional and non-functional requirements for the Personal Finance Application. It serves as the authoritative reference for developers, testers, and stakeholders throughout the software development lifecycle.

### 1.2 Scope

The Personal Finance Application is a full-stack web application for household financial management. The system enables users to:

- Track accounts and transactions across multiple financial institutions
- Manage budgets with category-based spending limits
- Set and monitor financial goals (savings, debt payoff, investments)
- Generate financial reports and analytics
- Process receipt images with OCR
- Track investment portfolios and performance
- Manage household members, roles, and shared visibility
- Configure settings, security preferences, and notification channels
- Organize data with categories, merchants, tags, and automation rules
- Automate recurring transactions and reminders
- Export data for portability and compliance

**Out of Scope:**

- Payment processing
- Cryptocurrency wallet management
- Tax filing automation
- Mental health screening workflows (PHQ-9)

### 1.3 Definitions, Acronyms, and Abbreviations

| Term              | Definition                                                           |
| ----------------- | -------------------------------------------------------------------- |
| **Household**     | A logical grouping of users sharing financial data                   |
| **Transaction**   | A financial event (income, expense, transfer)                        |
| **Goal**          | A financial target (save_up, pay_down, investment)                   |
| **Money Class**   | Internal decimal arithmetic class for currency precision             |
| **CSRF**          | Cross-Site Request Forgery                                           |
| **FOR UPDATE**    | PostgreSQL row-level locking mechanism                               |
| **Audit Log**     | Immutable record of financial write operations                       |
| **ODPC**          | Office of the Data Protection Commissioner (Zambia)                  |
| **DPA**           | Data Protection Act No. 3 of 2021 (Zambia)                           |
| **Personal Data** | Information relating to an identified or identifiable natural person |
| **Data Subject**  | Individual whose personal data is processed                          |

### 1.4 References

- IEEE 830-1998: Recommended Practice for Software Requirements Specifications
- **Data Protection Act No. 3 of 2021 (Zambia)** - Primary data protection regulation
- OWASP Application Security Verification Standard (ASVS) 4.0
- PCI DSS v4.0 (guidance only, not certified)
- ISO 27001:2022 Information Security Management
- Zambia DPA Compliance Guide: `docs/compliance/compliance-summary.md`

### 1.5 Overview

Section 2 provides product context and constraints. Section 3 details functional requirements. Section 4 covers interface specifications. Section 5 defines non-functional requirements.

---

## 2. Overall Description

### 2.1 Product Perspective

The application is a standalone system with the following architectural components:

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

### 2.2 Product Functions

| Module             | Primary Functions                                                                 |
| ------------------ | --------------------------------------------------------------------------------- |
| **Authentication** | Registration, login, logout, password reset, session management, MFA              |
| **Household**      | Household creation, member roles, shared visibility                               |
| **Settings**       | Profile, display settings, security preferences, notification preferences         |
| **Accounts**       | CRUD operations, balance tracking, visibility controls                            |
| **Transactions**   | CRUD, categorization, transfers, imports, rules engine                            |
| **Categories**     | Category groups, category management, budgeting metadata                          |
| **Merchants**      | Merchant normalization, merge, defaults                                           |
| **Tags**           | Tag creation and assignment for transactions                                      |
| **Rules**          | Automation rules for categorization and tagging                                   |
| **Recurring**      | Recurring rule creation, scheduling, reminders, linking                           |
| **Budgets**        | Category budgets, rollover support, progress tracking                             |
| **Goals**          | Save-up, pay-down, investment goals with account assignment                       |
| **Reports**        | Cashflow, spending, net worth, trends, exports                                    |
| **Investments**    | Holdings, securities, portfolio performance, T-Bill automation                    |
| **Receipts**       | Upload, OCR processing, transaction matching                                      |
| **Notifications**  | Preferences, weekly recap, security alerts                                        |
| **Exports**        | Data export, portability, and audit logging                                       |

### 2.3 User Classes and Characteristics

| User Class | Description               | Permissions                     |
| ---------- | ------------------------- | ------------------------------- |
| **Owner**  | Household creator         | Full access, member management  |
| **Admin**  | Elevated household member | Full financial access, settings |
| **Member** | Standard household member | View and edit own transactions  |
| **Viewer** | Read-only access          | View-only permissions           |

### 2.4 Operating Environment

- **Server:** Node.js 20+ LTS
- **Database:** PostgreSQL 15+
- **Client:** Modern browsers (Chrome 90+, Firefox 90+, Safari 15+, Edge 90+)
- **Optional:** Redis 7+ for distributed rate limiting

### 2.5 Design and Implementation Constraints

1. **Currency Precision:** All monetary calculations MUST use the Money class (decimal.js wrapper) to prevent floating-point errors
2. **Concurrent Access:** Financial mutations MUST use database transactions with FOR UPDATE row locking
3. **Audit Trail:** All financial write operations MUST be logged via BusinessAuditService
4. **LOC Limits:** Controllers <500 LOC, Client components <300 LOC
5. **3-Layer Architecture:** Controllers handle HTTP only; business logic in Services; data access in Repositories

### 2.6 Assumptions and Dependencies

**Assumptions:**

- TLS termination handled by reverse proxy in production
- Single-tenant deployment per household
- UTC timezone for all server-side timestamps

**Dependencies:**

- PostgreSQL database availability
- Session storage in PostgreSQL
- Optional Redis for rate limiting in multi-instance deployments

---

## 3. Specific Requirements

### 3.1 Functional Requirements

#### 3.1.1 Authentication Module

| ID       | Requirement                                                             | Priority |
| -------- | ----------------------------------------------------------------------- | -------- |
| AUTH-001 | System SHALL support email/password authentication                      | P0       |
| AUTH-002 | System SHALL hash passwords using bcrypt with cost factor 12            | P0       |
| AUTH-003 | System SHALL enforce password complexity (8+ chars, uppercase, number)  | P0       |
| AUTH-004 | System SHALL implement session-based authentication with secure cookies | P0       |
| AUTH-005 | System SHALL support password reset via email token                     | P1       |
| AUTH-006 | System SHALL lock accounts after 5 failed login attempts                | P1       |
| AUTH-007 | System SHALL log all authentication events to audit log                 | P0       |
| AUTH-008 | System SHALL support email-based multi-factor authentication (OTP)      | P1       |
| AUTH-009 | System SHALL provide backup codes for MFA recovery                      | P1       |
| AUTH-010 | System SHALL allow users to enable/disable MFA in settings              | P1       |
| AUTH-011 | System SHALL rate-limit MFA verification attempts (5/min)               | P0       |
| AUTH-012 | System SHALL hash MFA codes before storage                              | P0       |
| AUTH-013 | System SHALL require verified email before successful login             | P0       |
| AUTH-014 | System SHALL support user-initiated password changes                    | P0       |
| AUTH-015 | System SHALL prevent reuse of recent passwords (minimum 5 history)      | P1       |
| AUTH-016 | System SHALL provide login history to users                             | P1       |
| AUTH-017 | System SHALL allow users to view and revoke active sessions             | P0       |
| AUTH-018 | System SHALL notify users of new device sign-ins                        | P1       |

#### 3.1.2 Account Management

| ID       | Requirement                                                                                         | Priority |
| -------- | --------------------------------------------------------------------------------------------------- | -------- |
| ACCT-001 | System SHALL support account types: checking, savings, credit, loan, investment, cash, mobile_money | P0       |
| ACCT-002 | System SHALL track account balances with decimal precision                                          | P0       |
| ACCT-003 | System SHALL support soft deletion of accounts                                                      | P0       |
| ACCT-004 | System SHALL enforce household isolation for all account queries                                    | P0       |
| ACCT-005 | System SHALL support account visibility controls (hidden, owner-only)                               | P1       |
| ACCT-006 | System SHALL recalculate balances atomically on transaction changes                                 | P0       |

#### 3.1.3 Transaction Management

| ID      | Requirement                                                                           | Priority |
| ------- | ------------------------------------------------------------------------------------- | -------- |
| TXN-001 | System SHALL support transaction types: income, expense, transfer, balance_adjustment | P0       |
| TXN-002 | System SHALL validate transaction amounts using Money class                           | P0       |
| TXN-003 | System SHALL update account balances atomically within database transaction           | P0       |
| TXN-004 | System SHALL support transaction categorization                                       | P0       |
| TXN-005 | System SHALL support bulk import from CSV                                             | P1       |
| TXN-006 | System SHALL apply auto-categorization rules to new transactions                      | P1       |
| TXN-007 | System SHALL support split transactions across categories                             | P2       |

#### 3.1.4 Goal Management

| ID       | Requirement                                                       | Priority |
| -------- | ----------------------------------------------------------------- | -------- |
| GOAL-001 | System SHALL support goal types: save_up, pay_down, investment    | P0       |
| GOAL-002 | System SHALL track goal progress with currency precision          | P0       |
| GOAL-003 | System SHALL support goal-to-account assignments                  | P0       |
| GOAL-004 | System SHALL support inter-goal transfers with FOR UPDATE locking | P0       |
| GOAL-005 | System SHALL prevent double-spend via row-level locking           | P0       |
| GOAL-006 | System SHALL log all goal financial operations to audit log       | P0       |
| GOAL-007 | System SHALL support transaction-to-goal linking                  | P1       |

#### 3.1.5 Budget Management

| ID      | Requirement                                                | Priority |
| ------- | ---------------------------------------------------------- | -------- |
| BUD-001 | System SHALL support monthly category budgets              | P0       |
| BUD-002 | System SHALL track budget progress against actual spending | P0       |
| BUD-003 | System SHALL support budget rollover for unused amounts    | P2       |
| BUD-004 | System SHALL support envelope budgeting system             | P2       |

#### 3.1.6 Reporting Module

| ID      | Requirement                                              | Priority |
| ------- | -------------------------------------------------------- | -------- |
| RPT-001 | System SHALL generate cashflow reports by period         | P0       |
| RPT-002 | System SHALL generate spending reports by category       | P0       |
| RPT-003 | System SHALL calculate net worth across all accounts     | P0       |
| RPT-004 | System SHALL support CSV export of transactions          | P1       |
| RPT-005 | System SHALL support date range filtering on all reports | P0       |

#### 3.1.7 Investment Module

| ID      | Requirement                                                                                                                                   | Priority |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| INV-001 | System SHALL track security holdings with quantity and cost basis                                                                             | P0       |
| INV-002 | System SHALL support security types: stock, bond, etf, mutual_fund, unit_trust, term_deposit, tbill, forex, crypto                            | P0       |
| INV-003 | System SHALL calculate portfolio performance metrics                                                                                          | P1       |
| INV-004 | System SHALL support T-Bill maturity automation                                                                                               | P2       |
| INV-005 | System SHALL support investment transaction sub-types: buy, sell, dividend, interest, fee, split, transfer_in, transfer_out, coupon, maturity | P1       |
| INV-006 | System SHALL separate investment queries and mutations into sub-services                                                                      | P1       |

#### 3.1.8 Rules Engine

| ID       | Requirement                                                                                   | Priority |
| -------- | --------------------------------------------------------------------------------------------- | -------- |
| RULE-001 | System SHALL support condition-based auto-categorization rules                                | P1       |
| RULE-002 | System SHALL support rule conditions: amount, description, merchant, category, date, account  | P1       |
| RULE-003 | System SHALL support rule actions: rename_merchant, categorize, add_tags, hide, mark_reviewed | P1       |
| RULE-004 | System SHALL apply rules in priority order                                                    | P1       |

#### 3.1.9 Notification Module

| ID        | Requirement                                                         | Priority |
| --------- | ------------------------------------------------------------------- | -------- |
| NOTIF-001 | System SHALL support configurable notification preferences per type | P1       |
| NOTIF-002 | System SHALL support in-app and email notification channels         | P1       |
| NOTIF-003 | System SHALL support quiet hours configuration                      | P2       |
| NOTIF-004 | System SHALL generate weekly financial recap notifications          | P2       |
| NOTIF-005 | System SHALL send new login security alerts                         | P1       |
| NOTIF-006 | System SHALL support push notification subscriptions                | P2       |

#### 3.1.10 Household Management

| ID     | Requirement                                                         | Priority |
| ------ | ------------------------------------------------------------------- | -------- |
| HH-001 | System SHALL allow users to create a household with name and currency | P0       |
| HH-002 | System SHALL support household member role updates (owner/admin/member/view_only) | P0 |
| HH-003 | System SHALL restrict role changes to owners/admins only             | P0       |
| HH-004 | System SHALL support member removal with safeguards (cannot remove last member) | P1 |

#### 3.1.11 Settings & Preferences

| ID      | Requirement                                                         | Priority |
| ------- | ------------------------------------------------------------------- | -------- |
| SET-001 | System SHALL allow users to update profile information               | P0       |
| SET-002 | System SHALL support display settings (theme, locale, currency)      | P1       |
| SET-003 | System SHALL support notification preference configuration           | P1       |
| SET-004 | System SHALL allow users to view and revoke active sessions          | P0       |
| SET-005 | System SHALL allow users to change password with validation          | P0       |

#### 3.1.12 Categories & Merchants

| ID      | Requirement                                                         | Priority |
| ------- | ------------------------------------------------------------------- | -------- |
| CAT-001 | System SHALL support category groups and categories with ordering    | P0       |
| CAT-002 | System SHALL support category budget modes (by category/by group)    | P1       |
| MER-001 | System SHALL support merchant creation, update, and merge            | P1       |
| MER-002 | System SHALL allow default category mapping per merchant             | P1       |

#### 3.1.13 Tags

| ID     | Requirement                                                         | Priority |
| ------ | ------------------------------------------------------------------- | -------- |
| TAG-001 | System SHALL support tag CRUD and archiving                          | P1       |
| TAG-002 | System SHALL support bulk tag assignment to transactions             | P1       |

#### 3.1.14 Recurring Transactions

| ID     | Requirement                                                         | Priority |
| ------ | ------------------------------------------------------------------- | -------- |
| REC-001 | System SHALL support recurring rule creation for income/expense      | P0       |
| REC-002 | System SHALL support pause, resume, and skip actions                 | P1       |
| REC-003 | System SHALL provide upcoming recurring items list                   | P1       |
| REC-004 | System SHALL support linking recurring rules to transactions         | P1       |
| REC-005 | System SHALL support pattern detection for suggested recurring rules | P2       |

#### 3.1.15 Receipts & OCR

| ID     | Requirement                                                         | Priority |
| ------ | ------------------------------------------------------------------- | -------- |
| RCT-001 | System SHALL allow receipt upload and storage                        | P1       |
| RCT-002 | System SHALL extract receipt data via OCR                            | P2       |
| RCT-003 | System SHALL allow linking receipts to transactions                  | P1       |

#### 3.1.16 Data Export & Portability

| ID     | Requirement                                                         | Priority |
| ------ | ------------------------------------------------------------------- | -------- |
| EXP-001 | System SHALL export transactions and reports as CSV                  | P1       |
| EXP-002 | System SHALL support data export before account deletion             | P1       |

### 3.2 Data Requirements

#### 3.2.1 Data Integrity

| ID       | Requirement                                                         | Priority |
| -------- | ------------------------------------------------------------------- | -------- |
| DATA-001 | System SHALL enforce referential integrity via foreign keys         | P0       |
| DATA-002 | System SHALL use database transactions for multi-table updates      | P0       |
| DATA-003 | System SHALL prevent negative balances where business rules require | P1       |
| DATA-004 | System SHALL maintain audit trail for all financial mutations       | P0       |

#### 3.2.2 Data Retention

| ID      | Requirement                                                          | Priority |
| ------- | -------------------------------------------------------------------- | -------- |
| RET-001 | System SHALL retain transaction data for minimum 7 years             | P1       |
| RET-002 | System SHALL retain audit logs for minimum 7 years                   | P0       |
| RET-003 | System SHALL retain login history for 12 months                      | P1       |
| RET-004 | System SHALL purge expired sessions within 30 days                   | P1       |
| RET-005 | System SHALL purge exports after 30 days                              | P2       |
| RET-006 | System SHALL apply retention to receipts and files (account + 90 days) | P2      |
| RET-007 | System SHALL support data export before account deletion             | P1       |

---

## 4. External Interface Requirements

### 4.1 User Interfaces

| ID     | Requirement                                                   | Priority |
| ------ | ------------------------------------------------------------- | -------- |
| UI-001 | System SHALL provide responsive design for desktop and tablet | P0       |
| UI-002 | System SHALL support dark mode theme                          | P2       |
| UI-003 | System SHALL meet WCAG 2.1 AA accessibility standards         | P1       |
| UI-004 | System SHALL provide keyboard navigation for all features     | P1       |

### 4.2 Hardware Interfaces

Not applicable - web-based application.

### 4.3 Software Interfaces

| Interface  | Protocol | Purpose                  |
| ---------- | -------- | ------------------------ |
| PostgreSQL | TCP/5432 | Primary data storage     |
| Redis      | TCP/6379 | Rate limiting (optional) |
| SMTP       | TCP/587  | Email notifications      |

### 4.4 Communications Interfaces

| ID      | Requirement                                                 | Priority |
| ------- | ----------------------------------------------------------- | -------- |
| COM-001 | System SHALL use HTTPS for all client-server communication  | P0       |
| COM-002 | System SHALL use JSON for API request/response bodies       | P0       |
| COM-003 | System SHALL include CSRF tokens in state-changing requests | P0       |

---

## 5. Non-Functional Requirements

### 5.1 Performance Requirements

| ID       | Requirement                                      | Target                    |
| -------- | ------------------------------------------------ | ------------------------- |
| PERF-001 | API response time for list operations            | < 500ms (95th percentile) |
| PERF-002 | API response time for single-resource operations | < 200ms (95th percentile) |
| PERF-003 | Report generation time                           | < 2s for 1 year of data   |
| PERF-004 | Concurrent user support                          | 100 users per instance    |

### 5.2 Security Requirements

| ID      | Requirement                                                                              | Priority |
| ------- | ---------------------------------------------------------------------------------------- | -------- |
| SEC-001 | System SHALL implement CSRF protection on all state-changing endpoints                   | P0       |
| SEC-002 | System SHALL implement rate limiting (100 req/15min general, 5/15min auth)               | P0       |
| SEC-003 | System SHALL sanitize all user inputs                                                    | P0       |
| SEC-004 | System SHALL use parameterized queries (Drizzle ORM)                                     | P0       |
| SEC-005 | System SHALL set secure cookie flags (HttpOnly, Secure, SameSite)                        | P0       |
| SEC-006 | System SHALL implement Content Security Policy headers                                   | P1       |
| SEC-007 | System SHALL log security events to audit trail                                          | P0       |
| SEC-008 | System SHALL use Money class to prevent floating-point vulnerabilities                   | P0       |
| SEC-009 | System SHALL use FOR UPDATE locking to prevent race conditions                           | P0       |
| SEC-010 | System SHALL comply with Zambia Data Protection Act No. 3 of 2021                        | P0       |
| SEC-011 | System SHALL register with ODPC as Data Controller by 30 April 2025                      | P0       |
| SEC-012 | System SHALL implement data subject rights (access, rectification, erasure, portability) | P0       |
| SEC-013 | System SHALL provide privacy notice to users at data collection                          | P0       |
| SEC-014 | System SHALL report data breaches to ODPC within 24 hours                                | P0       |
| SEC-015 | System SHALL process and store personal data within Zambia or obtain approval            | P0       |
| SEC-016 | System SHALL appoint a Data Protection Officer                                           | P0       |
| SEC-017 | System SHALL maintain records of processing activities                                   | P0       |
| SEC-018 | System SHALL log security-sensitive settings changes to audit logs                        | P0       |
| SEC-019 | System SHALL enforce password history and prevent reuse                                  | P1       |
| SEC-020 | System SHALL allow session revocation for suspected compromise                           | P0       |

### 5.3 Reliability Requirements

| ID      | Requirement           | Target                       |
| ------- | --------------------- | ---------------------------- |
| REL-001 | System availability   | 99.5% monthly                |
| REL-002 | Data durability       | 99.999%                      |
| REL-003 | Transaction atomicity | 100% (database transactions) |

### 5.4 Maintainability Requirements

| ID      | Requirement                                                            | Priority |
| ------- | ---------------------------------------------------------------------- | -------- |
| MNT-001 | Code SHALL follow 3-layer architecture (Controller/Service/Repository) | P0       |
| MNT-002 | Controllers SHALL NOT contain direct database queries                  | P0       |
| MNT-003 | Server files SHALL NOT exceed 500 LOC                                  | P0       |
| MNT-004 | System SHALL use TypeScript strict mode                                | P0       |
| MNT-005 | System SHALL validate all inputs with Zod schemas                      | P0       |

### 5.5 Portability Requirements

| ID       | Requirement                                              | Priority |
| -------- | -------------------------------------------------------- | -------- |
| PORT-001 | System SHALL run on Linux, macOS, and Windows            | P0       |
| PORT-002 | System SHALL use environment variables for configuration | P0       |
| PORT-003 | System SHALL support PostgreSQL 15+                      | P0       |

---

## 6. Appendices

### 6.1 Glossary

| Term                 | Definition                                                                         |
| -------------------- | ---------------------------------------------------------------------------------- |
| Money Class          | `server/core/money.ts` - Wrapper around decimal.js for precise currency arithmetic |
| FOR UPDATE           | PostgreSQL row-level lock preventing concurrent modifications                      |
| BusinessAuditService | Service for logging all financial write operations                                 |
| Household            | Multi-user tenant unit for data isolation                                          |

### 6.2 Analysis Models

See `docs/architecture/architecture-diagram.md` for system context and data flow diagrams.

### 6.3 Change History

| Version | Date       | Author      | Changes                                                                                                                         |
| ------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 2025-12-01 | Engineering | Initial release                                                                                                                 |
| 2.0     | 2026-01-13 | Engineering | Added SEC-008, SEC-009 for Money class and row locking; Updated architecture constraints; Added MNT-002 for controller patterns |
| 2.1     | 2026-02-06 | Engineering | Updated scope, added missing module requirements, removed PHQ-9, expanded retention and security requirements                  |

---

**Document Approval**

| Role           | Name | Date |
| -------------- | ---- | ---- |
| Product Owner  |      |      |
| Technical Lead |      |      |
| QA Lead        |      |      |
