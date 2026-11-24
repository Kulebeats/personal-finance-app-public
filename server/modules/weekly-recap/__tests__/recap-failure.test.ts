import { describe, expect, it } from "vitest";
import { DrizzleQueryError } from "drizzle-orm";
import { CalculationError } from "../../../core/calculations/errors";
import { ForbiddenError } from "../../../core/errors";
import { classifyRecapBuildFailure, RecapCurrencyMissingError } from "../recap-failure";

/** OPS-007 P2 (#19 review): only the recap's own data settles a digest; every other failure is retried. */
const wrapped = (cause: Error) => new DrizzleQueryError("select 1", [], cause);
const systemError = (code: string) => Object.assign(new Error(`connect ${code}`), { errno: -111, code, syscall: "connect" });

describe("classifyRecapBuildFailure", () => {
  it.each([
    ["a missing household currency", new RecapCurrencyMissingError()],
    ["a refused recipient", new ForbiddenError("Weekly recap access denied")],
    ["a missing FX rate", new CalculationError("MISSING_FX_RATE", { from: "XTS", to: "ZMW" })],
  ])("settles %s as unbuildable", (_label, error) => {
    expect(classifyRecapBuildFailure(error)).toBe("unbuildable");
  });

  it.each([
    ["a wrapped ECONNREFUSED", wrapped(systemError("ECONNREFUSED"))],
    ["a wrapped ECONNRESET", wrapped(systemError("ECONNRESET"))],
    ["a wrapped ETIMEDOUT", wrapped(systemError("ETIMEDOUT"))],
    ["a wrapped pg-pool connect timeout", wrapped(new Error("timeout exceeded when trying to connect"))],
    ["a wrapped dropped connection", wrapped(new Error("Connection terminated unexpectedly"))],
    ["a Postgres error", wrapped(Object.assign(new Error("canceling statement"), { code: "57014" }))],
    ["an unknown error", new Error("something else")],
    ["a thrown non-error", "boom"],
  ])("retries %s as failed", (_label, error) => {
    expect(classifyRecapBuildFailure(error)).toBe("failed");
  });

  it("retries a data error whose cause is a connection fault", () => {
    const error = new CalculationError("MISSING_FX_RATE", { from: "XTS", to: "ZMW" });
    Object.defineProperty(error, "cause", { value: systemError("ECONNRESET") });

    expect(classifyRecapBuildFailure(error)).toBe("failed");
  });
});
