import { canonicalJson, fail, sha256, validateCode, validatePolicy, type DueItemRequest, type DueKind, type JobTransition, type OperationalPolicy } from "./contracts";

export type RequiredFamily = "recurring" | "budgets" | "goals" | "snapshots" | "market" | "investments" | "grz" | "outbox" | "receipts" | "recap" | "security" | "cleanup";
export type Blocker = "missing-producer" | "due-policy-unreviewed" | "fence-not-integrated" | "external-delivery-unsettled";
export interface CatalogEntry {
  readonly name: string; readonly family: RequiredFamily; readonly sourceRefs: readonly string[];
  readonly trigger: string | null; readonly effect: "database" | "external" | "mixed" | "unresolved";
  readonly blockers: readonly Blocker[]; readonly integration: "unsupported";
  readonly duePolicy: null; readonly storageDefinition: null;
}
const source = (name: string, family: RequiredFamily, sourceRefs: string[], trigger: string | null, effect: CatalogEntry["effect"], blockers: Blocker[] = []): CatalogEntry => Object.freeze({
  name, family, sourceRefs: Object.freeze(sourceRefs), trigger, effect,
  blockers: Object.freeze<Blocker[]>(["due-policy-unreviewed", "fence-not-integrated", ...(effect === "external" || effect === "mixed" ? ["external-delivery-unsettled"] as Blocker[] : []), ...blockers]),
  integration: "unsupported", duePolicy: null, storageDefinition: null,
});
export const REQUIRED_JOB_CATALOG: readonly CatalogEntry[] = Object.freeze([
  source("recurring.materialize", "recurring", ["server/routes/cron.ts", "server/services/recurring/RecurringProcessingService.ts"], "/recurring", "database"),
  source("recurring.remind", "recurring", ["server/routes/cron.ts", "notification service"], "/recurring-reminders", "external"),
  source("budget.rollover", "budgets", ["server/routes/cron.ts", "budget service"], "/budget-rollover", "database"),
  source("budget.alerts", "budgets", ["server/routes/cron.ts", "notification service"], "/budget-alerts", "external"),
  source("goals.status", "goals", ["server/routes/cron.ts", "goalStatusWorker"], "/goals-status", "database"),
  source("goals.deadlines", "goals", ["server/routes/cron.ts", "goalReminderWorker"], "/goals-deadlines", "external"),
  source("goals.weekly-report", "goals", ["server/routes/cron.ts", "goalReminderWorker"], "/goals-weekly", "external"),
  source("snapshots.daily", "snapshots", ["server/routes/cron.ts", "snapshotWorker"], "/snapshots", "database"),
  source("market.fx-refresh", "market", ["server/routes/cron.ts", "MarketDataService.updateFXRates"], "/market-data", "mixed"),
  source("market.price-refresh", "market", ["server/routes/cron.ts", "MarketDataService.updateSecurityPrices"], "/market-data", "mixed"),
  source("market.price-alerts", "market", ["server/routes/cron.ts", "PriceAlertService.checkPriceAlerts"], "/market-data", "external"),
  source("market.stale-price-alerts", "market", ["server/routes/cron.ts", "PriceAlertService.checkStalePrices"], "/market-data", "external"),
  source("investments.recurring-purchase", "investments", ["server/routes/cron.ts", "processDueInvestments"], "/investment-automation", "database"),
  source("investments.tbill-maturity", "investments", ["server/routes/cron.ts", "processTBillMaturities"], "/investment-automation", "database"),
  source("grz.coupon-due", "grz", ["GRZ schedule/payment surface"], null, "unresolved", ["missing-producer"]),
  source("grz.bond-maturity", "grz", ["master R14 maturity family"], null, "unresolved", ["missing-producer"]),
  source("outbox.dispatch", "outbox", ["server/core/events/processor.ts"], "event processor", "external"),
  source("receipts.match", "receipts", ["server/core/jobs/receiptMatcher.ts"], "receipt matching queue", "database"),
  source("receipts.retry", "receipts", ["server/services/receipt/matching.service.ts"], "receipt retry path", "database"),
  source("recap.weekly", "recap", ["scheduler", "processWeeklyRecapEmails"], "weekly-recap", "external"),
  source("security.daily-report", "security", ["scheduler"], "daily-security-report", "external"),
  source("cleanup.notifications", "cleanup", ["scheduler"], "notification-cleanup", "database"),
  source("cleanup.other-retention", "cleanup", ["legacy CLEANUP", "master cleanup family"], null, "unresolved", ["missing-producer"]),
]);
export const unsupportedRequiredJobs = (): readonly CatalogEntry[] => REQUIRED_JOB_CATALOG;

/** Test-only injection boundary. The catalog above cannot be promoted by matching a name. */
export interface RunnableDefinition {
  readonly name: string; readonly version: string; readonly resourceTypes: readonly string[];
  readonly dueKinds: readonly DueKind[]; readonly policy: OperationalPolicy;
  readonly knownFailureCodes: readonly string[]; readonly unknownHoldReasons: readonly string[];
  readonly validateInput: (request: DueItemRequest) => void;
  readonly validateCheckpoint: (checkpoint: unknown) => void;
  readonly validateResult: (result: unknown) => void;
  readonly validateTransition: (input: { request: DueItemRequest; previousCheckpoint: unknown; previousResult: unknown; transition: JobTransition }) => void;
  readonly continuationReadyAt: (input: { dueAt: string; checkpoint: unknown; result: unknown }) => string;
}
export type DefinitionSnapshot = Readonly<RunnableDefinition> & { readonly policyText: string; readonly policyHash: string };
export function snapshotDefinitions(definitions: readonly RunnableDefinition[]): ReadonlyMap<string, DefinitionSnapshot> {
  const result = new Map<string, DefinitionSnapshot>();
  for (const d of definitions) {
    if (!d || typeof d.name !== "string" || !/^fixture\.r14\.[a-z0-9.-]+$/.test(d.name) || REQUIRED_JOB_CATALOG.some(x => x.name === d.name) || result.has(d.name)) fail("UNSUPPORTED_DEFINITION");
    if (typeof d.version !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(d.version) ||
        !Array.isArray(d.resourceTypes) || d.resourceTypes.length > 32 || d.resourceTypes.some(x => typeof x !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,63}$/.test(x)) || new Set(d.resourceTypes).size !== d.resourceTypes.length ||
        !Array.isArray(d.dueKinds) || d.dueKinds.length === 0 || d.dueKinds.some(x => !["event", "period", "business-date"].includes(x)) || new Set(d.dueKinds).size !== d.dueKinds.length) fail("INVALID_DEFINITION");
    if (!Array.isArray(d.knownFailureCodes) || d.knownFailureCodes.length > 32 ||
        !Array.isArray(d.unknownHoldReasons) || d.unknownHoldReasons.length > 32 ||
        [...d.knownFailureCodes, ...d.unknownHoldReasons].some(code => { try { validateCode(code); return false; } catch { return true; } }) ||
        new Set([...d.knownFailureCodes, ...d.unknownHoldReasons]).size !== d.knownFailureCodes.length + d.unknownHoldReasons.length) fail("INVALID_DEFINITION");
    if ([d.validateInput, d.validateCheckpoint, d.validateResult, d.validateTransition, d.continuationReadyAt].some(x => typeof x !== "function")) fail("INVALID_DEFINITION");
    const policy = validatePolicy(d.policy);
    const policyText = canonicalJson(policy, 2048);
    result.set(d.name, Object.freeze({ name: d.name, version: d.version, resourceTypes: Object.freeze([...d.resourceTypes]), dueKinds: Object.freeze([...d.dueKinds]),
      knownFailureCodes: Object.freeze([...d.knownFailureCodes]), unknownHoldReasons: Object.freeze([...d.unknownHoldReasons]),
      policy, policyText, policyHash: sha256(policyText), validateInput: d.validateInput, validateCheckpoint: d.validateCheckpoint, validateResult: d.validateResult, validateTransition: d.validateTransition, continuationReadyAt: d.continuationReadyAt }));
  }
  return result;
}
