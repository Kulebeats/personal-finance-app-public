import { beforeEach, describe, expect, it, vi } from "vitest";

// OPS-003 / NEW-38: the production server must schedule every financial job and
// start the outbox processor; tests must never start either.
const state = vi.hoisted(() => ({
  schedule: vi.fn(),
  stop: vi.fn(),
  startProcessor: vi.fn(),
  stopProcessor: vi.fn(),
}));

vi.mock("node-cron", async (original) => {
  const actual = await original<typeof import("node-cron")>();
  return { default: { schedule: state.schedule, validate: actual.validate } };
});
vi.mock("../core/events/processor", () => ({ startProcessor: state.startProcessor, stopProcessor: state.stopProcessor }));
vi.mock("../core/scheduling/jobRunners", () => Object.fromEntries([
  "runFxRefresh", "runRecurringMaterialization", "runTBillMaturities", "runSipCatchUp", "runBudgetRollover",
  "runNotificationCleanup", "runMerchantLogoCleanup", "runPersonalExportCleanup", "runSnapshots", "runDailySecurityReport", "runWeeklyRecap",
  "runSecurityPriceRefresh", "runPriceAlerts", "runStalePriceAlerts", "runRecurringReminders", "runGoalDeadlines", "runBudgetAlerts", "runGoalWeeklyReport",
].map((name) => [name, vi.fn(async () => ({}))])));
vi.mock("../db", () => ({ db: {}, pool: {} }));
vi.mock("../utils/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const REQUIRED_FINANCIAL_JOBS = [
  "investments.tbill-maturity",
  "investments.recurring-purchase",
  "recurring.materialize",
  "market.fx-refresh",
  "recap.weekly",
  "budget.rollover",
  "snapshots.daily",
];

// A-21: these had only the HTTP cron door, which nothing calls.
const REQUIRED_NOTICE_JOBS = [
  "recurring.remind",
  "budget.alerts",
  "goals.deadlines",
  "goals.weekly-report",
  "market.stale-price-alerts",
];
// Jobs held outside the automatic schedule (see jobCatalog.ts).
const HELD_BACK_JOBS = ["goals.status", "market.price-refresh", "market.price-alerts"];

beforeEach(() => {
  vi.resetModules();
  state.schedule.mockReset().mockImplementation(() => ({ stop: state.stop }));
  state.stop.mockReset();
  state.startProcessor.mockReset();
  state.stopProcessor.mockReset();
});

describe("in-process scheduler registration", () => {
  it("registers the real financial jobs with valid UTC cadences and one fixed lock key each", async () => {
    const cron = await vi.importActual<typeof import("node-cron")>("node-cron");
    const { SCHEDULED_JOBS } = await import("../core/scheduling/jobRegistry");
    const names = SCHEDULED_JOBS.map((job) => job.name);

    expect(names).toEqual(expect.arrayContaining(REQUIRED_FINANCIAL_JOBS));
    expect(names).toEqual(expect.arrayContaining(REQUIRED_NOTICE_JOBS));
    for (const held of HELD_BACK_JOBS) expect(names).not.toContain(held);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(SCHEDULED_JOBS.map((job) => job.lockKey)).size).toBe(SCHEDULED_JOBS.length);
    for (const job of SCHEDULED_JOBS) {
      expect(cron.validate(job.cron), job.name).toBe(true);
      expect(Number.isInteger(job.lockKey) && job.lockKey > 0, job.name).toBe(true);
    }
  });

  it("schedules canonical jobs and one recovery tick in UTC and starts the outbox processor", async () => {
    const { SCHEDULED_JOBS } = await import("../core/scheduling/jobRegistry");
    const { initScheduler, isSchedulerRunning, stopScheduler } = await import("../scheduler");

    expect(initScheduler({ NODE_ENV: "production" })).toBe(true);
    expect(state.schedule).toHaveBeenCalledTimes(SCHEDULED_JOBS.length + 1);
    for (const [index, job] of SCHEDULED_JOBS.entries()) {
      expect(state.schedule.mock.calls[index]).toEqual([
        job.cron, expect.any(Function), { name: job.name, timezone: "UTC", noOverlap: true },
      ]);
    }
    expect(state.schedule.mock.calls[SCHEDULED_JOBS.length]).toEqual([
      "7,22,37,52 * * * *", expect.any(Function), { name: "scheduler.retry-incomplete", timezone: "UTC", noOverlap: true },
    ]);
    expect(state.startProcessor).toHaveBeenCalledOnce();
    expect(isSchedulerRunning()).toBe(true);

    expect(initScheduler({ NODE_ENV: "production" })).toBe(true);
    expect(state.schedule).toHaveBeenCalledTimes(SCHEDULED_JOBS.length + 1);
    expect(state.startProcessor).toHaveBeenCalledOnce();

    await stopScheduler();
    expect(state.stop).toHaveBeenCalledTimes(SCHEDULED_JOBS.length + 1);
    expect(state.stopProcessor).toHaveBeenCalledOnce();
    expect(isSchedulerRunning()).toBe(false);
  });

  it.each([
    [{ NODE_ENV: "test" }],
    [{ NODE_ENV: "test", SCHEDULER_ENABLED: "true" }],
    [{ NODE_ENV: "production", SCHEDULER_ENABLED: "false" }],
    [{ NODE_ENV: "development" }],
  ])("starts neither jobs nor the outbox processor for %j", async (env) => {
    const { initScheduler } = await import("../scheduler");

    expect(initScheduler(env)).toBe(false);
    expect(state.schedule).not.toHaveBeenCalled();
    expect(state.startProcessor).not.toHaveBeenCalled();
  });

  it("is controlled by the one SCHEDULER_ENABLED flag outside tests", async () => {
    const { isSchedulerEnabled } = await import("../core/scheduling/schedulerConfig");

    expect(isSchedulerEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(isSchedulerEnabled({ NODE_ENV: "production", SCHEDULER_ENABLED: "false" })).toBe(false);
    expect(isSchedulerEnabled({ NODE_ENV: "development", SCHEDULER_ENABLED: "true" })).toBe(true);
    expect(isSchedulerEnabled({ NODE_ENV: "development" })).toBe(false);
  });
});
