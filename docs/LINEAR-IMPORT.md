# Linear backlog structure

Linear becomes the single source of truth for remediation status, replacing the audit's
discredited markdown status docs. Create one issue per finding. Move an issue to Done only
after CI is green on the fix and the verifier agent returns PASS.

## Suggested setup
- **Project:** "Production Readiness Remediation"
- **Labels:** `P0`, `P1`, `P2`, `P3`; `DPA`, `money`, `concurrency`, `security`, `infra`,
  `testing`, `react`; plus a per-module label.
- **Custom field:** "Exit criterion" (the artifact that proves done) and "Audit est. (days)".
- **Workflow states:** Backlog -> Todo -> In Progress -> In Review (verifier) -> Done.
- **Convention:** the Definition of Done from CLAUDE.md is the issue's acceptance criteria.

## P0 launch blockers (create these first)

| Title | Labels | Est. (d) | Exit criterion |
|---|---|---|---|
| Reconcile prod deploy target + runbook | P0, infra | 2 | A working backend deploy and a runbook (build/env/migrate/start/health/rollback) |
| Distributed rate-limit store (Redis) wired to all limiters | P0, infra | 1.5 | All 7 limiters use the Redis store; test proves cross-instance limit |
| Distributed cron lock (no double-fire) | P0, infra | 2 | Cron jobs single-fire under 2 instances; test proves the lock |
| DB connection SSL/TLS in production | P0, infra, security | 0.5 | Pool sets ssl in prod; verified no cleartext |
| `trust proxy` set in production code | P0, security | 0.5 | Client IP in audit/login rows; secure cookie set behind proxy; test |
| GRZ securities money via Money class | P0, money | 3 | grep clean in grz-service/grz-securities; to-the-cent test |
| GRZ writes audit-logged | P0, DPA | 1.5 | BusinessAuditService row on every GRZ write; test asserts audit_logs |
| AI PII sanitisation for all 12 tools | P0, DPA | 3 | No raw rows to Gemini; data_sanitized from sanitiser; test |
| Gemini tool-arg Zod validation | P0, DPA, security | 2 | ai.validation schemas enforced before filters; test rejects bad args |
| CI runs check + both suites on PRs | P0, testing | 2 | ci.yml green on a trivial PR against Postgres |
| Real-DB integration tests: Goals/Transactions/Investments | P0, testing | 8 | Real HTTP+Postgres tests that fail on bug, pass on fix |
| Dashboard Rules-of-Hooks crash | P0, react | 0.5 | No conditional return before hooks; mount-on-household-change test |
| Household ownership transfer atomic | P0, concurrency | 1 | withTransaction + FOR UPDATE; concurrent-transfer test -> one owner |
| Weekly-recap consent gate + audit | P0, DPA | 1.5 | Consent checked before send; audit row; cron lock dependency noted |

## P1 high priority (summary - expand into issues)
Transactions FOR UPDATE + overdraft + in-txn idempotency; FX engine to exact math + fail on
missing rate; budgets non-atomic recalc; env validation for all ~12 vars (fail closed);
unhandledRejection/uncaughtException handlers; versioned migrations on deploy; client money
antipatterns (split modal, budget totals); `/uploads` behind ownership checks; AI rate-limit
and cache via Redis; budget_periods UNIQUE in schema.ts; recurring batch atomicity.

## P2 / P3 (summary - expand from the S5 sweep)
Un-skip security/audit/rate-limit tests; coverage thresholds incl. financial folders;
deterministic E2E with correct seeds; deep-audit and fix the remaining modules (rules
visibility leak, merchants count drift, tags usage drift, health dead 503, filter-presets
no tests, settings fake delete, client test rot); dark-mode CSS variables; aria-labels and
keyboard nav; LOC splits; bundle code-splitting; retire the dual calculation engine.

## Creating these automatically
The Linear connector is available. I can create the P0 issues above directly in your
"Production Readiness Remediation" project, with labels, estimates, and exit criteria, then
generate the P1/P2/P3 issues from the audit and the S5 sweep. Say the word and confirm the
project/team to use.
