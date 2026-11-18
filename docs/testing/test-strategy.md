# Test Strategy

## Personal Finance Application

**Document Version:** 1.0  
**Created:** 2026-02-06  
**Status:** Active

---

## 1. Test Scope & Approach

### 1.1 Scope

All testing artifacts for the Personal Finance Application, including:

- **19 Server Modules:** auth, accounts, transactions, budgets, goals, investments, reports, recurring, merchants, categories, rules, tags, receipts, notifications, settings, household, health, ai, weekly-recap
- **Client Components:** React components in `/client/src`
- **API Endpoints:** All routes under `/api/*`
- **Core Libraries:** Money class, calculation engines, repositories

### 1.2 Test Pyramid

```
        /\
       /E2E\      ← Manual/Browser tests (10%)
      /──────\
     /Integr-\   ← API + DB tests (30%)
    / ation   \
   /────────────\
  /    Unit     \ ← Pure functions, services (60%)
 /________________\
```

### 1.3 Test Tools

| Layer       | Tool               | Purpose                 |
| ----------- | ------------------ | ----------------------- |
| Unit        | Vitest             | Fast, TypeScript-native |
| Integration | Vitest + Supertest | API testing with DB     |
| E2E         | Playwright         | Browser automation      |
| Performance | k6                 | Load testing            |

---

## 2. Module Test Coverage Matrix

| Module            |     Unit     | Integration  | E2E | Coverage Target |
| ----------------- | :----------: | :----------: | :-: | --------------- |
| **auth**          | ✅ 15+ tests |    ✅ Yes    | ❌  | 90%             |
| **accounts**      |      ✅      |    ✅ Yes    | ❌  | 85%             |
| **transactions**  |      ✅      |    ✅ Yes    | ❌  | 90%             |
| **budgets**       |      ✅      |    ✅ Yes    | ❌  | 85%             |
| **goals**         |      ✅      |    ✅ Yes    | ❌  | 90%             |
| **investments**   |      ✅      | ✅ 2 suites  | ❌  | 85%             |
| **reports**       |  ⚠️ Partial  |  ⚠️ Partial  | ❌  | 80%             |
| **recurring**     |      ✅      | ✅ 3 suites  | ❌  | 85%             |
| **merchants**     |      ✅      |    ✅ Yes    | ❌  | 80%             |
| **categories**    |      ✅      | ✅ 2 suites  | ❌  | 80%             |
| **rules**         |      ✅      | ✅ 2 suites  | ❌  | 80%             |
| **tags**          |      ✅      | ✅ 2 suites  | ❌  | 80%             |
| **receipts**      |  ⚠️ Partial  |    ✅ Yes    | ❌  | 75%             |
| **notifications** |  ⚠️ Partial  |    ✅ Yes    | ❌  | 75%             |
| **settings**      |      ✅      | ✅ Extensive | ❌  | 85%             |
| **household**     |      ✅      | ✅ 2 suites  | ❌  | 85%             |
| **health**        |      ✅      |    ✅ Yes    | ❌  | 90%             |
| **ai**            | ✅ 5 suites  |    ✅ Yes    | ❌  | 75%             |
| **weekly-recap**  |  ⚠️ Partial  |  ⚠️ Partial  | ❌  | 70%             |

**Legend:** ✅ Exists | ⚠️ Partial/Needs expansion | ❌ Not implemented

**Current Test File Count:** 79 files in `server/`

---

## 3. Financial Core Test Requirements

> [!IMPORTANT]
> The financial core is the highest-risk area. These tests MUST exist and pass.

### 3.1 Money Class Tests

Location: `server/core/__tests__/money.test.ts`

| Requirement              | Test Case                                          |
| ------------------------ | -------------------------------------------------- |
| Precision                | Arithmetic at boundary values (0.01, 999999999.99) |
| Negative amounts         | Subtraction resulting in negative values           |
| Zero handling            | Operations with zero amounts                       |
| String/number input      | Constructor accepts both types                     |
| No floating-point errors | 0.1 + 0.2 must equal 0.3 exactly                   |

### 3.2 Transfer Atomicity Tests

| Requirement          | Test Case                                      |
| -------------------- | ---------------------------------------------- |
| Concurrent transfers | Two simultaneous transfers don't double-spend  |
| Rollback on failure  | Partial transfer failure rolls back completely |
| FOR UPDATE locking   | Row locks prevent race conditions              |
| Audit trail          | Every transfer creates audit log entry         |

### 3.3 Balance Consistency Tests

| Requirement               | Test Case                                    |
| ------------------------- | -------------------------------------------- |
| Account balance integrity | balance = sum(all transactions)              |
| Cross-account transfers   | Source + destination balances net to zero    |
| Soft delete handling      | Deleted transactions excluded from balance   |
| Currency isolation        | Multi-currency accounts calculate separately |

### 3.4 Budget Calculation Tests

| Requirement       | Test Case                                         |
| ----------------- | ------------------------------------------------- |
| Rollover logic    | Unused budget carries to next period              |
| Category totals   | Sum of category transactions matches budget spent |
| Period boundaries | Month-end calculations are accurate               |
| Overspend alerts  | Budgets correctly detect overspending             |

### 3.5 Investment Performance Tests

Location: `server/core/calculations/investments/__tests__/investments.test.ts`

| Requirement           | Test Case                                       |
| --------------------- | ----------------------------------------------- |
| Cost basis            | FIFO/LIFO calculations are accurate             |
| Returns calculation   | Total return % matches expected formula         |
| Dividend reinvestment | Reinvested dividends adjust cost basis          |
| Tax lot tracking      | Individual lots maintain correct purchase dates |

---

## 4. Security Test Requirements

### 4.1 Authentication Tests

Reference: `docs/security/auth-pentest-checklist.md` (80+ test cases)

| Category           | Key Tests                                          |
| ------------------ | -------------------------------------------------- |
| Credential attacks | Brute force, credential stuffing, timing attacks   |
| Session management | Regeneration on login, expiry, concurrent sessions |
| MFA                | Rate limiting, code expiry, brute force protection |
| Password security  | Complexity validation, bcrypt verification         |

### 4.2 Authorization Tests

| Requirement         | Test Case                                      |
| ------------------- | ---------------------------------------------- |
| Household isolation | User A cannot access User B's data             |
| Role enforcement    | Member vs Owner permissions                    |
| CSRF protection     | State-changing requests without token rejected |
| Rate limiting       | Limits enforced per endpoint tier              |

### 4.3 Input Validation Tests

| Requirement    | Test Case                               |
| -------------- | --------------------------------------- |
| Zod schemas    | All endpoints reject malformed input    |
| SQL injection  | Parameterized queries prevent injection |
| XSS prevention | User input sanitized in responses       |

---

## 5. Performance Test Targets

From SRS Performance Requirements:

| SRS ID   | Requirement             | Target        | Test Method       |
| -------- | ----------------------- | ------------- | ----------------- |
| PERF-001 | List operations         | < 500ms (p95) | k6 load test      |
| PERF-002 | Single resource         | < 200ms (p95) | k6 load test      |
| PERF-003 | Report generation (1yr) | < 2s          | k6 with seed data |
| PERF-004 | Concurrent users        | 100           | k6 ramping VUs    |

### k6 Test Script Location

`tests/performance/` (to be created)

---

## 6. Test Environments

| Environment | Database            | Redis    | Notes                 |
| ----------- | ------------------- | -------- | --------------------- |
| Local       | PostgreSQL / SQLite | Optional | Developer workstation |
| CI          | PostgreSQL (Docker) | No       | Fresh DB per run      |
| Staging     | PostgreSQL          | Yes      | Mirror production     |
| Production  | PostgreSQL          | Yes      | No testing here       |

### Environment Variables

```bash
NODE_ENV=test
DATABASE_URL=postgresql://test:test@localhost:5432/finance_test
SESSION_SECRET=test-secret-minimum-32-chars-here
```

---

## 7. Test Data Strategy

### 7.1 Seed Data

Location: `server/tests/fixtures/`

- `households.fixture.ts` - Test households
- `users.fixture.ts` - Test users with various roles
- `accounts.fixture.ts` - Account types for testing
- `transactions.fixture.ts` - Sample transactions

### 7.2 Factory Functions

Each module should have factories for creating test entities:

```typescript
// Example: createTestTransaction(overrides)
export function createTestTransaction(overrides?: Partial<Transaction>) {
  return {
    id: randomUUID(),
    amount: "100.00",
    type: "expense",
    date: new Date(),
    ...overrides,
  };
}
```

### 7.3 Database Reset

Between test runs:

```bash
npm run db:test:reset  # Drops and recreates test DB
```

---

## 8. Regression Test Policy

1. **All bug fixes** MUST include a regression test
2. **Financial calculation bugs** require property-based tests
3. **Security findings** require automated verification tests
4. **No PR merges** without passing test suite

### Property-Based Testing

For financial calculations, use property-based testing (fast-check):

```typescript
// Example: Money arithmetic properties
fc.assert(
  fc.property(fc.float(), fc.float(), (a, b) => {
    const m1 = new Money(a);
    const m2 = new Money(b);
    // Associativity: (a + b) - b = a
    expect(m1.add(m2).subtract(m2).toNumber()).toBeCloseTo(a);
  }),
);
```

---

## 9. Running Tests

### Commands

```bash
# All tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage

# Integration tests only
npm run test:integration

# Specific module
npm test -- modules/auth
```

### CI Pipeline

Tests run on every PR:

1. TypeScript compile check
2. ESLint
3. Unit tests
4. Integration tests
5. Coverage threshold check (80% minimum)

---

## 10. Related Documents

- [auth-pentest-checklist.md](../security/auth-pentest-checklist.md) - Security test cases
- [settings-testing-guide.md](./settings-testing-guide.md) - Settings module testing (detailed)
- [settings-integration-testing.md](./settings-integration-testing.md) - Settings integration tests

---

_Document created as part of documentation re-audit remediation (Task 1.3)_
