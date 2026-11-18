# Server Module Patterns

## Full Pattern (Complex Domains)

Use for domains with:

- Complex business logic
- Multiple sub-services
- Event-driven workflows
- Financial calculations

**Structure:**

```
module/
├── _.controller.ts    # HTTP handlers (thin)
├── _.service.ts       # Business logic (thick)
├── _.repository.ts    # Data access
├── _.validation.ts    # Zod schemas
├── _.types.ts         # Type definitions
├── _.events.ts        # Domain events
├── *.routes.ts        # Route definitions
├── sub-services/      # Sub-domain services
└── __tests__/         # Unit & integration tests
```

**Modules Using Full Pattern:**

- auth
- transactions
- reports
- investments
- recurring
- budgets
- goals

## Thin Pattern (Simple CRUD)

Use for domains with:

- Simple CRUD operations
- Minimal business logic
- No complex workflows

**Structure:**

```
module/
├── _.controller.ts    # HTTP handlers
├── _.routes.ts        # Route definitions
├── *.validation.ts    # Zod schemas (optional)
└── index.ts           # Module exports
```

**Modules Using Thin Pattern:**

- categories
- tags
- merchants
- notifications
- household
- settings
- rules
