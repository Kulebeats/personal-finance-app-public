/**
 * Server Modules Index
 *
 * Central export for all feature modules.
 * Each module follows the modular monolith pattern:
 * - controller.ts - HTTP handlers
 * - service.ts - Business logic (or re-export)
 * - routes.ts - Express routes
 * - README.md - API documentation
 */

// =============================================================================
// Phase 2: Core Modules
// =============================================================================

// Auth module
export { default as authRoutes } from "./auth/auth.routes";

// Transactions module
export {
  transactionService,
  createTransactionSchema,
  updateTransactionSchema,
  TransactionEvents,
} from "./transactions";

// =============================================================================
// Phase 4: Feature Modules (Week 9-11)
// =============================================================================

// Reports module
export { reportsRoutes, reportsService } from "./reports";

// Budgets module
export { budgetsRoutes, budgetsController, budgetsService } from "./budgets";

// Recurring module
export {
  recurringRoutes,
  recurringController,
  recurringService,
} from "./recurring";

// Investments module
export { investmentsRoutes, investmentsController } from "./investments";

// Settings module
export { settingsRoutes, settingsController } from "./settings";

// Categories module
export { categoriesRoutes, categoriesController } from "./categories";

// Tags module
export { tagsRoutes, tagsController } from "./tags";

// Merchants module
export { merchantsRoutes, merchantsController } from "./merchants";

// Notifications module
export { notificationsRoutes, notificationsController } from "./notifications";

// =============================================================================
// Phase 4: Feature Modules (Week 12)
// =============================================================================

// Rules module
export { rulesRoutes, rulesController } from "./rules";

// Receipts module
export { receiptsRoutes, receiptsController } from "./receipts";

// Weekly Recap module
export { weeklyRecapRoutes, weeklyRecapController } from "./weekly-recap";

// Household module
export { householdRoutes, householdController } from "./household";

// Health module
export { healthRoutes, healthController } from "./health";

// AI module
export { aiRoutes, AIService, AIAnalyticsService } from "./ai";

// Filter Presets module
export { filterPresetsRoutes, filterPresetsController } from "./filter-presets";
