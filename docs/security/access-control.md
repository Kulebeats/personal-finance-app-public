# Access Control

## Authentication
- Email/password login with bcrypt hashing (cost 12)
- Email verification required before login
- Password reset via time-limited email token
- Optional MFA (email OTP) with backup codes
- Password change with history enforcement (last 5)

## Authorization
- Household-scoped access checks on all data reads and writes
- Roles: Owner, Admin, Member, Viewer
- Owner and Admin can manage members and settings
- Member can create and edit household financial data
- Viewer is read-only

## Sessions
- Server-side sessions stored in PostgreSQL
- httpOnly cookies, Secure in production, SameSite Lax
- Session rotation on login and password change
- Users can revoke active sessions from Settings

## Rate Limiting
- Auth endpoints have stricter limits (login, MFA, password reset)
- General API limits by IP and user
- Upload and export endpoints have dedicated limits

## Security Events
- Authentication successes and failures
- MFA enrollment, verification attempts, and lockouts
- Session creation and revocation
- Household role changes and invitation actions

## Implementation Notes
- Enforce account lockout after 5 failed login attempts (AUTH-006)
- MFA verification rate limit: 5/minute (AUTH-011)
- Log all authentication events to the audit log (AUTH-007)
