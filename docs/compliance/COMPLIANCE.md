# Compliance Mapping

## Purpose

This document tracks compliance readiness for common fintech frameworks. It is not a certification or audit.

## Assumptions

- The app does not store or process payment card data
- The app does not initiate payments on behalf of users
- The app is not operating as a regulated production service yet

If any assumption changes, update this mapping and the jurisdiction scope.

## Baseline Standards

- ISO 27001/27002
- SOC 2 (Security, Availability, Confidentiality, Privacy)
- OWASP ASVS L2 and OWASP API Top 10
- NIST CSF 2.0

## Policy Coverage

- Access Control Policy: `docs/policies/access-control-policy.md`
- Logging and Audit Policy: `docs/policies/logging-audit-policy.md`
- Data Retention Policy: `docs/policies/data-retention-policy.md`
- Secure SDLC Policy: `docs/policies/secure-sdlc-policy.md`
- Business Continuity and DR: `docs/policies/business-continuity-disaster-recovery.md`
- Vendor Management: `docs/policies/vendor-management-policy.md`
- Incident Response: `docs/security/incident-response.md`
- Data Privacy: `docs/compliance/data-privacy.md`

## Framework Status

| Framework | Scope | Status | Notes |
| --- | --- | --- | --- |
| PCI DSS | Cardholder data environment | Not in scope | Applies if card data is stored or processed |
| GDPR | EU personal data processing | Partial | Policies exist; evidence gaps remain |
| PSD2 | Payment initiation and account access | Not in scope | Applies if regulated payment services are added |
| SOC 2 | Security and availability | Partial | Policies exist; control evidence needed |
| ISO 27001 | ISMS baseline | Partial | Formal ISMS and evidence needed |

## Evidence Gaps and Next Steps

- Implement DSR workflow tracking and evidence
- Run backup and restore tests and record results
- Maintain vendor inventory and risk ratings
- Complete accessibility audit with results
- Establish quarterly access reviews and retain evidence

## Review Cadence

- Quarterly review for evidence updates
- Annual review for framework alignment
