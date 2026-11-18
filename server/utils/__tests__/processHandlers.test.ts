import { describe, it, expect } from "vitest";
import { registerProcessErrorHandlers } from "../processHandlers";

describe("registerProcessErrorHandlers (SCP-325)", () => {
  it("registers unhandledRejection + uncaughtException listeners, idempotently", () => {
    registerProcessErrorHandlers();
    const rej = process.listenerCount("unhandledRejection");
    const exc = process.listenerCount("uncaughtException");
    expect(rej).toBeGreaterThanOrEqual(1);
    expect(exc).toBeGreaterThanOrEqual(1);

    // Second call must not add duplicate listeners.
    registerProcessErrorHandlers();
    expect(process.listenerCount("unhandledRejection")).toBe(rej);
    expect(process.listenerCount("uncaughtException")).toBe(exc);
  });
});
