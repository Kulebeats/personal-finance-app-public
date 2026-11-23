import { afterEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

const crypto = vi.hoisted(() => ({ timingSafeEqual: vi.fn() }));
const log = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("../../../utils/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: log.warn, error: vi.fn() } }));
vi.mock("node:crypto", async (original) => {
  const actual = await original<typeof import("node:crypto")>();
  crypto.timingSafeEqual.mockImplementation(actual.timingSafeEqual);
  return { ...actual, timingSafeEqual: crypto.timingSafeEqual };
});

import { ForbiddenError } from "../../errors";
import { errorHandler } from "../../errors/errorHandler";
import { verifyCronSecret, warnIfCronSecretMissing } from "../cronSecret";
import { validateEnv, validateEnvOrThrow } from "../../../utils/validateEnv";

const SECRET = "synthetic-cron-secret-0123456789";
const production = {
  NODE_ENV: "production", DATABASE_URL: "postgresql://synthetic@db.example.invalid/db",
  SESSION_SECRET: "synthetic-session-secret-not-real-use", CLIENT_URL: "https://app.example.invalid",
  APP_URL: "https://app.example.invalid", REDIS_URL: "rediss://redis.example.invalid:6380",
};

function check(header: unknown) {
  const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
  verifyCronSecret({ headers: { "x-cron-secret": header } } as unknown as Request, {} as Response, next);
  return next.mock.calls[0];
}

afterEach(() => { vi.unstubAllEnvs(); crypto.timingSafeEqual.mockClear(); log.warn.mockClear(); });

describe("CRON_SECRET at boot", () => {
  // OPS-003: production refuses to boot without the secret, with a startup
  // error that names it. Dev and test stay optional.
  it.each([
    [{ ...production }],
    [{ ...production, CRON_SECRET: "" }],
    [{ ...production, CRON_HTTP_ENABLED: "false" }],
  ])("refuses to boot production without CRON_SECRET %j", (env) => {
    const result = validateEnv(env);
    expect(result.success).toBe(false);
    expect(result.errors?.map((error) => error.variable)).toEqual(["CRON_SECRET"]);
    expect(() => validateEnvOrThrow(env)).toThrow(/CRON_SECRET: CRON_SECRET is required in production/);
  });

  it("still refuses a short CRON_SECRET in production", () => {
    const result = validateEnv({ ...production, CRON_SECRET: "short" });
    expect(result.errors?.map((error) => error.variable)).toEqual(["CRON_SECRET"]);
  });

  it.each(["development", "test"])("boots %s without CRON_SECRET, warns once, and refuses the cron route", async (nodeEnv) => {
    vi.stubEnv("CRON_SECRET", "");
    expect(validateEnv({ NODE_ENV: nodeEnv, DATABASE_URL: "postgresql://synthetic@localhost/db", SESSION_SECRET: "s".repeat(32) }))
      .toMatchObject({ success: true });
    expect(warnIfCronSecretMissing(process.env)).toBe(true);
    expect(log.warn).toHaveBeenCalledOnce();

    const ran = vi.fn((_req: Request, res: Response) => { res.json({ ran: true }); });
    const app = express().post("/api/cron/recurring", verifyCronSecret, ran).use(errorHandler);
    await request(app).post("/api/cron/recurring").expect(403);
    await request(app).post("/api/cron/recurring").set("x-cron-secret", "anything").expect(403);
    expect(ran).not.toHaveBeenCalled();
  });

  it("does not warn when CRON_SECRET is set", () => {
    expect(warnIfCronSecretMissing({ CRON_SECRET: SECRET })).toBe(false);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...production, CRON_SECRET: SECRET }],
    [{ ...production, CRON_SECRET: SECRET, CRON_HTTP_ENABLED: "false" }],
    [{ NODE_ENV: "development", DATABASE_URL: "postgresql://synthetic@localhost/db", SESSION_SECRET: "s".repeat(32) }],
  ])("boots %j", (env) => {
    expect(validateEnv(env).success).toBe(true);
  });

  it("rejects malformed scheduler and cron flags", () => {
    const result = validateEnv({ ...production, CRON_SECRET: SECRET, SCHEDULER_ENABLED: "yes", CRON_HTTP_ENABLED: "1" });

    expect(result.errors?.map((error) => error.variable)).toEqual(expect.arrayContaining(["SCHEDULER_ENABLED", "CRON_HTTP_ENABLED"]));
  });
});

describe("verifyCronSecret", () => {
  it("admits the configured secret", () => {
    vi.stubEnv("CRON_SECRET", SECRET);

    expect(check(SECRET)).toEqual([]);
    expect(crypto.timingSafeEqual).toHaveBeenCalledOnce();
  });

  it.each([
    ["a same-length wrong secret", `${SECRET.slice(0, -1)}X`],
    ["a shorter prefix", SECRET.slice(0, 8)],
    ["a longer value", `${SECRET}0`],
    ["an empty header", ""],
    ["a missing header", undefined],
    ["a repeated header", [SECRET, SECRET]],
  ])("refuses %s", (_label, header) => {
    vi.stubEnv("CRON_SECRET", SECRET);

    expect(check(header)).toEqual([expect.any(ForbiddenError)]);
  });

  it("compares unequal lengths in constant time too", () => {
    vi.stubEnv("CRON_SECRET", SECRET);

    check("x");
    expect(crypto.timingSafeEqual).toHaveBeenCalledOnce();
  });

  it.each(["development", "test"])("has no %s bypass when CRON_SECRET is unset", (nodeEnv) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv("CRON_SECRET", "");

    expect(check(undefined)).toEqual([expect.any(ForbiddenError)]);
    expect(check("anything")).toEqual([expect.any(ForbiddenError)]);
  });
});
