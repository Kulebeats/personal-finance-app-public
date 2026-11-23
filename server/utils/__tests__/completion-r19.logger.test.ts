import { afterEach, expect, it, vi } from "vitest";
import { logger, redactSensitive } from "../logger";

afterEach(() => vi.restoreAllMocks());

it("retains job/run/provider/outcome context instead of dropping the failure", () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  logger.error("Job failed", { job: "receipt-matcher", runId: "synthetic-run", provider: "mock", outcome: "failure", attempt: 2 });
  expect(JSON.parse(output.mock.calls[0][0] as string)).toMatchObject({
    job: "receipt-matcher", runId: "synthetic-run", provider: "mock", outcome: "failure", attempt: 2,
  });
});

it("redacts nested structured credentials and financial payloads without mutating inputs", () => {
  const context = { job: "fixture", nested: { Authorization: "Bearer SECRET", email: "fixture@example.invalid", amount: "777.77" }, rows: [{ password: "SECRET" }] };
  const cleaned = redactSensitive(context);
  expect(JSON.stringify(cleaned)).not.toMatch(/SECRET|777\.77|fixture@example/);
  expect(context.nested.amount).toBe("777.77");
  expect(cleaned.job).toBe("fixture");
});

it("keeps a safe error class/code without serializing arbitrary driver text", () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  const failure = Object.assign(new Error("postgres://SECRET@private.invalid amount=777.77"), { code: "ECONNREFUSED" });
  logger.error("Dependency failed", { error: failure, runId: "fixture" }, failure);
  const value = JSON.parse(output.mock.calls[0][0] as string);
  expect(JSON.stringify(value)).not.toMatch(/SECRET|private|777\.77/);
  expect(value.error).toMatchObject({ name: "Error", code: "ECONNREFUSED" });
});

it("handles cycles, bigint, accessors and hostile error fields without losing the event", () => {
  const getter = vi.fn(() => "SECRET");
  const context: Record<string, unknown> = { runId: "fixture", attempt: 1n };
  context.loop = context;
  Object.defineProperty(context, "untrusted", { enumerable: true, get: getter });
  const failure = new Error("SECRET");
  Object.defineProperty(failure, "name", { get: getter });
  context.error = failure;
  const output = vi.spyOn(console, "warn").mockImplementation(() => {});
  logger.warn("Fixture outcome", context);
  const cleaned = JSON.parse(output.mock.calls[0][0] as string);
  expect(cleaned).toMatchObject({ runId: "fixture", attempt: "[REDACTED]", loop: "[REDACTED]", untrusted: "[REDACTED]", error: { name: "Error" } });
  expect(getter).not.toHaveBeenCalled();
});

it("admits only reviewed scalar metrics and labels, including in metrics containers", () => {
  const cleaned = redactSensitive({ job: { nested: "SENTINEL" }, provider: "Bearer SENTINEL", runId: "fixture-run",
    count: "SENTINEL", durationMs: Infinity, processed: -1, metrics: { failed: 2, durationMs: 12.5, to: "SENTINEL", totalValue: 777.77 },
    error: { name: "TypeError", code: "ECONNREFUSED", message: "SENTINEL" } });
  expect(cleaned).toMatchObject({ runId: "fixture-run", metrics: { failed: 2, durationMs: 12.5 }, error: { name: "TypeError", code: "ECONNREFUSED" } });
  expect(JSON.stringify(cleaned)).not.toMatch(/SENTINEL|777\.77/);
});

it("retains operational metrics and protects reserved envelope fields from context overrides", () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  logger.info("Job completed", { level: "error", message: "SECRET", provider: "mock", inputTokens: 17,
    processed: 12, failed: 1, durationMs: 45, nested: [{ API_KEY: "SECRET", payment: "777.77" }] });
  const cleaned = JSON.parse(output.mock.calls[0][0] as string);
  expect(cleaned).toMatchObject({ level: "info", message: "Job completed", provider: "mock", inputTokens: 17, processed: 12, failed: 1, durationMs: 45 });
  expect(JSON.stringify(cleaned)).not.toMatch(/SECRET|777\.77/);
});

it("fails closed on existing mail/snapshot/MFA aliases and unknown nested fields", () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  logger.info("Synthetic operational event", { runId: "fixture-run", job: "snapshot", provider: "mock",
    processed: 12, to: "recipient@example.invalid", tbills: 777.77, pension: 888.88,
    totalValue: 999.99, assets: 1234.56, liabilities: 456.78, mfaCode: "192837",
    mfaBackupCodes: ["backup-SENTINEL"], unknownNested: { harmlessLooking: "raw-financial-SENTINEL" } });
  const entry = JSON.parse(output.mock.calls[0][0] as string);
  expect(entry).toMatchObject({ runId: "fixture-run", job: "snapshot", provider: "mock", processed: 12 });
  expect(JSON.stringify(entry)).not.toMatch(/recipient|777\.77|888\.88|999\.99|1234\.56|456\.78|192837|SENTINEL/);
});
