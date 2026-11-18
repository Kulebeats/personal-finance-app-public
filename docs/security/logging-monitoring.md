# Logging and Monitoring

## Logging Principles
- Structured JSON logs with consistent fields
- Log request metadata only, not full payloads
- Redact PII and secrets before logging
- Use request IDs for correlation
- No access tokens or session identifiers in logs

## What Is Logged
- API method, path, status, duration, requestId
- Authentication successes and failures
- MFA enrollment, verification, and lockout events
- Rate limit violations and abuse signals
- System errors and exceptions
- Export events and sensitive data access

## Audit Logging
- Financial mutations logged via BusinessAuditService
- Export audit events per `docs/security/export-audit-logging-spec.md`
- Authentication events recorded for forensic review

## Monitoring
- Health checks: /healthz and /health/ready
- Error rate and latency (P50/P95/P99)
- Database connectivity and migration status
- Queue depth and OCR processing failures
- External provider failures (email, AI, OCR)

## Alerting Recommendations
- Error rate spike > 2% for 5 minutes
- P95 latency > 5 seconds for 10 minutes
- Repeated 401/403/429 spikes
- Unusual upload or export volumes
- Repeated CSRF failures

## Retention
- Audit logs retained for 7 years
- Login history retained for 12 months
- Export files purged after 30 days
- Application logs retained per ops policy (minimum 90 days)
