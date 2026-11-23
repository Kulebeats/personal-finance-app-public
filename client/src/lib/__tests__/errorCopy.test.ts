import { describe, expect, it } from "vitest";
import type { ApiError } from "../api";
import { userErrorMessage } from "../errorCopy";

const FALLBACK = "Your goal could not be saved.";
const SERVER_TEXT = 'duplicate key value violates unique constraint "goals_pkey" {"detail":"internal"}';

function apiError(fields: Partial<ApiError>): ApiError {
  return Object.assign(new Error(SERVER_TEXT), fields);
}

describe("userErrorMessage", () => {
  it.each([
    ["VALIDATION_ERROR", "Some of the details aren't valid. Check them and try again."],
    ["NOT_FOUND", "It may have been deleted. Refresh the page and try again."],
    ["CONFLICT", "This was changed elsewhere or already exists. Refresh the page and try again."],
    ["PRIVATE_ACCOUNTS_PREVENT_LEAVING", "Resolve your private accounts before leaving this household. Share or transfer them where account controls allow it, or delete them."],
    ["PRIVATE_ACCOUNTS_PREVENT_REMOVAL", "This member must resolve their private accounts before they can be removed."],
    ["FORBIDDEN", "You don't have permission to do this in this household."],
    ["UNAUTHORIZED", "Your session has ended. Sign in again to continue."],
    ["MISSING_FX_RATE", "An exchange rate this needs isn't available yet. Try again later."],
    ["INTERNAL_ERROR", "Something went wrong on our side. Try again in a moment."],
  ])("maps the %s code to plain copy", (code, copy) => {
    expect(userErrorMessage(apiError({ code, status: 418 }), FALLBACK)).toBe(copy);
  });

  it("prefers the code over the status", () => {
    expect(userErrorMessage(apiError({ code: "NOT_FOUND", status: 400 }), FALLBACK))
      .toBe("It may have been deleted. Refresh the page and try again.");
  });

  it.each([
    [400, "Some of the details aren't valid. Check them and try again."],
    [401, "Your session has ended. Sign in again to continue."],
    [403, "You don't have permission to do this in this household."],
    [404, "It may have been deleted. Refresh the page and try again."],
    [409, "This was changed elsewhere or already exists. Refresh the page and try again."],
    [413, "That file is too large."],
    [500, "Something went wrong on our side. Try again in a moment."],
    [503, "Something went wrong on our side. Try again in a moment."],
  ])("maps HTTP %i without a known code to plain copy", (status, copy) => {
    expect(userErrorMessage(apiError({ code: "SOMETHING_NEW", status }), FALLBACK)).toBe(copy);
  });

  it("says when to retry after a rate limit", () => {
    expect(userErrorMessage(apiError({ code: "RATE_LIMITED", status: 429, retryAfterSeconds: 30 }), FALLBACK))
      .toBe("Too many attempts. Try again in 30 seconds.");
    expect(userErrorMessage(apiError({ status: 429 }), FALLBACK))
      .toBe("Too many attempts. Wait a moment and try again.");
  });

  it("says the server could not be reached when the request never left", () => {
    expect(userErrorMessage(new TypeError("Failed to fetch"), FALLBACK))
      .toBe("Can't reach the server. Check your connection and try again.");
  });

  it.each([
    ["an unknown code and status", apiError({ code: "SOMETHING_NEW", status: 418 })],
    ["a plain Error", new Error(SERVER_TEXT)],
    ["a JSON parse failure", new SyntaxError("Unexpected token < in JSON at position 0")],
    ["a thrown string", SERVER_TEXT],
    ["undefined", undefined],
  ])("falls back to the caller's copy for %s, never the server text", (_label, error) => {
    const copy = userErrorMessage(error, FALLBACK);
    expect(copy).toBe(FALLBACK);
    expect(copy).not.toContain("constraint");
  });
});
