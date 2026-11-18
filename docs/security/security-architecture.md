# Security Architecture

## Overview

The backend enforces session-based authentication, CSRF protection, rate limiting, and input validation. Security controls are designed for web threats (OWASP ASVS L2) and fintech expectations.

## Primary Controls

- Session-based auth with PostgreSQL session store
- Password hashing with bcrypt
- CSRF protection using double-submit cookie (exempt: `/api/auth/logout`)
- Security headers via helmet
- Rate limiting with Redis optional store
- Input validation with Zod schemas
- Upload validation for receipts, profile images, merchant logos
- Request ID + structured logging

## Web App Hardening

- CSP (production) with strict source directives
- HSTS (production)
- Frameguard, noSniff, referrer policy
- CORS restricted by CLIENT_URL

## API Security

- Auth and role-based guards
- Household scoping to prevent cross-tenant access
- Error sanitization for safe responses
- Environment validation to prevent unsafe startup

## Data Protection

- Session cookies: httpOnly + sameSite
- Optional secure cookies in production
- No response body logging for PII

## Related Docs

- Threat Model: `docs/security/threat-model.md`
- Access Control: `docs/security/access-control.md`
- Logging & Monitoring: `docs/security/logging-monitoring.md`
