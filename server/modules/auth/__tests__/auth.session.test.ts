/**
 * Session Sanity Middleware Tests
 *
 * Verifies that the middleware correctly handles missing session objects
 * to prevent server crashes.
 *
 * @module modules/auth/__tests__/auth.session.test
 */

import { describe, it, expect, vi } from "vitest";
import { sessionSanity } from "../../../middleware/sessionSanity";
import { Request, Response, NextFunction } from "express";

describe("Session Sanity Middleware", () => {
  it("should initialize empty session if missing", () => {
    const req = {
      path: "/test",
      ip: "127.0.0.1",
      // session is undefined
    } as unknown as Request;

    const res = {} as Response;
    const next = vi.fn();

    sessionSanity(req, res, next);

    expect((req as any).session).toBeDefined();
    expect((req as any).session).toEqual({});
    expect(next).toHaveBeenCalled();
  });

  it("should preserve existing session", () => {
    // Valid UUID to pass sanity check
    const existingSession = {
      userId: "123e4567-e89b-12d3-a456-426614174000",
      destroy: vi.fn(),
    };
    const req = {
      session: existingSession,
    } as unknown as Request;

    const res = {} as Response;
    const next = vi.fn();

    sessionSanity(req, res, next);

    expect(req.session).toBe(existingSession);
    expect(next).toHaveBeenCalled();
  });

  it("should destroy session with invalid UUID", () => {
    const destroyMock = vi.fn((cb) => cb && cb(null));
    const req = {
      session: {
        userId: "invalid-uuid",
        destroy: destroyMock,
      },
      ip: "127.0.0.1",
    } as unknown as Request;

    const res = {} as Response;
    const next = vi.fn();

    sessionSanity(req, res, next);

    // Verify session was reset
    expect((req as any).session).toEqual({});
    expect(destroyMock).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
