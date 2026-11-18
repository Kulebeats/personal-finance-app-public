/**
 * Reports Module Index
 *
 * Unified exports for the reports module.
 *
 * @module modules/reports
 */

export { default as reportsRoutes } from "./reports.routes";
export { reportsAnnualController } from "./reports.annual.controller";
export { reportsCashflowController } from "./reports.cashflow.controller";
export { reportsSpendingController } from "./reports.spending.controller";
export { reportsNetWorthController } from "./reports.networth.controller";
export { reportsAnalyticsController } from "./reports.analytics.controller";
export { reportsCustomController } from "./reports.custom.controller";
export { reportsExportsController } from "./reports.exports.controller";
export { reportsService } from "./reports.service";
export * from "./reports.types";
export * from "./reports.utils";
