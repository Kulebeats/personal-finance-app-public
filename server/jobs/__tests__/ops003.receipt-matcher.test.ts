/**
 * OPS-003: the receipt matcher is started. It runs as the scheduled job
 * receipts.match, under its own advisory lock and the job journal like every
 * other scheduled job, and a receipt that fails to match is a partial failure
 * of the run, never a silent success. The durable catalog names its real file.
 * Unit: the queue and the journal are mocked here; the real queue, locks and
 * journal are covered by ops003.receipt-matcher.realdb.integration.test.ts.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobRunDependencies } from "../../core/scheduling/scheduledJob";

const state = vi.hoisted(() => ({ failing: new Set<string>() }));
vi.mock("../../db", () => ({ db: {}, pool: {} }));
vi.mock("../../utils/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../repositories/ReceiptRepository", () => ({ receiptRepository: { findForMatching: async () => [
  { id: "receipt-one", householdId: "synthetic-household" }, { id: "receipt-two", householdId: "synthetic-household" },
] } }));
vi.mock("../../services/ReceiptService", async () => {
  const { receiptMatchingService } = await import("../../services/receipt/matching.service");
  return { receiptService: { processMatchingQueue: () => receiptMatchingService.processMatchingQueue(async (id) => {
    if (state.failing.has(id)) throw new Error("synthetic match failure");
    return { matched: true };
  }) } };
});

import { REQUIRED_JOB_CATALOG } from "../../core/jobs/durable/catalog";
import { SCHEDULED_JOB_SPECS, type ScheduledJobSpec } from "../../core/scheduling/jobCatalog";
import { SCHEDULED_JOBS } from "../../core/scheduling/jobRegistry";
import { runScheduledJob } from "../../core/scheduling/scheduledJob";

const NOW = new Date("2026-11-24T04:00:00.250Z");
const memory: JobRunDependencies = {
  withLock: async (_request, work) => ({ acquired: true, result: await work({ isLost: () => false, onRenewed: () => {} }) }),
  hasCompletedPeriod: async () => false,
  startRun: async () => "synthetic-run",
  renewRun: async () => {},
  finishRun: async () => {},
};
const receiptJob = () => SCHEDULED_JOBS.find((job) => job.name === "receipts.match");

afterEach(() => { state.failing.clear(); });

describe("receipts.match under the scheduler (OPS-003)", () => {
  it("is a scheduled job with its own lock key, outside the keys held back for the market jobs", () => {
    const specs: readonly ScheduledJobSpec[] = SCHEDULED_JOB_SPECS;
    const spec = specs.find((candidate) => candidate.name === "receipts.match");
    expect(spec).toBeDefined();
    const keys = specs.map((candidate) => candidate.lockKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect([112, 113]).not.toContain(spec?.lockKey);
    expect(receiptJob()).toBeDefined();
  });

  it("matches the queued receipts and journals a clean run as completed", async () => {
    await expect(runScheduledJob(receiptJob()!, memory, NOW))
      .resolves.toEqual({ status: "completed", summary: { processed: 2, matched: 2, failed: 0 } });
  });

  it("counts a receipt that failed to match, so the run is a partial failure, not a success", async () => {
    state.failing.add("receipt-one");

    await expect(runScheduledJob(receiptJob()!, memory, NOW))
      .resolves.toEqual({ status: "failed", errorCode: "PARTIAL_FAILURE", summary: { processed: 1, matched: 1, failed: 1 } });
  });
});

it("names only files that exist as the durable catalog's sources", () => {
  const paths = REQUIRED_JOB_CATALOG.flatMap((entry) => entry.sourceRefs).filter((ref) => ref.startsWith("server/"));
  expect(paths.filter((path) => !existsSync(resolve(__dirname, "../../..", path)))).toEqual([]);
});
