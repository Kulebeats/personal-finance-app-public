/**
 * Test Fixtures and Helpers
 *
 * Shared utilities for integration tests.
 */

import { randomUUID } from "crypto";
import { app } from "../app";
import { registerRoutes } from "../routes";

import { apiErrorMiddleware } from "../utils/errorHandler";
import { apiNotFound } from "../middleware/apiNotFound";
import { Request, Response, NextFunction } from "express";

let routesRegistered = false;

/**
 * Get app with routes registered.
 * Call this once before running tests that need HTTP endpoints.
 */
export async function getTestApp() {
  if (!routesRegistered) {
    await registerRoutes(app);

    // Unknown /api paths answer a JSON 404, as in app.ts
    app.use("/api", apiNotFound);

    // Add error handling middleware to match app.ts
    app.use(apiErrorMiddleware);

    // Fallback error handler
    app.use(
      (
        err: Error & { status?: number; statusCode?: number; code?: string },
        _req: Request,
        res: Response,
        _next: NextFunction,
      ) => {
        const status = err.status || err.statusCode || 500;
        res.status(status).json({
          success: false,
          error: {
            code: err.code || "UNKNOWN_ERROR",
            message: err.message || "An unexpected error occurred",
          },
        });
      },
    );

    routesRegistered = true;
  }
  return app;
}

export interface TestUser {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  fullName: string;
  householdId: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}

export interface TestHousehold {
  id: string;
  name: string;
  currency: string;
  defaultExpenseGroupId: string;
  defaultIncomeGroupId: string;
}

/**
 * Create a test user fixture
 */
export function createTestUser(overrides?: Partial<TestUser>): TestUser {
  const id = randomUUID();
  const shortId = id.slice(0, 8);
  return {
    id,
    email: `test${shortId}@example.com`,
    username: `testuser${shortId}`,
    passwordHash: "$2b$10$mockedHashForTesting",
    fullName: "Test User",
    householdId: randomUUID(),
    emailVerified: true,
    mfaEnabled: false,
    failedLoginAttempts: 0,
    lockedUntil: null,
    ...overrides,
  };
}

/**
 * Create a test household fixture
 */
export function createTestHousehold(
  userId: string,
  overrides?: Partial<TestHousehold>,
): TestHousehold {
  const id = randomUUID();
  return {
    id,
    name: "Test Household",
    currency: "ZMW",
    defaultExpenseGroupId: randomUUID(),
    defaultIncomeGroupId: randomUUID(),
    ...overrides,
  };
}

/**
 * Cleanup test data (placeholder for actual database cleanup)
 * TODO: Implement real database cleanup when tests use real DB
 */
export async function cleanupTestData(
  userId: string,
  householdId: string,
): Promise<void> {
  // TODO: Delete test data from database
  // await db.delete(users).where(eq(users.id, userId));
  // await db.delete(households).where(eq(households.id, householdId));
}

/**
 * Create mock auth cookie for tests
 */
export function createMockAuthCookie(
  sessionId: string,
  userId: string,
): string {
  // Simplified mock - real implementation would use express-session format
  return `connect.sid=s%3A${sessionId}.mock-signature; Path=/; HttpOnly`;
}
