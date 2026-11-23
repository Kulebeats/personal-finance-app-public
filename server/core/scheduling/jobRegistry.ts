import { SCHEDULED_JOB_SPECS, type ScheduledJobName, type ScheduledJobSpec } from "./jobCatalog";
import {
  runBudgetAlerts, runBudgetRollover, runDailySecurityReport, runFxRefresh, runGoalDeadlines, runGoalWeeklyReport,
  runMerchantLogoCleanup, runNotificationCleanup, runPersonalExportCleanup, runRecurringMaterialization,
  runRecurringReminders, runSipCatchUp, runSnapshots, runStalePriceAlerts, runTBillMaturities, runWeeklyRecap,
} from "./jobRunners";
import type { ScheduledJobDefinition } from "./scheduledJob";

/** The code each catalogued job runs. A catalog entry without one fails to type-check. */
const RUNNERS: Readonly<Record<ScheduledJobName, ScheduledJobDefinition["run"]>> = {
  "market.fx-refresh": runFxRefresh,
  "market.stale-price-alerts": runStalePriceAlerts,
  "recurring.remind": runRecurringReminders,
  "goals.deadlines": runGoalDeadlines,
  "budget.alerts": runBudgetAlerts,
  "goals.weekly-report": runGoalWeeklyReport,
  "recurring.materialize": runRecurringMaterialization,
  "investments.tbill-maturity": runTBillMaturities,
  "investments.recurring-purchase": runSipCatchUp,
  "budget.rollover": runBudgetRollover,
  "cleanup.notifications": runNotificationCleanup,
  "cleanup.merchant-logos": runMerchantLogoCleanup,
  "cleanup.personal-exports": runPersonalExportCleanup,
  "snapshots.daily": runSnapshots,
  "security.daily-report": runDailySecurityReport,
  "recap.weekly": runWeeklyRecap,
};

/** Every job the in-process scheduler runs: its catalogued schedule plus its code. */
export const SCHEDULED_JOBS: readonly (ScheduledJobDefinition & ScheduledJobSpec)[] = Object.freeze(
  SCHEDULED_JOB_SPECS.map((spec) => Object.freeze({ ...spec, run: RUNNERS[spec.name] })),
);

export const SCHEDULED_JOB_NAMES: readonly string[] = Object.freeze(SCHEDULED_JOBS.map((job) => job.name));
