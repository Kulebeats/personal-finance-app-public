import { defineConfig } from "vitest/config";
import path from "path";
import dotenv from "dotenv";
import {
  resolveTestDatabaseUrl,
  assertNotDevDatabase,
} from "./testing/test-database";

// Load .env from parent directory
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// Set NODE_ENV to test for vitest runs
process.env.NODE_ENV = "test";

// Point the suite at a DEDICATED test database before any test imports
// `server/db.ts` (which reads DATABASE_URL at module load).
//
// Loading `.env` above sets DATABASE_URL to the DEV database, and the real-DB
// integration suites DELETE users/households in cleanup — so without this, a
// test run destroys dev data. Locally `finance_app` derives `finance_app_test`;
// in CI, DATABASE_URL is already `pfa_test` and is used unchanged.
const ambientDatabaseUrl = process.env.DATABASE_URL;
const testDatabaseUrl = resolveTestDatabaseUrl({
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
  DATABASE_URL: ambientDatabaseUrl,
});
assertNotDevDatabase(testDatabaseUrl, ambientDatabaseUrl);
process.env.DATABASE_URL = testDatabaseUrl;

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    maxConcurrency: 1,
    testTimeout: 15000,
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json"],
      reportsDirectory: "../.local/coverage/server",
      include: [
        "core/calculations/**/*.ts",
        "core/money.ts",
        "core/validation/money.ts",
        "modules/accounts/**/*.ts",
        "modules/ai/**/*.ts",
        "modules/budgets/**/*.ts",
        "modules/cashflow/**/*.ts",
        "modules/filter-presets/**/*.ts",
        "modules/goals/**/*.ts",
        "modules/investments/**/*.ts",
        "modules/merchants/**/*.ts",
        "modules/recurring/**/*.ts",
        "modules/reports/**/*.ts",
        "modules/transactions/**/*.ts",
        "repositories/**/*.ts",
        "routes/budgets.ts",
        "routes/grz-securities.ts",
        "routes/import.ts",
        "routes/investments.ts",
        "routes/reports.ts",
        "routes/transactions.ts",
        "services/account/**/*.ts",
        "services/budget/**/*.ts",
        "services/goal/**/*.ts",
        "services/investment/**/*.ts",
        "services/recurring/**/*.ts",
        "services/transaction/**/*.ts",
        "services/AccountService.ts",
        "services/BudgetService.ts",
        "services/ImportService.ts",
        "services/import/**/*.ts",
        "services/TransferService.ts",
        "services/GoalAccountAssignmentService.ts",
        "services/RecurringService.ts",
        "services/TransactionGoalLinkService.ts",
        "services/grz-service.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "**/*.integration.test.ts",
        "**/__tests__/**",
        "**/*.d.ts",
        "**/index.ts",
      ],
      thresholds: {
        statements: 60,
        branches: 45,
        functions: 60,
        lines: 60,
        "core/calculations/**/*.ts": {
          statements: 50,
          branches: 40,
          functions: 55,
          lines: 50,
        },
        "modules/{accounts,budgets,cashflow,filter-presets,goals,investments,merchants,recurring,reports,transactions}/**/*.ts": {
          statements: 75,
          branches: 58,
          functions: 78,
          lines: 78,
        },
        "repositories/**/*.ts": {
          statements: 60,
          branches: 44,
          functions: 63,
          lines: 62,
        },
        "services/{account,budget,goal,recurring,transaction}/**/*.ts": {
          statements: 38,
          branches: 34,
          functions: 37,
          lines: 39,
        },
        // R14: newly-included high-risk paths that previously had NO coverage
        // floor at all (audit v2 finding E2). These thresholds are ratchets
        // calibrated to CURRENT measured coverage (2026-07-13), not quality
        // targets - they only need to stop further erosion. Raising these to
        // Rule 17's 80% financial-operations bar is a later packet.
        //
        // GRZ money math (bond/T-bill coupon, WHT, discount, yield + the cron
        // automation that drives it). Measured: stmts 42.18%, branches
        // 29.78%, functions 52.94%, lines 43.37%.
        "{routes/grz-securities.ts,services/grz-service.ts,services/investment/**/*.ts}": {
          statements: 40,
          branches: 28,
          functions: 50,
          lines: 41,
        },
        // AI/PII module (Gemini orchestration, sanitiser, guardrails,
        // conversation persistence). Measured: stmts 47.17%, branches
        // 35.19%, functions 52.33%, lines 47.99%.
        "modules/ai/**/*.ts": {
          statements: 45,
          branches: 33,
          functions: 50,
          lines: 46,
        },
        // CSV import (parse/execute route + ImportService). Measured:
        // stmts 70.95%, branches 54.35%, functions 76.19%, lines 70.81%.
        // NOTE: keep `services/import/**` in this glob. The parsing helpers were
        // extracted there during the LOC burn-down; a glob naming only the old
        // single file would silently stop gating them (the same stale-scope
        // failure Rule 2 itself hit).
        "{routes/import.ts,services/ImportService.ts,services/import/**/*.ts}": {
          statements: 68,
          branches: 52,
          functions: 74,
          lines: 68,
        },
      },
    },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
});
