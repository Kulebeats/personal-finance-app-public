# Developer Onboarding Guide

## Personal Finance Application

Welcome to the team! This guide will get you productive quickly.

---

## Day 1: Environment Setup

### 1. Clone Repository

```bash
git clone https://github.com/org/personal-finance-app.git
cd personal-finance-app
npm install
```

### 2. Database Setup

See `docs/setup/database-setup.md` for the authoritative guide and troubleshooting.

**Option A: Local PostgreSQL**

```bash
# Create database
psql -U postgres -c "CREATE DATABASE finance_app;"

# Copy env file
cp .env.example .env
# Edit DATABASE_URL in .env

# Run migrations
npm run db:push
```

**Option B: Cloud Database (Recommended)**

Use [Neon](https://neon.tech) free tier - setup takes 2 minutes.

### 3. Start Development

```bash
npm run dev
```

Visit http://localhost:5000

### 4. Create Test User

```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@test.com","password":"Test123!@#","username":"developer"}'
```

---

## Day 2: Codebase Orientation

### Project Structure

```
personal-finance-app/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── hooks/          # TanStack Query hooks
│   │   ├── pages/          # Route pages
│   │   └── lib/            # Utilities
├── server/                 # Express backend
│   ├── modules/            # Domain modules
│   │   ├── auth/
│   │   ├── accounts/
│   │   ├── transactions/
│   │   └── ...
│   ├── middleware/         # Express middleware
│   └── shared/             # Cross-cutting concerns
├── shared/
│   ├── schema.ts           # Database schema (Drizzle)
│   └── types.ts            # Shared TypeScript types
└── docs/                   # Documentation
```

### Key Files to Read First

1. `shared/schema.ts` - Database models
2. `server/app.ts` - Express setup, middleware
3. `server/modules/auth/` - Authentication pattern
4. `client/src/hooks/use-accounts.ts` - API pattern

### Architecture Pattern

```
Request → Controller → Service → Repository → Database
                ↓
           Validation (Zod)
```

See [architecture.md](../system/architecture.md) for details.

---

## Week 1: Understanding the Domain

### Core Concepts

| Concept         | Description                                                   |
| --------------- | ------------------------------------------------------------- |
| **Household**   | Multi-tenant isolation unit. All data belongs to a household. |
| **Account**     | Bank account, credit card, investment account, etc.           |
| **Transaction** | Income, expense, or transfer between accounts                 |
| **Category**    | Transaction classification (Food, Utilities, etc.)            |
| **Budget**      | Monthly spending limit per category                           |
| **Goal**        | Savings or payoff target                                      |

### Common Tasks

**Add a new API endpoint:**

1. Update/create route in `server/modules/<module>/routes.ts`
2. Add controller method in `controller.ts`
3. Add business logic in `service.ts`
4. Add data access in `repository.ts`
5. Add Zod schema in `schemas.ts`
6. Write tests in `__tests__/`

**Add a new page:**

1. Create page component in `client/src/pages/`
2. Add route in `client/src/main.tsx`
3. Create hooks in `client/src/hooks/`
4. Use existing components from `client/src/components/ui/`

---

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific module
npm test -- --grep "transactions"

# Database tests (requires test DB)
npm run test:integration
```

See [test-strategy.md](../testing/test-strategy.md) for complete testing guidelines.

---

## Common Gotchas

1. **Money calculations** - Always use `Money` class, never raw arithmetic
2. **Household isolation** - Every query must include `householdId`
3. **CSRF tokens** - Frontend must include `X-CSRF-Token` header on mutations
4. **Session auth** - We use sessions, not JWT

---

## Getting Help

- **Slack**: #finance-app-dev
- **Architecture questions**: Check [ADRs](../decisions/)
- **API reference**: See [API notes](../api/README.md) and [OpenAPI spec](../api/openapi.yaml)

---

## First PR Checklist

- [ ] Tests pass (`npm test`)
- [ ] Build works (`npm run build`)
- [ ] Linting passes (`npm run lint`)
- [ ] CHANGELOG updated if user-facing
- [ ] PR description includes "Closes #issue"

---

_Last updated: 2026-02-06_
