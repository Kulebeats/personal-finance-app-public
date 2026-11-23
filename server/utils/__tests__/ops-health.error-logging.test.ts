import { afterEach, describe, expect, it, vi } from "vitest";

// The job runner's journal and lock are injected below; no database is reached.
vi.mock("../../db", () => ({ db: {}, pool: {} }));

import { logger, redactSensitive } from "../logger";
import { runScheduledJob, type JobRunDependencies } from "../../core/scheduling/scheduledJob";

/**
 * OPS-014 within R19: an error log must say where a failure came from without
 * carrying its text. A genuine Error keeps its safe name, its code and at most
 * five scrubbed stack frames. Its message never reaches the log, and secret or
 * PII context keys stay redacted.
 */
afterEach(() => vi.restoreAllMocks());

const entries = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);

const inlineDependencies: JobRunDependencies = {
  withLock: async (_request, work) => ({ acquired: true, result: await work({ isLost: () => false, onRenewed: () => {} }) }),
  hasCompletedPeriod: async () => false,
  startRun: async () => "run-ops-health",
  renewRun: async () => {},
  finishRun: async () => {},
};

describe("error logs keep where a failure came from, never its text", () => {
  it("keeps a thrown job error's name, code and bounded frames but not its message", async () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = Object.assign(new Error("PRIVATE_SENTINEL price feed failed"), { code: "ECONNRESET" });

    await runScheduledJob({ name: "test.ops-health", cron: "0 1 * * *", lockKey: 1, run: async () => { throw failure; } }, inlineDependencies);

    const entry = entries(output).find((line) => line.message === "Scheduled job failed");
    expect(entry?.error).toMatchObject({ name: "Error", code: "ECONNRESET" });
    expect(entry?.error).not.toHaveProperty("message");
    expect(JSON.stringify(entry)).not.toContain("PRIVATE_SENTINEL");
    const stack = (entry?.error as { stack?: unknown }).stack;
    expect(Array.isArray(stack)).toBe(true);
    expect((stack as string[]).length).toBeGreaterThan(0);
    expect((stack as string[]).length).toBeLessThanOrEqual(5);
    for (const frame of stack as string[]) expect(frame).toMatch(/^at /);
  });

  it("keeps an app error code such as MISSING_FX_RATE", () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("Recap failed", {}, Object.assign(new Error("No rate for PRIVATE_SENTINEL"), { code: "MISSING_FX_RATE" }));
    const [entry] = entries(output);
    expect(entry.error).toMatchObject({ name: "Error", code: "MISSING_FX_RATE" });
    expect(JSON.stringify(entry)).not.toContain("PRIVATE_SENTINEL");
  });

  it("never turns a line of the message into a frame", () => {
    const failure = new Error("PRIVATE_SENTINEL\n    at PRIVATE_FRAME (forged.ts:1:1)");
    const cleaned = redactSensitive({ error: failure });
    expect(JSON.stringify(cleaned)).not.toMatch(/PRIVATE/);
    const stack = (cleaned.error as { stack?: string[] }).stack;
    expect(stack?.length ?? 0).toBeGreaterThan(0);
  });

  it("keeps secret and PII context keys redacted", () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("Dependency failed", {
      jobName: "test.ops-health", password: "SECRETPW", token: "SECRETTOKEN", email: "kb.synthetic@example.invalid",
    }, new Error("Login for kb.synthetic@example.invalid failed"));

    const [entry] = entries(output);
    expect(JSON.stringify(entry)).not.toMatch(/example\.invalid|SECRETPW|SECRETTOKEN/);
    expect(entry).toMatchObject({ jobName: "test.ops-health", password: "[REDACTED]", token: "[REDACTED]", email: "[REDACTED]" });
  });

  it("admits no message or stack from a value that is not an Error", () => {
    const cleaned = redactSensitive({ error: { name: "TypeError", message: "PRIVATE_SENTINEL", stack: "at PRIVATE_FRAME" } });
    expect(JSON.stringify(cleaned)).not.toMatch(/PRIVATE/);
    expect(redactSensitive({ error: "PRIVATE_STRING" }).error).toBe("[REDACTED]");
  });

  it("never calls a stack getter an error defines for itself", () => {
    const getter = vi.fn(() => "at PRIVATE_FRAME");
    const failure = new Error("PRIVATE_SENTINEL");
    Object.defineProperty(failure, "stack", { get: getter });
    const cleaned = redactSensitive({ error: failure });
    expect(getter).not.toHaveBeenCalled();
    expect(JSON.stringify(cleaned)).not.toMatch(/PRIVATE/);
    expect(cleaned.error).toEqual({ name: "Error" });
  });
});
