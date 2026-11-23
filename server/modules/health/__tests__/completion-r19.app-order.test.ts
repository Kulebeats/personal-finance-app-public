import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type session from "express-session";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";
import { createHmac } from "node:crypto";

const state = vi.hoisted(() => ({
  phase: "get", gets: 0, touches: 0, attaches: 0,
}));
vi.mock("../../../config/session-store", async () => {
  const { default: library } = await import("express-session");
  class FixtureStore extends library.Store {
  get(_id: string, callback: (error: Error | null, value?: session.SessionData) => void) {
    state.gets++;
    const cookie = new library.Cookie();
    cookie.maxAge = 60000;
    if (state.phase !== "get") callback(null, { cookie, userId: "00000000-0000-4000-8000-000000000001" });
  }
  touch(_id: string, _value: session.SessionData, callback: (error?: Error) => void) {
    state.touches++;
    if (state.phase !== "touch") callback();
  }
  set(_id: string, _value: session.SessionData, callback?: (error?: Error) => void) { callback?.(); }
  destroy(_id: string, callback?: (error?: Error) => void) { callback?.(); }
  }
  return { sessionStore: new FixtureStore() };
});
vi.mock("../../../db", () => ({ pool: { query: vi.fn().mockRejectedValue(new Error("synthetic DB outage")) } }));
vi.mock("../../../config/redis", () => ({ redis: null, productionRedis: null, assertRequiredJobCapabilities: vi.fn() }));
vi.mock("../../../routes", () => ({ registerRoutes: vi.fn() }));
vi.mock("../../../startup", () => ({ initializeServices: vi.fn() }));
vi.mock("../../../auth", () => ({
  attachUser: (_req: Request, _res: Response, next: NextFunction) => { state.attaches++; if (state.phase !== "auth") next(); },
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../../../middleware/householdGuard", () => ({ householdGuard: (_req: Request, _res: Response, next: NextFunction) => next() }));
vi.mock("../../../middleware/uploadsAuth", () => ({ serveUpload: vi.fn() }));
import { app } from "../../../app";
import healthRoutes from "../health.routes";

// This is the normal post-app route-registration position before the repair.
// The repaired app handles the reserved probes earlier, so this is unreachable.
app.use("/health", healthRoutes);
app.get("/__session-control", (req, res) => res.json({ userId: req.session.userId }));
beforeEach(() => { state.gets = 0; state.touches = 0; state.attaches = 0; app.locals.isShuttingDown = false; });
afterEach(() => vi.unstubAllEnvs());

it.each(["get", "auth", "touch"])("actual app health ordering bypasses a stalled session %s with a valid signed cookie", async (phase) => {
  state.phase = phase;
  const id = "synthetic-session";
  const signature = createHmac("sha256", process.env.SESSION_SECRET!).update(id).digest("base64").replace(/=+$/, "");
  const cookie = `connect.sid=${encodeURIComponent(`s:${id}.${signature}`)}`;
  const responses = await Promise.all(["/health/live", "/health/ready", "/health/startup", "/healthz"].map(async (endpoint) => {
    const call = request(app).get(endpoint).set("Cookie", cookie);
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        call.then((response) => response.status, () => -1),
        new Promise<number>((resolve) => { timer = setTimeout(() => resolve(-1), 1800); }),
      ]);
    } finally { clearTimeout(timer!); call.abort(); }
  }));
  expect(responses).toEqual([200, 503, 503, 200]);
  expect(state.gets).toBe(0);
  expect(state.touches).toBe(0);
  expect(state.attaches).toBe(0);
});

it("positive control preserves normal session get/auth/touch outside the reserved health paths", async () => {
  state.phase = "none";
  const id = "synthetic-session";
  const signature = createHmac("sha256", process.env.SESSION_SECRET!).update(id).digest("base64").replace(/=+$/, "");
  const response = await request(app).get("/__session-control")
    .set("Cookie", `connect.sid=${encodeURIComponent(`s:${id}.${signature}`)}`).expect(200);
  expect(response.body.userId).toBe("00000000-0000-4000-8000-000000000001");
  expect(state.gets).toBe(1);
  expect(state.attaches).toBe(1);
  expect(state.touches).toBe(1);
});
