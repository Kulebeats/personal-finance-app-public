/**
 * The HTTP cron door runs each job through the scheduler's own runner
 * (`runScheduledJob`: advisory locks plus the job journal), never the work
 * directly, and refuses the jobs held back from the scheduler. So the door
 * cannot run a period twice or overlap the scheduler, and a held job is not
 * reachable through it.
 *
 * Unit: the runner is replaced by a spy, so each test chooses its outcome;
 * every piece of job work is a spy that must never be called by the route
 * itself. The real lock and journal are covered by
 * cron.door-journal.realdb.integration.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import type { JobRunOutcome, ScheduledJobDefinition } from "../../core/scheduling/scheduledJob";
import { SCHEDULED_JOB_SPECS } from "../../core/scheduling/jobCatalog";

const runner = vi.hoisted(() => ({ run: vi.fn() }));
const work = vi.hoisted(() => ({
  processRecurringForAllHouseholds: vi.fn(), processBudgetRolloverForAllHouseholds: vi.fn(),
  processBudgetAlerts: vi.fn(), processRecurringReminders: vi.fn(), runDailySnapshots: vi.fn(),
  runGoalStatusRecalculation: vi.fn(), runGoalDeadlineReminders: vi.fn(), runWeeklyGoalReport: vi.fn(),
  updateFXRates: vi.fn(), updateSecurityPrices: vi.fn(), checkPriceAlerts: vi.fn(), checkStalePrices: vi.fn(),
  processTBillMaturities: vi.fn(), processDueInvestments: vi.fn(),
}));

vi.mock("../../core/scheduling/scheduledJob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../core/scheduling/scheduledJob")>()),
  runScheduledJob: runner.run,
}));
vi.mock("../../core/scheduling/jobRunners", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../core/scheduling/jobRunners")>();
  // Every scheduled runner becomes inert; the route must not call any of them itself.
  const inert = Object.fromEntries(Object.keys(actual).map((name) => [name, vi.fn()]));
  return {
    ...inert,
    processRecurringForAllHouseholds: work.processRecurringForAllHouseholds,
    processBudgetRolloverForAllHouseholds: work.processBudgetRolloverForAllHouseholds,
  };
});
vi.mock("../../core/scheduling/householdNoticeRunners", () => ({
  processBudgetAlerts: work.processBudgetAlerts, processRecurringReminders: work.processRecurringReminders,
}));
vi.mock("../../jobs/snapshotWorker", () => ({ runDailySnapshots: work.runDailySnapshots }));
vi.mock("../../jobs/goalStatusWorker", () => ({ runGoalStatusRecalculation: work.runGoalStatusRecalculation }));
vi.mock("../../jobs/goalReminderWorker", () => ({
  runGoalDeadlineReminders: work.runGoalDeadlineReminders, runWeeklyGoalReport: work.runWeeklyGoalReport,
}));
vi.mock("../../services/MarketDataService", () => ({
  marketDataService: { updateFXRates: work.updateFXRates, updateSecurityPrices: work.updateSecurityPrices },
}));
vi.mock("../../services/PriceAlertService", () => ({
  priceAlertService: { checkPriceAlerts: work.checkPriceAlerts, checkStalePrices: work.checkStalePrices },
}));
vi.mock("../../services/InvestmentAutomationService", () => ({
  investmentAutomationService: { processTBillMaturities: work.processTBillMaturities, processDueInvestments: work.processDueInvestments },
}));
vi.mock("../../middleware/rateLimit", () => ({ strictLimiter: (_req: Request, _res: Response, next: NextFunction) => next() }));

import cronRoutes from "../cron";

const SECRET = "synthetic-cron-door-secret";
const app = express();
app.use("/api/cron", cronRoutes);

const post = (route: string) => request(app).post(`/api/cron/${route}`).set("x-cron-secret", SECRET);
const lockKeyOf = (name: string) => SCHEDULED_JOB_SPECS.find((spec) => spec.name === name)?.lockKey;
const ranJobs = () => runner.run.mock.calls.map(([job]) => (job as ScheduledJobDefinition).name);
const completed: JobRunOutcome = { status: "completed", summary: { processed: 1 } };

/** Each door route and the catalogued jobs it runs, in order. */
const ROUTES: readonly (readonly [string, readonly string[]])[] = [
  ["snapshots", ["snapshots.daily"]],
  ["recurring", ["recurring.materialize"]],
  ["recurring-reminders", ["recurring.remind"]],
  ["budget-rollover", ["budget.rollover"]],
  ["budget-alerts", ["budget.alerts"]],
  ["goals-weekly", ["goals.weekly-report"]],
  ["goals-deadlines", ["goals.deadlines"]],
  ["investment-automation", ["investments.tbill-maturity", "investments.recurring-purchase"]],
];

/** Routes whose work is held back from the scheduler (jobCatalog.ts). */
const HELD_ROUTES = ["goals-status", "market-data"] as const;

function expectNoDirectWork(): void {
  for (const [name, spy] of Object.entries(work)) expect(spy, name).not.toHaveBeenCalled();
}

/** A Monday after every slot: each recovery window, daily and weekly, is open. */
const OPEN_WINDOWS = new Date("2026-11-23T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(OPEN_WINDOWS);
  vi.stubEnv("CRON_SECRET", SECRET);
  runner.run.mockResolvedValue(completed);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  runner.run.mockReset();
  for (const spy of Object.values(work)) spy.mockReset();
});

describe("the cron door runs catalogued jobs through the scheduler's runner", () => {
  it.each(ROUTES)("POST /api/cron/%s runs %j under its lock and journal", async (route, names) => {
    const response = await post(route).expect(200);

    expect(ranJobs()).toEqual(names);
    for (const [job] of runner.run.mock.calls) {
      const definition = job as ScheduledJobDefinition;
      expect(definition.lockKey, definition.name).toBe(lockKeyOf(definition.name));
      expect(typeof definition.run).toBe("function");
    }
    expect(response.body).toMatchObject({ success: true, jobs: names.map((name) => ({ name, status: "completed" })) });
    expectNoDirectWork();
  });

  it.each(["PERIOD_HELD", "JOB_BUSY"] as const)("answers 409 when the lock is held (%s), and runs nothing", async (reason) => {
    runner.run.mockResolvedValue({ status: "skipped", reason } satisfies JobRunOutcome);

    const response = await post("recurring").expect(409);

    expect(response.body).toMatchObject({ success: false, jobs: [{ name: "recurring.materialize", status: "skipped", reason }] });
    expectNoDirectWork();
  });

  it("answers 200 when the period already completed, without running it again", async () => {
    runner.run.mockResolvedValue({ status: "skipped", reason: "PERIOD_DONE" } satisfies JobRunOutcome);

    const response = await post("budget-alerts").expect(200);

    expect(response.body).toMatchObject({ success: true, jobs: [{ name: "budget.alerts", status: "skipped", reason: "PERIOD_DONE" }] });
    expectNoDirectWork();
  });

  it("answers 500 with the bounded code when the run failed", async () => {
    runner.run.mockResolvedValue({ status: "failed", errorCode: "PARTIAL_FAILURE", summary: { failed: 1 } } satisfies JobRunOutcome);

    const response = await post("snapshots").expect(500);

    expect(response.body).toMatchObject({ success: false, jobs: [{ name: "snapshots.daily", status: "failed", errorCode: "PARTIAL_FAILURE" }] });
  });

  it.each(["snapshots", "recurring-reminders", "goals-deadlines"])(
    "POST /api/cron/%s before today's slot answers 409 WINDOW_CLOSED and runs nothing", async (route) => {
      // 02:00 UTC: the latest slot is yesterday's, whose window closed at midnight.
      vi.setSystemTime(new Date("2026-11-24T02:00:00.000Z"));

      const response = await post(route).expect(409);

      expect(response.body).toMatchObject({ success: false, jobs: [{ status: "skipped", reason: "WINDOW_CLOSED" }] });
      expect(runner.run).not.toHaveBeenCalled();
      expectNoDirectWork();
    },
  );

  it("a runner error (lock or journal unavailable) is a 500, not a crash", async () => {
    runner.run.mockRejectedValue(Object.assign(new Error("synthetic journal outage"), { code: "57P01" }));

    const response = await post("budget-rollover").expect(500);

    expect(response.body).toMatchObject({ success: false });
    expect(JSON.stringify(response.body)).not.toContain("synthetic journal outage");
  });
});

describe("the cron door refuses jobs held back from the scheduler", () => {
  it.each(HELD_ROUTES)("POST /api/cron/%s answers 409 JOB_HELD and runs nothing", async (route) => {
    const response = await post(route).expect(409);

    expect(response.body).toMatchObject({ success: false, error: { code: "JOB_HELD" } });
    expect(runner.run).not.toHaveBeenCalled();
    expectNoDirectWork();
  });
});
