# ADR-002: Household-Based Multi-Tenancy

**Status:** Accepted  
**Date:** 2026-01-13  
**Deciders:** Engineering Team

## Context

The app must support multiple users in a household sharing financial data while maintaining data isolation between different households.

**Options Considered:**

1. Single-user only
2. User-based isolation (each user sees only their data)
3. Household-based isolation (members share visibility)
4. Organization-based with roles (enterprise pattern)

## Decision

Use **household-based multi-tenancy** where all data belongs to a household, and members have role-based access within that household.

## Rationale

Households are the natural unit for personal finance:

- Couples share expenses
- Families coordinate budgets
- Roommates split bills

User-based isolation would require complex sharing mechanisms. Household-based isolation provides natural sharing by default with roles (Owner, Admin, Member, Viewer) for access control.

## Implementation

```typescript
// Every query includes householdId
const accounts = await db
  .select()
  .from(accounts)
  .where(eq(accounts.householdId, req.session.householdId));
```

Repository layer enforces this pattern consistently.

## Consequences

**Positive:**

- Natural sharing between household members
- Single isolation boundary to enforce
- Simpler queries than share-by-share permissions

**Negative:**

- Users can currently belong to only one household
- Migrating between households requires data transfer
- No fine-grained per-account permissions

## Future Considerations

- Multi-household membership (Phase 2)
- Per-account member restrictions
