import { describe, expect, it } from "vitest";

import { getPostgresError, isPostgresError } from "../postgresError";

describe("postgres error normalization", () => {
  it("returns a direct PostgreSQL error", () => {
    const error = {
      code: "23505",
      constraint: "household_members_household_user_unique",
    };

    expect(getPostgresError(error)).toBe(error);
    expect(
      isPostgresError(
        error,
        "23505",
        "household_members_household_user",
      ),
    ).toBe(true);
  });

  it("unwraps a Drizzle query error cause", () => {
    const cause = {
      code: "23505",
      constraint: "filter_presets_name_unique_per_scope",
    };
    const error = new Error("Failed query", { cause });

    expect(getPostgresError(error)).toBe(cause);
    expect(
      isPostgresError(error, "23505", "filter_presets_name_unique"),
    ).toBe(true);
  });

  it("does not classify unrelated errors or loop through cause cycles", () => {
    const cyclic = new Error("cyclic") as Error & { cause?: unknown };
    cyclic.cause = cyclic;

    expect(getPostgresError(new Error("ordinary failure"))).toBeUndefined();
    expect(getPostgresError(cyclic)).toBeUndefined();
    expect(isPostgresError({ code: "NOT_PG" }, "23505")).toBe(false);
  });
});
