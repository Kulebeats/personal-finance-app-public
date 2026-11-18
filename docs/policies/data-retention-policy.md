# Data Retention Policy

## Purpose

Define retention and deletion rules for customer data, logs, and operational records.

## Scope

- User profile and account data
- Financial records and analytics
- Security and audit logs
- Uploaded files and exports
- Support and operational records

## Retention Schedule

| Data Class | Retention Period | Deletion Method | Legal Basis |
| --- | --- | --- | --- |
| Financial transactions | 7 years from creation | Soft delete, then hard delete after retention | Tax and audit requirements |
| Accounts and balances | Account lifetime + 90 days | Soft delete, then hard delete | User service history |
| Budgets, goals, rules | Account lifetime + 90 days | Hard delete after retention | User service history |
| Audit logs | 7 years | Archive then hard delete | Compliance and security |
| Login history | 12 months | Hard delete after retention | Security monitoring |
| Sessions | 30 days after expiry | Automatic purge | Security hygiene |
| Exports (files) | 30 days | Automatic purge | Data minimization |
| Uploaded receipts | Account lifetime + 90 days | Cascade delete | User data |
| Support tickets | 2 years | Archive then delete | Operational record |
| System metrics | 12 months | Roll-up to aggregates | Performance monitoring |

## Deletion Workflow

1. User requests account deletion or data erasure.
2. Identity is verified and request is logged.
3. Data is soft-deleted immediately where applicable.
4. Hard deletion occurs after retention period or legal hold clearance.
5. Deletion completion is recorded in audit logs.

## Legal Holds

- Legal holds override deletion schedules
- Holds are approved by legal or compliance lead
- Holds are reviewed every 90 days

## Backups

- Backups follow the same retention windows
- Backups are encrypted and access-controlled
- Backup deletion is scheduled alongside primary data deletion

## Data Subject Requests

- Requests are handled per `docs/compliance/data-privacy.md`
- Response target is 30 days or less
- All requests are logged and tracked

## Review Cadence

- Annual review or after regulatory change
