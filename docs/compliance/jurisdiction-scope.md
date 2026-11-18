# Jurisdiction and Regulatory Scope

## Purpose

Provide a standard method to decide which regulatory frameworks apply based on where you operate and what data you process.

## Recommended Baseline (Industry Standard)

Apply regardless of region:

- ISO 27001/27002 for security management
- SOC 2 (Security, Availability, Confidentiality, Privacy)
- OWASP ASVS L2 and OWASP API Security Top 10
- NIST CSF 2.0 for security program maturity

## Jurisdiction Triggers

| Trigger | Add-On Requirements |
| --- | --- |
| EU or UK customers | GDPR / UK GDPR, lawful basis, DPIA, DSR process |
| Cardholder data | PCI DSS |
| Payment initiation or account access in EU | PSD2 + Strong Customer Authentication |
| US financial institution or consumer data | GLBA + state privacy laws |
| Singapore operations | MAS TRM |

## Fintech Considerations

- If operating under a regulated financial institution, add local regulator requirements
- If aggregating bank data, apply open-banking security requirements
- If storing sensitive financial data, enforce strong encryption and access controls

## Recommendation for This Product

- Adopt the baseline set above
- Add jurisdictional requirements only when you operate in that region
- If unsure, start with GDPR-style privacy controls and SOC 2 evidence collection
