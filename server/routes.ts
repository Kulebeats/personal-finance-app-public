import type { Express } from "express";
import { createServer, type Server } from "node:http";
import { logger } from "./utils/logger";

// Feature flags removed - all modules now use modular routes (cutover complete)

// =============================================================================
// Modular Routes (Phase 4)
// =============================================================================
import {
  reportsRoutes as modularReportsRoutes,
  budgetsRoutes as modularBudgetsRoutes,
  recurringRoutes as modularRecurringRoutes,
  investmentsRoutes as modularInvestmentsRoutes,
  settingsRoutes as modularSettingsRoutes,
  categoriesRoutes as modularCategoriesRoutes,
  tagsRoutes as modularTagsRoutes,
  merchantsRoutes as modularMerchantsRoutes,
  notificationsRoutes as modularNotificationsRoutes,
  // Week 12
  rulesRoutes as modularRulesRoutes,
  receiptsRoutes as modularReceiptsRoutes,
  weeklyRecapRoutes as modularWeeklyRecapRoutes,
  householdRoutes as modularHouseholdRoutes,
  healthRoutes,
  // Auth module (cutover 2026-01-26)
  authRoutes,
  // AI module (2026-01-29)
  aiRoutes,
  // Filter Presets module
  filterPresetsRoutes,
} from "./modules";

// =============================================================================
// Other Routes
// =============================================================================
// Legacy routes removed (cutover complete): settings, household, categories, merchants, tags, rules, reports, auth
import { accountsRoutes } from "./modules/accounts";
import { transactionsRoutes } from "./modules/transactions";
// Legacy routes removed (cutover complete): budgets, recurring
import { goalsRoutes } from "./modules/goals";
import cronRoutes from "./routes/cron";
import securityRoutes from "./routes/security";
// Legacy routes removed (cutover complete): receipts, notifications
import importRoutes from "./routes/import";
// Legacy routes removed (cutover complete): investments
import grzSecuritiesRoutes from "./routes/grz-securities";
import investmentNotificationRoutes from "./routes/investment-notifications";
import investmentAnalyticsRoutes from "./routes/investment-analytics";
import investmentTaxRoutes from "./routes/investment-tax";
import investmentPensionRoutes from "./routes/investment-pension";
import investmentRecurringRoutes from "./routes/investment-recurring";
import investmentMarketRoutes from "./routes/investment-market";
import grzCalculatorsRoutes from "./routes/grz-calculators";
import grzAuctionsRoutes from "./routes/grz-auctions";
// Legacy routes removed (cutover complete): weekly-recap
import adminRoutes from "./routes/admin";
import {
  generalLimiter,
  analyticsLimiter,
  authLimiter,
  ipAuthLimiter,
} from "./middleware/rateLimit";
import { generateCsrfToken } from "./app";
import { legacyApiRedirect } from "./middleware/apiVersion";

export async function registerRoutes(app: Express): Promise<Server> {
  // Log route configuration at startup (all modules now use modular routes)
  logger.info(
    "Route configuration: All modules using modular routes (cutover complete)",
  );

  // =============================================================================
  // Health Check Endpoints (top-level - not under /api for orchestration)
  // Per spec: ENTERPRISE REFACTORING SPECIFICATION.md (p.737-790)
  // =============================================================================
  app.use("/health", healthRoutes);

  // CSRF token endpoint (must be before protection middleware applies to routes)
  app.get("/api/csrf-token", (req, res) => {
    const token = generateCsrfToken(req, res);
    res.json({ csrfToken: token });
  });

  // Health check for route configuration
  app.get("/api/health/routes", (req, res) => {
    res.json({
      status: "modular",
      message: "All modules using modular routes (cutover complete)",
      timestamp: new Date().toISOString(),
    });
  });

  // Apply general rate limiting to all API routes
  app.use("/api", generalLimiter);

  // Apply deprecation warning for unversioned /api/* routes
  // Clients should migrate to /api/v1/*
  app.use("/api", legacyApiRedirect);

  // Mount /api/v1/* as an alias to /api/* (forwards to same handlers)
  // This allows clients to use versioned URLs without duplicating routes
  app.use("/api/v1", (req, _res, next) => {
    // Rewrite URL to remove /v1 so downstream routes work as-is
    req.url = req.url || "/";
    next();
  });

  // All routes below work for both /api/* and /api/v1/*

  // Authentication routes (modular - cutover 2026-01-26, with stricter rate limit)
  app.use("/api/auth", ipAuthLimiter, authLimiter, authRoutes);

  // Security routes (must come BEFORE settings routes for path matching)
  app.use("/api/settings/security", securityRoutes);

  // Settings routes (modular - cutover complete)
  app.use("/api/settings", modularSettingsRoutes);

  // Household routes (modular - cutover complete)
  app.use("/api/household", modularHouseholdRoutes);

  // Accounts routes (already modular)
  app.use("/api/accounts", accountsRoutes);

  // Import routes
  app.use("/api/import", importRoutes);

  // Categories routes (modular - cutover complete)
  app.use("/api/categories", modularCategoriesRoutes);

  // Merchants routes (modular - cutover complete)
  app.use("/api/merchants", modularMerchantsRoutes);

  // Tags routes (modular - cutover complete)
  app.use("/api/tags", modularTagsRoutes);

  // Rules routes (modular - cutover complete)
  app.use("/api/rules", modularRulesRoutes);

  // Reports routes (modular - cutover complete, with analytics rate limit)
  app.use("/api/reports", analyticsLimiter, modularReportsRoutes);

  // Transactions routes (already modular)
  app.use("/api/transactions", transactionsRoutes);

  // Budgets routes (modular - cutover complete)
  app.use("/api/budgets", modularBudgetsRoutes);

  // Goals routes (already modular)
  app.use("/api/goals", goalsRoutes);

  // Recurring transactions routes (modular - cutover complete)
  app.use("/api/recurring", modularRecurringRoutes);

  // Receipts routes (modular - cutover complete)
  app.use("/api/receipts", modularReceiptsRoutes);

  // Notifications routes (modular - cutover complete)
  app.use("/api/notifications", modularNotificationsRoutes);

  // Investment tracking routes (per-module flag for main investments)
  app.use("/api/investments/notifications", investmentNotificationRoutes);
  app.use("/api/investments/tax", investmentTaxRoutes);
  app.use("/api/investments/pension", investmentPensionRoutes);
  app.use("/api/investments/recurring", investmentRecurringRoutes);
  app.use("/api/investments/market", investmentMarketRoutes);
  app.use("/api/investments/grz/calculate", grzCalculatorsRoutes);
  app.use("/api/investments/grz", grzAuctionsRoutes);

  // Investments routes (modular - cutover complete)
  app.use("/api/investments", modularInvestmentsRoutes);

  // GRZ Securities routes
  app.use("/api/grz", grzSecuritiesRoutes);

  // Investment Analytics
  app.use("/api/investments/analytics", investmentAnalyticsRoutes);

  // Weekly Recap (modular - cutover complete, uses analytics limiter)
  app.use("/api/weekly-recap", analyticsLimiter, modularWeeklyRecapRoutes);

  // FIX DOC-AI-001: AI routes inherit general rate limit from /api, plus custom household-level limits
  app.use("/api/ai", aiRoutes);

  // Filter Presets routes
  app.use("/api/filter-presets", filterPresetsRoutes);

  // Cron job routes (protected by CRON_SECRET)
  app.use("/api/cron", cronRoutes);

  // Admin routes for shadow mode monitoring
  app.use("/api/admin", adminRoutes);

  const httpServer = createServer(app);

  return httpServer;
}
