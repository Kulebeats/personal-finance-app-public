# Step-Up Re-Authentication ("Sudo Mode") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make step-up re-authentication satisfiable by password for every user (including the default non-MFA user), and handle it on the client, so destructive/financial actions stop dead-ending at an unsatisfiable 401.

**Architecture:** The `requireStepUp` middleware stays enforcing. We fix *how* step-up is satisfied: the `POST /api/settings/security/step-up` endpoint accepts the user's **password** (verified with bcrypt) as well as the existing emailed MFA code. The client centralizes 401 `STEP_UP_REQUIRED` handling inside `apiCall`, opening a password dialog and retrying the original request once — so all 8 gated routes work with zero per-hook changes. A real-DB integration test (no mocked middleware) guards the fix.

**Tech Stack:** Express, PostgreSQL (Drizzle ORM), `csrf-csrf`, express-session, Zod, bcrypt; React 18 + TanStack Query + Radix UI (shadcn) + Vitest + supertest.

**Spec:** `docs/architecture/step-up-reauth-design.md`

---

## Pre-flight

- [ ] **P.1: Create a feature branch** (currently on `main`).

```bash
git checkout -b fix/step-up-reauth-sudo-mode
```

- [ ] **P.2: Confirm the test DB is reachable** (the real-DB test needs it).

```bash
node -e "require('dotenv').config();const{Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:4000});p.query('select 1').then(()=>{console.log('DB OK');return p.end()}).catch(e=>{console.error('DB DOWN',e.code);process.exit(1)})"
```

Expected: `DB OK`. (If down, start local Postgres or set `DATABASE_URL`. CI uses an ephemeral Postgres service.)

---

## Task 1: Real-DB integration test (RED)

Write the authoritative guard first. It exercises the **real** `requireStepUp` middleware and **real** step-up endpoint against real Postgres. Cases 3 and 4 must FAIL against the current code.

**Files:**
- Create: `server/modules/accounts/__tests__/accounts.stepup.db.integration.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * Step-Up Re-Authentication — Real-DB Integration Tests
 *
 * Exercises the REAL requireStepUp middleware and the REAL step-up endpoint
 * against a real Postgres (NO mocked middleware). Guards the sudo-mode fix:
 * a non-MFA user must be able to satisfy step-up with their password and then
 * perform destructive/financial actions.
 *
 * See docs/architecture/step-up-reauth-design.md
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { db } from "../../../db";
import { eq } from "drizzle-orm";
import {
  users,
  households,
  householdMembers,
  accounts,
  transactions,
} from "@shared/schema";
import {
  getTestApp,
  createTestUser,
  createTestHousehold,
} from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { randomUUID } from "crypto";

describe("Account/Transfer Step-Up — Real DB Integration", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;
  let deleteAccountId: string;
  let fromAccountId: string;
  let toAccountId: string;

  const timestamp = Date.now();
  const PASSWORD = "TestPassword123!";

  beforeAll(async () => {
    app = await getTestApp();

    const testUser = createTestUser({
      email: `stepup-${timestamp}@example.com`,
      username: `stepup-user-${timestamp}`,
      mfaEnabled: false,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "Step-Up Test Household",
    });

    testUser.passwordHash = await hashPassword(PASSWORD);
    householdId = testHousehold.id;
    userId = testUser.id;
    testUser.householdId = testHousehold.id;

    await db.insert(households).values({
      id: testHousehold.id,
      name: testHousehold.name,
      currency: testHousehold.currency,
    });

    await db.insert(users).values({
      id: testUser.id,
      email: testUser.email,
      username: testUser.username,
      passwordHash: testUser.passwordHash,
      fullName: testUser.fullName,
      householdId: testUser.householdId,
      emailVerified: testUser.emailVerified,
      mfaEnabled: testUser.mfaEnabled,
      failedLoginAttempts: testUser.failedLoginAttempts,
      lockedUntil: testUser.lockedUntil,
    });

    await db.insert(householdMembers).values({
      householdId: testHousehold.id,
      userId: testUser.id,
      role: "admin",
    });

    deleteAccountId = randomUUID();
    fromAccountId = randomUUID();
    toAccountId = randomUUID();

    await db.insert(accounts).values([
      {
        id: deleteAccountId,
        householdId,
        name: "Account To Delete",
        type: "checking",
        balance: "0.00",
        currency: "ZMW",
        isActive: true,
      },
      {
        id: fromAccountId,
        householdId,
        name: "Transfer Source",
        type: "checking",
        balance: "1000.00",
        currency: "ZMW",
        isActive: true,
      },
      {
        id: toAccountId,
        householdId,
        name: "Transfer Destination",
        type: "savings",
        balance: "0.00",
        currency: "ZMW",
        isActive: true,
      },
    ]);

    const loginRes = await request(app).post("/api/auth/login").send({
      email: testUser.email,
      password: PASSWORD,
    });
    expect(loginRes.status).toBe(200);
    authCookie = loginRes.headers["set-cookie"][0];
  });

  afterAll(async () => {
    await db
      .delete(transactions)
      .where(eq(transactions.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db
      .delete(householdMembers)
      .where(eq(householdMembers.householdId, householdId));
    await db.delete(users).where(eq(users.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
  });

  // 1. No step-up -> blocked (passes on unfixed code too; documents the gate)
  it("blocks DELETE /accounts/:id without step-up (401 requiresStepUp)", async () => {
    const res = await request(app)
      .delete(`/api/accounts/${deleteAccountId}`)
      .set("Cookie", authCookie);

    expect(res.status).toBe(401);
    expect(res.body.requiresStepUp).toBe(true);
    expect(res.body.error.code).toBe("STEP_UP_REQUIRED");
  });

  // 2. Wrong password -> 401, delete still blocked
  it("rejects step-up with wrong password and keeps delete blocked", async () => {
    const stepUpRes = await request(app)
      .post("/api/settings/security/step-up")
      .set("Cookie", authCookie)
      .send({ password: "WrongPassword!" });

    expect(stepUpRes.status).toBe(401);
    expect(stepUpRes.body.error.code).toBe("INVALID_CREDENTIALS");

    const delRes = await request(app)
      .delete(`/api/accounts/${deleteAccountId}`)
      .set("Cookie", authCookie);
    expect(delRes.status).toBe(401);
  });

  // 3. Password step-up -> delete works (THE fail-then-pass guard)
  it("allows DELETE after password step-up (non-MFA user)", async () => {
    const stepUpRes = await request(app)
      .post("/api/settings/security/step-up")
      .set("Cookie", authCookie)
      .send({ password: PASSWORD });

    expect(stepUpRes.status).toBe(200);
    expect(stepUpRes.body.success).toBe(true);

    const delRes = await request(app)
      .delete(`/api/accounts/${deleteAccountId}`)
      .set("Cookie", authCookie);
    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);

    const [row] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, deleteAccountId));
    expect(row).toBeDefined();
    expect(row.deletedAt).not.toBeNull();
  });

  // 4. Financial transfer works under the same step-up window (cross-level)
  it("allows POST /transactions/transfer under the active step-up window", async () => {
    const res = await request(app)
      .post("/api/transactions/transfer")
      .set("Cookie", authCookie)
      .send({
        fromAccountId,
        toAccountId,
        amount: { amount: "100.00", currency: "ZMW" },
        name: "Test transfer",
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
    expect(res.body.data.outflow.id).toBeDefined();
    expect(res.body.data.inflow.id).toBeDefined();

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.householdId, householdId));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it FAILS against current code**

```bash
npm run test:server:run -- modules/accounts/__tests__/accounts.stepup.db.integration.test.ts
```

Expected: cases 1 and 2 PASS; **cases 3 and 4 FAIL** — case 3's `POST /step-up { password }` returns `400 "6-digit code required"` (current schema requires `code`), not `200`; case 4's transfer returns `401` because step-up was never set. This proves the test can fail.

- [ ] **Step 3: Commit the failing test**

```bash
git add server/modules/accounts/__tests__/accounts.stepup.db.integration.test.ts
git commit -m "test: add real-DB step-up integration test (currently failing)"
```

---

## Task 2: Backend — dual-mode step-up endpoint (GREEN)

Rewrite the step-up handler to accept password **or** MFA code, return `401 INVALID_CREDENTIALS` on failure, and apply `authLimiter`.

**Files:**
- Modify (full rewrite): `server/routes/security.mfa.stepup.ts`

- [ ] **Step 1: Replace the file contents**

```typescript
/**
 * MFA Step-up Routes
 *
 * Verify step-up re-authentication for sensitive actions. Accepts the user's
 * PASSWORD (works for every user) OR an emailed MFA code (for MFA-enrolled
 * users). See docs/architecture/step-up-reauth-design.md.
 *
 * @module routes/security.mfa.stepup
 */

import { Router, Request, Response } from "express";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, verifyPassword as verifyHash } from "../auth";
import { authLimiter } from "../middleware/rateLimit";
import { logger } from "../utils/logger";
import { auditService, AuditEventType } from "../services/AuditService";
import { setStepUpVerified, isStepUpValid } from "../middleware/requireStepUp";

const stepUpSchema = z
  .object({
    code: z.string().length(6).optional(),
    password: z.string().min(1).optional(),
  })
  .refine((data) => Boolean(data.code) || Boolean(data.password), {
    message: "Password or 6-digit code required",
  });

export function registerMfaStepUpRoutes(router: Router): void {
  /**
   * POST /step-up - Verify password or MFA code for step-up authentication.
   */
  router.post(
    "/step-up",
    authLimiter,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const userId = req.session.userId!;
        const validation = stepUpSchema.safeParse(req.body);

        if (!validation.success) {
          return res.status(400).json({
            success: false,
            error: { message: "Password or 6-digit code required" },
          });
        }

        const { code, password } = validation.data;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        if (!user) {
          return res.status(401).json({
            success: false,
            error: {
              code: "INVALID_CREDENTIALS",
              message: "Invalid credentials",
            },
          });
        }

        let verified = false;
        let method: "password" | "mfa_code" | null = null;

        // MFA code path: only for enrolled users with a live, unexpired code.
        if (
          code &&
          user.mfaEnabled &&
          user.mfaCode &&
          user.mfaCodeExpiry &&
          new Date() <= user.mfaCodeExpiry
        ) {
          if (await verifyHash(code, user.mfaCode)) {
            verified = true;
            method = "mfa_code";
          }
        }

        // Password re-auth path: available to every user.
        if (!verified && password && user.passwordHash) {
          if (await verifyHash(password, user.passwordHash)) {
            verified = true;
            method = "password";
          }
        }

        if (!verified) {
          await auditService.log({
            eventType: AuditEventType.MFA_FAILED,
            userId,
            ipAddress: req.ip || req.socket.remoteAddress,
            userAgent: req.headers["user-agent"],
            details: { action: "step-up" },
          });

          return res.status(401).json({
            success: false,
            error: {
              code: "INVALID_CREDENTIALS",
              message: "Invalid credentials",
            },
          });
        }

        // Consume the one-time MFA code only if that's what was used.
        if (method === "mfa_code") {
          await db
            .update(users)
            .set({ mfaCode: null, mfaCodeExpiry: null })
            .where(eq(users.id, userId));
        }

        setStepUpVerified(req);

        await auditService.log({
          eventType: AuditEventType.MFA_VERIFIED,
          userId,
          ipAddress: req.ip || req.socket.remoteAddress,
          userAgent: req.headers["user-agent"],
          details: { action: "step-up", method },
        });

        logger.info("Step-up verification successful", {
          requestId: req.requestId,
          userId: userId.substring(0, 8) + "...",
          method,
        });

        res.json({
          success: true,
          message: "Step-up verification successful",
          expiresIn: 15 * 60, // seconds
        });
      } catch (error) {
        logger.error(
          "Error verifying step-up",
          { requestId: req.requestId },
          error as Error,
        );
        res
          .status(500)
          .json({ error: { message: "Step-up verification failed" } });
      }
    },
  );

  /**
   * GET /step-up/status - Check if current session has valid step-up verification.
   */
  router.get("/step-up/status", requireAuth, (req: Request, res: Response) => {
    res.json({
      success: true,
      data: {
        isVerified: isStepUpValid(req),
      },
    });
  });
}
```

- [ ] **Step 2: Type-check**

```bash
npm run check
```

Expected: no errors.

- [ ] **Step 3: Run the integration test — cases 3 and 4 now PASS**

```bash
npm run test:server:run -- modules/accounts/__tests__/accounts.stepup.db.integration.test.ts
```

Expected: all 4 cases PASS.

- [ ] **Step 4: Commit**

```bash
git add server/routes/security.mfa.stepup.ts
git commit -m "feat: accept password for step-up re-auth (sudo mode)"
```

---

## Task 3: Backend — relax DESTRUCTIVE TTL to 5 minutes

**Files:**
- Create: `server/middleware/__tests__/requireStepUp.ttl.test.ts`
- Modify: `server/middleware/requireStepUp.ts:21-25`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { STEP_UP_TTL } from "../requireStepUp";

describe("STEP_UP_TTL", () => {
  it("uses a 5-minute window for DESTRUCTIVE actions", () => {
    expect(STEP_UP_TTL.DESTRUCTIVE).toBe(5 * 60 * 1000);
  });

  it("keeps FINANCIAL at 5 minutes and SETTINGS at 15 minutes", () => {
    expect(STEP_UP_TTL.FINANCIAL).toBe(5 * 60 * 1000);
    expect(STEP_UP_TTL.SETTINGS).toBe(15 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run it to verify the DESTRUCTIVE assertion FAILS**

```bash
npm run test:server:run -- middleware/__tests__/requireStepUp.ttl.test.ts
```

Expected: FAIL — `STEP_UP_TTL.DESTRUCTIVE` is currently `1 * 60 * 1000`.

- [ ] **Step 3: Update the constant**

In `server/middleware/requireStepUp.ts`, change the `STEP_UP_TTL` block to:

```typescript
export const STEP_UP_TTL = {
  FINANCIAL: 5 * 60 * 1000, // 5 minutes
  SETTINGS: 15 * 60 * 1000, // 15 minutes
  DESTRUCTIVE: 5 * 60 * 1000, // 5 minutes (relaxed from 1 min for usable sudo window)
} as const;
```

- [ ] **Step 4: Run the test — PASS**

```bash
npm run test:server:run -- middleware/__tests__/requireStepUp.ttl.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/middleware/requireStepUp.ts server/middleware/__tests__/requireStepUp.ttl.test.ts
git commit -m "feat: relax DESTRUCTIVE step-up window to 5 minutes"
```

---

## Task 4: Client — `apiCall` step-up retry + `securityApi`

**Files:**
- Modify: `client/src/lib/api.ts`

- [ ] **Step 1: Add the step-up handler bridge.** Insert immediately after the `clearCsrfToken` function (around line 327):

```typescript
// ============================================================================
// STEP-UP ("SUDO MODE") HANDLER BRIDGE
// ============================================================================

// Registered by StepUpProvider so the API layer can prompt for re-authentication
// and transparently retry a request that returned 401 STEP_UP_REQUIRED.
type StepUpHandler = (level: string) => Promise<boolean>;
let stepUpHandler: StepUpHandler | null = null;

export function registerStepUpHandler(handler: StepUpHandler | null): void {
  stepUpHandler = handler;
}
```

- [ ] **Step 2: Change the `apiCall` signature** to add a retry guard:

Replace:

```typescript
async function apiCall<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
```

with:

```typescript
async function apiCall<T>(
  endpoint: string,
  options: RequestInit = {},
  retryOnStepUp = true,
): Promise<T> {
```

- [ ] **Step 3: Add the retry branch inside the `if (!response.ok)` block.**

Replace the existing block:

```typescript
  if (!response.ok) {
    // Clear CSRF token on 403 (might be invalid)
    if (response.status === 403) {
      clearCsrfToken();
    }
    const error = new Error(
      data.error?.message || "API request failed",
    ) as Error & {
      code?: string;
      details?: unknown;
      status: number;
    };
    error.code = data.error?.code;
    error.details = data.error?.details;
    error.status = response.status;
    throw error;
  }
```

with:

```typescript
  if (!response.ok) {
    // Clear CSRF token on 403 (might be invalid)
    if (response.status === 403) {
      clearCsrfToken();
    }

    // Step-up ("sudo mode"): on 401 STEP_UP_REQUIRED, prompt for re-auth and
    // retry the original request once.
    if (
      retryOnStepUp &&
      response.status === 401 &&
      (data?.error?.code === "STEP_UP_REQUIRED" || data?.requiresStepUp) &&
      stepUpHandler
    ) {
      const verified = await stepUpHandler(data?.level ?? "SETTINGS");
      if (verified) {
        return apiCall<T>(endpoint, options, false);
      }
    }

    const error = new Error(
      data.error?.message || "API request failed",
    ) as Error & {
      code?: string;
      details?: unknown;
      status: number;
    };
    error.code = data.error?.code;
    error.details = data.error?.details;
    error.status = response.status;
    throw error;
  }
```

- [ ] **Step 4: Add `securityApi`.** Insert just before the combined `export const api = {` block (around line 1326):

```typescript
// ============================================================================
// SECURITY API (step-up re-authentication)
// ============================================================================

export const securityApi = {
  /**
   * Verify step-up ("sudo mode") with the current password (works for all
   * users) or an emailed MFA code (for enrolled users). Passes
   * retryOnStepUp=false so the step-up call never recurses into step-up
   * handling.
   */
  async stepUp(payload: { password?: string; code?: string }): Promise<void> {
    await apiCall<ApiResponse<unknown>>(
      "/settings/security/step-up",
      { method: "POST", body: JSON.stringify(payload) },
      false,
    );
  },
};
```

- [ ] **Step 5: Add `security` to the combined `api` object.**

Replace:

```typescript
export const api = {
  accounts: accountsApi,
  transactions: transactionsApi,
  tags: tagsApi,
  rules: rulesApi,
  recurring: recurringApi,
};
```

with:

```typescript
export const api = {
  accounts: accountsApi,
  transactions: transactionsApi,
  tags: tagsApi,
  rules: rulesApi,
  recurring: recurringApi,
  security: securityApi,
};
```

- [ ] **Step 6: Type-check**

```bash
npm run check
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/api.ts
git commit -m "feat: centralize step-up 401 handling and add securityApi.stepUp"
```

---

## Task 5: Client — `StepUpDialog` component

**Files:**
- Create: `client/src/components/security/StepUpDialog.tsx`

- [ ] **Step 1: Create the presentational dialog**

```tsx
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface StepUpDialogProps {
  open: boolean;
  level: string;
  submitting: boolean;
  error: string | null;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

const LEVEL_COPY: Record<string, string> = {
  DESTRUCTIVE:
    "This is a destructive action. Confirm your password to continue.",
  FINANCIAL: "This moves money. Confirm your password to continue.",
  SETTINGS:
    "This changes sensitive settings. Confirm your password to continue.",
};

export function StepUpDialog({
  open,
  level,
  submitting,
  error,
  onSubmit,
  onCancel,
}: StepUpDialogProps) {
  const [password, setPassword] = useState("");

  // Never retain the password between opens.
  useEffect(() => {
    if (!open) setPassword("");
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || submitting) return;
    onSubmit(password);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Confirm it's you</DialogTitle>
            <DialogDescription>
              {LEVEL_COPY[level] ?? LEVEL_COPY.SETTINGS}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-4">
            <Label htmlFor="step-up-password">Password</Label>
            <Input
              id="step-up-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "step-up-error" : undefined}
              disabled={submitting}
            />
            {error && (
              <p
                id="step-up-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!password || submitting}>
              {submitting ? "Verifying…" : "Confirm"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npm run check
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/security/StepUpDialog.tsx
git commit -m "feat: add StepUpDialog password re-auth modal"
```

---

## Task 6: Client — `StepUpProvider` host + wire into the app

**Files:**
- Create: `client/src/components/security/StepUpProvider.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Create the host** (owns dialog state, registers the handler, resolves the retry promise)

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { registerStepUpHandler, securityApi } from "@/lib/api";
import { StepUpDialog } from "./StepUpDialog";

/**
 * Mount once near the app root. Registers a global step-up handler so the API
 * layer (api.ts) can prompt for re-authentication on 401 STEP_UP_REQUIRED and
 * transparently retry. Renders no children; it only hosts the dialog.
 */
export function StepUpProvider() {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<string>("SETTINGS");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolverRef = useRef<((verified: boolean) => void) | null>(null);

  useEffect(() => {
    registerStepUpHandler((requestedLevel: string) => {
      setLevel(requestedLevel);
      setError(null);
      setSubmitting(false);
      setOpen(true);
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
      });
    });
    return () => registerStepUpHandler(null);
  }, []);

  const finish = useCallback((verified: boolean) => {
    setOpen(false);
    setSubmitting(false);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(verified);
  }, []);

  const handleSubmit = useCallback(
    async (password: string) => {
      setSubmitting(true);
      setError(null);
      try {
        await securityApi.stepUp({ password });
        finish(true);
      } catch (err) {
        setSubmitting(false);
        setError(err instanceof Error ? err.message : "Verification failed");
      }
    },
    [finish],
  );

  const handleCancel = useCallback(() => finish(false), [finish]);

  return (
    <StepUpDialog
      open={open}
      level={level}
      submitting={submitting}
      error={error}
      onSubmit={handleSubmit}
      onCancel={handleCancel}
    />
  );
}
```

- [ ] **Step 2: Import it in `client/src/App.tsx`.** Add after the existing `CommandPaletteProvider` import (around line 33):

```tsx
import { StepUpProvider } from "@/components/security/StepUpProvider";
```

- [ ] **Step 3: Render it as a sibling of `<ImportWizard />`.**

Replace:

```tsx
                  <ImportWizard />
                  <CommandPalette />
```

with:

```tsx
                  <ImportWizard />
                  <CommandPalette />
                  <StepUpProvider />
```

- [ ] **Step 4: Type-check**

```bash
npm run check
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/security/StepUpProvider.tsx client/src/App.tsx
git commit -m "feat: mount StepUpProvider so gated actions prompt for re-auth"
```

---

## Task 7: Client — unit test for the `apiCall` step-up retry

Proves requirement #2's core logic (prompt → retry; cancel → no retry) without a browser.

**Files:**
- Create: `client/src/lib/__tests__/api.stepup.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  accountsApi,
  securityApi,
  registerStepUpHandler,
  clearCsrfToken,
} from "../api";

describe("apiCall step-up retry", () => {
  beforeEach(() => {
    registerStepUpHandler(null);
    clearCsrfToken();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    registerStepUpHandler(null);
    vi.unstubAllGlobals();
  });

  it("prompts for step-up on 401 and retries the original request", async () => {
    let deleteCalls = 0;
    let stepUpCalls = 0;

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      if (url.includes("/api/csrf-token")) {
        return new Response(JSON.stringify({ csrfToken: "test-token" }), {
          status: 200,
        });
      }
      if (url.includes("/api/settings/security/step-up")) {
        stepUpCalls++;
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (url.includes("/api/accounts/acc-1") && method === "DELETE") {
        deleteCalls++;
        if (deleteCalls === 1) {
          return new Response(
            JSON.stringify({
              success: false,
              error: { code: "STEP_UP_REQUIRED", message: "needs step-up" },
              requiresStepUp: true,
              level: "DESTRUCTIVE",
            }),
            { status: 401 },
          );
        }
        return new Response(
          JSON.stringify({ success: true, data: { message: "deleted" } }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let promptedLevel: string | null = null;
    registerStepUpHandler(async (level) => {
      promptedLevel = level;
      await securityApi.stepUp({ password: "pw" });
      return true;
    });

    await expect(accountsApi.delete("acc-1")).resolves.toBeUndefined();

    expect(promptedLevel).toBe("DESTRUCTIVE");
    expect(stepUpCalls).toBe(1);
    expect(deleteCalls).toBe(2); // original + retry
  });

  it("does not retry when the user cancels step-up", async () => {
    let deleteCalls = 0;

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      if (url.includes("/api/csrf-token")) {
        return new Response(JSON.stringify({ csrfToken: "t" }), { status: 200 });
      }
      if (url.includes("/api/accounts/acc-1") && method === "DELETE") {
        deleteCalls++;
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: "STEP_UP_REQUIRED", message: "needs step-up" },
            requiresStepUp: true,
            level: "DESTRUCTIVE",
          }),
          { status: 401 },
        );
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    registerStepUpHandler(async () => false); // user cancels

    await expect(accountsApi.delete("acc-1")).rejects.toMatchObject({
      code: "STEP_UP_REQUIRED",
      status: 401,
    });
    expect(deleteCalls).toBe(1); // no retry
  });
});
```

- [ ] **Step 2: Run the test**

```bash
npm run test:run -- client/src/lib/__tests__/api.stepup.test.ts
```

Expected: both cases PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/lib/__tests__/api.stepup.test.ts
git commit -m "test: cover apiCall step-up prompt-and-retry"
```

---

## Task 8: Full verification + docs

- [ ] **Step 1: Type-check (must be clean)**

```bash
npm run check
```

- [ ] **Step 2: Server suite (real DB)**

```bash
npm run test:server:run
```

Expected: all pass, including `accounts.stepup.db.integration.test.ts` and `requireStepUp.ttl.test.ts`.

- [ ] **Step 3: Client suite**

```bash
npm run test:run
```

Expected: all pass, including `api.stepup.test.ts`.

- [ ] **Step 4: Annotate the mocked test** so future readers know it does not guard step-up. In `server/modules/accounts/__tests__/accounts.integration.test.ts`, replace the mock block:

```typescript
vi.mock("../../../middleware/requireStepUp", () => ({
  requireStepUp: () => (req: any, res: any, next: any) => next(),
}));
```

with:

```typescript
// NOTE: requireStepUp is mocked to a no-op here so these controller-level tests
// can focus on validation/audit. The REAL step-up behaviour (password re-auth,
// the 401 gate, DB state) is guarded by accounts.stepup.db.integration.test.ts.
vi.mock("../../../middleware/requireStepUp", () => ({
  requireStepUp: () => (req: any, res: any, next: any) => next(),
}));
```

- [ ] **Step 5: Create the plan pointer in the repo convention location**

Create `docs/architecture/step-up-reauth-implementation-plan.md`:

```markdown
# Step-Up Re-Auth — Implementation Plan

The full task-by-task implementation plan lives at
[docs/superpowers/plans/2026-06-05-step-up-reauth.md](../superpowers/plans/2026-06-05-step-up-reauth.md).

Design spec: [step-up-reauth-design.md](./step-up-reauth-design.md).
```

- [ ] **Step 6: Commit docs + annotation**

```bash
git add server/modules/accounts/__tests__/accounts.integration.test.ts docs/architecture/step-up-reauth-implementation-plan.md
git commit -m "docs: annotate mocked step-up test and add plan pointer"
```

- [ ] **Step 7: Manual end-to-end check (optional, real app)**

```bash
npm run dev        # terminal 1 (Express)
npm run dev:client # terminal 2 (Vite :5000)
```

As a default non-MFA user: Accounts → delete an account → password dialog appears → enter password → deletion succeeds. Confirm in DevTools Network: `DELETE /api/accounts/:id` 401 → `POST /api/settings/security/step-up` 200 → `DELETE` retry 200.

---

## Self-Review

**Spec coverage:**
- §3.1 dual-mode endpoint → Task 2. ✓
- §3.2 `authLimiter` → Task 2 (import + route). ✓
- §3.3 DESTRUCTIVE TTL → Task 3. ✓
- §3.4 `requireStepUp` unchanged → respected (no edits beyond the TTL constant). ✓
- §4.1 centralized retry + `securityApi.stepUp` → Task 4. ✓
- §4.2 `StepUpDialog` + `StepUpProvider` → Tasks 5–6. ✓
- §4.3 zero per-hook changes → confirmed (no hook edits in any task). ✓
- §5 real-DB test, delete + transfer, fail-then-pass → Task 1. ✓
- §6 verification → Task 8. ✓
- Mocked-test annotation → Task 8 Step 4. ✓

**Placeholder scan:** none — every code/test step contains complete code; every command has expected output.

**Type/name consistency:** `registerStepUpHandler`, `securityApi.stepUp`, `apiCall(endpoint, options, retryOnStepUp)`, `STEP_UP_TTL`, `StepUpDialog` props (`open/level/submitting/error/onSubmit/onCancel`) are used identically across Tasks 4–7. Endpoint path `/api/settings/security/step-up` (client uses `/settings/security/step-up` since `apiCall` prefixes `/api`). Error code `STEP_UP_REQUIRED` (server) and `INVALID_CREDENTIALS` (failure) match between Task 1 assertions and Task 2 responses. ✓

**Notes for the executor:**
- Commit messages are plain conventional commits (no attribution trailer) per the repo's global git config.
- The single-file server test command form is `npm run test:server:run -- <path-relative-to-server/>`.
