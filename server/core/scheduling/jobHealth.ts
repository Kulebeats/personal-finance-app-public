import { SCHEDULED_JOB_SPECS, type ScheduledJobSpec } from "./jobCatalog";
import {
  cataloguedSince, didSchedulerStartRecordFail, listScheduledJobStatus, scheduledJournalEpoch, type ScheduledJobStatus,
} from "./jobJournal";
import { isSchedulerEnabled, isSchedulerExpected, type FlagEnv } from "./schedulerConfig";

/**
 * Scheduled-job freshness for readiness (OPS-002). A job is stale when its last
 * success is older than twice its interval (one missed run is tolerated; two
 * are not). A job that has never succeeded is measured the same way from the
 * journal epoch: the scheduler's first recorded start against this database,
 * or the journal's first run if earlier. Both are database facts, so a restart
 * never renews the grace, and a weekly job is still not stale in the days after
 * a deploy before its first slot comes round. Only a non-production process
 * that itself runs the scheduler, on a database with neither fact (a fresh dev
 * or test database), falls back to its own start; in production a never-run
 * job with no persisted epoch is stale. A job added after that first start is
 * measured from when a running scheduler first catalogued it (jobJournal.ts),
 * so a deploy that adds a job does not read stale before its first slot. If the
 * job ran before its catalogue entry was recorded, that first attempt still
 * counts toward the grace period.
 *
 * Readiness is also never healthy when the scheduler is switched off in a
 * profile that should run it (production; see schedulerConfig.ts), or when
 * this process could not record its start; `reasons` names which. Only the job
 * name, last success time and stale flag are reported, because readiness is
 * unauthenticated; the last status and error code stay on the system-role
 * `GET /api/admin/jobs`.
 */
export const STALE_INTERVAL_MULTIPLIER = 2;

/** Module load is process start, to within startup time. */
const PROCESS_STARTED_AT = new Date();

// These jobs were already scheduled before markers. The first catalogue
// marker was an upgrade event, so it cannot renew their existing grace.
const PRE_CATALOGUE_JOBS: ReadonlySet<string> = new Set([
  "market.fx-refresh", "market.stale-price-alerts", "recurring.materialize",
  "investments.tbill-maturity", "investments.recurring-purchase", "budget.rollover",
  "cleanup.notifications", "cleanup.merchant-logos", "cleanup.personal-exports",
  "snapshots.daily", "recurring.remind", "goals.deadlines", "budget.alerts",
  "security.daily-report", "security.mfa-reminders", "recap.weekly", "goals.weekly-report",
]);

export interface ScheduledJobFreshness {
  readonly jobName: string;
  readonly lastSuccessAt: string | null;
  readonly stale: boolean;
}

/**
 * Why readiness is degraded beyond a stale job: the scheduler is off in a
 * profile that should run it, or this process could not record its start.
 */
export type ScheduledJobsReason = "SCHEDULER_SWITCHED_OFF" | "SCHEDULER_START_UNRECORDED";

export interface ScheduledJobsHealth {
  /** "stale" when any job is stale or a reason applies; the platform health check still passes. */
  readonly status: "healthy" | "stale";
  /** Whether this process runs the scheduler, so a stale report can be read in context. */
  readonly schedulerEnabled: boolean;
  readonly jobs: readonly ScheduledJobFreshness[];
  /** Bounded codes only; absent on reports built elsewhere (an unreadable journal). */
  readonly reasons?: readonly ScheduledJobsReason[];
}

export interface JobHealthOptions {
  readonly specs?: readonly Pick<ScheduledJobSpec, "name" | "intervalMs">[];
  readonly now?: Date;
  readonly env?: FlagEnv;
  readonly processStartedAt?: Date;
  readonly hasStartRecordFailed?: boolean;
  readonly readStatus?: (jobNames: readonly string[]) => Promise<ScheduledJobStatus[]>;
  readonly readEpoch?: (jobNames: readonly string[]) => Promise<Date | null>;
  readonly readCatalogued?: (jobNames: readonly string[]) => Promise<ReadonlyMap<string, Date>>;
}

/**
 * `since` is when the scheduler could first have run the job; it stands in for
 * the last success of a job that has none. Without it, never-succeeded is stale.
 */
export function isJobStale(lastSuccessAt: string | null, intervalMs: number, now: Date, since: Date | null = null): boolean {
  const reference = lastSuccessAt === null ? since?.getTime() ?? Number.NaN : Date.parse(lastSuccessAt);
  if (Number.isNaN(reference)) return true;
  return now.getTime() - reference > STALE_INTERVAL_MULTIPLIER * intervalMs;
}

export async function readScheduledJobsHealth(options: JobHealthOptions = {}): Promise<ScheduledJobsHealth> {
  const specs = options.specs ?? SCHEDULED_JOB_SPECS;
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const schedulerEnabled = isSchedulerEnabled(env);
  const names = specs.map((spec) => spec.name);
  const [statuses, epoch, catalogued] = await Promise.all([
    (options.readStatus ?? listScheduledJobStatus)(names),
    (options.readEpoch ?? scheduledJournalEpoch)(names),
    (options.readCatalogued ?? cataloguedSince)(names),
  ]);
  const isExpected = isSchedulerExpected(env);
  // Process start is renewed by every restart, so it is never an epoch in production.
  const processEpoch = schedulerEnabled && !isExpected ? options.processStartedAt ?? PROCESS_STARTED_AT : null;
  const since = epoch ?? processEpoch;
  const jobs = specs.map((spec, index) => {
    const lastSuccessAt = statuses[index]?.lastSuccessAt ?? null;
    const firstCatalogued = catalogued.get(spec.name);
    const useEarlierEpoch = PRE_CATALOGUE_JOBS.has(spec.name) && since !== null
      && (firstCatalogued === undefined || since < firstCatalogued);
    const jobSince = useEarlierEpoch ? since : firstCatalogued ?? since;
    return { jobName: spec.name, lastSuccessAt, stale: isJobStale(lastSuccessAt, spec.intervalMs, now, jobSince) };
  });
  const reasons = degradedReasons(schedulerEnabled, isExpected, options.hasStartRecordFailed ?? didSchedulerStartRecordFail());
  return {
    status: reasons.length > 0 || jobs.some((job) => job.stale) ? "stale" : "healthy",
    schedulerEnabled,
    jobs,
    reasons,
  };
}

function degradedReasons(isEnabled: boolean, isExpected: boolean, hasStartRecordFailed: boolean): ScheduledJobsReason[] {
  const reasons: ScheduledJobsReason[] = [];
  if (!isEnabled && isExpected) reasons.push("SCHEDULER_SWITCHED_OFF");
  if (isEnabled && hasStartRecordFailed) reasons.push("SCHEDULER_START_UNRECORDED");
  return reasons;
}
