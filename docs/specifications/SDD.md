# Software Design Document (SDD)

## Personal Finance Application

**Document Version:** 2.0
**Date:** 2026-01-13
**Status:** Approved
**Standard:** IEEE 1016-2009

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [System Overview](#2-system-overview)
3. [System Architecture](#3-system-architecture)
4. [Data Design](#4-data-design)
5. [Component Design](#5-component-design)
6. [Interface Design](#6-interface-design)
7. [Security Design](#7-security-design)
8. [Appendices](#8-appendices)

---

## 1. Introduction

### 1.1 Purpose

This Software Design Document (SDD) describes the architecture, components, interfaces, and data structures of the Personal Finance Application. It provides the technical blueprint for implementation and serves as a reference for maintenance.

### 1.2 Scope

This document covers:
- System architecture and design patterns
- Component specifications and interactions
- Data models and storage design
- Security mechanisms and controls
- Interface contracts

### 1.3 Definitions

| Term | Definition |
|------|------------|
| **Controller** | HTTP request handler; transforms requests/responses only |
| **Service** | Business logic layer; contains domain rules and orchestration |
| **Repository** | Data access layer; encapsulates database operations |
| **Money** | Decimal arithmetic wrapper for currency precision |
| **TransactionType** | Drizzle database transaction context type |
| **ODPC** | Office of the Data Protection Commissioner (Zambia) |
| **Personal Data** | Information relating to an identified or identifiable natural person (DPA 2021) |
| **Data Protection Officer** | Individual responsible for monitoring DPA compliance |

### 1.4 References

- SRS Document: `docs/specifications/srs.md`
- Zambia DPA Compliance: `docs/compliance/ZAMBIA_DPA_compliance-summary.md`
- Data Protection Act No. 3 of 2021 (Zambia)
- Database Schema: `shared/schema.ts`
- API Specification: `docs/api/openapi.yaml`

---

## 2. System Overview

### 2.1 System Context

```
┌─────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL ACTORS                             │
├──────────────┬───────────────┬───────────────┬─────────────────────┤
│    User      │  Email Server │  File System  │   Redis (optional)  │
│  (Browser)   │    (SMTP)     │   (Uploads)   │   (Rate Limiting)   │
└──────┬───────┴───────┬───────┴───────┬───────┴──────────┬──────────┘
       │               │               │                  │
       │ HTTPS         │ SMTP          │ FS               │ TCP
       ▼               ▼               ▼                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PERSONAL FINANCE APPLICATION                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │   React     │  │   Express   │  │  Services   │  │ PostgreSQL │ │
│  │   Client    │──│     API     │──│   Layer     │──│  Database  │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Design Goals

1. **Financial Precision** - Eliminate floating-point errors in currency calculations
2. **Concurrency Safety** - Prevent race conditions in financial operations
3. **Audit Compliance** - Immutable audit trail for all financial mutations
4. **Maintainability** - Clear separation of concerns with enforced boundaries
5. **Security** - Defense-in-depth with multiple security layers

---

## 3. System Architecture

### 3.1 Architectural Pattern

The system follows a **Layered Architecture** with strict dependency rules:

```
┌─────────────────────────────────────────────────────────────────┐
│                      PRESENTATION LAYER                          │
│  React Components → Hooks → TanStack Query → HTTP Client        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      CONTROLLER LAYER                            │
│  Express Routes → Controllers (HTTP handling ONLY)               │
│  - Request validation (Zod)                                      │
│  - Response formatting                                           │
│  - Error handling delegation                                     │
│  ⚠️ NO business logic, NO direct database access                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       SERVICE LAYER                              │
│  Domain Services (Business logic and orchestration)              │
│  - Business rules enforcement                                    │
│  - Cross-cutting concerns (audit logging)                        │
│  - Transaction orchestration                                     │
│  - Money class arithmetic                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     REPOSITORY LAYER                             │
│  Data Access (Database operations only)                          │
│  - CRUD operations                                               │
│  - Query composition                                             │
│  - Transaction participation                                     │
│  - Row-level locking (FOR UPDATE)                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DATABASE LAYER                              │
│  PostgreSQL + Drizzle ORM                                        │
│  - Schema definition                                             │
│  - Migrations                                                    │
│  - Connection pooling                                            │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Module Structure

```
server/
├── core/                    # Core utilities and cross-cutting concerns
│   ├── money.ts            # Currency arithmetic (decimal.js wrapper)
│   ├── errors.ts           # Custom error types (AppError, etc.)
│   ├── http.ts             # HTTP response helpers
│   ├── validation/         # Validation schemas and utilities
│   └── audit/              # Business audit logging
│
├── modules/                 # Feature modules (modular routes)
│   ├── auth/               # Authentication module
│   │   ├── auth.controller.ts
│   │   ├── auth.routes.ts
│   │   ├── auth.validation.ts
│   │   └── auth.repository.ts
│   ├── accounts/           # Account management
│   ├── transactions/       # Transaction management
│   ├── goals/              # Goal management
│   ├── budgets/            # Budget management
│   ├── investments/        # Investment tracking
│   ├── reports/            # Reporting and analytics
│   ├── merchants/          # Merchant management
│   ├── rules/              # Auto-categorization rules
│   ├── tags/               # Tag management
│   └── receipts/           # Receipt processing
│
├── services/               # Business logic services
│   ├── goal/               # Goal domain services
│   │   ├── GoalBaseService.ts
│   │   ├── GoalMutationService.ts
│   │   ├── GoalQueryService.ts
│   │   └── assignment.service.ts
│   ├── account/            # Account domain services
│   ├── GoalTransferService.ts
│   ├── TransactionGoalLinkService.ts
│   ├── BusinessAuditService.ts
│   └── ...
│
├── repositories/           # Data access layer
│   ├── AccountRepository.ts
│   ├── TransactionRepository.ts
│   ├── GoalRepository.ts
│   ├── RuleRepository.ts
│   └── ...
│
└── utils/                  # Utility functions
    ├── withTransaction.ts  # Database transaction wrapper
    ├── logger.ts           # Structured logging
    └── errorHandler.ts     # Error handling utilities
```

### 3.3 Key Design Patterns

#### 3.3.1 Money Class Pattern

**Purpose:** Prevent floating-point precision errors in currency calculations.

**Implementation:** `server/core/money.ts`

```typescript
import Decimal from "decimal.js";

export class Money {
  private _amount: Decimal;

  constructor(value: string | number | Decimal) {
    this._amount = new Decimal(value);
  }

  static zero(): Money {
    return new Money(0);
  }

  add(other: Money): Money {
    return new Money(this._amount.plus(other._amount));
  }

  subtract(other: Money): Money {
    return new Money(this._amount.minus(other._amount));
  }

  multiply(factor: number | string): Money {
    return new Money(this._amount.times(factor));
  }

  isNegative(): boolean {
    return this._amount.isNegative();
  }

  isNegativeOrZero(): boolean {
    return this._amount.isNegative() || this._amount.isZero();
  }

  isPositiveOrZero(): boolean {
    return this._amount.isPositive() || this._amount.isZero();
  }

  abs(): Money {
    return new Money(this._amount.abs());
  }

  toNumber(): number {
    return this._amount.toNumber();
  }

  toString(): string {
    return this._amount.toString();
  }
}
```

**Usage Rules:**
- NEVER use `parseFloat()`, `Number()`, or `Math.round()` for currency
- ALWAYS use Money class for arithmetic
- Convert to number ONLY at API response boundaries

#### 3.3.2 Transaction with Row Locking Pattern

**Purpose:** Prevent race conditions and double-spend vulnerabilities.

**Implementation:** `server/utils/withTransaction.ts`

```typescript
import { db } from "../db";

export type TransactionType = /* Drizzle transaction type */;

export async function withTransaction<T>(
  callback: (tx: TransactionType) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    return await callback(tx);
  });
}
```

**FOR UPDATE Locking Pattern:**

```typescript
// In GoalTransferService.ts
private async getGoalForUpdate(
  tx: TransactionType,
  goalId: string,
  householdId: string
): Promise<Goal> {
  const result = await tx
    .select()
    .from(goals)
    .where(and(eq(goals.id, goalId), eq(goals.householdId, householdId)))
    .for("update")  // Acquire row lock
    .limit(1);

  if (!result.length) {
    throw new NotFoundError("Goal not found");
  }
  return result[0];
}

async transfer(householdId: string, userId: string, data: TransferData) {
  return await withTransaction(async (tx) => {
    // Both reads happen INSIDE transaction with locks
    const fromGoal = await this.getGoalForUpdate(tx, data.fromGoalId, householdId);
    const toGoal = await this.getGoalForUpdate(tx, data.toGoalId, householdId);

    // Arithmetic using Money class
    const fromBalance = new Money(fromGoal.currentAmount);
    const transferAmount = new Money(data.amount);
    const newFromBalance = fromBalance.subtract(transferAmount);

    // Update with Money values
    await tx.update(goals)
      .set({ currentAmount: newFromBalance.toString() })
      .where(eq(goals.id, fromGoal.id));

    // ... rest of transfer logic
  });
}
```

#### 3.3.3 Repository Pattern

**Purpose:** Encapsulate data access and provide household-scoped queries.

**Example:** `server/repositories/RuleRepository.ts`

```typescript
export class RuleRepository {
  async findByHousehold(householdId: string): Promise<Rule[]> {
    return db
      .select()
      .from(rules)
      .where(eq(rules.householdId, householdId))
      .orderBy(asc(rules.priority));
  }

  async updateByHousehold(
    id: string,
    householdId: string,
    data: Partial<Rule>
  ): Promise<Rule | undefined> {
    const result = await db
      .update(rules)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(rules.id, id), eq(rules.householdId, householdId)))
      .returning();
    return result[0];
  }

  async deleteByHousehold(
    id: string,
    householdId: string
  ): Promise<Rule | undefined> {
    const result = await db
      .delete(rules)
      .where(and(eq(rules.id, id), eq(rules.householdId, householdId)))
      .returning();
    return result[0];
  }
}
```

---

## 4. Data Design

### 4.1 Database Schema Overview

```
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│  households  │───────│    users     │───────│   sessions   │
└──────────────┘       └──────────────┘       └──────────────┘
       │                      │
       │                      │
       ▼                      ▼
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│   accounts   │───────│ transactions │───────│  categories  │
└──────────────┘       └──────────────┘       └──────────────┘
       │                      │                      │
       │                      │                      │
       ▼                      ▼                      ▼
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│    goals     │───────│  goal_links  │───────│   budgets    │
└──────────────┘       └──────────────┘       └──────────────┘
       │
       ▼
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│  goal_txfrs  │       │   holdings   │───────│  securities  │
└──────────────┘       └──────────────┘       └──────────────┘
                              │
                              ▼
                       ┌──────────────┐
                       │  audit_logs  │
                       └──────────────┘
```

### 4.2 Key Tables

#### 4.2.1 Financial Tables

| Table | Purpose | Key Constraints |
|-------|---------|-----------------|
| `accounts` | Financial accounts | `householdId` FK, `balance` decimal(15,2) |
| `transactions` | Financial events | `accountId` FK, `amount` decimal(15,2), `type` enum |
| `goals` | Financial goals | `currentAmount` decimal(15,2), `targetAmount` decimal(15,2) |
| `goal_transfers` | Inter-goal transfers | `fromGoalId` FK, `toGoalId` FK, `amount` decimal(15,2) |
| `holdings` | Investment positions | `quantity` decimal(18,8), `costBasis` decimal(15,4) |

#### 4.2.2 Audit Tables

| Table | Purpose | Retention |
|-------|---------|-----------|
| `audit_logs` | Financial mutations | 7 years |
| `security_events` | Auth/security events | 1 year |

### 4.3 Data Integrity Rules

1. **Monetary Values:** All currency columns use `decimal(15,2)` precision
2. **Foreign Keys:** All relationships enforced at database level
3. **Soft Deletes:** Accounts and transactions use `deletedAt` timestamp
4. **Audit Trail:** All financial writes logged with before/after values
5. **Household Isolation:** All queries include `householdId` filter

---

## 5. Component Design

### 5.1 Goal Transfer Service

**File:** `server/services/GoalTransferService.ts`

**Responsibility:** Handle inter-goal fund transfers with concurrency safety.

**Design Rationale:**
- Uses FOR UPDATE locking to prevent double-spend
- All arithmetic uses Money class
- Reads and writes within single transaction
- Audit logging for compliance

**Sequence Diagram:**

```
Client          Controller       Service          Repository        Database
  │                 │               │                  │                │
  │ POST /transfer  │               │                  │                │
  │────────────────>│               │                  │                │
  │                 │ transfer()    │                  │                │
  │                 │──────────────>│                  │                │
  │                 │               │ BEGIN TX         │                │
  │                 │               │─────────────────────────────────>│
  │                 │               │ SELECT FOR UPDATE│                │
  │                 │               │──────────────────>│               │
  │                 │               │                  │ SELECT ... FOR │
  │                 │               │                  │ UPDATE         │
  │                 │               │                  │───────────────>│
  │                 │               │                  │<───────────────│
  │                 │               │<──────────────────│               │
  │                 │               │ Money arithmetic │                │
  │                 │               │ (subtract/add)   │                │
  │                 │               │ UPDATE goals     │                │
  │                 │               │──────────────────>│               │
  │                 │               │                  │ UPDATE         │
  │                 │               │                  │───────────────>│
  │                 │               │                  │<───────────────│
  │                 │               │<──────────────────│               │
  │                 │               │ INSERT transfer  │                │
  │                 │               │──────────────────>│               │
  │                 │               │                  │───────────────>│
  │                 │               │                  │<───────────────│
  │                 │               │<──────────────────│               │
  │                 │               │ COMMIT TX        │                │
  │                 │               │─────────────────────────────────>│
  │                 │<──────────────│                  │                │
  │<────────────────│               │                  │                │
  │  201 Created    │               │                  │                │
```

### 5.2 Rules Controller

**File:** `server/modules/rules/rules.controller.ts`

**Responsibility:** HTTP handling for auto-categorization rules.

**Design Rationale:**
- Controller handles ONLY HTTP concerns
- Validation via Zod schemas
- Delegates to Repository for data access
- No direct database imports

**Code Structure:**

```typescript
export const rulesController = {
  async list(req, res, next) {
    // 1. Extract context
    const { householdId } = req.householdContext!;

    // 2. Delegate to repository
    const rules = await ruleRepository.findByHousehold(householdId);

    // 3. Format response
    return success(res, { rules });
  },

  async create(req, res, next) {
    // 1. Extract context
    const { householdId, userId } = req.householdContext!;

    // 2. Validate input
    const parseResult = createRuleSchema.safeParse(req.body);
    if (!parseResult.success) {
      return validationError(res, parseResult.error);
    }

    // 3. Delegate to repository
    const rule = await ruleRepository.create({ ...parseResult.data, householdId });

    // 4. Format response
    return success(res, { rule }, undefined, 201);
  }
};
```

---

## 6. Interface Design

### 6.1 REST API Design

**Base URL:** `/api`

**Authentication:** Session cookie + CSRF token

**Response Format:**

```typescript
// Success Response
{
  "success": true,
  "data": { /* resource data */ },
  "message": "Optional message"
}

// Error Response
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": { /* optional field errors */ }
  }
}
```

### 6.2 Key Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | /api/auth/login | Authenticate user |
| GET | /api/accounts | List household accounts |
| POST | /api/transactions | Create transaction |
| POST | /api/goals/transfers | Transfer between goals |
| GET | /api/reports/cashflow | Generate cashflow report |

### 6.3 Validation Schema Pattern

All request bodies validated with Zod:

```typescript
// Example: Investment transaction types
const investmentTransactionTypes = [
  "buy", "sell", "dividend", "interest",
  "fee", "split", "transfer_in", "transfer_out",
  "coupon", "maturity"
] as const;

const createInvestmentTransactionSchema = z.object({
  accountId: z.string().uuid(),
  securityId: z.string().uuid().optional(),
  type: z.enum(investmentTransactionTypes),
  amount: z.string().or(z.number()).transform(String),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
```

---

## 7. Security Design

### 7.1 Security Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      SECURITY LAYERS                             │
├─────────────────────────────────────────────────────────────────┤
│  Layer 1: Network          │ TLS termination, HTTPS only        │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2: Rate Limiting    │ 100 req/15min, 5 auth/15min        │
├─────────────────────────────────────────────────────────────────┤
│  Layer 3: Authentication   │ Session cookies, password hash     │
├─────────────────────────────────────────────────────────────────┤
│  Layer 4: CSRF Protection  │ Double-submit cookie pattern       │
├─────────────────────────────────────────────────────────────────┤
│  Layer 5: Authorization    │ Household isolation, role checks   │
├─────────────────────────────────────────────────────────────────┤
│  Layer 6: Input Validation │ Zod schemas, parameterized queries │
├─────────────────────────────────────────────────────────────────┤
│  Layer 7: Business Logic   │ Money class, FOR UPDATE locking    │
├─────────────────────────────────────────────────────────────────┤
│  Layer 8: Audit Trail      │ BusinessAuditService logging       │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Financial Security Controls

| Control | Implementation | Purpose |
|---------|----------------|---------|
| **Precision Safety** | Money class (decimal.js) | Prevent penny-shaving attacks |
| **Race Condition Prevention** | FOR UPDATE locking | Prevent double-spend |
| **Audit Trail** | BusinessAuditService | Compliance and forensics |
| **Household Isolation** | All queries filter by householdId | Multi-tenant security |

### 7.3 Audit Logging

All financial mutations logged with:

```typescript
await businessAuditService.logUpdate({
  userId,
  householdId,
  entityId: goal.id,
  entityType: "goal",
  oldValue: { currentAmount: beforeAmount },
  newValue: { currentAmount: afterAmount },
  ipAddress: req.ip,
});
```

### 7.4 Data Protection Compliance (Zambia DPA 2021)

The system implements controls to comply with the Zambia Data Protection Act No. 3 of 2021:

| DPA Requirement | Implementation | Location |
|-----------------|----------------|----------|
| **Lawfulness & Transparency** | Privacy policy + user consent | `client/src/pages/Privacy.tsx` |
| **Purpose Limitation** | Data collected for financial tracking only | All data collection points |
| **Data Minimization** | Only essential fields required | User registration, profile |
| **Accuracy** | User can update profile, edit transactions | Settings, transaction modules |
| **Storage Limitation** | 7-year retention for financial data | Database retention policies |
| **Security Measures** | Encryption, access control, audit logging | Security architecture (7.1) |
| **Data Subject Rights** | Access, rectification, erasure, portability | User settings, data export |
| **Breach Notification** | 24-hour reporting to ODPC | Incident response plan |
| **Data Localization** | Processing and storage in Zambia | Infrastructure configuration |
| **Records of Processing** | Audit logs maintained | `audit_logs` table |

**Registration Status:**
- Data Controller Registration: Required by 30 April 2025
- Data Protection Officer: Required (appointment in progress)

**See:** `docs/compliance/ZAMBIA_DPA_compliance-summary.md` for complete compliance documentation.

---

## 8. Appendices

### 8.1 Technology Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Frontend | React | 18.x |
| UI Components | Radix UI | Latest |
| Styling | Tailwind CSS | 3.x |
| State Management | TanStack Query | 5.x |
| Backend | Express.js | 4.x |
| Runtime | Node.js | 20.x LTS |
| Database | PostgreSQL | 15+ |
| ORM | Drizzle | Latest |
| Validation | Zod | 3.x |
| Decimal Math | decimal.js | 10.x |

### 8.2 File Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Controller | `{module}.controller.ts` | `rules.controller.ts` |
| Routes | `{module}.routes.ts` | `rules.routes.ts` |
| Validation | `{module}.validation.ts` | `rules.validation.ts` |
| Service | `{Domain}Service.ts` | `GoalTransferService.ts` |
| Repository | `{Entity}Repository.ts` | `RuleRepository.ts` |

### 8.3 Change History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-12-01 | Engineering | Initial release |
| 2.0 | 2026-01-13 | Engineering | Added Money class pattern, FOR UPDATE locking pattern, updated controller design to remove direct DB access, added security controls section |

---

**Document Approval**

| Role | Name | Date |
|------|------|------|
| Technical Architect | | |
| Security Lead | | |
| Engineering Manager | | |
