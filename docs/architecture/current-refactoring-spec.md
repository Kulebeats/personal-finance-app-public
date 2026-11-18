# Current Refactoring Spec (Small-Scale Deployment)

Date: 2026-01-11
Audience: Engineering + QA
Context: <500 active users, prioritize correctness, security, and maintainability over large-scale ops.

## 1) Scope and Goals

### In scope (now)
- Deterministic money handling across API and UI.
- Audit logging for all financial writes.
- Consistent validation and response shapes.
- Focused refactors for files over 500 LOC in client pages.
- Integration testing for critical flows.
- Documentation updates for the current system.

### Out of scope (later - enterprise scale only)

These require significant infrastructure and complexity that's not justified for <200 users:

#### Observability & Monitoring

- Distributed tracing (OpenTelemetry, Jaeger)
- Real-time monitoring dashboards (Prometheus, Grafana, Datadog)
- Automated alerting rules and on-call integration
- APM (Application Performance Monitoring)
- Log aggregation pipelines (ELK, Splunk)
- Structured tracing with trace IDs across services

#### Infrastructure & Caching

- Redis or external caching layer (PostgreSQL query cache is sufficient)
- Load balancing across multiple instances
- Database read replicas or connection pooling beyond simple limits
- CDN for static assets
- Kubernetes orchestration or containerized deployment

#### Advanced Patterns

- CQRS (Command Query Responsibility Segregation)
- Event Sourcing (only for >1M transactions/year)
- Microservices decomposition or service extraction
- Event-driven architecture with distributed outbox pattern
- Per-user feature flag rollout with percentage-based targeting
- Shadow testing infrastructure (only for regulated calculations)
- Idempotency service (important for payment APIs, not expense tracking)

#### Operational Excellence

- Multi-region deployment or geo-redundancy
- Disaster recovery with detailed RTO/RPO targets
- Advanced graceful shutdown with connection draining
- Database migration expand-contract pattern (simple direct migrations fine)
- Complex job queue with distributed workers
- Health check endpoints beyond basic liveness probe

#### Compliance & Audit

- SOC 2 Type II certification
- PCI DSS Level 1 compliance (basic encryption is sufficient)
- HIPAA or advanced GDPR controls
- Dual-key JWT rotation
- Backup encryption and immutable audit logs

#### Performance Optimization

- Full module rewrite for every domain (only problematic ones)
- Large-scale performance tuning beyond basic caching
- Query optimization with advanced indexing strategies
- Client-side performance budgets with automated enforcement

## 2) Prioritized Requirements

### P0 (Must-have)
- Money types and validation must be decimal-safe.
  - Add `server/core/money` and adopt `{ amount: string, currency: string }` for API payloads.
  - Replace `number` money fields in shared types used by reports and transactions.
- Audit logging for create/update/delete on:
  - Transactions, Budgets, Recurring rules, Goals.
- Security checklist remains enforced (Phase 0 complete; keep it complete).

### P1 (Should-have)
- Standardized validation and response shapes in module routes.
  - Use `server/core/validation` middleware.
  - Return `{ success: true, data, meta? }` and `{ success: false, error }`.
- Integration tests for critical flows (see Section 5).
- Update docs/TODO so tasks reflect current code.

### P2 (Can wait)
- Event outbox and job runner in production only if needed.
  - If required, start processors at startup with feature flags.
  - If not required, document that they are disabled.
- Advanced observability metrics and load testing.

## 3) Client Refactor Targets (Pages > 500 LOC)

Refactor these pages into smaller components/hooks (target < 300 LOC per page):
- `client/src/pages/settings/sections/MerchantsSection/index.tsx` (~1442 LOC)
- `client/src/pages/settings/sections/RulesSection/index.tsx` (~901 LOC)
- `client/src/pages/settings/sections/RulesSection/RuleEditorModal.tsx` (~921 LOC)
- `client/src/pages/settings/sections/SecuritySection/index.tsx` (~666 LOC)
- `client/src/pages/settings/sections/CategoriesSection/index.tsx` (~635 LOC)

Note: Test files over 500 LOC can stay large unless they block readability.

## 4) Inline Comments Policy

- Only add comments for non-obvious logic or complex flows.
- Do not comment trivial assignments or obvious steps.
- Prefer short, focused comments that clarify intent.

## 5) Integration Testing Requirements

### Required integration tests
- Auth session lifecycle: login, session regeneration, logout.
- Transactions: create/update/delete + audit log entry.
- Budgets: create/update + alerts/progress queries.
- Recurring: create rule + preview occurrences.
- Reports: key endpoints return correct shapes (spending/cashflow/net worth).
- Settings: security settings update + audit log.

### Guidelines
- Use existing test frameworks (Vitest + Supertest).
- Verify response shapes and error codes.
- Mock only external systems; keep DB real or use a test DB.

## 6) Documentation Requirements

Update or create:
- Current refactor checklist (update `docs/refactoring-todo.md`).
- API spec (keep `docs\api\openapi.yaml` updated to include `/api/v1`).
- Module READMEs for touched modules.
- Short release notes in `docs\operations\changelog.md` when refactor tasks land.

## 7) Acceptance Criteria (Current)

- Money types are decimal-safe across API payloads and validations.
- Financial write operations are audited.
- Client pages listed in Section 3 are < 300 LOC after refactor.
- Integration tests from Section 5 are green.
- Documentation in Section 6 is updated and accurate.

