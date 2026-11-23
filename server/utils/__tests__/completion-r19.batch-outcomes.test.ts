import { afterEach, expect, it, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import type { JobRunDependencies } from "../../core/scheduling/scheduledJob";

const state = vi.hoisted(() => ({ allFail: false, result: null as null | { processed: number; matched: number } }));
vi.mock("../../repositories/ReceiptRepository", () => ({ receiptRepository: { findForMatching: async () => [
  { id: "bad", householdId: "synthetic-household" }, { id: "good", householdId: "synthetic-household" },
] } }));
vi.mock("../../services/ReceiptService", async () => {
  const { receiptMatchingService } = await import("../../services/receipt/matching.service");
  return { receiptService: { processMatchingQueue: async () => {
    const result = await receiptMatchingService.processMatchingQueue(async (id) => {
      if (state.allFail || id === "bad") throw new Error("PRIVATE_RECEIPT_FAILURE_SENTINEL");
      return { matched: true };
    });
    state.result = result;
    return result;
  } } };
});
vi.mock("../../db", async () => {
  const { householdMembers } = await import("@shared/schema");
  return { db: { select: () => ({ from: (table: unknown) => table === householdMembers
    ? { where: async () => [{ userId: "synthetic-recipient", role: "member" }] }
    : Promise.resolve([{ id: "bad" }, { id: "good" }]) }) } };
});
vi.mock("../../jobs/snapshotWorker", () => ({ runDailySnapshots: vi.fn() }));
vi.mock("../../jobs/goalStatusWorker", () => ({ runGoalStatusRecalculation: vi.fn() }));
vi.mock("../../jobs/goalReminderWorker", () => ({ runGoalDeadlineReminders: vi.fn(), runWeeklyGoalReport: vi.fn() }));
vi.mock("../../services/RecurringService", () => ({ recurringService: {} }));
vi.mock("../../services/NotificationService", () => ({ notificationService: { triggerBudgetAlert: vi.fn().mockResolvedValue(true) } }));
vi.mock("../../services/BudgetService", () => ({ budgetService: { getBudgetAlerts: async (id: string) => {
  if (state.allFail || id === "bad") throw new Error("PRIVATE_BUDGET_FAILURE_SENTINEL");
  return [{ budget: { id: "synthetic-budget", name: "PRIVATE_BUDGET_NAME_SENTINEL" }, percentUsed: 90, alertLevel: "warning" }];
} } }));
vi.mock("../../middleware/rateLimit", () => ({ strictLimiter: (_req: Request, _res: Response, next: NextFunction) => next() }));
vi.mock("../../core/scheduling/scheduledJob", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../core/scheduling/scheduledJob")>();
  // The door runs through the scheduler's runner; here its lock and journal are in memory.
  const memory: JobRunDependencies = {
    withLock: async (_request, work) => ({ acquired: true, result: await work({ isLost: () => false, onRenewed: () => {} }) }),
    hasCompletedPeriod: async () => false,
    startRun: async () => "synthetic-door-run",
    renewRun: async () => {},
    finishRun: async () => {},
  };
  return {
    ...actual,
    runScheduledJob: (...[job, deps, now]: Parameters<typeof actual.runScheduledJob>) => actual.runScheduledJob(job, deps ?? memory, now),
  };
});
import cronRoutes from "../../routes/cron";
import { startReceiptMatchingJob, stopReceiptMatchingJob } from "../../jobs/receiptMatcher";

const app = express(); app.use("/api/cron", cronRoutes);
afterEach(() => { stopReceiptMatchingJob(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); state.result = null; });

it.each([false, true])("actual budget-alert router does not label caught item failures as success (allFail=%s)", async (allFail) => {
  state.allFail = allFail;
  vi.stubEnv("CRON_SECRET", "synthetic-cron");
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // A household that failed is a partial failure of the scheduled run: the door answers 500.
  const response = await request(app).post("/api/cron/budget-alerts").set("x-cron-secret", "synthetic-cron").expect(500);
  expect(response.body).toMatchObject({ success: false, jobs: [{ name: "budget.alerts", status: "failed", errorCode: "PARTIAL_FAILURE",
    summary: { householdsChecked: 2, totalAlerts: allFail ? 0 : 1, notificationsSent: allFail ? 0 : 1, failed: allFail ? 2 : 1 } }] });
  const entry = output.mock.calls.map(([value]) => JSON.parse(value as string)).find((value) => value.job === "budget-alerts");
  expect(entry).toMatchObject({ households: 2, totalAlerts: allFail ? 0 : 1 });
  expect(entry).not.toHaveProperty("outcome", "success");
  expect(JSON.stringify(entry)).not.toContain("PRIVATE_");
});

it.each([false, true])("actual receipt batch and worker do not label caught failures as success (allFail=%s)", async (allFail) => {
  vi.useFakeTimers();
  state.allFail = allFail;
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  startReceiptMatchingJob();
  await vi.waitFor(() => expect(state.result).toEqual({ processed: allFail ? 0 : 1, matched: allFail ? 0 : 1 }));
  expect(errors).toHaveBeenCalledTimes(allFail ? 2 : 1);
  const entries = output.mock.calls.map(([value]) => JSON.parse(value as string));
  expect(entries.some((entry) => entry.job === "receipt-matcher" && entry.outcome === "success")).toBe(false);
  if (!allFail) expect(entries).toContainEqual(expect.objectContaining({ job: "receipt-matcher", processed: 1, matched: 1 }));
  expect(JSON.stringify(entries)).not.toContain("PRIVATE_");
});
