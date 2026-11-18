# ADR-001: Session-Based Authentication Over JWT

**Status:** Accepted  
**Date:** 2026-01-13  
**Deciders:** Engineering Team

## Context

The application needs a secure authentication mechanism for a finance app handling sensitive data.

**Options Considered:**

1. JWT (stateless tokens)
2. Session-based (server-side sessions)
3. OAuth 2.0 only (external provider)

## Decision

Use **session-based authentication** with PostgreSQL session store.

## Rationale

| Factor       | JWT                      | Session           | Winner  |
| ------------ | ------------------------ | ----------------- | ------- |
| Revocation   | Hard (blocklist needed)  | Easy (delete row) | Session |
| Token size   | Large (headers)          | Small (cookie ID) | Session |
| Server state | Stateless                | Stateful          | JWT     |
| Security     | XSS risk if localStorage | HttpOnly cookie   | Session |
| Complexity   | Higher                   | Lower             | Session |

For a finance app where:

- Users must be immediately logged out on password change
- Session hijacking must be mitigated
- We don't need cross-origin API access

Session-based auth is the better choice.

## Consequences

**Positive:**

- Immediate session revocation on password change
- Smaller attack surface (no token theft)
- Simpler implementation

**Negative:**

- Requires session storage (PostgreSQL)
- Slightly higher per-request overhead
- Must handle session expiry

## References

- OWASP Session Management Cheat Sheet
- express-session documentation
