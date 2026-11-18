# Phase 4 QA Review Prompt: Remaining Modules

You are a senior QA and architecture reviewer. Conduct a comprehensive review of the Phase 4 implementation of the Enterprise Refactoring in the Personal Finance App. Validate correctness, security, maintainability, and documentation quality across all 12 migrated modules.

---

## Review Objectives

### 1. Security & Access Control
- Validate `requireAuth` middleware on all protected routes
- Confirm `householdGuard` middleware enforces household isolation
- Verify `requireRole("member")` on write operations where applicable
- Ensure rate limiting applied per specification:
  | Endpoint Type | Limiter | Limit |
  |---------------|---------|-------|
  | Reports | analyticsLimiter | 30/min |
  | Investments | expensiveAnalyticsLimiter | 10/min |
  | Settings writes | generalLimiter | 100/min |
  | Receipts upload | uploadLimiter | 20/hour |
- Check no PII logged, no hardcoded credentials

### 2. Architecture & Modularity
- Verify **Controller → Service → Repository** layering
- Confirm no business logic inside route handlers
- Validate domain isolation (no cross-module logic leaks)
- Check all modules export via unified `index.ts`
- Verify sub-modules are properly organized (Investments: 7, Settings: 4, Reports: 5)
- Confirm legacy services properly re-exported

### 3. Functionality & Behavior
- Validate all CRUD operations work correctly
- Test pagination and filtering
- Verify caching applied via `withCache()` HOF on reports
- Test event emissions where integrated
- Validate file uploads (receipts) follow security patterns

### 4. Documentation Quality
Evaluate for:
- ✅ **Completeness**: Module purpose, responsibilities, API usage
- ✅ **Accuracy**: Matches current code structure and data flows
- ✅ **Security Awareness**: Auth, validation, data protection notes
- ✅ **Dev Onboarding**: New developers can understand without deep dive
- ✅ **API Clarity**: Endpoint behavior, params, return types, errors
- ✅ **Inline Comments**: Business logic and invariants explained

---

## Modules to Audit

### Week 9 Modules (Reports, Budgets, Recurring)

#### Reports Module (`server/modules/reports/`)

**Expected Structure:**
```
reports/
├── index.ts                  # Re-exports all sub-modules
├── reports.types.ts          # Shared report types
├── reports.utils.ts          # Date range, FX utilities
├── spending/
│   ├── spending.controller.ts
│   ├── spending.service.ts
│   ├── spending.routes.ts
│   └── spending.validation.ts
├── cashflow/
│   ├── cashflow.controller.ts
│   ├── cashflow.service.ts
│   ├── cashflow.routes.ts
│   └── cashflow.validation.ts
├── networth/
│   ├── networth.controller.ts
│   ├── networth.service.ts
│   ├── networth.routes.ts
│   └── networth.validation.ts
├── annual/
│   ├── annual.controller.ts
│   ├── annual.service.ts
│   ├── annual.routes.ts
│   └── annual.validation.ts
├── analytics/
│   ├── analytics.controller.ts
│   ├── analytics.service.ts
│   ├── analytics.routes.ts
│   └── analytics.validation.ts
└── README.md
```

**Review Checklist:**
- [ ] 5 sub-modules created (spending, cashflow, networth, annual, analytics)
- [ ] Uses existing ReportRepositories from Phase 1
- [ ] Caching via `withCache()` applied to expensive queries
- [ ] `analyticsLimiter` rate limiting on all endpoints
- [ ] Validation schemas for date ranges, groupBy, currency
- [ ] FX conversion handled consistently

**Endpoints to Verify (13 total):**
| Endpoint | Sub-module | Cached |
|----------|------------|--------|
| GET /reports/spending | spending | Yes |
| GET /reports/spending/trend | spending | Yes |
| GET /reports/spending/subcategory | spending | Yes |
| GET /reports/cashflow | cashflow | Yes |
| GET /reports/income | cashflow | Yes |
| GET /reports/savings-rate | cashflow | Yes |
| GET /reports/net-worth | networth | Yes |
| GET /reports/net-worth/changes | networth | Yes |
| GET /reports/annual | annual | Yes |
| GET /reports/sankey | annual | Yes |
| GET /reports/ratios | analytics | No |
| GET /reports/forecast | analytics | No |
| GET /reports/custom-chart | analytics | No |

**Validation Schemas Expected:**
```typescript
dateRangeSchema: { startDate, endDate, accountId?, currency? }
spendingQuerySchema: dateRangeSchema + { groupBy, excludeTransfers }
trendQuerySchema: dateRangeSchema + { groupBy, compareWith? }
annualQuerySchema: { year, currency? }
```

---

#### Budgets Module (`server/modules/budgets/`)

**Expected Structure:**
```
budgets/
├── budgets.controller.ts     # ~12 methods
├── budgets.service.ts        # Re-export BudgetService
├── budgets.validation.ts     # Zod schemas
├── budgets.events.ts         # BUDGET_CREATED, BUDGET_EXCEEDED
├── budgets.types.ts          # Invariants documented
├── budgets.routes.ts         # Middleware chain
├── sub-services/
│   ├── budget-alert.service.ts       # Threshold alerts
│   ├── budget-rollover.service.ts    # Period rollovers
│   └── budget-forecast.service.ts    # Spending forecasts
├── index.ts
└── README.md
```

**Review Checklist:**
- [ ] Controller has ~12 methods (CRUD + progress + alerts + rollover)
- [ ] Re-exports existing BudgetService
- [ ] Events defined: BUDGET_CREATED, BUDGET_UPDATED, BUDGET_EXCEEDED
- [ ] Alert threshold validation (0-100%)
- [ ] Period validation (weekly, monthly, quarterly, yearly)
- [ ] Rollover logic handles carry-over amounts

**Endpoints to Verify (10 total):**
| Endpoint | Method | Description |
|----------|--------|-------------|
| GET /budgets | list | List all budgets |
| POST /budgets | create | Create budget |
| GET /budgets/:id | getById | Get budget by ID |
| PUT /budgets/:id | update | Update budget |
| DELETE /budgets/:id | delete | Delete budget |
| GET /budgets/progress | getProgress | Current period progress |
| GET /budgets/:id/history | getHistory | Budget history |
| POST /budgets/:id/rollover | rollover | Rollover to next period |
| GET /budgets/alerts | getAlerts | Active threshold alerts |
| PUT /budgets/alerts/:id/dismiss | dismissAlert | Dismiss alert |

---

#### Recurring Module (`server/modules/recurring/`)

**Expected Structure:**
```
recurring/
├── recurring.controller.ts     # ~15 methods
├── recurring.service.ts        # Re-export RecurringService
├── recurring.validation.ts     # Zod schemas
├── recurring.events.ts         # RULE_CREATED, RULE_TRIGGERED
├── recurring.types.ts          # Rule types documented
├── recurring.routes.ts         # Middleware chain
├── sub-services/
│   ├── rule-engine.service.ts        # PatternDetectionService wrapper
│   ├── occurrence-generator.service.ts # Future occurrences
│   ├── linking.service.ts            # Transaction linking
│   └── reminder.service.ts           # Payment reminders
├── index.ts
└── README.md
```

**Review Checklist:**
- [ ] Controller has ~15 methods
- [ ] Re-exports RecurringService and PatternDetectionService
- [ ] Pattern detection parameters validated (minOccurrences, maxDayVariance)
- [ ] Frequency validation (daily, weekly, monthly, yearly)
- [ ] Transaction linking/unlinking works correctly
- [ ] Skip/pause/resume lifecycle implemented

**Endpoints to Verify (14 total):**
| Endpoint | Method | Description |
|----------|--------|-------------|
| GET /recurring | list | List all rules |
| POST /recurring | create | Create rule |
| GET /recurring/:id | getById | Get rule by ID |
| PUT /recurring/:id | update | Update rule |
| DELETE /recurring/:id | delete | Delete rule |
| GET /recurring/upcoming | getUpcoming | Upcoming payments |
| GET /recurring/summary | getSummary | Monthly summary |
| POST /recurring/detect | detectPatterns | Auto-detect patterns |
| POST /recurring/:id/confirm | confirmPattern | Confirm pattern |
| POST /recurring/:id/skip | skip | Skip occurrence |
| POST /recurring/:id/pause | pause | Pause rule |
| POST /recurring/:id/resume | resume | Resume rule |
| POST /recurring/:id/link | linkTransaction | Link transaction |
| DELETE /recurring/:id/link/:txId | unlinkTransaction | Unlink |

---

### Week 10 Modules (Investments, Settings)

#### Investments Module (`server/modules/investments/`) - COMPLEX

**Expected Structure:**
```
investments/
├── index.ts                    # Re-exports all 7 sub-modules
├── investments.types.ts        # Shared types
├── investments.utils.ts        # Shared utilities
│
├── holdings/
│   ├── holdings.controller.ts
│   ├── holdings.service.ts
│   ├── holdings.validation.ts
│   ├── holdings.routes.ts
│   └── holdings.types.ts
│
├── portfolio/
│   ├── portfolio.controller.ts
│   ├── portfolio.service.ts     # PortfolioValuationService
│   ├── portfolio.validation.ts
│   └── portfolio.routes.ts
│
├── performance/
│   ├── performance.controller.ts
│   ├── performance.service.ts   # InvestmentPerformanceService
│   ├── performance.validation.ts
│   └── performance.routes.ts
│
├── market/
│   ├── market.controller.ts
│   ├── market.service.ts        # MarketDataService
│   ├── market.validation.ts
│   └── market.routes.ts
│
├── alerts/
│   ├── alerts.controller.ts
│   ├── alerts.service.ts        # PriceAlertService
│   ├── alerts.validation.ts
│   └── alerts.routes.ts
│
├── tax/
│   ├── tax.controller.ts
│   ├── tax.service.ts           # InvestmentTaxService
│   ├── tax.validation.ts
│   └── tax.routes.ts
│
├── pension/
│   ├── pension.controller.ts
│   ├── pension.service.ts       # PensionService
│   ├── pension.validation.ts
│   └── pension.routes.ts
│
└── README.md
```

**Review Checklist:**
- [ ] 7 sub-modules created and properly organized
- [ ] Re-exports all existing investment services
- [ ] `expensiveAnalyticsLimiter` applied to performance endpoints
- [ ] Holdings CRUD with transaction recording
- [ ] Portfolio valuation uses correct market prices
- [ ] Performance calculations (TWR, MWR) documented
- [ ] Tax lot tracking for gains/losses
- [ ] Pension contribution tracking

**Key Endpoints by Sub-module:**

**Holdings (9 endpoints):**
- GET/POST /investments/holdings
- GET/PUT/DELETE /investments/holdings/:id
- POST /investments/holdings/:id/transactions
- GET /investments/holdings/:id/transactions
- POST /investments/holdings/:id/split
- POST /investments/holdings/:id/dividend

**Portfolio (4 endpoints):**
- GET /investments/portfolio
- GET /investments/portfolio/allocation
- GET /investments/portfolio/history
- GET /investments/portfolio/diversification

**Performance (4 endpoints):**
- GET /investments/performance
- GET /investments/performance/:id
- GET /investments/performance/compare
- GET /investments/performance/attribution

**Market (4 endpoints):**
- GET /investments/market/quotes
- GET /investments/market/quotes/:symbol
- GET /investments/market/search
- GET /investments/market/history/:symbol

**Alerts (5 endpoints):**
- GET/POST /investments/alerts
- GET/PUT/DELETE /investments/alerts/:id

**Tax (4 endpoints):**
- GET /investments/tax/summary
- GET /investments/tax/lots/:holdingId
- GET /investments/tax/gains
- POST /investments/tax/wash-sale-check

**Pension (5 endpoints):**
- GET/POST /investments/pension
- GET/PUT/DELETE /investments/pension/:id

---

#### Settings Module (`server/modules/settings/`)

**Expected Structure:**
```
settings/
├── index.ts
├── settings.types.ts
│
├── user-settings/
│   ├── user-settings.controller.ts
│   ├── user-settings.service.ts
│   ├── user-settings.validation.ts
│   └── user-settings.routes.ts
│
├── household-settings/
│   ├── household-settings.controller.ts
│   ├── household-settings.service.ts
│   ├── household-settings.validation.ts
│   └── household-settings.routes.ts
│
├── preferences/
│   ├── preferences.controller.ts
│   ├── preferences.service.ts
│   ├── preferences.validation.ts
│   └── preferences.routes.ts
│
├── notifications/
│   ├── notification-settings.controller.ts
│   ├── notification-settings.service.ts
│   ├── notification-settings.validation.ts
│   └── notification-settings.routes.ts
│
└── README.md
```

**Review Checklist:**
- [ ] 4 sub-modules created
- [ ] Auto-save pattern preserved (2-second debounce on client)
- [ ] User settings: profile, appearance, locale
- [ ] Household settings: currency, fiscal year, members
- [ ] Preferences: dashboard layout, default views
- [ ] Notification settings: channels, frequencies, types

---

### Week 11 Modules (Categories, Merchants, Tags, Rules)

#### Categories Module (`server/modules/categories/`)

**Expected Structure:**
```
categories/
├── categories.controller.ts    # ~15 methods
├── categories.service.ts
├── categories.validation.ts
├── categories.types.ts
├── categories.routes.ts
├── index.ts
└── README.md
```

**Review Checklist:**
- [ ] CRUD for categories and subcategories
- [ ] Category groups support
- [ ] Icons and colors management
- [ ] Default categories seeding logic preserved
- [ ] Prevent deletion of categories with transactions

**Endpoints to Verify:**
- GET/POST /categories
- GET/PUT/DELETE /categories/:id
- GET/POST /categories/:id/subcategories
- GET/PUT/DELETE /categories/subcategories/:id
- GET /categories/groups
- POST /categories/reorder

---

#### Merchants Module (`server/modules/merchants/`)

**Expected Structure:**
```
merchants/
├── merchants.controller.ts     # ~12 methods
├── merchants.service.ts
├── merchants.validation.ts
├── merchants.types.ts
├── merchants.routes.ts
├── sub-services/
│   ├── recognition.service.ts     # MerchantRecognitionService
│   └── categorization.service.ts  # Auto-categorization
├── index.ts
└── README.md
```

**Review Checklist:**
- [ ] Re-exports MerchantRecognitionService
- [ ] Pattern matching for merchant recognition
- [ ] Default category assignment
- [ ] Merchant aliases support
- [ ] Logo/icon URL handling

---

#### Tags Module (`server/modules/tags/`)

**Expected Structure:**
```
tags/
├── tags.controller.ts          # ~10 methods
├── tags.service.ts
├── tags.validation.ts
├── tags.types.ts
├── tags.routes.ts
├── index.ts
└── README.md
```

**Review Checklist:**
- [ ] CRUD operations
- [ ] Tag colors and icons
- [ ] Bulk tag assignment
- [ ] Tag usage statistics
- [ ] Prevent deletion of tags in use (or cascade option)

---

#### Rules Module (`server/modules/rules/`)

**Expected Structure:**
```
rules/
├── rules.controller.ts         # ~8 methods
├── rules.service.ts            # Re-export RuleService
├── rules.validation.ts
├── rules.types.ts
├── rules.routes.ts
├── index.ts
└── README.md
```

**Review Checklist:**
- [ ] Re-exports RuleService
- [ ] Rule conditions validation (amount, description, merchant)
- [ ] Rule actions validation (category, tags)
- [ ] Rule priority/ordering
- [ ] Test rule against sample transaction endpoint

---

### Week 12 Modules (Notifications, Receipts, Weekly Recap)

#### Notifications Module (`server/modules/notifications/`)

**Expected Structure:**
```
notifications/
├── notifications.controller.ts
├── notifications.service.ts
├── notifications.validation.ts
├── notifications.types.ts
├── notifications.routes.ts
├── index.ts
└── README.md
```

**Review Checklist:**
- [ ] Re-exports NotificationService
- [ ] List notifications with read/unread filter
- [ ] Mark as read (single and bulk)
- [ ] Delete notifications
- [ ] Notification preferences respected

---

#### Receipts Module (`server/modules/receipts/`)

**Expected Structure:**
```
receipts/
├── receipts.controller.ts
├── receipts.service.ts
├── receipts.validation.ts
├── receipts.types.ts
├── receipts.routes.ts
├── sub-services/
│   └── ocr.service.ts          # receiptParser wrapper
├── index.ts
└── README.md
```

**Review Checklist:**
- [ ] Re-exports ReceiptService and receiptParser
- [ ] File upload with `uploadLimiter` (20/hour)
- [ ] File validation (magic bytes, size limit)
- [ ] OCR processing endpoint
- [ ] Receipt-to-transaction linking

---

#### Weekly Recap Module (`server/modules/weekly-recap/`)

**Expected Structure:**
```
weekly-recap/
├── weekly-recap.controller.ts
├── weekly-recap.service.ts
├── weekly-recap.validation.ts
├── weekly-recap.types.ts
├── weekly-recap.routes.ts
├── index.ts
└── README.md
```

**Review Checklist:**
- [ ] Get current week recap
- [ ] Get historical recaps
- [ ] Recap preferences (opt-in/out)
- [ ] Uses report data correctly

---

## Expected Output Format

```markdown
## [Module Name] – QA Rating: [PASS / PARTIAL / FAIL]

### ✅ Verified:
- [What works correctly, with file references]
- Example: `spending.controller.ts:45-67` implements getBreakdown correctly

### 🔴 Issues Found:
- **[Issue Summary]**
  - Location: `[file:line]` or `[endpoint]`
  - Risk: [Critical/High/Medium/Low]
  - Evidence: [Code snippet or reproduction steps]
  - Recommendation: [Fix suggestion]

### ⚠️ Documentation Gaps:
- Missing: [e.g., no README in module]
- Outdated: [e.g., describes legacy patterns]
- Improvement: [e.g., add validation schema docs]

### 📘 Suggestions:
- [Optional enhancements]
```

---

## Comprehensive Checklist

### Code Quality & Modularity
- [ ] Each module has Controller → Service → Repository layering
- [ ] Sub-modules properly organized (Investments: 7, Settings: 4, Reports: 5)
- [ ] All modules export via unified `index.ts`
- [ ] Legacy services properly re-exported
- [ ] No logic leaks between domains
- [ ] Max file size < 500 LOC for controllers

### Security & Access Control
- [ ] All routes protected by `requireAuth`
- [ ] `householdGuard` on all household-scoped routes
- [ ] `requireRole("member")` on write operations
- [ ] Rate limiting applied per specification
- [ ] File uploads validated (receipts)
- [ ] No PII in logs

### Validation
- [ ] Zod schemas for all inputs
- [ ] Date range validation (startDate < endDate)
- [ ] Currency codes validated (3-char ISO)
- [ ] UUID validation for IDs
- [ ] Numeric ranges validated (budget thresholds 0-100)

### Caching (Reports Module)
- [ ] `withCache()` applied to report endpoints
- [ ] TTL presets used appropriately (MEDIUM for reports)
- [ ] Cache invalidation on transaction changes
- [ ] Cache tags for grouped invalidation

### Events Integration
- [ ] Budget events: BUDGET_CREATED, BUDGET_EXCEEDED
- [ ] Recurring events: RULE_CREATED, RULE_TRIGGERED
- [ ] Events use consolidated EventTypes from `core/events/eventTypes.ts`

### Documentation
- [ ] README.md in each module
- [ ] Endpoint documentation (inputs, outputs, errors)
- [ ] Validation schema documentation
- [ ] Sub-service responsibilities documented

---

## Test Scenarios

### Reports Module
1. Get spending breakdown with date range → returns categorized data
2. Get spending trend with comparison → returns trend with delta
3. Cache hit on repeat request → faster response, cache stats updated
4. Invalid date range (end < start) → 400 validation error
5. Missing required currency → uses household default

### Budgets Module
1. Create budget → budget created with alert threshold
2. Spending exceeds threshold → BUDGET_EXCEEDED event (if integrated)
3. Rollover budget → carry-over amount calculated correctly
4. Delete budget with history → soft delete or cascade

### Recurring Module
1. Detect patterns → returns detected recurring transactions
2. Confirm pattern → creates recurring rule
3. Skip occurrence → occurrence marked skipped
4. Generate upcoming → returns next N occurrences

### Investments Module
1. Add holding → holding created with cost basis
2. Record dividend → updates holding, creates transaction
3. Get portfolio allocation → returns asset class breakdown
4. Calculate performance → returns TWR/MWR metrics

### Settings Module
1. Update user setting → auto-saves with debounce
2. Update household setting → all members see change
3. Update notification preference → respects new setting

---

## Performance Budgets

| Module | Endpoint Type | P95 Target |
|--------|---------------|------------|
| Reports | List queries | < 300ms |
| Reports | Trend/Annual | < 500ms |
| Investments | Portfolio summary | < 200ms |
| Investments | Performance calc | < 500ms |
| Settings | Read | < 50ms |
| Settings | Write | < 100ms |
| All others | CRUD | < 100ms |

---

## Rollback Verification

- [ ] Feature flags documented for each module
- [ ] Legacy routes preserved as fallback
- [ ] No database schema changes (modules only)
- [ ] Rollback procedure documented

---

## Dependencies Verification

### From Phase 3 (Must Be Complete):
- [x] Event system (`core/events/`) - EventBus, Outbox, EventTypes
- [x] Job system (`core/jobs/`) - JobService, JobRunner
- [x] Cache system (`core/cache/`) - CacheStore, withCache, TTL presets
- [x] Validation system (`core/validation/`) - validate, validateMultiple
- [x] HTTP helpers (`core/http/`) - success, error responses
- [x] Error handling (`core/errors/`) - HttpError hierarchy

### From Phase 1 (Must Be Complete):
- [x] ReportRepositories - SpendingReportRepository, etc.
- [x] Module template structure

---

## Reference Documents

- [../architecture/phase4-implementation-plan.md](../architecture/phase4-implementation-plan.md)
- [enterprise-refactoring-specification.md](../architecture/enterprise-refactoring-specification.md)
- [refactoring-todo.md](refactoring-todo.md)
- [phase-2-3-qa-review.md](phase-2-3-qa-review.md) (for format reference)

---

## Notes

- **Do NOT implement:** CQRS, Event Sourcing, Redis (in-memory cache only), Microservices
- **Feature flags:** Use `FF_MODULE_{NAME}_ENABLED` pattern
- **Backward compatibility:** Modules coexist with legacy routes during migration
- **Focus areas:** Investments (complex, 7 sub-modules), Reports (caching critical)

---

*End of Phase 4 QA Review Prompt*
