# Documentation Re-Audit v3 — Complete Review
## Personal Finance Application
**Date:** 2026-02-06
**Scope:** 40 documents reviewed across specifications, security, compliance, setup, policies, and testing
**Total Lines Reviewed:** ~12,400

---

## 1. Executive Summary

### Final Ratings

| Area | v1 Audit | v2 (My Previous) | v3 (Final) | Reason for Change |
|------|----------|-------------------|------------|-------------------|
| Overall Completeness | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐½ | Security + policy docs now reviewed; coverage is genuinely broad |
| Detail Level | ⭐⭐⭐ | ⭐⭐⭐½ | ⭐⭐⭐½ | Security review report is excellent; some docs still shallow |
| Currency | ⭐⭐⭐ | ⭐⭐½ | ⭐⭐½ | SRS still missing MFA/PHQ-9; security review pre-dates CSRF fix |
| Standards Compliance | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | IEEE + OWASP mapping confirmed |
| Structure & Organization | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | DB setup duplication confirmed; naming still inconsistent |
| Security Documentation | Not rated | ⭐⭐⭐⭐ | ⭐⭐⭐⭐½ | Full security suite now reviewed — genuinely strong |
| Testing Documentation | Not rated | ⭐⭐ | ⭐⭐ | Still Settings-only; no change |
| Policy Documentation | Not rated | Not rated | ⭐⭐⭐ | Policies exist but are thin frameworks |
| Setup & Onboarding | Not rated | Not rated | ⭐⭐½ | 5 overlapping DB docs; no unified developer guide |

**Final Grade: B+ (upgraded from B)**

The upgrade is driven entirely by the security documentation suite, which I had not seen before. The security-review-report.md (584 lines) with its OWASP Top 10 mapping, the auth-pentest-checklist.md (276 lines) with 80+ test cases, the secrets-rotation.md with concrete rotation procedures, and the supporting threat model, risk register, and incident response docs represent the strongest security documentation I've seen in a personal project. This elevates the overall picture significantly.

---

## 2. Complete Document Inventory (40 Documents)

### 2.1 Specifications (5,253 lines) — ⭐⭐⭐⭐⭐

| Document | Lines | Quality | Notes |
|----------|-------|---------|-------|
| srs.md | 393 | Excellent | IEEE 830, 50+ requirements, Zambia DPA integration |
| sdd.md | 714 | Excellent | IEEE 1016, full code patterns, 8-layer security design |
| brd.md | 477 | Excellent | Personas, risk matrix, traceability chain |
| user-stories.md | 1,336 | Excellent | 8 epics, Given/When/Then acceptance criteria |
| use-cases.md | 783 | Excellent | UML, activity/sequence/state diagrams |
| Analytics Architecture | 2,746 | Outstanding | Production-grade: schemas, API contracts, query plans, caching, benchmarks |

**Assessment:** This is the project's crown jewel. The specification layer is enterprise-grade with genuine traceability from business requirements → functional requirements → design → implementation patterns. The Analytics Architecture is the single most thorough document in the suite. Only gap: SRS needs updating for post-January features (MFA, PHQ-9, investments refactor).

### 2.2 Security Documentation (1,448 lines) — ⭐⭐⭐⭐½

| Document | Lines | Quality | Notes |
|----------|-------|---------|-------|
| security-review-report.md | 584 | Outstanding | OWASP Top 10 mapping, 10 finding categories, code-level remediation |
| auth-pentest-checklist.md | 276 | Excellent | 80+ test cases across 8 categories with expected results |
| secrets-rotation.md | 116 | Good | Concrete procedures, verification checklist, inventory |
| threat-model.md | 46 | Adequate | Mermaid trust boundary diagram, STRIDE-lite coverage |
| security-architecture.md | 42 | Adequate | Primary controls listed, cross-references other docs |
| risk-register.md | 17 | Thin | 6 risks, quarterly review cadence. Needs expansion |
| access-control.md | 36 | Adequate | AuthN/AuthZ/sessions/rate limiting summary |
| incident-response.md | 41 | Adequate | P1/P2/P3 severity, 5-step runbook, roles defined |
| security.md | 35 | Good | Vulnerability disclosure policy with safe harbor |
| export-audit-logging-spec.md | 88 | Good | Schema defined, example event, retention rules |
| logging-monitoring.md | 29 | Thin | Principles only, no dashboards/alerts config |

**Assessment:** The security-review-report.md is exceptional — it includes line-by-line code references, CVE identifications, OWASP mapping, and concrete remediation code. The auth-pentest-checklist.md covers credential attacks, account enumeration, SQL injection, session management, cookie security, password security, MFA, rate limiting, input validation, and error handling with individual test cases. Combined with secrets rotation procedures and threat modeling, this is a mature security documentation suite.

**Key finding:** The security review has been updated to reflect CSRF implementation and P0 remediation status (updated 2026-02-06).

**Gaps:**
- Risk register is too thin (6 risks for a finance app; should have 15-20)
- Logging/monitoring doc needs operationalization (what dashboards, what thresholds)
- Incident response templates now filled; schedule annual tabletop review
- Security review updated; ensure quarterly refresh cadence to avoid drift

### 2.3 Compliance & Privacy (274 lines) — ⭐⭐⭐½

| Document | Lines | Quality | Notes |
|----------|-------|---------|-------|
| compliance-summary.md | 71 | Good | Framework status, control mapping, honest gap acknowledgment |
| data-privacy.md | 46 | Adequate | Data categories, storage, access controls. Missing DPIA/DSR workflow |
| standards-alignment.md | 52 | Good | ISO/SOC2/OWASP/NIST mapping with gap analysis |
| jurisdiction-scope.md | 36 | Good | Decision framework for regulatory triggers |
| accessibility-audit.md | 89 | Updated | Audit plan with confirmed baseline checks and pending manual tests |

**Assessment:** Good framework but execution evidence is missing across the board. The compliance-summary.md is honest about this ("Policies exist; evidence and control testing needed"). The Zambia DPA integration across SRS/SDD/BRD is notably strong. Accessibility audit is a checklist shell, not results.

### 2.4 Policy Documents (139 lines) — ⭐⭐⭐

| Document | Lines | Quality | Notes |
|----------|-------|---------|-------|
| access-control-policy.md | 39 | Thin | Correct principles but no implementation detail |
| business-continuity-disaster-recovery.md | 32 | Thin | RTO/RPO defined (24h/4h), backup strategy, but no procedures |
| data-retention-policy.md | 34 | Thin | Data classes defined, retention guidelines, but no schedules |
| sdlc.md | 34 | Thin | 6-phase lifecycle, quality gates, but minimal detail |

**Assessment:** All four policies follow the right structure and cover the right topics. But each is a 30-40 line skeleton. For comparison, a production BCP/DR plan is typically 10-30 pages with recovery procedures, contact trees, and test results. These are "policy intent" documents, not operational policies.

### 2.5 System & Architecture (314 lines) — ⭐⭐⭐

| Document | Lines | Quality | Notes |
|----------|-------|---------|-------|
| overview.md | 61 | Thin | Capabilities list, no user journeys or module dependencies |
| architecture.md | 49 | Thin | One Mermaid diagram, subsystem list only |
| data-flows.md | 70 | Adequate | 4 Mermaid diagrams for core flows |
| feature-flags.md | 84 | Good | Complete inventory, migration path, code examples |
| module-patterns.md | 63 | Good | Full vs Thin pattern criteria with module assignments |
| health.md | 48 | Good | All 3 probe types with response examples |
| deployment.md | 31 | Thin | Bare minimum, no Docker/CI/CD/backup procedures |
| migration-guide.md | 116 | Good | Legacy→modular migration complete, rollback procedures |

**Assessment:** The feature flags, module patterns, and migration guide are good operational docs. But overview, architecture, and deployment are stubs. The migration guide is well-written and includes the important note that cutover is complete — this is the kind of historical documentation that helps future developers understand why the codebase looks the way it does.

### 2.6 Setup & Database (820 lines) — ⭐⭐½

| Document | Lines | Quality | Notes |
|----------|-------|---------|-------|
| setup.md | 201 | Detailed | Phase 1 setup, auth system, default data |
| database-readme.md | 255 | Detailed | Windows-focused, pgAdmin, pro tips |
| database-setup-steps.md | 195 | Detailed | Step-by-step with troubleshooting |
| local-database-setup.md | 169 | Detailed | 3 setup options (service/cloud/manual) |
| API README.md | 76 | Good | Auth, pagination, error format, examples |

**Assessment:** Each individual doc is well-written and helpful. The problem is there are FOUR database setup documents that overlap heavily:

| Topic | database-readme.md | database-setup-steps.md | local-database-setup.md | setup.md |
|-------|:--:|:--:|:--:|:--:|
| Run setup script as admin | ✅ | ✅ | ✅ | ✅ |
| Update .env with password | ✅ | ✅ | ✅ | ✅ |
| Run npm db:push | ✅ | ✅ | ✅ | ✅ |
| Table list after migration | ✅ | ✅ | ❌ | ❌ |
| Troubleshooting | ✅ | ✅ | ✅ | ❌ |
| Cloud DB alternative | ❌ | ❌ | ✅ | ❌ |
| Test auth endpoint | ✅ | ❌ | ❌ | ✅ |
| pgAdmin instructions | ✅ | ❌ | ❌ | ❌ |
| Backup/restore | ✅ | ❌ | ❌ | ❌ |

A developer encountering these four files will not know which to follow. This is the clearest consolidation win in the entire documentation suite.

### 2.7 Testing Documentation (1,833 lines) — ⭐⭐

| Document | Lines | Quality | Notes |
|----------|-------|---------|-------|
| settings-testing-guide.md | 269 | Good (for Settings) | Manual + automated testing for Settings only |
| settings-integration-testing.md | 774 | Good (for Settings) | Settings integration test infrastructure |
| settings-test-changelog.md | 655 | Good (for Settings) | Settings test changes |
| accessibility-audit.md | 89 | Updated | Audit plan with confirmed baseline checks and pending manual tests |

**Assessment unchanged from v2:** 1,698 lines of testing docs all cover one feature (Settings). No test documentation exists for the financial core. This remains the biggest gap.

---

## 3. What Changed from My v2 Assessment

### 3.1 Security Rating Upgrade (⭐⭐⭐⭐ → ⭐⭐⭐⭐½)

The security-review-report.md alone justifies the upgrade. This is a 584-line code-level security review with:
- Line-by-line source code references (e.g., `server/app.ts:121`)
- CWE identifiers for each finding
- Concrete code-level remediation with before/after examples
- OWASP Top 10 (2021) compliance matrix
- NIST CSF and ISO 27001 alignment notes
- Prioritized remediation plan with effort estimates
- Dependency vulnerability audit (npm audit results)

Combined with the AUTH_PENTEST_CHECKLIST (80+ test cases covering credential attacks, session management, cookie security, MFA, rate limiting, and input validation), this creates a security testing framework that most startups and many enterprises don't have.

### 3.2 Completeness Upgrade (⭐⭐⭐⭐ → ⭐⭐⭐⭐½)

With the full suite visible, the documentation covers:
- ✅ Business requirements (BRD)
- ✅ Functional requirements (SRS)
- ✅ Design specifications (SDD)
- ✅ User stories and use cases
- ✅ Architecture and data flows
- ✅ API documentation
- ✅ Security review and threat model
- ✅ Penetration test checklist
- ✅ Secrets rotation procedures
- ✅ Incident response plan
- ✅ Compliance mapping
- ✅ Data privacy documentation
- ✅ Access control policy
- ✅ BCP/DR policy
- ✅ Data retention policy
- ✅ SDLC definition
- ✅ Feature flags reference
- ✅ Migration guide
- ✅ Module patterns
- ✅ Health check endpoints
- ✅ Vulnerability disclosure policy (security.md)
- ✅ Export audit logging spec
- ✅ Logging and monitoring guidelines
- ⚠️ Testing (Settings only, no system-wide strategy)
- ⚠️ Developer onboarding (fragmented across 4 DB docs)
- ⚠️ Operational runbooks (not yet created)
- ⚠️ CHANGELOG (missing)
- ⚠️ ADRs (only 1 exists)
- ⚠️ Data dictionary (schema overview in SDD but no standalone reference)

That's 23 ✅ out of 29 documentation categories. The breadth is genuinely impressive.

### 3.3 What Didn't Change

- **Testing: ⭐⭐** — Still the biggest gap. Security pentest checklist is separate from app testing.
- **Structure: ⭐⭐⭐** — Legacy DB docs archived and naming normalized; remaining cleanup is deprecation removal.
- **Currency: ⭐⭐½** — SRS still stale for post-January features. Security review updated with CSRF implemented.

---

## 4. Critical Findings (Prioritized)

### 🔴 P0 — Must Fix Immediately

| # | Finding | Risk | Evidence |
|---|---------|------|----------|
| P0-1 | **Secrets exposed in security-remediation.md** | Credential compromise if committed to git | Plaintext SESSION_SECRET, CRON_SECRET, LOGO_DEV_TOKEN in remediation guide (verify git history) |
| P0-2 | **Security review report is stale** | False negative — team thinks CSRF is missing when it's likely fixed | Report says "❌ NOT IMPLEMENTED" for CSRF, but API README references CSRF tokens |
| P0-3 | **No system-wide test strategy** | Cannot verify financial core correctness | 1,698 lines of test docs all cover Settings feature only |

### 🟡 P1 — Fix This Sprint

| # | Finding | Risk | Evidence |
|---|---------|------|----------|
| P1-1 | **SRS not updated for recent features** | Traceability chain broken | MFA, PHQ-9, investments refactor, budget fixes not in SRS |
| P1-2 | **4 overlapping database setup docs** | Developer confusion, maintenance burden | database-readme.md, database-setup-steps.md, local-database-setup.md, setup.md all cover same steps |
| P1-3 | **No CHANGELOG.md** | Release history not tracked | Only changelog is for Settings test infrastructure |
| P1-4 | **Risk register too thin** | Security posture underrepresented | 6 risks for a finance app (should be 15-20) |

### 🟢 P2 — Fix This Month

| # | Finding | Risk | Evidence |
|---|---------|------|----------|
| P2-1 | **System docs are stubs** | Poor developer onboarding | overview.md (61), architecture.md (49), deployment.md (31) |
| P2-2 | **Policy docs are skeletons** | Compliance gap for SOC2/ISO readiness | All 4 policies are 30-40 line frameworks |
| P2-3 | **Incident response templates missing (resolved)** | Unusable in actual incident | Templates added in 2026-02-06 update |
| P2-4 | **Only 1 ADR exists** | Architectural decisions undocumented | 10+ major decisions lack ADRs |
| P2-5 | **No data dictionary** | Developers must read schema code for field definitions | 15+ entity types without standalone reference |
| P2-6 | **File naming inconsistent** | Tooling issues, cognitive load | SCREAMING_SNAKE, kebab-case, spaces in filenames mixed |
| P2-7 | **Testing docs misnamed** | Creates false confidence in test coverage | settings-testing-guide.md sounds system-wide but is Settings-only |

---

## 5. Detailed Implementation Plan

### Phase 1: Critical Security & Accuracy Fixes (Week 1)

#### Task 1.1: Rotate Exposed Secrets
**Priority:** P0-1 | **Effort:** 30 minutes | **Owner:** DevOps/Backend

**Why:** The remediation guide (now `docs/security/security-remediation.md`, formerly `security-remediation.md`) previously contained plaintext secrets. If this file was ever committed to git, these secrets are compromised regardless of later removal.

**Steps:**
1. Check if the remediation guide exists in git history (old and new paths):
   ```bash
   git log --all --full-history -- "**/security-remediation.md" "**/security-remediation.md"
   ```
2. If found in history, the secrets are compromised. Generate new values:
   ```bash
   # New SESSION_SECRET
   openssl rand -hex 32
   # New CRON_SECRET
   openssl rand -hex 32
   ```
3. Update production environment variables with new values
4. Rewrite the remediation guide to reference secret names only (never values):
   ```markdown
   ## Secrets to Configure
   - `SESSION_SECRET` — Generate with `openssl rand -hex 32`
   - `CRON_SECRET` — Generate with `openssl rand -hex 32`
   - `LOGO_DEV_TOKEN` — Obtain from logo.dev dashboard
   ```
5. If secrets were in git history, purge with BFG Repo-Cleaner:
   ```bash
   # Install BFG
   brew install bfg  # or download from rtyley.github.io/bfg-repo-cleaner
   
   # Create a file with strings to replace
   echo "41d97bbac7e9a26332d8dc20b595c8c861ed78da15e1e080e3cd70dc0bed3de1" > secrets.txt
   echo "ab111ac9825b9c54af5fb320ea0bc564e8d325423fa554df3af16166c407fd5f" >> secrets.txt
   echo "pk_X-1ZO13GSgeOoUrIuJ6GMQ" >> secrets.txt
   
   # Run BFG
   bfg --replace-text secrets.txt
   git reflog expire --expire=now --all && git gc --prune=now --aggressive
   git push --force
   ```
6. Add pre-commit hook to prevent future secret commits:
   ```bash
   # Install gitleaks
   brew install gitleaks  # or download from github.com/gitleaks/gitleaks
   
   # Create .gitleaks.toml in project root
   ```
   Create `.gitleaks.toml`:
   ```toml
   title = "Finance App Gitleaks Config"
   
   [allowlist]
   paths = [
     '''\.env\.example''',
   ]
   ```
   Add to `.pre-commit-config.yaml`:
   ```yaml
   repos:
     - repo: https://github.com/gitleaks/gitleaks
       rev: v8.18.1
       hooks:
         - id: gitleaks
   ```

**Verification:** Run `gitleaks detect` on the repository. Zero findings = success.

---

#### Task 1.2: Update Security Review Report
**Priority:** P0-2 | **Effort:** 1 hour | **Owner:** Security/Backend

**Why:** The security review report (dated Jan 10, 2026) states CSRF is "❌ NOT IMPLEMENTED" but the API README references CSRF tokens, suggesting it was implemented afterward. A stale security report creates false negatives — someone reading it will think CSRF is still missing.

**Steps:**
1. Verify current CSRF implementation status:
   ```bash
   # Search for CSRF middleware in codebase
   grep -r "csrf" server/ --include="*.ts" -l
   grep -r "csrfToken" server/ --include="*.ts" -l
   ```
2. If CSRF is implemented, update security-review-report.md section 8:
   - Change status from "❌ NOT IMPLEMENTED" to "✅ IMPLEMENTED (post-review)"
   - Add implementation date and approach (double-submit cookie)
   - Update OWASP Top 10 mapping: A01 from "⚠️ PARTIAL" to "✅ PASS"
3. Verify the other 3 HIGH findings:
   - P0-1 (qs dependency CVE): Run `npm audit` — is it fixed?
   - P0-2 (MFA code in logs): Check `server/routes/security.ts:665` — is `code` still logged?
   - P0-4 (rate limit X-Forwarded-For bypass): Check if `trust proxy` is configured
4. Update the report's revision history:
   ```markdown
   | 1.2 | 2026-02-XX | Engineering | Verified CSRF implementation (post P0-3), 
   updated dependency status, verified MFA logging fix, rate limit bypass status |
   ```
5. Update the OWASP Top 10 table, Conclusion section, and Priority Remediation Plan to reflect current state

**Verification:** All findings in the report have current Status columns. No finding says "NOT IMPLEMENTED" for something that has been implemented.

---

#### Task 1.3: Create System-Wide Test Strategy Document
**Priority:** P0-3 | **Effort:** 3 hours | **Owner:** QA/Backend

**Why:** All 1,698 lines of testing documentation cover the Settings feature only. There is no documentation for how the financial core (Money class, transfers, balances, concurrency) is tested. For a finance application, this is the single biggest documentation gap.

**Steps:**

1. Create `docs/testing/test-strategy.md` with this structure:

   **Section 1: Test Scope & Approach**
   - Define what's in scope: all 19 server modules, client components, API endpoints
   - Define test pyramid: unit → integration → e2e → manual
   - Define tools: Vitest (unit/integration), Playwright or Cypress (e2e), k6 (performance)

   **Section 2: Module Test Coverage Matrix**
   ```markdown
   | Module | Unit Tests | Integration Tests | E2E Tests | Coverage Target |
   |--------|-----------|-------------------|-----------|-----------------|
   | auth | ✅ Yes | ✅ Yes | ❌ No | 80% |
   | transactions | ✅ Yes | ❌ No | ❌ No | 90% |
   | goals | ✅ Yes | ❌ No | ❌ No | 90% |
   | budgets | ❌ No | ❌ No | ❌ No | 80% |
   | investments | ❌ No | ❌ No | ❌ No | 80% |
   | reports | ❌ No | ❌ No | ❌ No | 70% |
   | settings | ✅ Yes | ✅ Yes | ❌ No | 80% |
   | ... | ... | ... | ... | ... |
   ```
   Populate by running:
   ```bash
   # Find all test files
   find . -name "*.test.ts" -o -name "*.test.tsx" -o -name "*.spec.ts" | sort
   
   # Count tests per module
   grep -r "describe\|it(" server/modules/*/  --include="*.test.ts" -l
   ```

   **Section 3: Financial Core Test Requirements**
   - Money class precision: test arithmetic at boundary values (0.01, 999999999.99, negative amounts)
   - Transfer atomicity: test concurrent transfers to same goal don't double-spend
   - Balance consistency: test that account balance = sum of all transactions
   - Budget calculations: test rollover, category totals, period boundaries
   - Investment performance: test cost basis, returns calculations

   **Section 4: Security Test Requirements**
   - Reference auth-pentest-checklist.md for auth testing
   - Household isolation: test that user A cannot access user B's data
   - CSRF: test that state-changing requests without token are rejected
   - Rate limiting: test that limits are enforced (reference security review)
   - Input validation: test that Zod schemas reject malformed input

   **Section 5: Performance Test Targets**
   Map to SRS performance requirements:
   ```markdown
   | SRS Requirement | Target | Test Method |
   |-----------------|--------|-------------|
   | PERF-001 | List ops < 500ms (p95) | k6 load test |
   | PERF-002 | Single resource < 200ms (p95) | k6 load test |
   | PERF-003 | Report generation < 2s (1yr data) | k6 with seed data |
   | PERF-004 | 100 concurrent users | k6 ramping VUs |
   ```

   **Section 6: Test Environments**
   - Local: SQLite or PostgreSQL test database, no Redis
   - CI: PostgreSQL via Docker, test database per run
   - Staging: mirror production config

   **Section 7: Test Data Strategy**
   - Seed data scripts for each test scenario
   - Test database cleanup between runs
   - Factory functions for creating test entities

   **Section 8: Regression Test Policy**
   - All bug fixes must include regression test
   - Financial calculation bugs require property-based test
   - Security findings require automated verification test

2. Rename existing testing docs to clarify scope:
   ```bash
   mv docs/testing/testing-guide.md docs/testing/settings-testing-guide.md
   mv docs/testing/integration-testing.md docs/testing/settings-integration-testing.md
   mv docs/testing/changelog-integration-tests.md docs/testing/settings-test-changelog.md
   ```

3. Update any cross-references to the renamed files

**Verification:** `docs/testing/test-strategy.md` exists with all 8 sections. Module coverage matrix has entries for all 19 modules. Financial core test requirements are specific enough to write tests from.

---

### Phase 2: Traceability & Consolidation (Week 2)

#### Task 2.1: Update SRS for Post-January Features
**Priority:** P1-1 | **Effort:** 2 hours | **Owner:** Product/BA

**Why:** The SRS is the authoritative requirements reference (it says so in section 1.1). Features implemented after its last update (2026-01-13) break the traceability chain that makes the SRS valuable.

**Steps:**

1. Add MFA requirements to Section 3.1.1 (Authentication):
   ```markdown
   | AUTH-008 | System SHALL support TOTP-based multi-factor authentication | P1 |
   | AUTH-009 | System SHALL provide backup codes for MFA recovery | P1 |
   | AUTH-010 | System SHALL allow users to enable/disable MFA in settings | P1 |
   | AUTH-011 | System SHALL rate-limit MFA verification attempts (5/min) | P0 |
   ```

2. Add new Section 3.1.9 for Mental Health Module:
   ```markdown
   #### 3.1.9 Mental Health Screening Module
   
   | ID | Requirement | Priority |
   |----|-------------|----------|
   | MH-001 | System SHALL implement PHQ-9 depression screening questionnaire | P2 |
   | MH-002 | System SHALL calculate PHQ-9 severity scores per standard scoring | P2 |
   | MH-003 | System SHALL store screening results with date and score | P2 |
   | MH-004 | System SHALL provide score interpretation guidance | P2 |
   | MH-005 | System SHALL NOT use screening data for any automated decisions | P0 |
   ```

3. Update Section 3.1.7 (Investment Module) for sub-controllers and refactored architecture:
   ```markdown
   | INV-005 | System SHALL support investment transaction sub-types (buy, sell, dividend, interest, fee, split, transfer_in, transfer_out, coupon, maturity) | P1 |
   | INV-006 | System SHALL separate investment queries and mutations into sub-services | P1 |
   ```

4. Add notification requirements (Section 3.1.10 or expand existing):
   ```markdown
   | NOTIF-001 | System SHALL support configurable notification preferences per type | P1 |
   | NOTIF-002 | System SHALL support in-app, email, and push notification channels | P1 |
   | NOTIF-003 | System SHALL support quiet hours configuration | P2 |
   | NOTIF-004 | System SHALL generate weekly financial recap notifications | P2 |
   ```

5. Update version history:
   ```markdown
   | 3.0 | 2026-02-XX | Engineering | Added AUTH-008 to AUTH-011 (MFA), MH-001 to MH-005 (PHQ-9), 
   INV-005 to INV-006 (investment refactor), NOTIF-001 to NOTIF-004 (notifications) |
   ```

**Verification:** Every implemented feature can be traced back to an SRS requirement ID. Run a spot-check: search codebase for MFA-related files → verify each maps to AUTH-008 through AUTH-011.

---

#### Task 2.2: Consolidate Database Setup Documentation
**Priority:** P1-2 | **Effort:** 1.5 hours | **Owner:** DevOps

**Why:** Four documents cover the same 3-step process (run script → update .env → run db:push). A developer finding all four will not know which to follow, and maintaining four copies means they'll inevitably diverge.

**Steps:**

1. Create single canonical guide: `docs/setup/database-setup.md`
2. Structure:
   ```markdown
   # Database Setup
   
   ## Quick Start (3 Steps)
   [From database-readme.md — the clearest version]
   
   ## Detailed Instructions
   ### Option A: Local PostgreSQL (Windows)
   [From database-setup-steps.md steps 1-4]
   
   ### Option B: Local PostgreSQL (macOS/Linux)
   [New section — currently missing entirely]
   
   ### Option C: Cloud Database (Neon/Supabase)
   [From local-database-setup.md Option 2]
   
   ## What Gets Created
   [Table list from database-setup-steps.md]
   
   ## Database Management
   ### pgAdmin
   [From database-readme.md]
   
   ### Command Line
   [From database-readme.md]
   
   ### Backup & Restore
   [From database-readme.md Pro Tips]
   
   ## Troubleshooting
   [Consolidated from all 3 docs — deduplicated]
   
   ## Migration Guide
   [Reference docs/setup/migration-guide.md for legacy→modular migration]
   ```

3. Remove or redirect old files:
   - Delete `database-setup-steps.md` (content merged into consolidated doc)
   - Delete `local-database-setup.md` (content merged)
   - Redirect `database-readme.md` → "See docs/setup/database-setup.md"
   - Update `setup.md` to reference consolidated doc instead of duplicating steps

4. Update all cross-references in other docs (search for each old filename)

**Verification:** Only ONE document describes how to set up the database. `grep -r "database-setup-steps\|local-database-setup\|database-readme" docs/` returns only redirect notices.

---

#### Task 2.3: Create Root CHANGELOG.md
**Priority:** P1-3 | **Effort:** 45 minutes | **Owner:** Any developer

**Steps:**

1. Create `CHANGELOG.md` in project root following Keep a Changelog format:
   ```markdown
   # Changelog
   All notable changes to the Personal Finance App.
   Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
   
   ## [Unreleased]
   
   ## [0.X.0] - 2026-02-XX
   ### Added
   - Multi-factor authentication (TOTP + backup codes)
   - PHQ-9 mental health screening module
   - Investment sub-controllers (buy, sell, dividend, etc.)
   - Notification preferences and quiet hours
   - Weekly financial recap
   
   ### Changed
   - Investments module refactored into sub-services
   - Budget calculation fixes for rollover edge cases
   
   ### Fixed
   - Budget module calculation errors
   - Household controller LOC violation (814 → 114 LOC)
   
   ## [0.1.0] - 2026-01-13
   ### Added
   - Complete modular architecture (all 13 modules migrated from legacy routes)
   - Security review and remediation (Phase 0)
   - CSRF protection (double-submit cookie pattern)
   - Rate limiting across all endpoint tiers
   - Feature flag system for module switchover
   - Comprehensive IEEE-compliant documentation suite (SRS, SDD, BRD)
   - Zambia DPA compliance framework
   ```

2. Add to SDLC quality gates in `sdlc.md`:
   ```markdown
   - CHANGELOG updated for user-visible changes
   ```

**Verification:** `CHANGELOG.md` exists at project root with at least 2 version entries.

---

#### Task 2.4: Expand Risk Register
**Priority:** P1-4 | **Effort:** 1 hour | **Owner:** Security

**Why:** 6 risks for a finance app is insufficient. The security review report, threat model, and compliance docs all identify risks that aren't in the register.

**Steps:**

Add risks from existing documentation that aren't captured:

```markdown
| R-007 | Floating-point calculation errors | Critical | Low | Money class (decimal.js) | Backend | Mitigated |
| R-008 | Concurrent transaction race conditions | Critical | Medium | FOR UPDATE row locking | Backend | Mitigated |
| R-009 | Dependency CVEs (qs/express) | High | High | npm audit + Dependabot | DevOps | Open |
| R-010 | ODPC registration deadline miss | High | Medium | Registration by April 2025 | Legal | Open |
| R-011 | MFA code leakage in logs | High | Low | Logger redaction rules | Backend | Mitigating |
| R-012 | Secrets exposed in documentation | Critical | Medium | Pre-commit hooks + rotation | DevOps | Open |
| R-013 | Stale security documentation | Medium | High | Quarterly review cadence | Security | Open |
| R-014 | No automated test coverage for financial core | High | High | Test strategy implementation | QA | Open |
| R-015 | Rate limit bypass via X-Forwarded-For | High | Medium | trust proxy configuration | Backend | Open |
| R-016 | Backup/restore not tested | Medium | Medium | Bi-annual restore tests | Ops | Open |
| R-017 | Missing data subject request workflow | Medium | Medium | GDPR/DPA DSR implementation | Product | Open |
| R-018 | Incomplete accessibility compliance | Medium | Medium | WCAG audit completion | Frontend | Open |
```

**Verification:** Risk register has 15+ entries. Every HIGH finding from security-review-report.md has a corresponding risk entry.

---

### Phase 3: Depth Improvements (Weeks 3-4)

#### Task 3.1: Expand System Overview to 200+ Lines
**Priority:** P2-1 | **Effort:** 2 hours | **Owner:** Tech Lead

**Current state:** 61 lines listing capabilities. **Target:** 200+ lines with:

1. **User journey narratives** (not just capability lists):
   - New user: Registration → household creation → first account → first transaction → first budget → first report
   - Returning user: Login → dashboard → check budgets → review transactions → export report
   - Household member: Invitation → join → view shared accounts → add transactions

2. **Module dependency map:**
   ```mermaid
   flowchart TD
     Auth --> Sessions
     Transactions --> Accounts
     Transactions --> Categories
     Transactions --> Merchants
     Transactions --> Rules
     Budgets --> Categories
     Budgets --> Transactions
     Goals --> Accounts
     Reports --> Transactions
     Reports --> Accounts
     Reports --> Budgets
     Investments --> Accounts
     Receipts --> Transactions
     Notifications --> Goals
     Notifications --> Budgets
   ```

3. **Performance characteristics:** Response times, concurrent user capacity, data volume expectations

4. **Deployment topology:** Single-instance vs. multi-instance with Redis

---

#### Task 3.2: Expand Architecture Doc to 150+ Lines
**Priority:** P2-1 | **Effort:** 2 hours | **Owner:** Tech Lead

**Current state:** 49 lines with one Mermaid diagram. **Target:** 150+ lines adding:

1. **Request lifecycle** — Trace a transaction creation from HTTP request through controller → service → repository → database → audit log → response
2. **Error handling philosophy** — How errors propagate through layers, what gets logged, what reaches the client
3. **Caching strategy** — When Redis is used, cache invalidation rules, cache-aside vs. write-through
4. **Background jobs** — What runs, when, how failures are handled
5. **Cross-cutting concerns** — How audit logging, household isolation, and validation work across modules

---

#### Task 3.3: Expand Deployment Doc to 100+ Lines
**Priority:** P2-1 | **Effort:** 2 hours | **Owner:** DevOps

**Current state:** 31 lines. **Target:** 100+ lines adding:

1. **Docker setup** — Dockerfile, docker-compose.yml for local dev
2. **CI/CD pipeline** — What runs on PR, what runs on merge to main
3. **Environment configuration** — Complete env var reference (required vs. optional)
4. **Scaling considerations** — When to add Redis, when to consider horizontal scaling
5. **Backup/restore procedures** — Step-by-step database backup, restore, and verification
6. **Rollback procedures** — How to roll back a deployment, database migration rollback

---

#### Task 3.4: Flesh Out Policy Documents
**Priority:** P2-2 | **Effort:** 3 hours total | **Owner:** Security/Compliance

Each policy needs expansion from ~35 lines to ~100+ lines:

**access-control-policy.md** — Add:
- Specific role definitions (Owner, Admin, Member, Viewer) with permission matrices
- Access review procedure (who reviews, how often, what's checked)
- Provisioning/deprovisioning workflow for household members
- Emergency access procedures

**business-continuity-disaster-recovery.md** — Add:
- Specific recovery procedures (not just "daily backups" — actual commands)
- Contact tree for incidents
- Test results from restore tests (currently says "at least twice per year" but no results)
- Infrastructure dependencies and failover

**data-retention-policy.md** — Add:
- Specific retention schedules per data class (not just "guidelines"):
  ```markdown
  | Data Class | Retention Period | Deletion Method | Legal Basis |
  |-----------|-----------------|-----------------|-------------|
  | Financial transactions | 7 years from creation | Soft delete → hard delete after hold | Tax/audit requirements |
  | Audit logs | 7 years | Automatic archival | Compliance |
  | Session data | 30 days after expiry | Automatic purge | No legal requirement |
  | Profile data | Account lifetime + 90 days | User-initiated deletion | DPA 2021 |
  | Uploaded receipts | Account lifetime | Cascade with account deletion | User data |
  ```
- Data subject request (DSR) workflow
- Deletion verification procedure

**sdlc.md** — Add:
- Specific quality gates per phase (not just "TypeScript checks" — what's the threshold?)
- Code review requirements
- Security review triggers (when does a feature need threat modeling?)
- Documentation update requirements per change type

---

#### Task 3.5: Fill Incident Response Templates
**Priority:** P2-3 | **Effort:** 1 hour | **Owner:** Security | **Status:** Complete (2026-02-06)

Templates and role assignments have been added to `docs/security/incident-response.md`, and regulatory guidance is captured in `docs/compliance/breach-notification.md`.

---

#### Task 3.6: Create 5+ ADRs
**Priority:** P2-4 | **Effort:** 2 hours | **Owner:** Tech Lead

Create `docs/adr/` directory with template and initial ADRs:

**ADR template:**
```markdown
# ADR-XXX: [Title]
**Date:** YYYY-MM-DD
**Status:** Accepted | Superseded | Deprecated

## Context
[What is the issue? What forces are at play?]

## Decision
[What is the change? What was chosen?]

## Consequences
[What are the positive and negative outcomes?]
```

**Priority ADRs to write:**

| ADR | Title | Key rationale to capture |
|-----|-------|------------------------|
| ADR-001 | Layered monolith architecture | Why not microservices. Maintainability for small team. Module boundaries for future extraction. |
| ADR-002 | PostgreSQL with Drizzle ORM | Why not Prisma/TypeORM. Type safety, migration approach, schema-as-code. |
| ADR-003 | Session authentication over JWT | Why sessions for a finance app. Server-side revocation, no token refresh complexity. |
| ADR-004 | Money class for currency precision | Why decimal.js. Floating-point risks in finance. Why not database-only precision. |
| ADR-005 | FOR UPDATE locking for concurrency | Why pessimistic locking. Double-spend prevention. Why not optimistic locking. |
| ADR-006 | Feature flag migration strategy | Why gradual migration. Rollback safety. Why flags were removed post-cutover. |
| ADR-007 | Household model for multi-tenancy | Why not user-level isolation. Shared finances use case. Row-level security approach. |
| ADR-008 | PHQ-9 mental health screening inclusion | Why include health screening in a finance app. Financial stress correlation. Ethical guardrails. |

---

#### Task 3.7: Create Data Dictionary
**Priority:** P2-5 | **Effort:** 2 hours | **Owner:** Backend

Create `docs/data/data-dictionary.md`:

Structure for each entity:
```markdown
## accounts

| Field | Type | Nullable | Default | Description |
|-------|------|----------|---------|-------------|
| id | uuid | No | gen_random_uuid() | Primary key |
| householdId | uuid | No | - | FK to households.id |
| name | varchar(255) | No | - | User-defined account name |
| type | enum | No | - | checking, savings, credit, loan, investment, cash, mobile_money |
| balance | decimal(15,2) | No | 0.00 | Current balance (updated atomically) |
| currency | varchar(3) | No | 'ZMW' | ISO 4217 currency code |
| isHidden | boolean | No | false | Visibility flag |
| deletedAt | timestamp | Yes | null | Soft delete marker |
| createdAt | timestamp | No | now() | Creation timestamp |
| updatedAt | timestamp | No | now() | Last update timestamp |

**Relationships:**
- belongs to household (householdId → households.id)
- has many transactions
- has many holdings (investment accounts)
- can be assigned to goals
```

Repeat for all core entities: users, transactions, categories, merchants, goals, budgets, holdings, securities, rules, audit_logs, sessions, households, household_members, notifications, receipts.

Generate initial version from schema:
```bash
# Extract table definitions from shared/schema.ts
grep -A 30 "export const" shared/schema.ts
```

---

### Phase 4: Quality of Life & Consistency (Month 2)

#### Task 4.1: Standardize File Naming
**Priority:** P2-6 | **Effort:** 1 hour

Adopt kebab-case as the standard. Rename:
```bash
# Files with spaces (breaks CLI tools)
mv "analytics-reporting-architecture.md" analytics-reporting-architecture.md
mv "analytics-architecture-amendments.md" analytics-architecture-amendments.md

# SCREAMING_SNAKE → kebab-case (optional but recommended)
# Keep SCREAMING_SNAKE for major standalone docs (security.md, CHANGELOG.md, README.md)
# Use kebab-case for everything else
```

Add naming convention to a `docs/CONTRIBUTING.md`:
```markdown
## File Naming
- Use kebab-case for all doc files: `my-document.md`
- Exception: Top-level project files (README.md, CHANGELOG.md, security.md)
- Never use spaces in filenames
```

#### Task 4.2: Rename Misleading Testing Docs
**Priority:** P2-7 | **Effort:** 15 minutes

```bash
mv docs/testing/testing-guide.md docs/testing/settings-testing-guide.md
mv docs/testing/integration-testing.md docs/testing/settings-integration-testing.md
mv docs/testing/changelog-integration-tests.md docs/testing/settings-test-changelog.md
```

Update cross-references.

#### Task 4.3: Create Developer Onboarding Guide
**Priority:** P2 | **Effort:** 2 hours

Create `docs/DEVELOPER_GUIDE.md` — a single entry point for new developers:
```markdown
# Developer Guide

## Prerequisites
- Node.js 20+
- PostgreSQL 15+
- npm 9+

## Setup
1. Clone repository
2. `npm install`
3. Database setup: See docs/setup/database-setup.md
4. Copy `.env.example` to `.env` and configure
5. `npm run db:push`
6. `npm run dev`

## Architecture
- Overview: docs/system/overview.md
- Architecture: docs/system/architecture.md
- Module patterns: docs/module-patterns.md

## Key Conventions
- 3-layer architecture: Controller → Service → Repository
- Money class for all currency math (never use parseFloat)
- FOR UPDATE locking for concurrent financial operations
- Household isolation on all queries

## Common Tasks
- Adding a new module: Follow module-patterns.md
- Adding a new API endpoint: See docs/api/README.md
- Database migration: `npm run db:push`
- Running tests: `npm test`

## Documentation
- Specifications: docs/specifications/
- Security: docs/security/
- Testing: docs/testing/
```

#### Task 4.4: Create Operational Runbooks
**Priority:** P3 | **Effort:** 4 hours

Create `docs/operations/` directory with:
- `database-maintenance.md` — Vacuum, reindex, connection monitoring
- `backup-restore.md` — Step-by-step backup, restore, and verification
- `incident-playbook.md` — Specific scenarios (DB down, high error rate, suspected breach)
- `monitoring-dashboard.md` — What to watch, thresholds, escalation

---

## 6. Implementation Timeline

```
Week 1 (P0 + P1 Quick Wins)
├── Day 1-2: Task 1.1 — Rotate secrets, add pre-commit hooks
├── Day 2-3: Task 1.2 — Update security review report
├── Day 3-5: Task 1.3 — Write test strategy document
├── Day 5:   Task 2.3 — Create CHANGELOG.md
└── Day 5:   Task 4.2 — Rename misleading testing docs

Week 2 (P1 Consolidation)
├── Day 1-2: Task 2.1 — Update SRS for MFA, PHQ-9, investments, notifications
├── Day 2-3: Task 2.2 — Consolidate 4 DB setup docs into 1
└── Day 4-5: Task 2.4 — Expand risk register to 15+ entries

Weeks 3-4 (P2 Depth)
├── Task 3.1 — Expand overview.md (2 hrs)
├── Task 3.2 — Expand architecture.md (2 hrs)
├── Task 3.3 — Expand deployment.md (2 hrs)
├── Task 3.4 — Flesh out policy docs (3 hrs)
├── Task 3.5 — Fill incident response templates (1 hr)
├── Task 3.6 — Create 5+ ADRs (2 hrs)
└── Task 3.7 — Create data dictionary (2 hrs)

Month 2 (P2-P3 Quality)
├── Task 4.1 — Standardize file naming (1 hr)
├── Task 4.3 — Developer onboarding guide (2 hrs)
└── Task 4.4 — Operational runbooks (4 hrs)
```

**Total estimated effort: ~38 hours across 6 weeks**

---

## 7. Summary

**What's genuinely excellent (don't touch):**
The specification layer (SRS + SDD + BRD + User Stories + Use Cases + Analytics Architecture = 5,253 lines) is enterprise-grade. The security documentation suite (security review + pentest checklist + secrets rotation + threat model + incident response = 1,448 lines) is mature and actionable. The IEEE compliance, Zambia DPA integration, and financial precision documentation (Money class, FOR UPDATE locking) are above what most production fintech projects achieve.

**What needs work (prioritized above):**
- P0: Rotate exposed secrets, update stale security report, create test strategy
- P1: Update SRS, consolidate DB docs, add CHANGELOG, expand risk register
- P2: Expand shallow system docs, flesh out policies, write ADRs, create data dictionary
- P3: Developer guide, file naming, operational runbooks

**The path from B+ to A:** The specs and security docs are already A-grade. The gap is in operational documentation (thin system docs, missing test strategy, fragmented setup docs, skeleton policies). Closing these gaps is execution work, not redesign — the foundations are strong.

---

## 8. Post-Update Verification (2026-02-06)

### Completed Since v3 Draft

- Closed settings integration scaffold gap with active passing suite (6/6): `server/modules/settings/__tests__/settings.integration.test.ts`
- Closed investments tax-lot test gap with active passing suite (4/4): `server/routes/__tests__/investments.test.ts`
- Updated module status docs to remove stale deferred markers for settings/investments and removed dashboard commit-reference TBD placeholders.
- System-wide test strategy created: `docs/testing/test-strategy.md`
- Settings testing docs renamed for clarity: `docs/testing/settings-testing-guide.md`, `docs/testing/settings-integration-testing.md`, `docs/testing/settings-test-changelog.md`
- Security review updated with CSRF fix and P0 remediations: `docs/security/security-review-report.md` (updated 2026-02-06)
- Risk register expanded to 19 entries: `docs/security/risk-register.md`
- CHANGELOG created at project root: `CHANGELOG.md`
- ADRs created: `docs/decisions/adr-001-session-auth.md` through `adr-005-csrf-double-submit.md`
- Developer onboarding guide created: `docs/setup/developer-onboarding.md`
- Gitleaks configuration added: `.gitleaks.toml`
- System overview, architecture, and deployment docs expanded (200+ lines each): `docs/system/overview.md`, `docs/system/architecture.md`, `docs/system/deployment.md`
- Data dictionary created: `docs/specifications/data-dictionary.md`
- Policy docs expanded with operational detail: `docs/policies/access-control-policy.md`, `docs/policies/logging-audit-policy.md`, `docs/policies/data-retention-policy.md`, `docs/policies/business-continuity-disaster-recovery.md`, `docs/policies/secure-sdlc-policy.md`, `docs/policies/vendor-management-policy.md`
- Incident response templates and roles completed: `docs/security/incident-response.md`
- Breach notification process documented: `docs/compliance/breach-notification.md`
- Accessibility audit updated with baseline checks and test plan: `docs/accessibility/accessibility-audit.md`
- OpenAPI contract improved with CSRF endpoint and auth schemas: `docs/api/openapi.yaml`
- Security settings API documented: `docs/api/security-api.md`
- Docs structure normalized (kebab-case, root cleanup, broken links fixed) and modules index added: `docs/README.md`, `docs/modules/README.md`
- Legacy DB setup docs archived under `docs/setup/legacy/` with canonical guide in `docs/setup/database-setup.md`
- SRS updated to reflect MFA, recurring, settings, and data retention requirements (PHQ-9 removed from scope): `docs/specifications/srs.md`

### Still Incomplete / Needs Follow-Up

- SRS still needs updates for investments refactor and any remaining spec gaps.
- Accessibility manual testing and automated scans still pending; update `docs/accessibility/accessibility-audit.md` with results.
- Data dictionary discoverability could be improved by adding a dedicated `docs/data/` index.
- Consider deleting or fully deprecating legacy DB setup docs after a sunset period to avoid drift.

### Structure Update (Docs Root)

All documentation now lives in category folders under `docs/` (root contains only `docs/README.md`).

### Accuracy Corrections to v3 Findings

- P0-2 "security review stale" is resolved. Security review updated 2026-02-06 with CSRF implemented.
- P0-3 "no system-wide test strategy" is resolved. `docs/testing/test-strategy.md` exists.
- P1-2 "overlapping database setup docs" is partially resolved. Legacy docs moved to `docs/setup/legacy/` and canonical guide is `docs/setup/database-setup.md`.
- P1-4 "risk register too thin" is resolved. Risk register expanded to 19 entries.
- P1-1 "SRS not updated for recent features" is partially resolved. MFA and core module gaps updated; investments refactor still pending.
- P2-2 "policy docs are skeletons" is resolved. Policies expanded with operational detail.
- P2-3 "incident response templates missing" is resolved. Templates and roles added in `docs/security/incident-response.md`.
- P2-4 "only 1 ADR exists" is resolved. Five ADRs now exist in `docs/decisions/`.
- P2-6 "file naming inconsistent" is largely resolved. Docs now use kebab-case and live in folders under `docs/`.
- P2-7 "testing docs misnamed" is resolved. Settings testing docs renamed and clarified.
- P0-1 "secrets exposed in security-remediation.md" requires history verification. Current `docs/security/security-remediation.md` uses placeholders and warns against committing secrets, but git history still needs verification.
