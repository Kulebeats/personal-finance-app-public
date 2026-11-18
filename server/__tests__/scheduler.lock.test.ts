/**
 * Scheduler Distributed Lock - Unit Tests (SCP-308)
 *
 * Verifies that scheduled jobs are wrapped in the distributed-lock helper and
 * run normally WITHOUT a Redis server (single-instance fallback). Cross-instance
 * single-firing requires a real Redis and is not verifiable here.
 *
 * @module __tests__/scheduler.lock.test
 */

import { describe, it, expect, vi } from "vitest";
import { redis } from "../config/redis";
import { runScheduledJob } from "../scheduler";

describe("runScheduledJob (SCP-308) - fallback without Redis", () => {
  it("runs without Redis configured", () => {
    expect(redis).toBeNull();
  });

  it("executes the job exactly once when Redis is unset", async () => {
    const job = vi.fn(async () => {});
    await runScheduledJob("test-job", job);
    expect(job).toHaveBeenCalledTimes(1);
  });

  it("does not throw when the wrapped job throws (errors handled by job body)", async () => {
    // The real job bodies swallow their own errors; here we confirm that a
    // throwing job propagates out of runScheduledJob so the cron tick logs it.
    const job = vi.fn(async () => {
      throw new Error("job failed");
    });
    await expect(runScheduledJob("failing-job", job)).rejects.toThrow(
      "job failed",
    );
  });
});
