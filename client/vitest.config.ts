import { configDefaults, defineConfig } from "vitest/config";
import { resolve } from "path";

process.env.BROWSERSLIST_IGNORE_OLD_DATA ??= "1";

// Specs that must run in a UTC+2 zone. Assigning process.env.TZ inside a
// worker thread does not change that thread's Date zone, so these run in a
// forked child whose TZ is set when the process is spawned.
const LUSAKA_TZ_SPECS = ["client/src/hooks/__tests__/use-reports.month-range.test.ts"];

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: [resolve(__dirname, "src/test-setup.ts")],
    globals: true,
    pool: "threads",
    fileParallelism: false,
    maxConcurrency: 1,
    // Client runner: only client specs. Run from the repo root, an unscoped
    // "**/*" swept in server/** (needs real Postgres/node) and e2e/** (Playwright
    // specs that fail under vitest), which have their own CI steps/jobs.
    // `include` lives on each project: `extends: true` concatenates arrays, so
    // a root-level include would pull every spec into the TZ project too.
    projects: [
      {
        extends: true,
        test: {
          name: "client",
          include: ["client/**/*.{test,spec}.{ts,tsx}"],
          exclude: [...configDefaults.exclude, ...LUSAKA_TZ_SPECS],
        },
      },
      {
        extends: true,
        test: {
          name: "client-tz-lusaka",
          include: LUSAKA_TZ_SPECS,
          pool: "forks",
          env: { TZ: "Africa/Lusaka" },
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json"],
      reportsDirectory: ".local/coverage/client",
      include: [
        "src/features/accounts/**/*.{ts,tsx}",
        "src/features/ai/**/*.{ts,tsx}",
        "src/features/budget/**/*.{ts,tsx}",
        "src/features/cashflow/**/*.{ts,tsx}",
        "src/features/goals/**/*.{ts,tsx}",
        "src/features/investments/**/*.{ts,tsx}",
        "src/features/recurring/**/*.{ts,tsx}",
        "src/features/reports/**/*.{ts,tsx}",
        "src/features/settings/schemas/**/*.ts",
        "src/features/settings/utils/**/*.ts",
        "src/features/settings/components/**/*.tsx",
        "src/features/transactions/**/*.{ts,tsx}",
        "src/components/reports/**/*.{ts,tsx}",
        "src/components/RouteErrorBoundary.tsx",
        "src/pages/settings/**/*.tsx",
        "src/utils/**/*.ts",
        "src/hooks/**/*.ts",
        "src/lib/**/*.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.property.test.ts",
        "**/*.property.test.tsx",
        "**/index.ts",
        "**/index.tsx",
        "**/__tests__/**",
        "**/mocks/**",
      ],
      thresholds: {
        statements: 42,
        branches: 38,
        functions: 38,
        lines: 42,
        "src/features/accounts/**/*.{ts,tsx}": {
          statements: 36,
          branches: 25,
          functions: 29,
          lines: 35,
        },
        "src/features/ai/**/*.{ts,tsx}": {
          statements: 85,
          branches: 78,
          functions: 85,
          lines: 85,
        },
        "src/features/budget/**/*.{ts,tsx}": {
          statements: 62,
          branches: 56,
          functions: 60,
          lines: 63,
        },
        "src/features/cashflow/**/*.{ts,tsx}": {
          statements: 60,
          branches: 43,
          functions: 58,
          lines: 60,
        },
        "src/features/goals/**/*.{ts,tsx}": {
          statements: 80,
          branches: 50,
          functions: 80,
          lines: 80,
        },
        "src/features/investments/**/*.{ts,tsx}": {
          statements: 49,
          branches: 36,
          functions: 29,
          lines: 49,
        },
        "src/features/recurring/**/*.{ts,tsx}": {
          statements: 60,
          branches: 52,
          functions: 44,
          lines: 60,
        },
        "src/features/reports/**/*.{ts,tsx}": {
          statements: 47,
          branches: 38,
          functions: 40,
          lines: 49,
        },
        "src/features/transactions/**/*.{ts,tsx}": {
          statements: 41,
          branches: 41,
          functions: 31,
          lines: 40,
        },
        "src/components/reports/**/*.{ts,tsx}": {
          statements: 60,
          branches: 65,
          functions: 50,
          lines: 63,
        },
        "src/features/settings/**/*.{ts,tsx}": {
          statements: 95,
          branches: 85,
          functions: 95,
          lines: 95,
        },
        "src/utils/**/*.ts": {
          statements: 70,
          branches: 65,
          functions: 85,
          lines: 70,
        },
        "src/hooks/**/*.ts": {
          statements: 28,
          branches: 15,
          functions: 29,
          lines: 29,
        },
        "src/lib/**/*.ts": {
          statements: 28,
          branches: 20,
          functions: 33,
          lines: 29,
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@assets": resolve(__dirname, "../attached_assets"),
      // SCP-334: client source imports from @shared (e.g. ruleConditions); without
      // this alias the whole RulesSection suite failed to load (0 tests). Mirrors
      // the root vitest.config.ts and vite.config.ts.
      "@shared": resolve(__dirname, "../shared"),
    },
  },
});
