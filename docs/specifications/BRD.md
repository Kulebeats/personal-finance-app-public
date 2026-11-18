# Business Requirements Document (BRD)

## Personal Finance Application

**Document Version:** 1.0
**Date:** 2026-01-13
**Status:** Approved
**Classification:** Internal

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Business Objectives](#2-business-objectives)
3. [Scope](#3-scope)
4. [Stakeholders](#4-stakeholders)
5. [Business Requirements](#5-business-requirements)
6. [Business Process Flows](#6-business-process-flows)
7. [Success Metrics](#7-success-metrics)
8. [Constraints and Assumptions](#8-constraints-and-assumptions)
9. [Risks and Mitigations](#9-risks-and-mitigations)
10. [Approval](#10-approval)

---

## 1. Executive Summary

### 1.1 Purpose

This Business Requirements Document defines the business needs for the Personal Finance Application, a comprehensive household financial management platform. The application enables individuals and households to track accounts, manage budgets, set financial goals, and generate insights through reports and analytics.

### 1.2 Business Problem

Households face challenges in:
- Tracking finances across multiple accounts and institutions
- Maintaining accurate budgets and spending limits
- Setting and monitoring progress toward financial goals
- Understanding spending patterns and net worth trends
- Collaborating on household finances with family members

### 1.3 Proposed Solution

A full-stack web application providing:
- Unified account and transaction management
- Category-based budgeting with rollover support
- Goal tracking for savings, debt payoff, and investments
- Comprehensive financial reporting and analytics
- Multi-user household collaboration

---

## 2. Business Objectives

### 2.1 Primary Objectives

| ID | Objective | Success Measure |
|----|-----------|-----------------|
| BO-01 | Enable comprehensive financial tracking | Users can manage all account types in one place |
| BO-02 | Improve budgeting discipline | 80% of active users create at least one budget |
| BO-03 | Support goal achievement | Users can track progress toward financial goals |
| BO-04 | Provide actionable insights | Monthly reports show spending trends and patterns |
| BO-05 | Enable household collaboration | Multiple users can share financial data securely |

### 2.2 Strategic Alignment

```
┌─────────────────────────────────────────────────────────────────┐
│                    STRATEGIC VISION                              │
│         "Empower households to achieve financial wellness"       │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   VISIBILITY  │    │    CONTROL    │    │   INSIGHTS    │
│ See all money │    │ Budget & plan │    │ Understand    │
│ in one place  │    │ effectively   │    │ patterns      │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   Accounts    │    │   Budgets     │    │   Reports     │
│ Transactions  │    │   Goals       │    │   Analytics   │
│   Balances    │    │   Rules       │    │   Exports     │
└───────────────┘    └───────────────┘    └───────────────┘
```

---

## 3. Scope

### 3.1 In Scope

| Area | Capabilities |
|------|--------------|
| **Account Management** | Track checking, savings, credit, loan, investment, cash, mobile money accounts |
| **Transaction Tracking** | Record income, expenses, transfers; categorization; split transactions |
| **Budgeting** | Monthly category budgets, rollover support, progress tracking |
| **Goals** | Save-up, pay-down, investment goals with account assignment |
| **Reports** | Cashflow, spending by category, net worth, trends |
| **Investments** | Holdings, securities, portfolio performance |
| **Receipts** | Upload, OCR processing, transaction matching |
| **Collaboration** | Household member access with role-based permissions |

### 3.2 Out of Scope

| Area | Reason |
|------|--------|
| Payment processing | Not a payment platform |
| Cryptocurrency wallets | Specialized requirements |
| Tax filing automation | Regulatory compliance requirements |
| Mobile native apps | Web-first approach; responsive design covers mobile |

### 3.3 Scope Boundaries Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    IN SCOPE (This Application)                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ Accounts │  │ Budgets  │  │  Goals   │  │ Reports  │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │  Trans.  │  │ Merchants│  │Investments│  │ Receipts │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└─────────────────────────────────────────────────────────────────┘
                              │
                    Manual Data Entry
                              │
┌─────────────────────────────────────────────────────────────────┐
│                    OUT OF SCOPE (External Systems)               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                      │
│  │ Payment  │  │  Crypto  │  │Tax Filing│                      │
│  │Processing│  │ Wallets  │  │ Systems  │                      │
│  └──────────┘  └──────────┘  └──────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Stakeholders

### 4.1 Stakeholder Matrix

| Stakeholder | Role | Interest | Influence |
|-------------|------|----------|-----------|
| End Users | Primary users | High | High |
| Household Members | Collaborative users | High | Medium |
| Product Owner | Business decisions | High | High |
| Development Team | Implementation | Medium | High |
| QA Team | Quality assurance | Medium | Medium |
| Security Team | Compliance | High | High |

### 4.2 User Personas

#### Persona 1: Primary Financial Manager

| Attribute | Description |
|-----------|-------------|
| **Name** | Alex (Household Owner) |
| **Role** | Primary income earner, manages household finances |
| **Goals** | Track all accounts, set savings goals, understand spending |
| **Pain Points** | Spreadsheets are tedious, hard to see complete picture |
| **Needs** | Dashboard view, goal progress, spending insights |

#### Persona 2: Household Contributor

| Attribute | Description |
|-----------|-------------|
| **Name** | Jordan (Household Member) |
| **Role** | Secondary income, contributes to shared expenses |
| **Goals** | Log personal expenses, view shared budgets |
| **Pain Points** | Doesn't want to manage everything, just contribute |
| **Needs** | Simple expense entry, budget visibility |

#### Persona 3: Investment Tracker

| Attribute | Description |
|-----------|-------------|
| **Name** | Morgan (Investor) |
| **Role** | Actively manages investment portfolio |
| **Goals** | Track holdings, monitor performance, plan for growth |
| **Pain Points** | Investment data scattered across platforms |
| **Needs** | Portfolio summary, performance metrics, cost basis tracking |

---

## 5. Business Requirements

### 5.1 Core Business Requirements

#### BR-01: Account Aggregation

| Attribute | Description |
|-----------|-------------|
| **ID** | BR-01 |
| **Priority** | Critical |
| **Description** | Users shall be able to track all financial accounts in a single application |
| **Rationale** | Complete visibility requires all accounts in one place |
| **Acceptance Criteria** | - Support 7+ account types<br>- Track balances with precision<br>- Show net worth across all accounts |

#### BR-02: Transaction Management

| Attribute | Description |
|-----------|-------------|
| **ID** | BR-02 |
| **Priority** | Critical |
| **Description** | Users shall be able to record, categorize, and analyze financial transactions |
| **Rationale** | Transaction data is the foundation of financial tracking |
| **Acceptance Criteria** | - Manual entry and CSV import<br>- Category assignment<br>- Split transaction support<br>- Search and filter capabilities |

#### BR-03: Budget Planning

| Attribute | Description |
|-----------|-------------|
| **ID** | BR-03 |
| **Priority** | High |
| **Description** | Users shall be able to create and track category-based budgets |
| **Rationale** | Budgets help users control spending |
| **Acceptance Criteria** | - Monthly budget creation<br>- Progress tracking<br>- Rollover support<br>- Visual indicators for status |

#### BR-04: Goal Tracking

| Attribute | Description |
|-----------|-------------|
| **ID** | BR-04 |
| **Priority** | High |
| **Description** | Users shall be able to set financial goals and track progress |
| **Rationale** | Goals motivate saving and debt payoff behavior |
| **Acceptance Criteria** | - Support save-up, pay-down, investment goals<br>- Account assignment<br>- Progress visualization<br>- Transfer between goals |

#### BR-05: Financial Reporting

| Attribute | Description |
|-----------|-------------|
| **ID** | BR-05 |
| **Priority** | High |
| **Description** | Users shall be able to generate reports on financial status and trends |
| **Rationale** | Insights drive better financial decisions |
| **Acceptance Criteria** | - Cashflow reports<br>- Spending by category<br>- Net worth tracking<br>- Export to CSV |

#### BR-06: Household Collaboration

| Attribute | Description |
|-----------|-------------|
| **ID** | BR-06 |
| **Priority** | Medium |
| **Description** | Multiple users shall be able to share and manage household finances |
| **Rationale** | Families need to collaborate on finances |
| **Acceptance Criteria** | - Role-based access (Owner, Admin, Member, Viewer)<br>- Shared accounts and budgets<br>- Secure data isolation |

### 5.2 Business Requirements Traceability

```
┌─────────────────────────────────────────────────────────────────┐
│                    BUSINESS REQUIREMENTS                         │
├─────────┬─────────┬─────────┬─────────┬─────────┬──────────────┤
│  BR-01  │  BR-02  │  BR-03  │  BR-04  │  BR-05  │    BR-06     │
│ Account │  Trans  │ Budget  │  Goal   │ Reports │  Household   │
└────┬────┴────┬────┴────┬────┴────┬────┴────┬────┴──────┬───────┘
     │         │         │         │         │           │
     ▼         ▼         ▼         ▼         ▼           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FUNCTIONAL REQUIREMENTS                       │
├─────────┬─────────┬─────────┬─────────┬─────────┬──────────────┤
│ACCT-001 │TXN-001  │BUD-001  │GOAL-001 │RPT-001  │  AUTH-001    │
│ACCT-002 │TXN-002  │BUD-002  │GOAL-002 │RPT-002  │  AUTH-002    │
│  ...    │  ...    │  ...    │  ...    │  ...    │    ...       │
└─────────┴─────────┴─────────┴─────────┴─────────┴──────────────┘
```

---

## 6. Business Process Flows

### 6.1 User Registration and Onboarding

```
┌─────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  START  │────▶│   Register  │────▶│   Verify    │────▶│   Create    │
│         │     │   Account   │     │   Email     │     │  Household  │
└─────────┘     └─────────────┘     └─────────────┘     └──────┬──────┘
                                                               │
                                                               ▼
┌─────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   END   │◀────│   Ready     │◀────│    Add      │◀────│  Configure  │
│         │     │   to Use    │     │  Accounts   │     │  Settings   │
└─────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

### 6.2 Monthly Budget Cycle

```
┌─────────────────────────────────────────────────────────────────┐
│                     MONTHLY BUDGET CYCLE                         │
│                                                                  │
│  Month Start           Mid-Month            Month End            │
│      │                     │                    │                │
│      ▼                     ▼                    ▼                │
│  ┌───────┐            ┌───────┐            ┌───────┐            │
│  │Create │            │Track  │            │Review │            │
│  │Budget │───────────▶│Spend  │───────────▶│Results│            │
│  └───────┘            └───────┘            └───────┘            │
│      │                     │                    │                │
│      │    ┌───────────────┐│                    │                │
│      │    │  Log Trans.   ││                    │                │
│      │    │  Check Budget ││                    │                │
│      │    │  Adjust if    ││                    │                │
│      │    │  needed       │▼                    │                │
│      │    └───────────────┘                     │                │
│      │                                          │                │
│      │                                          ▼                │
│      │                                    ┌───────────┐          │
│      │                                    │  Rollover │          │
│      └───────────────────────────────────▶│  to Next  │          │
│                                           │   Month   │          │
│                                           └───────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 Goal Achievement Process

```
┌──────────────────────────────────────────────────────────────────┐
│                    GOAL ACHIEVEMENT FLOW                          │
│                                                                   │
│   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐      │
│   │ Create  │    │ Assign  │    │Contribute│    │ Achieve │      │
│   │  Goal   │───▶│ Account │───▶│  Funds   │───▶│  Goal   │      │
│   └─────────┘    └─────────┘    └────┬─────┘    └─────────┘      │
│                                      │                            │
│                                      ▼                            │
│                        ┌─────────────────────────┐               │
│                        │   Contribution Methods   │               │
│                        ├─────────────────────────┤               │
│                        │ • Direct deposit        │               │
│                        │ • Transfer from account │               │
│                        │ • Link transaction      │               │
│                        │ • Transfer from goal    │               │
│                        └─────────────────────────┘               │
└──────────────────────────────────────────────────────────────────┘
```

---

## 7. Success Metrics

### 7.1 Key Performance Indicators

| KPI | Target | Measurement Method |
|-----|--------|-------------------|
| User Adoption | 100+ active households | Monthly active users |
| Account Coverage | 3+ accounts per user | Avg accounts per household |
| Budget Engagement | 80% users with budgets | Users with active budgets |
| Goal Achievement | 60% goals completed | Goals reaching target |
| Report Generation | Weekly usage | Report views per user |
| Data Accuracy | 99.99% | Financial calculation precision |

### 7.2 Business Value Metrics

| Metric | Description | Target |
|--------|-------------|--------|
| Time Savings | Time spent on financial tracking | 50% reduction vs spreadsheets |
| Visibility | Complete financial picture | Single dashboard view |
| Goal Progress | Achieving financial goals | Measurable progress tracking |
| Family Collaboration | Shared financial management | Multi-user household support |

---

## 8. Constraints and Assumptions

### 8.1 Constraints

| Type | Constraint |
|------|------------|
| **Technical** | Must use Money class for all currency calculations |
| **Technical** | Must use FOR UPDATE locking for concurrent financial operations |
| **Technical** | Server files must be < 500 LOC |
| **Security** | All financial data isolated by household |
| **Security** | Must pass OWASP ASVS 4.0 requirements |
| **Regulatory** | Compliance with Zambia Data Protection Act No. 3 of 2021 |
| **Regulatory** | ODPC registration required by 30 April 2025 |
| **Regulatory** | Data localization (processing and storage in Zambia) |
| **Regulatory** | PCI DSS guidance (not certified) |

### 8.2 Assumptions

| ID | Assumption |
|----|------------|
| A-01 | Users will manually enter transaction data |
| A-02 | Single household per deployment (multi-tenant within household) |
| A-03 | TLS termination handled by reverse proxy in production |
| A-04 | Users have modern browsers (Chrome 90+, Firefox 90+, Safari 15+) |
| A-05 | PostgreSQL 15+ available for data storage |

---

## 9. Risks and Mitigations

### 9.1 Risk Register

| ID | Risk | Probability | Impact | Mitigation |
|----|------|-------------|--------|------------|
| R-01 | Floating-point calculation errors | Low | Critical | Money class with decimal.js |
| R-02 | Concurrent transaction race conditions | Medium | Critical | FOR UPDATE row locking |
| R-03 | Unauthorized data access | Low | Critical | Household isolation, role-based access |
| R-04 | Data loss | Low | Critical | Database transactions, audit logging |
| R-05 | Poor user adoption | Medium | High | Intuitive UI, onboarding flow |

### 9.2 Risk Matrix

```
                    IMPACT
           Low    Medium    High    Critical
         ┌──────┬────────┬────────┬──────────┐
    High │      │        │  R-05  │          │
         ├──────┼────────┼────────┼──────────┤
  P Med  │      │        │        │   R-02   │
  R      ├──────┼────────┼────────┼──────────┤
  O Low  │      │        │        │ R-01,03  │
  B      │      │        │        │   R-04   │
         └──────┴────────┴────────┴──────────┘
```

---

## 10. Approval

### 10.1 Document Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Product Owner | | | |
| Business Analyst | | | |
| Technical Lead | | | |
| Security Lead | | | |

### 10.2 Change History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-13 | Business Analysis | Initial release |

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| **Household** | A logical grouping of users sharing financial data |
| **Goal** | A financial target with types: save_up, pay_down, investment |
| **Money Class** | Internal decimal arithmetic wrapper for currency precision |
| **FOR UPDATE** | PostgreSQL row-level locking for concurrent safety |
| **Rollover** | Carrying unused budget amounts to the next period |
| **ODPC** | Office of the Data Protection Commissioner (Zambia) |
| **DPA** | Data Protection Act No. 3 of 2021 (Zambia) |
| **Data Controller** | Entity determining purposes and means of personal data processing |
| **Data Subject** | Individual whose personal data is processed |

## Appendix B: Reference Documents

| Document | Location |
|----------|----------|
| Software Requirements Specification | `docs/specifications/srs.md` |
| Software Design Document | `docs/specifications/sdd.md` |
| Security Audit Report | `docs/reviews/security-audit-report-2026-01-13-v3.md` |
| **Zambia DPA Compliance Guide** | `docs/compliance/ZAMBIA_DPA_compliance-summary.md` |
| Architecture Diagram | `docs/architecture/architecture-diagram.md` |

## Appendix C: Regulatory References

| Standard/Regulation | Authority | Applicability |
|---------------------|-----------|---------------|
| **Data Protection Act No. 3 of 2021** | Republic of Zambia | Full compliance required for processing personal data of Zambian residents |
| **OWASP ASVS 4.0** | OWASP Foundation | Security verification standard |
| **ISO 27001:2022** | International Organization for Standardization | Information security management guidance |
| **PCI DSS v4.0** | PCI Security Standards Council | Guidance only (not certified) |
