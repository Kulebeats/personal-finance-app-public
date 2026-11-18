# Data Privacy

## Scope

This document describes what data the app stores, where it lives, how it is protected, and how requests for data access or deletion are handled.

## Data Categories

- Account identity: username, email, password hash
- Profile data: name, contact numbers, address, birthday, profile images
- Financial data: accounts, transactions, budgets, goals, recurring rules
- Household data: memberships, roles, preferences
- Device and session data: session tokens, login history, IP address, user agent metadata
- Reports and analytics outputs: aggregated summaries and exports

## Data Sources

- User-provided data via the web client
- System-generated data such as audit and analytics records

## Storage Locations

- PostgreSQL database for primary data
- Optional Redis cache for analytics (enabled via `REDIS_URL`)
- Local file storage for uploads in `uploads/`

## Access Controls

- Authentication required for protected routes
- Household membership enforced via `householdGuard`
- Role checks for privileged actions

## Security Controls

- Passwords hashed with bcrypt
- Session cookies are HTTP-only with `sameSite=lax` and secure in production
- Structured logs redact sensitive fields

## Data Retention

- Retention is defined in `docs/policies/data-retention-policy.md`
- Backups follow the same retention windows

## Data Subject Requests (DSR)

1. Intake: user submits request via support or privacy email
2. Verification: confirm identity before processing
3. Fulfillment: export, correction, or deletion as requested
4. Completion: notify user and log the request

Target response time is 30 days or less.

## Data Export and Deletion

- CSV export is available via `/api/reports/export` for supported reports
- Full data portability is supported via export endpoints
- Account deletion triggers soft delete, then hard delete after retention period

## DPIA Triggers

A DPIA is required when changes introduce:

- New sensitive data categories
- Large scale processing of financial records
- Automated profiling or scoring with user impact
- Third-party processing of sensitive data

## Privacy Contact

- Email: privacy@yourdomain.example

## Related Docs

- `docs/policies/data-retention-policy.md`
- `docs/compliance/compliance.md`
- `docs/compliance/breach-notification.md`
