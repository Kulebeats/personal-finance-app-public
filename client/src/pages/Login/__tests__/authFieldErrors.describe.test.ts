/**
 * UX misc (auth part): the sign-in and register toasts never show the server's
 * own text. A field error the form has no input for must fall back to fixed
 * plain copy, not the server's message for that field.
 */
import { describe, expect, it } from "vitest";
import { describeFieldErrors } from "../authFieldErrors";

const RAW = "column users.x violates constraint";
const PLAIN = "Some of the details aren't valid. Check them and try again.";
const KNOWN_FIELDS = ["email", "password"] as const;

describe("describeFieldErrors", () => {
  it("shows plain copy, not the server message, for a field the form does not know", () => {
    const text = describeFieldErrors([{ field: "x", message: RAW }], KNOWN_FIELDS);

    expect(text).not.toContain(RAW);
    expect(text).toBe(PLAIN);
  });

  it("shows plain copy when known and unknown fields fail together", () => {
    const text = describeFieldErrors(
      [{ field: "email", message: "Invalid email" }, { field: "x", message: RAW }],
      KNOWN_FIELDS,
    );

    expect(text).not.toContain(RAW);
    expect(text).toBe(PLAIN);
  });

  it("points at the highlighted fields when every error has an input", () => {
    const text = describeFieldErrors([{ field: "email", message: RAW }], KNOWN_FIELDS);

    expect(text).toBe("Please correct the highlighted fields.");
  });
});
