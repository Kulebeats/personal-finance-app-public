/**
 * A-15: one household's snapshot failure (or a lock held elsewhere) must reach
 * the job journal as a failed run, so the period stays open for the recovery
 * tick to retry within that day, and the cron door must not answer success for it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

vi.mock("../../db", () => ({
  db: { select: () => ({ from: async () => [{ id: "household-ok" }, { id: "household-bad" }] }) },
  pool: {},
}));
vi.mock("../../config/redis", () => ({ productionRedis: null, redis: null }));
vi.mock("../../utils/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
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

import { snapshotWorker } from "../snapshotWorker";
import { runSnapshots } from "../../core/scheduling/jobRunners";
import { PARTIAL_FAILURE, runScheduledJob, type JobRunDependencies } from "../../core/scheduling/scheduledJob";
import type { JobRunFinish } from "../../core/scheduling/jobJournal";
import cronRoutes from "../../routes/cron";

const NOW = new Date("2026-11-21T00:30:00.000Z");

function journalDeps() {
  const finished: JobRunFinish[] = [];
  const deps: JobRunDependencies = {
    withLock: async (_request, work) => ({ acquired: true, result: await work({ isLost: () => false, onRenewed: () => {} }) }),
    hasCompletedPeriod: async () => false,
    startRun: async () => "synthetic-run",
    renewRun: async () => {},
    finishRun: async (_runId, finish) => { finished.push(finish); },
  };
  return { deps, finished };
}

const snapshotJob = { name: "snapshots.daily", cron: "0 0 * * *", lockKey: 9_901, run: runSnapshots };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("A-15 snapshot run outcomes", () => {
  it("journals a run with one failed household as failed, not completed", async () => {
    vi.spyOn(snapshotWorker, "processHousehold").mockImplementation(async (id) => {
      if (id === "household-bad") throw Object.assign(new Error("synthetic"), { code: "MISSING_FX_RATE" });
      return true;
    });
    const { deps, finished } = journalDeps();

    const outcome = await runScheduledJob(snapshotJob, deps, NOW);

    expect(outcome).toMatchObject({ status: "failed", errorCode: PARTIAL_FAILURE, summary: { processed: 1, failed: 1 } });
    expect(finished).toEqual([expect.objectContaining({ isOk: false, errorCode: PARTIAL_FAILURE })]);
  });

  it("counts a household whose lock another worker holds as not done", async () => {
    vi.spyOn(snapshotWorker, "processHousehold").mockImplementation(async (id) => id !== "household-bad");
    const { deps } = journalDeps();

    const outcome = await runScheduledJob(snapshotJob, deps, NOW);

    expect(outcome).toMatchObject({ status: "failed", errorCode: PARTIAL_FAILURE, summary: { processed: 1, busy: 1 } });
  });

  it("journals a run where every household captured as completed", async () => {
    vi.spyOn(snapshotWorker, "processHousehold").mockResolvedValue(true);
    const { deps, finished } = journalDeps();

    const outcome = await runScheduledJob(snapshotJob, deps, NOW);

    expect(outcome).toMatchObject({ status: "completed", summary: { processed: 2, failed: 0 } });
    expect(finished).toEqual([expect.objectContaining({ isOk: true })]);
  });

  it("the cron door answers failure when a household failed", async () => {
    // After the 03:00 slot, inside its day: the door runs today's period.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T12:00:00.000Z"));
    vi.stubEnv("CRON_SECRET", "synthetic-cron");
    vi.spyOn(snapshotWorker, "processHousehold").mockImplementation(async (id) => {
      if (id === "household-bad") throw new Error("synthetic");
      return true;
    });
    const app = express();
    app.use("/api/cron", cronRoutes);

    const res = await request(app).post("/api/cron/snapshots").set("x-cron-secret", "synthetic-cron");

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ success: false, jobs: [{
      name: "snapshots.daily", status: "failed", errorCode: PARTIAL_FAILURE, summary: { processed: 1, failed: 1 },
    }] });
  });
});
