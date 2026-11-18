# ADR-005: CSRF Protection via Double-Submit Cookie

**Status:** Accepted  
**Date:** 2026-01-27  
**Deciders:** Engineering Team

## Context

The application uses session cookies for authentication. This makes it vulnerable to Cross-Site Request Forgery (CSRF) attacks without additional protection.

**Options Considered:**

1. SameSite: "strict" cookies only
2. Synchronizer token pattern (session-stored token)
3. Double-submit cookie pattern
4. Custom header validation

## Decision

Use **double-submit cookie pattern** via the `csrf-csrf` library.

## Rationale

| Option             | Security  | UX Impact          | Complexity |
| ------------------ | --------- | ------------------ | ---------- |
| SameSite strict    | Good      | Breaks email links | Low        |
| Synchronizer token | Excellent | None               | Medium     |
| Double-submit      | Excellent | None               | Low        |
| Custom header      | Good      | None               | Low        |

**Why double-submit:**

- No server-side token storage needed
- Works with SameSite: "lax" (preserves email link UX)
- Well-understood pattern
- csrf-csrf provides TypeScript-native implementation

## Implementation

```typescript
import { doubleCsrf } from "csrf-csrf";

const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.SESSION_SECRET!,
  cookieName:
    process.env.NODE_ENV === "production" ? "__Host-csrf" : "csrf-token",
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  },
});

app.use(doubleCsrfProtection);
```

**Frontend:**

- Fetch CSRF token from `/api/csrf-token`
- Include `X-CSRF-Token` header on all mutations

## Consequences

**Positive:**

- Strong CSRF protection
- No breaking UX changes
- Stateless (no extra session storage)

**Negative:**

- Frontend must include header
- Token rotation requires coordination
- Pre-auth routes need exemption

## Exemptions

Routes exempt from CSRF (safe or pre-auth):

- `GET`, `HEAD`, `OPTIONS` methods
- `/api/auth/login`
- `/api/auth/register`
- `/api/auth/mfa/verify`
