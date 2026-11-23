import type { Request, Response } from "express";
import { pool } from "../../db";
import { assertRequiredJobCapabilities, productionRedis, redis } from "../../config/redis";
import { createReadinessCheck, READINESS_TIMEOUT_MS, type ReadinessProbe } from "../../core/readiness";
import { readScheduledJobsHealth, type ScheduledJobsHealth } from "../../core/scheduling/jobHealth";
import { isSchedulerEnabled } from "../../core/scheduling/schedulerConfig";
import { cronSecretMatches } from "../../core/scheduling/cronSecret";
import { createRedisReadinessProbe } from "./redis-readiness";

// A full or abbreviated git SHA; anything else is reported as no revision.
const REVISION_PATTERN = /^[0-9a-f]{7,40}$/i;

const databaseProbe: ReadinessProbe = async () => {
  // Pool acquisition is bounded by db.ts; the outer deadline bounds HTTP.
  // pg supports per-query query_timeout; @types/pg only declares it on clients.
  const query = { text: "SELECT 1", query_timeout: 1000 };
  await pool.query(query);
};

const requiredJobsProbe: ReadinessProbe = async () => {
  assertRequiredJobCapabilities();
};

const cacheProbe: ReadinessProbe = async (signal) => {
  if (productionRedis) {
    await productionRedis.readiness.probe(signal);
    return;
  }
  if (!redis) {
    if (process.env.NODE_ENV === "production" || process.env.REDIS_URL) {
      throw new Error("Required Redis is not configured");
    }
    return "not_configured";
  }
  // Probe the actual service without its unbounded offline/retry queue.
  const client = redis.duplicate({
    lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0,
    connectTimeout: 400, commandTimeout: 400, retryStrategy: () => null,
    autoResendUnfulfilledCommands: false,
  });
  const disconnect = () => client.disconnect();
  client.on("error", () => {}); // The command rejection is the probe outcome.
  signal.addEventListener("abort", disconnect, { once: true });
  try {
    if (signal.aborted) throw new Error("Readiness deadline exceeded");
    await client.connect();
    await createRedisReadinessProbe({
      assertCurrent() { if (signal.aborted) throw new Error("Readiness deadline exceeded"); },
      async setExpiring(key, value, ttlMs) { await client.set(key, value, "PX", ttlMs); },
      get: key => client.get(key),
      deleteKey: key => client.del(key),
    })(signal);
  } finally {
    signal.removeEventListener("abort", disconnect);
    client.disconnect();
  }
};

type ScheduledJobsReport = ScheduledJobsHealth | { status: "unknown"; schedulerEnabled: boolean; jobs: [] };
interface ReadinessReport {
  readonly code: 200 | 503;
  readonly body: { readonly status: string } & Readonly<Record<string, unknown>>;
}

const BEARER_PATTERN = /^Bearer (.+)$/;

/** True only for `Authorization: Bearer <CRON_SECRET>`, compared like the cron door; unset secret = nobody. */
export function holdsOperatorSecret(req: Request): boolean {
  const match = BEARER_PATTERN.exec(req.get("authorization") ?? "");
  return cronSecretMatches(match?.[1], process.env.CRON_SECRET);
}

/** The deployed git revision, when the platform supplies a well-formed one. */
export function appRevision(env: NodeJS.ProcessEnv = process.env): string | null {
  const revision = env.RENDER_GIT_COMMIT ?? env.APP_REVISION;
  return typeof revision === "string" && REVISION_PATTERN.test(revision) ? revision : null;
}

/** The journal read shares the probe budget; a slow or failed read is "unknown". */
async function boundedJobsReport(read: () => Promise<ScheduledJobsHealth>): Promise<ScheduledJobsReport> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Scheduled-job freshness deadline exceeded")), READINESS_TIMEOUT_MS);
  });
  const reading = Promise.resolve().then(read);
  reading.catch(() => {}); // A read that fails after the deadline is already reported as unknown.
  try {
    return await Promise.race([reading, deadline]);
  } catch {
    return { status: "unknown", schedulerEnabled: isSchedulerEnabled(), jobs: [] };
  } finally {
    clearTimeout(timer);
  }
}

export function createHealthController(
  probes: {
    database: ReadinessProbe;
    cache: ReadinessProbe;
    requiredJobs?: ReadinessProbe;
    scheduledJobs?: () => Promise<ScheduledJobsHealth>;
  } = { database: databaseProbe, cache: cacheProbe },
) {
  const { scheduledJobs = () => readScheduledJobsHealth(), ...dependencyProbes } = probes;
  const check = createReadinessCheck({
    ...dependencyProbes,
    requiredJobs: probes.requiredJobs ?? requiredJobsProbe,
  });
  const getLive = (_req: Request, res: Response) => res.status(200).json({ status: "healthy" });
  const draining = { code: 503, body: { status: "unhealthy", checks: { shutdown: { status: "unhealthy" } } } } as const;
  const report = async (req: Request): Promise<ReadinessReport> => {
    if (req.app.locals.isShuttingDown) return draining;
    const [result, jobsReport] = await Promise.all([check(), boundedJobsReport(scheduledJobs)]);
    // Shutdown can begin while probes are pending; do not re-admit traffic.
    if (req.app.locals.isShuttingDown) return draining;
    // A dependency failure fails readiness (503). A stale or unreadable job
    // journal only degrades it: the deploy health check must not kill an
    // instance because a daily job is overdue (OPS-002).
    const status = result.status === "unhealthy" ? "unhealthy" : jobsReport.status === "healthy" ? "healthy" : "degraded";
    return { code: status === "unhealthy" ? 503 : 200,
      body: { status, revision: appRevision(), checks: result.checks, scheduledJobs: jobsReport } };
  };
  // Public readiness is the status only; the revision, checks and job times
  // go to the operator holding CRON_SECRET. Same status code either way.
  const getReady = async (req: Request, res: Response) => {
    const { code, body } = await report(req);
    res.status(code).json(holdsOperatorSecret(req) ? body : { status: body.status });
  };
  // Startup answers exactly like readiness, redaction included.
  return { getLive, getReady, getStartup: getReady };
}

export const healthController = createHealthController();
export const { getLive, getReady, getStartup } = healthController;
