# ADR-004: Three-Layer Architecture

**Status:** Accepted  
**Date:** 2026-01-13  
**Deciders:** Engineering Team

## Context

The backend needs a clear structure that separates concerns and makes code testable.

## Decision

Use a **three-layer architecture**: Controller → Service → Repository.

## Rationale

| Layer          | Responsibility                                      | Does NOT do    |
| -------------- | --------------------------------------------------- | -------------- |
| **Controller** | HTTP handling, request parsing, response formatting | Business logic |
| **Service**    | Business rules, validation, orchestration           | HTTP concerns  |
| **Repository** | Data access, queries, transactions                  | Business rules |

This separation provides:

- **Testability**: Services can be unit tested without HTTP
- **Flexibility**: Swap data store without touching business logic
- **Clarity**: Each file has a single purpose

## Implementation

```
modules/transactions/
├── transactions.controller.ts  # HTTP only
├── transactions.service.ts     # Business logic
├── transactions.repository.ts  # Data access
└── transactions.routes.ts      # Route definitions
```

**Example Flow:**

```typescript
// controller - handles HTTP
async create(req, res) {
  const data = TransactionSchema.parse(req.body);
  const result = await this.service.create(householdId, data);
  res.status(201).json({ data: result });
}

// service - business logic
async create(householdId, data) {
  await this.validateBudget(data);
  return await this.repository.insert(householdId, data);
}

// repository - data access
async insert(householdId, data) {
  return await db.insert(transactions).values({ ...data, householdId });
}
```

## Consequences

**Positive:**

- Clear separation of concerns
- Easy to test each layer independently
- Consistent structure across modules

**Negative:**

- More files per feature
- Some boilerplate for simple CRUD
- Must resist temptation to add logic to controllers
