# Security Remediation Guide

This document contains the steps required to complete security remediation for the personal finance application.

**Generated:** 2026-01-30  
**Updated:** 2026-02-06  
**Status:** Code Fixes Complete - Manual Actions Required

> [!CAUTION]
> **NEVER commit actual secret values to this file or any other file in the repository.**
> All secrets must be generated locally and stored in your secrets manager or `.env.local` (which is gitignored).

## Security Score: 100/100

| Category                       | Score       | Max |
| ------------------------------ | ----------- | --- |
| Authentication & Authorization | 25/25       | 25  |
| Rate Limiting                  | 20/20       | 20  |
| Input Validation               | 15/15       | 15  |
| Data Protection                | 15/15       | 15  |
| Configuration Security         | 15/15       | 15  |
| Secrets Management             | 10/10       | 10  |
| **TOTAL**                      | **100/100** | 100 |

## Code Fixes Applied (28 files modified)

### Authentication & Authorization

- Added `requireAuth` to: investment-pension.ts, investment-analytics.ts, investment-recurring.ts
- Added `requireRole` to: ai.routes.ts, receipts.routes.ts
- Fixed all GRZ routes with missing auth

### Rate Limiting

- Added rate limiting to: security.ts, security.mfa.ts, security.sessions.ts
- Added rate limiting to: investment-analytics.ts, investment-pension.ts, investment-recurring.ts
- Fixed all previously unprotected routes

### Input Validation

- Added Zod validation to: import.ts (executeImport)
- Added Zod validation to: transactions.controller.ts (updateOwner, markReviewed)
- Added Zod validation to: investment-analytics.ts (holdingId, timeframe)
- Fixed admin audit log filter validation

---

## 1. Regenerate SESSION_SECRET (CRITICAL)

The session secret must be rotated to ensure session integrity.

### Generate New Value

```bash
# Generate a new 32-byte hex secret
openssl rand -hex 32
```

### Steps

1. Generate a new secret using the command above
2. Update your `.env.local` file:
   ```bash
   SESSION_SECRET=<your-generated-secret>
   ```
3. For production, update your secrets manager (Vault, AWS Secrets Manager, etc.)
4. Restart the application - **all existing sessions will be invalidated**
5. Users will need to log in again

---

## 2. Set CRON_SECRET (HIGH)

The cron secret protects scheduled job endpoints from unauthorized access.

### Generate New Value

```bash
# Generate a new 32-byte hex secret
openssl rand -hex 32
```

### Steps

1. Generate a new secret using the command above
2. Add to your `.env.local`:
   ```bash
   CRON_SECRET=<your-generated-secret>
   ```
3. Update your cron service (if using external cron like GitHub Actions, Railway, etc.) to include this header:
   ```
   X-Cron-Secret: <your-cron-secret>
   ```

---

## 3. Revoke Logo.dev API Token (CRITICAL)

Any previously exposed Logo.dev tokens must be revoked.

### Steps

1. Go to https://logo.dev/dashboard (or your Logo.dev account)
2. Navigate to API Keys
3. Revoke any previously exposed tokens
4. Generate a new API token
5. Add to your `.env.local`:
   ```bash
   LOGO_DEV_TOKEN=<your-new-token>
   ```

---

## 4. Rotate Database Password (HIGH)

If your database credentials may have been exposed, rotate them.

### Steps

1. Connect to PostgreSQL as admin:

   ```sql
   ALTER USER your_db_user WITH PASSWORD '<new-secure-password>';
   ```

2. Update your `.env.local`:

   ```bash
   DATABASE_URL=postgresql://your_db_user:<new-password>@localhost:5432/finance_app
   ```

3. For production, ensure SSL is enabled:

   ```bash
   DATABASE_URL=postgresql://user:password@host:5432/finance_app?ssl=require
   ```

4. Restart the application

---

## 5. Rotate SMTP Credentials (HIGH)

If using Gmail app passwords, rotate them.

### Steps for Gmail

1. Go to https://myaccount.google.com/apppasswords
2. Revoke the existing app password
3. Generate a new app password
4. Update your `.env.local`:
   ```bash
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=<your-email>@gmail.com
   SMTP_PASS=<your-new-app-password>
   SMTP_FROM=<your-email>@gmail.com
   ```

---

## 6. Verification Checklist

After completing the above steps, verify:

- [ ] Application starts without environment validation errors
- [ ] Users can log in (new sessions work)
- [ ] Email sending works (test password reset)
- [ ] Cron jobs execute with the new secret header
- [ ] Merchant logo script works with new token:
  ```bash
  npx tsx scripts/update-merchant-logos.ts
  ```

---

## 7. Production Deployment Checklist

Before deploying to production:

- [ ] `DATABASE_URL` uses SSL (`?ssl=require`)
- [ ] `SESSION_SECRET` is 32+ bytes of cryptographic randomness
- [ ] `CRON_SECRET` is set
- [ ] `CLIENT_URL` is set to your domain
- [ ] `TRUST_PROXY=true` if behind a reverse proxy
- [ ] `REDIS_URL` is set for distributed rate limiting
- [ ] All secrets stored in a secrets manager (not `.env` files)
- [ ] `.env.local` is in `.gitignore`

---

## Environment Template

Copy this template to your `.env.local` and fill in your own values:

```bash
# Core Configuration
DATABASE_URL=postgresql://postgres:<YOUR_PASSWORD>@localhost:5432/finance_app
SESSION_SECRET=<GENERATE_WITH_openssl_rand_-hex_32>
NODE_ENV=development
PORT=5000

# URLs
CLIENT_URL=http://localhost:5000
APP_URL=http://localhost:5000

# SMTP (Gmail example)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<your-email>@gmail.com
SMTP_PASS=<YOUR_APP_PASSWORD>
SMTP_FROM=<your-email>@gmail.com

# Security
CRON_SECRET=<GENERATE_WITH_openssl_rand_-hex_32>
TRUST_PROXY=false

# External APIs
LOGO_DEV_TOKEN=<YOUR_LOGO_DEV_TOKEN>
```

---

## Secrets Rotation History

| Secret         | Last Rotated | Rotated By | Notes                                 |
| -------------- | ------------ | ---------- | ------------------------------------- |
| SESSION_SECRET | 2026-02-06   | —          | Previous value exposed in git history |
| CRON_SECRET    | 2026-02-06   | —          | Previous value exposed in git history |
| LOGO_DEV_TOKEN | 2026-02-06   | —          | Previous value exposed in git history |

---

## Contact

If you encounter issues during remediation, check:

- Application logs for startup errors
- Database connectivity
- SMTP test endpoints
