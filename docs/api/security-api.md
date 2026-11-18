# Security Settings API

## Purpose

Document security-related endpoints for email verification, MFA, sessions, and login history.

## Base Path

`/api/settings/security`

## Authentication

- Session-based authentication required for all endpoints except email verification
- CSRF token required for state-changing requests
- Rate limiting applied to all security routes

## Endpoints

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/settings/security` | Yes | Security status summary |
| POST | `/api/settings/security/email/verify` | No | Verify email with token |
| POST | `/api/settings/security/email/change` | Yes | Request email change |
| POST | `/api/settings/security/email/resend` | Yes | Resend verification email |
| POST | `/api/settings/security/email/cancel` | Yes | Cancel pending email change |
| GET | `/api/settings/security/sessions` | Yes | List active sessions |
| DELETE | `/api/settings/security/sessions/:id` | Yes + step-up | Revoke a session |
| DELETE | `/api/settings/security/sessions` | Yes + step-up | Revoke all other sessions |
| GET | `/api/settings/security/sessions/login-history` | Yes | Recent login history |
| GET | `/api/settings/security/sessions/login-history/export` | Yes | Export login history |
| POST | `/api/settings/security/mfa/send-code` | No | Send MFA code for login |
| POST | `/api/settings/security/mfa/verify-code` | No | Verify MFA code for login |
| POST | `/api/settings/security/mfa/verify-backup` | No | Verify MFA backup code |
| POST | `/api/settings/security/mfa/enable` | Yes | Enable MFA and generate backup codes |
| POST | `/api/settings/security/mfa/disable` | Yes | Disable MFA |
| GET | `/api/settings/security/mfa/status` | Yes | MFA status |
| POST | `/api/settings/security/step-up` | Yes | Step-up MFA for sensitive actions |
| GET | `/api/settings/security/step-up/status` | Yes | Step-up status |

## Request and Response Notes

- `email/verify` expects `{ "token": "..." }` and returns a success message
- `email/change` expects `{ "newEmail": "...", "password": "..." }`
- `sessions/login-history/export` supports `format=csv|json` and `limit` query params
- Step-up is required before revoking sessions

## Error Shape

All errors follow the standard API error format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```

## Related Docs

- `docs/security/security-review-report.md`
- `docs/security/auth-pentest-checklist.md`
- `docs/policies/access-control-policy.md`
