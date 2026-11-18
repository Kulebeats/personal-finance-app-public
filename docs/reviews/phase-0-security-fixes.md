# Security Fixes Guide

**Personal Finance App - Comprehensive Security Hardening**
**Based on Security Audit Report v2.0**

---

## Executive Summary

This document consolidates all security findings into an actionable fix guide. The fixes align with the existing architecture:

- **Session-based authentication** (not JWT)
- **Household-based role system** (owner > admin > member > view_only)
- **Existing structured logger** at `server/utils/logger.ts`

### Current Security Score: 6.8/10

| Category | Score | Key Issue |
|----------|-------|-----------|
| Authentication | 7.5/10 | No MFA, no account lockout |
| Authorization | 4/10 | **CRITICAL** - Admin routes unprotected |
| Session Management | 8/10 | Good |
| Logging & Audit | 5/10 | Console.log with PII, file-based logging |
| Rate Limiting | 9/10 | Excellent |

### What's Already Excellent

- Structured logger with PII redaction (`server/utils/logger.ts`)
- Request ID tracking middleware
- Household-based access control (`householdGuard`)
- Entity validation middleware
- Multi-tier rate limiting
- bcrypt password hashing (12 rounds)
- Secure session cookies (httpOnly, secure, sameSite)

---

## Priority Matrix

| Priority | Fix Time | Findings |
|----------|----------|----------|
| **P0 - Immediate** | 2 hours | CRITICAL-01, CRITICAL-02, HIGH-03 |
| **P1 - This Week** | 3 hours | HIGH-01, HIGH-02, HIGH-04 |
| **P2 - This Sprint** | 8 hours | MEDIUM-01 through MEDIUM-04 |

---

## P0: Immediate Fixes ✅ **COMPLETED**

### CRITICAL-01: Unprotected Admin Endpoint ✅ **FIXED**

**Location:** `server/routes/admin.ts`
**CVSS Score:** 9.1 (Critical) → **0 (Resolved)**
**Status:** ✅ **IMPLEMENTED** (2026-01-13)

#### Original Problem

The `/api/admin` route had no authentication - anyone could access internal system metrics.

#### Solution Implemented

```typescript
// server/routes/admin.ts:10-12
router.use(requireAuth);
router.use(requireAnySystemRole());
```

**Verification:**
- ✅ All 18 admin endpoints protected with authentication + system roles
- ✅ Super admin required for user management (role assignment, account unlock)
- ✅ Audit logging on all admin actions
- ✅ User ID sanitization in logs

#### Fix

**Step 1: Update `server/routes.ts`**

```typescript
// Change line 116 from:
app.use("/api/admin", adminRoutes);

// To:
import { requireAuth } from "./auth";
app.use("/api/admin", requireAuth, adminRoutes);
```

**Step 2: Update `server/routes/admin.ts`**

Replace the entire file:

```typescript
import { Router } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import { logger } from "../utils/logger";

const router = Router();

/**
 * Middleware to require owner role for admin routes
 */
async function requireOwnerRole(req: any, res: any, next: any) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const household = await storage.getHouseholdByUserId(req.session.userId);
    if (!household) {
      return res.status(403).json({ error: "No household found" });
    }

    const membership = await storage.getHouseholdMembership(
      household.id,
      req.session.userId
    );

    if (!membership || membership.role !== "owner") {
      logger.warn("Non-owner attempted admin access", {
        userId: req.session.userId?.substring(0, 8) + "...",
        route: req.path,
      });
      return res.status(403).json({ error: "Owner role required" });
    }

    next();
  } catch (error) {
    logger.error("Admin auth check failed", {}, error as Error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// Apply owner check to all admin routes
router.use(requireOwnerRole);

/**
 * GET /api/admin/calculation-shadow-status
 */
router.get("/calculation-shadow-status", async (req, res) => {
  try {
    const stats = await db.execute(sql`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN error_code IS NOT NULL THEN 1 ELSE 0 END) as errors,
        AVG(execution_time_ms) as avg_latency
      FROM calculation_logs
      WHERE timestamp > NOW() - INTERVAL '24 hours'
    `);

    const mismatches = await db.execute(sql`
      SELECT *
      FROM calculation_logs
      WHERE error_message LIKE 'Shadow mismatch%'
      ORDER BY timestamp DESC
      LIMIT 10
    `);

    logger.info("Admin shadow status accessed", {
      userId: (req as any).session.userId?.substring(0, 8) + "...",
    });

    res.json({
      enabled: true,
      last24Hours: {
        total: parseInt((stats.rows[0].total as string) || "0"),
        errors: parseInt((stats.rows[0].errors as string) || "0"),
        avgLatencyMs: parseFloat((stats.rows[0].avg_latency as string) || "0"),
      },
      recentMismatches: mismatches.rows.map((row) => ({
        timestamp: row.timestamp,
        function: row.function_name,
        details: row.error_message,
      })),
    });
  } catch (error) {
    logger.error("Failed to get shadow status", {}, error as Error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
```

#### Verification

```bash
curl -i http://localhost:5000/api/admin/calculation-shadow-status
# Expected: 401 Unauthorized
```

---

### CRITICAL-02: Debug Logging Exposes User IDs ✅ **FIXED**

**Location:** `server/middleware/householdGuard.ts`
**CVSS Score:** 7.5 (High) → **0 (Resolved)**
**Status:** ✅ **IMPLEMENTED** (2026-01-13)

#### Original Problem

Console.log statements exposed user IDs and household data in production logs.

```typescript
// server/middleware/householdGuard.ts:52-64 - VULNERABLE
console.log("[householdGuard] userId from session:", userId);
console.log("[householdGuard] household result:", household?.id, household?.name);
console.log("[householdGuard] No household found for userId:", userId);
```

#### Files with console.log violations

| File | Lines | Content |
|------|-------|---------|
| `householdGuard.ts` | 52, 57-61, 64, 100 | User IDs, household data |
| `auth.ts` | 46, 121, 260, 412 | Error details |
| `weekly-recap.ts` | 192, 247 | Error objects |
| `notifications.ts` | 59, 84, 131 | Error details |
| `security.ts` | 77, 120, 215, etc. | Error details |
| `admin.ts` | 54 | Error details |
| `import.ts` | 19, 75 | Error details |

#### Fix

Replace all `console.log/error/warn` with the structured logger:

```typescript
// BEFORE
console.log("[householdGuard] userId from session:", userId);

// AFTER
import { logger } from "../utils/logger";
logger.debug("Household guard check", {
  requestId: req.requestId,
  userId: userId?.substring(0, 8) + "...",
});
```

**Quick find command:**

```bash
grep -rn "console\.\(log\|error\|warn\)" server/ --include="*.ts" | grep -v "__tests__" | grep -v "node_modules"
```

---

### HIGH-03: File-Based Error Logging

**Location:** `server/middleware/householdGuard.ts:101-112`
**Fix Time:** 10 minutes

#### Problem

Errors written directly to a file on disk:

```typescript
// server/middleware/householdGuard.ts:101-112 - VULNERABLE
const fs = require("fs");
const path = require("path");
try {
  fs.appendFileSync(
    path.join(process.cwd(), "household_guard_error.log"),
    `[${new Date().toISOString()}] Error: ${
      error instanceof Error ? error.stack : JSON.stringify(error)
    }\n`
  );
} catch (e) { /* ignore */ }
```

#### Fix

Remove the file logging block entirely and use the structured logger:

```typescript
// Replace with:
logger.error("Household guard error", {
  requestId: req.requestId,
  userId: userId?.substring(0, 8) + "...",
}, error instanceof Error ? error : new Error(String(error)));
```

Also delete the `household_guard_error.log` file if it exists in the project root.

---

## P1: This Week Fixes

### HIGH-01: CORS Misconfiguration

**Location:** `server/app.ts:52-57`
**Fix Time:** 15 minutes

#### Problem

CORS falls back to `localhost:5000` if `CLIENT_URL` not set:

```typescript
// server/app.ts - VULNERABLE
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5000", // Risky fallback
    credentials: true,
  })
);
```

#### Fix

Require `CLIENT_URL` in production:

```typescript
// Validate CLIENT_URL
const corsOrigin = process.env.CLIENT_URL;
if (!corsOrigin && process.env.NODE_ENV === "production") {
  throw new Error("CLIENT_URL environment variable is required in production");
}

app.use(
  cors({
    origin: corsOrigin || "http://localhost:5000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
  })
);
```

---

### HIGH-02: Unprotected Import Parse Endpoint

**Location:** `server/routes/import.ts:10`
**Fix Time:** 30 minutes

#### Problem

Anyone can upload files without authentication:

```typescript
// server/routes/import.ts - VULNERABLE
router.post("/parse", upload.single("file"), async (req, res) => {
  // No auth check!
```

#### Fix

Replace `server/routes/import.ts`:

```typescript
import { Router } from "express";
import multer from "multer";
import { importService } from "../services/ImportService";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import { logger } from "../utils/logger";

const router = Router();

// Configure multer with file size limit (10MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
});

// Apply authentication to ALL import routes
router.use(requireAuth);

// POST /api/import/parse - Parse uploaded CSV
router.post("/parse", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    logger.info("CSV parse started", {
      userId: req.session.userId?.substring(0, 8) + "...",
      fileSize: req.file.size,
      fileName: req.file.originalname,
    });

    const result = await importService.parseCsv(req.file.buffer);

    logger.info("CSV parse completed", {
      userId: req.session.userId?.substring(0, 8) + "...",
      rowCount: result.rows?.length || 0,
    });

    res.json(result);
  } catch (error) {
    logger.error("CSV Parse Error", {
      userId: req.session.userId?.substring(0, 8) + "...",
    }, error as Error);
    res.status(500).json({ message: (error as Error).message });
  }
});

// POST /api/import/execute - Execute import
router.post("/execute", async (req, res) => {
  try {
    const {
      householdId,
      targetAccountId,
      strategy,
      mapping,
      categoryMapping,
      rows,
    } = req.body;

    if (!rows || !mapping || !strategy) {
      return res.status(400).json({ message: "Missing required import data" });
    }

    const effectiveUserId = req.session.userId!;

    const userHousehold = await storage.getHouseholdByUserId(effectiveUserId);
    if (!userHousehold) {
      return res.status(404).json({ message: "Household not found" });
    }

    const targetHouseholdId = householdId ?? userHousehold.id;
    if (householdId && householdId !== userHousehold.id) {
      const membership = await storage.getHouseholdMembership(
        householdId,
        effectiveUserId
      );
      if (!membership) {
        return res.status(403).json({ message: "Forbidden" });
      }
    }

    logger.info("Import execution started", {
      userId: effectiveUserId.substring(0, 8) + "...",
      householdId: targetHouseholdId.substring(0, 8) + "...",
      rowCount: rows.length,
      strategy,
    });

    const result = await importService.executeImport(rows, {
      userId: effectiveUserId,
      householdId: targetHouseholdId,
      targetAccountId,
      strategy,
      mapping,
      categoryMapping,
    });

    logger.info("Import execution completed", {
      userId: effectiveUserId.substring(0, 8) + "...",
      imported: result.imported,
      skipped: result.skipped,
    });

    res.json(result);
  } catch (error) {
    logger.error("Import Execution Error", {
      userId: req.session.userId?.substring(0, 8) + "...",
    }, error as Error);
    res.status(500).json({ message: (error as Error).message });
  }
});

export default router;
```

---

### HIGH-04: Verification Token Exposed in Response

**Location:** `server/routes/security.ts:208-211`
**Fix Time:** 5 minutes

#### Problem

Email verification URL returned in response without checking environment:

```typescript
// server/routes/security.ts - VULNERABLE
if (!isEmailServiceConfigured()) {
  response.devVerifyUrl = verifyUrl;  // Token exposed!
  response.devMessage = "SMTP not configured. Use this link to verify:";
}
```

#### Fix

Add `NODE_ENV` check:

```typescript
if (!isEmailServiceConfigured() && process.env.NODE_ENV === "development") {
  response.devVerifyUrl = verifyUrl;
  response.devMessage = "SMTP not configured. Use this link to verify:";
  logger.warn("Email service not configured - verification URL in response", {
    userId: userId?.substring(0, 8) + "...",
  });
}
```

---

## P2: This Sprint Fixes

### MEDIUM-01: No Account Lockout

**Effort:** 2-3 hours

Add failed login tracking to prevent brute force:

```typescript
// Add to server/routes/auth.ts

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;

async function isAccountLocked(email: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - LOCKOUT_DURATION_MINUTES * 60 * 1000);

  const recentAttempts = await db
    .select({ count: count() })
    .from(failedLoginAttempts)
    .where(
      and(
        eq(failedLoginAttempts.email, email.toLowerCase()),
        gt(failedLoginAttempts.attemptedAt, cutoff)
      )
    );

  return recentAttempts[0].count >= MAX_FAILED_ATTEMPTS;
}
```

See `enterprise-refactoring-specification.md` Phase 2.1 for full implementation.

---

### MEDIUM-02: Add Audit Logging

**Effort:** 4-6 hours

Create audit trail for sensitive operations. See `enterprise-refactoring-specification.md` Phase 1 for:
- Database schema
- AuditService implementation
- Integration examples

---

### MEDIUM-03: Security Headers Enhancement

**Effort:** 1 hour

Update Helmet configuration in `server/app.ts`:

```typescript
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  })
);
```

---

### MEDIUM-04: Session Regeneration on Login

**Effort:** 30 minutes

Add session regeneration after successful login to prevent session fixation:

```typescript
// In login handler, after password verification:
req.session.regenerate((err) => {
  if (err) {
    logger.error("Session regeneration failed", {}, err);
    return res.status(500).json({ error: "Login failed" });
  }

  req.session.userId = user.id;
  // ... rest of login logic
});
```

---

## ✅ Verification Checklist - ALL COMPLETE

### P0 Fixes ✅

- [x] `/api/admin/*` returns 401 without session - **VERIFIED**
- [x] `/api/admin/*` requires system role - **VERIFIED** (requireAnySystemRole)
- [x] No `console.log` statements in `householdGuard.ts` - **VERIFIED**
- [x] No `fs.appendFileSync` in `householdGuard.ts` - **VERIFIED**
- [x] Structured logger with PII sanitization - **VERIFIED**

### P1 Fixes ✅

- [x] App throws error on startup if `CLIENT_URL` missing in production - **VERIFIED** (app.ts:81-83)
- [x] `/api/import/parse` returns 401 without session - **VERIFIED** (import.ts:21)
- [x] File uploads limited to 10MB - **VERIFIED** (import.ts:16)
- [x] File validation with magic bytes - **VERIFIED** (fileValidation.ts)
- [x] `devVerifyUrl` only returned in development - **VERIFIED** (security.email.ts:179)

### P2 Fixes ✅

- [x] Account lockout after 5 failed attempts - **VERIFIED** (auth.service.ts:56-57)
- [x] MFA/TOTP implementation - **VERIFIED** (security.mfa.ts)
- [x] Session regeneration on login - **VERIFIED** (auth.service.ts:331-346)
- [x] Comprehensive audit logging - **VERIFIED** (AuditService.ts, 17 event types)
- [x] Security headers (HSTS, CSP) - **VERIFIED** (app.ts:28-77)

### Audit Results

```bash
# Production code console.log count (excluding tests, scripts, monitoring)
# Result: 0 in security-critical code ✅
# Remaining: 20 in monitoring/observability code (acceptable)

# File system logging
# Result: 0 fs.appendFileSync instances ✅

# Security score improvement
# Before: 6.8/10
# After: 8.3/10 (+1.5 points) ✅
```

---

## Summary

| Priority | Fixes | Effort | Impact |
|----------|-------|--------|--------|
| **P0** | CRITICAL-01, CRITICAL-02, HIGH-03 | 2 hours | Blocks critical vulnerabilities |
| **P1** | HIGH-01, HIGH-02, HIGH-04 | 3 hours | Closes high-risk gaps |
| **P2** | MEDIUM-01 to 04 | 8 hours | Hardens overall security |

**Total effort to reach 8.0+ security score: ~13 hours**

---

## References

- Full security audit: `docs/reviews/security-audit-report-2026-01-13-v3.md`
- Enhancement roadmap: `docs/enterprise-refactoring-specification.md`
- Existing logger: `server/utils/logger.ts`
- Existing auth middleware: `server/auth.ts`, `server/middleware/householdGuard.ts`

---

**Document Version:** 4.0
**Last Updated:** January 28, 2026
**Status:** ✅ **COMPLETED** - All P0, P1, and P2 fixes implemented and verified

---

## ✅ COMPLETION SUMMARY

**Implementation Date:** January 13-28, 2026
**Security Score:** 6.8/10 → **8.3/10** (+1.5 points)

### Fixes Completed

| Priority | Fixes | Status | Verification |
|----------|-------|--------|--------------|
| **P0** | CRITICAL-01, CRITICAL-02, HIGH-03 | ✅ **100%** | All admin endpoints protected, PII logging eliminated, file logging removed |
| **P1** | HIGH-01, HIGH-02, HIGH-04 | ✅ **100%** | CORS validated, import auth added, dev tokens secured |
| **P2** | MEDIUM-01 to 04 | ✅ **100%** | Account lockout active, MFA implemented, audit logging complete, session regeneration added |

### Security Enhancements Beyond Original Scope

1. **Multi-Factor Authentication (MFA)**: Full TOTP implementation with backup codes
2. **System Roles**: Super admin, support, analyst, readonly_admin roles
3. **File Upload Validation**: Magic bytes, MIME type, double extension checks
4. **Step-Up Authentication**: 15-minute TTL for sensitive operations
5. **Comprehensive Audit Logging**: 17 event types with PII sanitization

---
