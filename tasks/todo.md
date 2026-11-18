# P0 Security Fixes Implementation

Based on the Security Review Report, this plan addresses the 4 HIGH priority items.

## P0-1: Update qs/express Dependencies (CVE Fix)

- [x] Run `npm update express body-parser qs` to patch DoS vulnerability
- [x] Verify fix with `npm audit` - HIGH vulnerabilities patched
- [x] Confirm no breaking changes

## P0-2: Remove MFA Code from Logs

- [x] Edit `server/routes/security.ts:665` - remove `code` property from logger.warn call
- [x] Verify no other locations log MFA codes

## P0-3: Implement CSRF Protection (using csrf-csrf)

> Note: Using `csrf-csrf` package instead of deprecated `csurf`

- [x] Install `csrf-csrf` and `cookie-parser` packages
- [x] Add `cookie-parser` middleware to `server/app.ts` (before session)
- [x] Configure `csrf-csrf` with double-submit cookie pattern
- [x] Create `/api/csrf-token` endpoint to expose token to frontend
- [x] Update CORS config to allow `X-CSRF-Token` header
- [x] Skip CSRF for safe methods (GET, HEAD, OPTIONS) and cron routes

## P0-4: Fix Rate Limit Bypass (X-Forwarded-For Spoofing)

- [x] Update `server/middleware/rateLimit.ts` - only trust X-Forwarded-For behind trusted proxy
- [x] Add `TRUST_PROXY` environment variable check
- [x] Update `getClientIp` function with production-safe logic

## Rate Limiter Hardening (A+ Improvements)

- [x] Add `Retry-After` header (RFC 6585 compliance)
- [x] Add security logging for rate limit events (NIST SP 800-92)
- [x] Add JSDoc documentation for `getClientIp` function
- [x] Refactor to shared `createRateLimitHandler(windowMs)` factory

---

## Review Section

### Changes Made

1. **P0-1: Dependency Update**

   - Updated `express`, `body-parser`, and `qs` packages
   - HIGH severity DoS vulnerability (GHSA-6rw7-vpxm-498p) patched
   - 4 moderate dev-only vulnerabilities remain (esbuild)

2. **P0-2: MFA Code Logging Fix**

   - File: `server/routes/security.ts:665`
   - Removed `code` property from logger.warn call
   - Added comment: "Security: MFA code intentionally not logged"

3. **P0-3: CSRF Protection**

   - Installed `csrf-csrf` and `cookie-parser` packages
   - Added `cookieParser()` middleware in `server/app.ts`
   - Configured `doubleCsrf()` with:
     - Session-bound tokens (uses `sessionID`)
     - `__Host-csrf` cookie (secure prefix)
     - 64-byte token size
     - Token extracted from `X-CSRF-Token` header
   - Created `/api/csrf-token` GET endpoint in `server/routes.ts`
   - Updated CORS to allow `X-CSRF-Token` header
   - Skipped CSRF for: GET/HEAD/OPTIONS, `/healthz`, `/api/cron`

4. **P0-4: Rate Limit Bypass Fix**

   - File: `server/middleware/rateLimit.ts`
   - `getClientIp()` now only trusts `X-Forwarded-For` when:
     - `NODE_ENV === "production"` AND
     - `TRUST_PROXY === "true"`
   - Otherwise uses `req.socket.remoteAddress`

5. **Rate Limiter Hardening**
   - Added `Retry-After` header to 429 responses (RFC 6585)
   - Added `logger.warn()` for rate limit events with IP, path, method, userId
   - Added JSDoc for `getClientIp` with CWE-290 reference
   - Refactored to `createRateLimitHandler(windowMs)` factory function
   - All 5 limiters now use consistent handler with logging

### Testing Performed

- TypeScript compilation: ✅ Passed (`npx tsc --noEmit`)
- `npm audit`: HIGH vulnerabilities resolved

### Notes

- Frontend must call `GET /api/csrf-token` on load and include token in `X-CSRF-Token` header for all POST/PUT/DELETE/PATCH requests
- Set `TRUST_PROXY=true` in production environment if behind load balancer (Render, Vercel, etc.)
- Remaining moderate vulnerabilities are in dev dependencies (esbuild) and don't affect production
- Rate limit events are now logged for security monitoring and incident response
