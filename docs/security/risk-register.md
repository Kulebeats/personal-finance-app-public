# Risk Register

## Personal Finance Application

**Last Updated:** 2026-02-06  
**Review Cadence:** Quarterly or after major releases

---

## Risk Matrix

| Likelihood ↓ / Impact → | Low | Medium | High | Critical |
| ----------------------- | --- | ------ | ---- | -------- |
| **High**                | P3  | P2     | P1   | P0       |
| **Medium**              | P4  | P3     | P2   | P1       |
| **Low**                 | P5  | P4     | P3   | P2       |

---

## Active Risks

### Security Risks

| ID      | Risk                          | Impact   | Likelihood | Mitigation                                                | Owner    | Status      | Priority |
| ------- | ----------------------------- | -------- | ---------- | --------------------------------------------------------- | -------- | ----------- | -------- |
| SEC-001 | Cross-household data exposure | Critical | Low        | Household guard, role checks, property tests              | Backend  | Mitigated   | P2       |
| SEC-002 | Session hijacking             | High     | Low        | HttpOnly cookies, secure flag, CSRF, session regeneration | Backend  | Mitigated   | P3       |
| SEC-003 | CSRF attacks                  | High     | Medium     | Double-submit cookie (csrf-csrf)                          | Backend  | ✅ Resolved | -        |
| SEC-004 | Rate limit bypass             | Medium   | Low        | Trust proxy configuration                                 | Backend  | ✅ Resolved | -        |
| SEC-005 | MFA code brute force          | High     | Medium     | Rate limiting (5/min), code expiry (10 min)               | Backend  | Mitigated   | P2       |
| SEC-006 | SQL injection                 | Critical | Low        | Drizzle ORM parameterized queries, Zod validation         | Backend  | Mitigated   | P2       |
| SEC-007 | secrets in git history        | Critical | Medium     | Gitleaks pre-commit, secrets rotated                      | Security | Mitigated   | P1       |

### Data Risks

| ID      | Risk                    | Impact | Likelihood | Mitigation                                 | Owner   | Status    | Priority |
| ------- | ----------------------- | ------ | ---------- | ------------------------------------------ | ------- | --------- | -------- |
| DAT-001 | CSV export leakage      | Medium | Medium     | Access controls, audit logging             | Product | Open      | P3       |
| DAT-002 | Upload malware          | Medium | Medium     | File type validation, size limits          | Backend | Mitigated | P3       |
| DAT-003 | Missing backup strategy | High   | Medium     | Cloud provider backups, documented restore | Ops     | Open      | P2       |
| DAT-004 | PII in logs             | High   | Low        | Structured logging with PII redaction      | Backend | Mitigated | P3       |
| DAT-005 | Orphaned uploads        | Low    | High       | Cleanup job for unlinked files             | Backend | Open      | P4       |

### Operational Risks

| ID      | Risk                          | Impact   | Likelihood | Mitigation                                | Owner    | Status    | Priority |
| ------- | ----------------------------- | -------- | ---------- | ----------------------------------------- | -------- | --------- | -------- |
| OPS-001 | Database unavailable          | Critical | Low        | Connection retry, health checks, failover | Ops      | Mitigated | P2       |
| OPS-002 | Deployment breaks production  | High     | Medium     | CI/CD pipeline, staging environment       | DevOps   | Mitigated | P2       |
| OPS-003 | No incident response plan     | Medium   | Medium     | Create runbooks (in progress)             | Security | Open      | P3       |
| OPS-004 | Single point of failure (dev) | High     | Medium     | Documentation, bus factor reduction       | Mgmt     | Open      | P2       |

### Compliance Risks

| ID      | Risk                      | Impact | Likelihood | Mitigation                          | Owner   | Status    | Priority |
| ------- | ------------------------- | ------ | ---------- | ----------------------------------- | ------- | --------- | -------- |
| CMP-001 | Zambia DPA non-compliance | High   | Low        | DPA compliance framework documented | Legal   | Mitigated | P3       |
| CMP-002 | Inadequate data retention | Medium | Medium     | Retention policy documented         | Legal   | Mitigated | P3       |
| CMP-003 | Missing consent tracking  | Medium | Low        | Consent fields in user registration | Product | Mitigated | P4       |

---

## Resolved Risks

| ID      | Risk              | Resolution Date | Resolution                                  |
| ------- | ----------------- | --------------- | ------------------------------------------- |
| SEC-003 | CSRF attacks      | 2026-01-27      | Implemented csrf-csrf double-submit pattern |
| SEC-004 | Rate limit bypass | 2026-01-27      | Configured trust proxy                      |
| SEC-007 | Secrets in git    | 2026-02-06      | Rotated all exposed secrets, added gitleaks |

---

## Risk Response Strategies

| Strategy     | When to Use                 | Example                         |
| ------------ | --------------------------- | ------------------------------- |
| **Mitigate** | Reduce likelihood or impact | Add validation, access controls |
| **Accept**   | Low impact, low likelihood  | Minor UX issues                 |
| **Transfer** | Can shift to third party    | Cloud provider handles backups  |
| **Avoid**    | Eliminate functionality     | Remove risky feature            |

---

## Review History

| Date       | Reviewer      | Changes                                                   |
| ---------- | ------------- | --------------------------------------------------------- |
| 2026-01-13 | Security Team | Initial risk register                                     |
| 2026-02-06 | Audit Review  | Added operational/compliance risks, marked resolved items |

---

_Next review: 2026-05-06 (Q2)_
