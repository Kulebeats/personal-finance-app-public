# Standards Alignment

This document provides alignment notes for common 2025 security and fintech standards. It is not a certification or audit.

## Recommended Standards Set

- ISO 27001/27002: ISMS and control baseline
- ISO 27005: risk management
- ISO 22301: business continuity
- ISO 27701: privacy information management
- SOC 2 (Security, Availability, Confidentiality, Privacy)
- OWASP ASVS v4.0.3 (Level 2)
- OWASP API Security Top 10
- NIST CSF 2.0 (Identify, Protect, Detect, Respond, Recover)

## Fintech Conditional Standards

Apply only if in scope:

- PCI DSS: if processing, storing, or transmitting cardholder data
- PSD2/SCA: if operating in the EU with payment initiation or account access
- GDPR: if processing EU personal data
- GLBA: if operating in the US with financial data
- MAS TRM: if operating in Singapore
- FCA/FFIEC: if operating under UK/US regulated financial institutions

## Alignment Notes (Snapshot)

- Identity and Access: session-based auth, role checks, household guards
- Data Protection: httpOnly cookies, CSRF defense, input validation
- Security Logging: structured logging, no response body logging
- Rate Limiting: auth and API throttling
- Privacy: documented data classes and retention recommendations

## Control Mapping (High Level)

| Standard | Control Area | Current Evidence | Gaps |
| --- | --- | --- | --- |
| ISO 27001 A.5-A.8 | Governance, assets, access control | Security architecture + access control docs | Formal policies and evidence |
| ISO 27005 | Risk management | Risk register + threat model | Risk ownership cadence |
| ISO 22301 | BC/DR | Deployment doc, backups recommended | Formal BCP plan |
| ISO 27701 | Privacy | Data privacy doc | DPIA and retention schedule |
| SOC 2 | Security, availability | Logging, rate limiting, auth | Formal control testing |
| OWASP ASVS L2 | App security | CSRF, headers, validation | Full requirement traceability |
| OWASP API Top 10 | API security | Auth, validation, rate limiting | Formal API security tests |
| NIST CSF 2.0 | Functions | Logs, IR doc, risk register | Metrics and KPIs |

## Next Steps

- Decide target jurisdictions and regulator expectations
- Formalize policies: access, change, incident response, data retention
- Add evidence artifacts: logs, test results, approvals, audit trails
