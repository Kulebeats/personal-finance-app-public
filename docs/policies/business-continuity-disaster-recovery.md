# Business Continuity and Disaster Recovery

## Purpose

Ensure service recovery and data protection during outages or disasters.

## Scope

- Production application services
- Databases, caches, and file storage
- Third-party dependencies

## Recovery Targets

- RTO (Recovery Time Objective): 24 hours
- RPO (Recovery Point Objective): 4 hours

## Critical Dependencies

- PostgreSQL database
- Optional Redis cache
- SMTP provider
- Hosting provider and CDN

## Backup Strategy

- Daily database backups
- Weekly full backups with integrity checks
- Uploads backed up with database snapshots
- Backups encrypted at rest and in transit

## Restoration Procedure

1. Declare incident and start incident log.
2. Identify last known good backup.
3. Restore database to staging and run validation checks.
4. Promote restored database to production.
5. Verify core user workflows and audit logs.

## Validation Checks

- Run health checks and verify API readiness
- Compare row counts for critical tables
- Validate authentication and household access
- Verify audit logging and exports

## Communication Plan

- Notify internal stakeholders within 1 hour
- Provide status updates every 4 hours during outage
- Publish post-incident report within 5 business days

## Testing

- Restore tests at least twice per year
- Record test results, timing, and gaps
- Update runbooks after each test

## Review Cadence

- Annual review or after major infrastructure changes
