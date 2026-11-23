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
import grzValuationRoutes from "./routes/grz-valuations";
import grzPrincipalBasisRoutes from "./routes/grz-principal-basis";
import investmentNotificationRoutes from "./routes/investment-notifications";
import investmentAnalyticsRoutes from "./routes/investment-analytics";
import investmentTaxRoutes from "./routes/investment-tax";
import investmentPensionRoutes from "./routes/investment-pension";
import investmentRecurringRoutes from "./routes/investment-recurring";
import investmentOccurrencesRoutes from "./modules/investments/investments.occurrences.routes";
import investmentMarketRoutes from "./routes/investment-market";
import grzCalculatorsRoutes from "./routes/grz-calculators";
import grzAuctionsRoutes from "./routes/grz-auctions";
// Legacy routes removed (cutover complete): weekly-recap
import adminRoutes from "./routes/admin";
// Mounted inside the settings router; imported here only so its own `:id` gets the uuid check.
import personalSettingsRoutes from "./modules/settings/settings.personal.routes";
import { generalLimiter } from "./middleware/rateLimit";
import { registerUuidParams } from "./middleware/uuidParams";
import { generateCsrfToken } from "./app";
import { legacyApiRedirect } from "./middleware/apiVersion";
import { isCronHttpEnabled } from "./core/scheduling/schedulerConfig";
import { warnIfCronSecretMissing } from "./core/scheduling/cronSecret";

export async function registerRoutes(app: Express): Promise<Server> {
  // Log route configuration at startup (all modules now use modular routes)
  logger.info(
    "Route configuration: All modules using modular routes (cutover complete)",
  );

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

  // Deprecation headers on unversioned /api/* routes (header only; nothing is redirected)
  app.use("/api", legacyApiRedirect);

  // VERSIONING (NEW-33): there is NO /api/v1 alias. An earlier /api/v1 mount here only
  // forwarded the request unchanged (it never rewrote the URL), so every router below is
  // mounted at /api/<name> only and /api/v1/<name> falls through to the /api catch-all and
  // answers a JSON 404. The Deprecation/Link headers above point at /api/v1, a path that does
  // not exist yet. No alias is added.

  // Malformed ids on the money and organisation routers answer 400 VALIDATION_ERROR instead
  // of reaching Postgres as an invalid uuid (500). Every id param listed here is a uuid
  // primary key (categories `id` covers category groups too).
  registerUuidParams([
    { router: modularTagsRoutes, params: ["id", "transactionId", "tagId"] },
    { router: modularCategoriesRoutes, params: ["id"] },
    // Not `context` on filter presets: /default/:context is a named view, not an id.
    { router: filterPresetsRoutes, params: ["id"] },
    { router: modularReportsRoutes, params: ["id"] },
    { router: personalSettingsRoutes, params: ["id"] },
    { router: investmentRecurringRoutes, params: ["id"] },
    { router: investmentOccurrencesRoutes, params: ["planId"] },
    { router: modularHouseholdRoutes, params: ["inviteId"] },
    { router: adminRoutes, params: ["id", "roleId"] },
    { router: transactionsRoutes, params: ["id", "attachmentId"] },
    { router: accountsRoutes, params: ["id"] },
    { router: modularBudgetsRoutes, params: ["id"] },
    { router: goalsRoutes, params: ["id", "accountId", "txId"] },
    { router: modularRecurringRoutes, params: ["id", "linkId", "transactionId"] },
    { router: modularRulesRoutes, params: ["id"] },
    { router: modularReceiptsRoutes, params: ["id"] },
    { router: modularInvestmentsRoutes, params: ["id"] },
    { router: modularMerchantsRoutes, params: ["id", "sourceId", "historyId", "aliasId"] },
    { router: grzSecuritiesRoutes, params: ["id"] },
    { router: investmentPensionRoutes, params: ["id"] },
  ]);

  // Authentication attempts are throttled on their specific routes.
  app.use("/api/auth", authRoutes);

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
  app.use("/api/reports", modularReportsRoutes);

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
  // Operator market refresh needs no household: mount it ahead of the
  // household-guarded /api/investments router below (NEW-13).
  app.use("/api/investments/market", investmentMarketRoutes);
  app.use("/api/investments", investmentOccurrencesRoutes);
  app.use("/api/investments/recurring", investmentRecurringRoutes);
  app.use("/api/investments/grz/calculate", grzCalculatorsRoutes);
  app.use("/api/investments/grz", grzAuctionsRoutes);

  // Investments routes (modular - cutover complete)
  app.use("/api/investments", modularInvestmentsRoutes);

  // GRZ Securities routes
  app.use("/api/grz", grzValuationRoutes);
  app.use("/api/grz", grzSecuritiesRoutes);
  app.use("/api/grz", grzPrincipalBasisRoutes);

  // Investment Analytics
  app.use("/api/investments/analytics", investmentAnalyticsRoutes);

  // Weekly Recap (modular - cutover complete, uses analytics limiter)
  app.use("/api/weekly-recap", modularWeeklyRecapRoutes);

  // FIX DOC-AI-001: AI routes inherit general rate limit from /api, plus custom household-level limits
  app.use("/api/ai", aiRoutes);

  // Filter Presets routes
  app.use("/api/filter-presets", filterPresetsRoutes);

  // Cron job routes (CRON_SECRET; without it every request is refused)
  if (isCronHttpEnabled()) {
    warnIfCronSecretMissing();
    app.use("/api/cron", cronRoutes);
  }

  // Admin routes for shadow mode monitoring
  app.use("/api/admin", adminRoutes);

  const httpServer = createServer(app);

  return httpServer;
}
