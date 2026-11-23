import { afterEach, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { performance } from "node:perf_hooks";

const state = vi.hoisted(() => ({
  call: vi.fn(() => new Promise(() => {})),
  probe: { on: vi.fn(), connect: vi.fn().mockRejectedValue(new Error("synthetic Redis outage")), disconnect: vi.fn() },
}));
vi.mock("../../../db", () => ({ pool: { query: vi.fn().mockResolvedValue({ rows: [{ value: 1 }] }) } }));
vi.mock("../../../config/redis", () => ({ redis: { call: state.call, duplicate: () => state.probe }, productionRedis: null, assertRequiredJobCapabilities: vi.fn() }));
import healthRoutes from "../health.routes";

afterEach(() => vi.unstubAllEnvs());
function fixture() {
  const app = express();
  app.set("trust proxy", 1);
  app.use("/health", healthRoutes);
  return app;
}

it("actual health router bypasses stalled Redis counters while live200 and ready503 stay bounded", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const app = fixture();
  const started = performance.now();
  const responses = await Promise.all(["live", "ready"].map(async (endpoint) => {
    const call = request(app).get(`/health/${endpoint}`).set("X-Forwarded-For", "198.51.100.17");
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        call.then((response) => ({ status: response.status }), () => ({ status: -1 })),
        new Promise<{ status: number }>((resolve) => { timer = setTimeout(() => resolve({ status: -1 }), 1800); }),
      ]);
    } finally { clearTimeout(timer!); call.abort(); }
  }));
  expect(responses).toEqual([{ status: 200 }, { status: 503 }]);
  expect(performance.now() - started).toBeLessThan(2000);
  expect(state.call).not.toHaveBeenCalled();
});

it("preserves100public health requests per minute and blocks101 without any Redis call", async () => {
  const app = fixture();
  for (let index = 1; index <= 100; index++) {
    const response = await request(app).get("/health/live").set("X-Forwarded-For", "192.0.2.19").expect(200);
    expect(+response.headers["ratelimit-remaining"]).toBe(100 - index);
  }
  const response = await request(app).get("/health/live").set("X-Forwarded-For", "192.0.2.19").expect(429);
  expect(response.body.error.code).toBe("RATE_LIMITED");
  expect(+response.headers["retry-after"]).toBeGreaterThan(0);
});
