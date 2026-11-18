# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### June 2026 — Production-Readiness Remediation (~40 PRs, #3–#43)

Remediation sprint following the 2026-06-04 independent audit. Full detail:
[`docs/operations/ai-changelog/2026-06-production-readiness-remediation.md`](ai-changelog/2026-06-production-readiness-remediation.md).

- **Infrastructure**: CI `verify` job (real Postgres) + remediation scaffold (#3); deploy
  reconcile + production runbook + versioned migrations (#6); process-level error handlers
  (#8); centralized Redis for rate-limit/scheduler-lock/AI cap (#10); env fail-closed
  validation (#11); authenticated `/uploads` (#9).
- **Security & DPA**: transaction-aware audit logging for GRZ writes + reports CSV egress
  (#7) and CSV export creation (#43); weekly-recap per-user consent gate + audit (#17).
- **AI**: PII sanitizer on all tools + real `data_sanitized` (#24); Zod tool-arg validation
  before SQL (#30); conversation persistence with cross-tenant isolation (#37).
- **Money & FX**: GRZ money via `Money` class (#21); FX fail-closed on missing rate
  (#12, #23); client money floats removed (#26).
- **Concurrency**: `FOR UPDATE` + overdraft guard + in-txn idempotency on transfers (#14);
  atomic budgets (#13), recurring (#16), household transfer/invite (#19, #33), rules (#15,
  #34); bulk-owner validation + cap (#29); race-safe receipt linking (#18).
- **Household/Taxonomy**: retain co-members' data on erasure + audit-before-destroy
  (#22/#28); household role checks (#20); merchant/tag/category integrity + atomicity (#31).
- **Frontend**: nivo→recharts migration (#5); dark-mode + a11y + code-splitting (#32).
- **Testing/CI**: real-DB integration tests (#27); type-checked tests (#38); test-reality
  + observability fixes (#39/#40/#41); calc cleanup (#35); mock-theater suites greened +
  3 product bugs fixed (#45, in review).

### Added

- **Documentation Reorganization**: Moved docs into structured folders with new system, policy, and compliance docs
- **Secrets Rotation Documentation**: Manual rotation procedures for SESSION_SECRET (90-day schedule)
- **Test Coverage**: Server tests passing (535/535), coverage reports enabled (36% statements)
- **Money DTO Standardization**: Refactored validation schemas to use decimal string format for all monetary fields

### Fixed

- Fixed `TypeError` in investments route when processing tax lots with undefined rows
- Fixed Zod validation failures in investment tests by using valid UUID format

---

## [0.1.0] - 2026-01-11

### Added - Phase 4 Completion

- **Module Migration**: All 17 server modules migrated to modular architecture
  - auth, transactions, reports, investments, accounts, goals, recurring, receipts
  - budgets, settings, weekly-recap, categories, merchants, rules, household
  - tags, notifications
- **Feature Flags**: Per-module feature flags in `server/config/featureFlags.ts`
- **Route Wiring**: Conditional routing with legacy fallback in `server/routes.ts`

### Added - Phase 0 Security

- Object-level authorization (`server/core/authorization/ownership.ts`)
- Step-up MFA for sensitive actions (`server/middleware/requireStepUp.ts`)
- File upload content validation (`server/middleware/fileValidation.ts`)
- Account lockout after 5 failed attempts
- Session regeneration on login
- 5 specialized rate limiters
- Audit logging with 17 event types
- HSTS enforcement with 1-year maxAge

### Added - Phase 1 Foundation

- Core errors module (10 error classes)
- Core events module (EventBus, transactional outbox)
- Core HTTP helpers (responses, pagination)
- Core validation registry (13+ schemas)
- Core cache module (withCache HOF, TTL presets)
- Core jobs module (background job service)
- Report repository split (6 domain-specific repositories)

### Added - Client Refactoring

- Transactions feature module (1,560 → 292 LOC, 81% reduction)
- Budget feature module (3,190 → 551 LOC, 83% reduction)
- Recurring feature module (1,245 → 404 LOC, 68% reduction)
- Settings feature module (shared components and hooks)

### Security

- All admin routes protected with `requireAuth` + admin role
- Debug logging with PII removed from `householdGuard.ts`
- File-based error logging removed
- CORS requires explicit origin in production
- MFA backup codes expire after 90 days
- Log retention policy defined (90d hot, 1yr cold, 2yr security)
