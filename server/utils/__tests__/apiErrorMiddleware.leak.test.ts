import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { apiErrorMiddleware, ValidationError } from "../errorHandler";

/**
 * Regression: a 500 (unexpected error) must NEVER echo the error message to the
 * client. The `sanitizeErrorMessage` denylist misses raw SQL text (no stack/path
 * markers), so before the fix a driver error like
 * `Failed query: select ... from "password_reset_tokens" ...` leaked schema and
 * query internals through the 500 response body — on an UNAUTHENTICATED endpoint
 * (POST /api/auth/reset-password). This asserts the generic-500 guard.
 */
function mockRes() {
  const res = {} as Response & { body?: unknown; code?: number };
  res.status = vi.fn().mockImplementation((c: number) => {
    res.code = c;
    return res;
  });
  res.json = vi.fn().mockImplementation((b: unknown) => {
    res.body = b;
    return res;
  });
  return res;
}

const req = {
  method: "POST",
  path: "/api/auth/reset-password",
  ip: "127.0.0.1",
  headers: {},
  socket: {},
} as unknown as Request;

describe("apiErrorMiddleware — 500 message leakage", () => {
  it("returns a generic message for an unexpected error carrying raw SQL, never the raw query", () => {
    const leaky = new Error(
      'Failed query: select "id", "user_id", "token_hash", "expires_at", "used_at" ' +
        'from "password_reset_tokens" where "password_reset_tokens"."token_hash" = $1 ' +
        "limit $2 for update\nparams: 47ae3a778f14d20499ca2255c16919e49497ad96,1",
    );

    const res = mockRes();
    apiErrorMiddleware(leaky, req, res, vi.fn() as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("An internal error occurred. Please try again.");
    // The decisive assertions: no schema/query internals reach the client.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("password_reset_tokens");
    expect(serialized).not.toContain("Failed query");
    expect(serialized).not.toContain("token_hash");
    expect(serialized).not.toContain("for update");
  });

  it("still surfaces an intentional AppError message (ValidationError is not swallowed)", () => {
    const intended = new ValidationError(
      "This password reset link is invalid or has expired. Please request a new one.",
    );

    const res = mockRes();
    apiErrorMiddleware(intended, req, res, vi.fn() as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe(
      "This password reset link is invalid or has expired. Please request a new one.",
    );
  });
});
