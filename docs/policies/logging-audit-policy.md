# Logging and Audit Policy

## Purpose

Define required audit events, log handling, retention, and access controls.

## Scope

- Application logs (server and client)
- Security and audit logs
- Database and infrastructure logs
- Export and reporting logs

## Required Audit Events

- Authentication success and failure
- MFA enable, disable, and step-up events
- Session creation and revocation
- Role changes and household membership changes
- Password and email changes
- Data export requests and downloads
- High-risk administrative actions
- Configuration and feature-flag changes

## Required Log Fields

- Timestamp (UTC)
- Request ID
- User ID (hashed or truncated)
- Household ID
- Endpoint and method
- Result status (success or failure)
- Source IP and user agent (if available)

## PII and Secret Handling

- Do not log passwords, MFA codes, tokens, or secrets
- Redact sensitive fields in structured logs
- Mask emails and identifiers where possible
- Avoid logging full payloads for financial data

## Retention

- Security and audit logs retained for 7 years
- Application logs retained for 90 days hot, 1 year cold
- Export logs retained for 7 years
- Log retention follows `docs/policies/data-retention-policy.md`

## Access Controls

- Logs are restricted to security and operations roles
- Use break-glass access for emergency log review
- All log access is itself logged

## Monitoring and Alerts

- Alert on elevated auth failures and MFA failures
- Alert on rate-limit spikes or repeated 401 and 403 responses
- Alert on export volume anomalies
- Alert on 5xx error rate and latency regression

## Export Audit Trail

- Log export requests with user, time, and report parameters
- Do not store raw exported data unless required
- Use the schema in `docs/security/export-audit-logging-spec.md`

## Review Cadence

- Quarterly review of logging coverage
- Annual review of retention thresholds
