# Access Control Policy

## Purpose

Define authentication, authorization, and access governance for all users, staff roles, and systems.

## Scope

- Web and API access to all application features
- Household-level roles and system-level roles
- Administrative and support operations
- Service accounts and automation

## Roles

### Household Roles

| Role | Read | Write | Admin | Notes |
| --- | --- | --- | --- | --- |
| owner | Yes | Yes | Yes | Full household control, billing, invites, and exports |
| admin | Yes | Yes | Limited | Can manage members and settings, cannot transfer ownership |
| member | Yes | Limited | No | Can create and edit own data within household rules |
| view_only | Yes | No | No | Read-only access |
| professional | Yes | Limited | No | Intended for advisors with scoped write access |

### System Roles

| Role | Access | Notes |
| --- | --- | --- |
| super_admin | Full system access | Production-only, break-glass use |
| support | Limited read, scoped write | Support workflows only |
| analyst | Read-only metrics | No user PII access unless approved |
| readonly_admin | Read-only admin dashboard | No write operations |

## Authentication Requirements

- Session-based authentication with server-side session storage
- Passwords hashed with bcrypt
- MFA is required for system roles and recommended for household owners
- CSRF tokens are required on all state-changing requests
- Rate limiting enforced on auth and security endpoints

## Authorization Requirements

- Household isolation is mandatory for all data queries
- Role checks are required for all privileged actions
- Deny-by-default for new endpoints until access rules are defined
- Step-up MFA is required for sensitive actions (session revocation, email changes)

## Provisioning and Role Changes

1. Invitations are created by owners or admins only.
2. Role changes require owner or admin approval.
3. Role changes are logged in the audit trail.
4. System role assignments require written approval from security lead.

## Deprovisioning

- Remove access within 24 hours of request or offboarding
- Revoke sessions and API tokens immediately
- Remove system roles and rotate shared secrets if exposure is suspected
- Record deprovisioning actions in audit logs

## Access Reviews

- Quarterly review of system roles and admin access
- Semi-annual review of household owners and inactive accounts
- Evidence stored in the compliance evidence folder

## Emergency Access (Break-Glass)

- Use only for production incidents
- Requires approval from security lead and one additional approver
- Access is time-boxed (maximum 4 hours)
- All actions are logged and reviewed post-incident

## Logging and Monitoring

- Log authentication failures and rate limit events
- Log role changes, access revocations, and exports
- Do not log secrets, tokens, or raw PII

## Exceptions

- All exceptions require written approval and an expiry date
- Document exceptions in the risk register

## Review Cadence

- Review annually or after major security changes
