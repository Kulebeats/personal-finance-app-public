# ADR-003: Money Class for Currency Precision

**Status:** Accepted  
**Date:** 2026-01-13  
**Deciders:** Engineering Team

## Context

Financial calculations require exact decimal precision. JavaScript's native number type uses IEEE 754 floating-point, which causes errors:

```javascript
0.1 + 0.2 === 0.3; // false
0.1 + 0.2; // 0.30000000000000004
```

For a finance app, such errors are unacceptable.

## Decision

Implement a **Money class** wrapping decimal.js for all currency operations.

## Rationale

**Options Considered:**

1. Native numbers with rounding
2. Integer cents (store 100 for $1.00)
3. decimal.js wrapper class
4. dinero.js library

| Option             | Precision | DX   | Flexibility |
| ------------------ | --------- | ---- | ----------- |
| Native + round     | Poor      | Good | Low         |
| Integer cents      | Good      | Poor | Medium      |
| decimal.js wrapper | Excellent | Good | High        |
| dinero.js          | Excellent | Good | High        |

We chose decimal.js wrapper for:

- Arbitrary precision
- Clean API
- Control over implementation

## Implementation

```typescript
class Money {
  private value: Decimal;

  add(other: Money): Money { ... }
  subtract(other: Money): Money { ... }
  multiply(factor: number): Money { ... }
  toNumber(): number { ... }
  toString(): string { ... }
}
```

All financial mutations use Money class in services.

## Consequences

**Positive:**

- Guaranteed precision for all calculations
- Clear semantic type for currency
- Testable arithmetic properties

**Negative:**

- Must wrap/unwrap for storage (Decimal → string in DB)
- Extra import required
- Team must remember to use Money, not raw numbers

## Enforcement

- Code review for any direct arithmetic on amounts
- ESLint rule (future) to flag number operations on money fields
