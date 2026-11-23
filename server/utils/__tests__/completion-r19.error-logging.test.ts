import { afterEach, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { apiErrorMiddleware } from "../errorHandler";

afterEach(() => vi.restoreAllMocks());

it("does not serialize an unauthenticated unmatched path or JSON payload on a parser failure", async () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = express();
  // Same ordering as app.ts: JSON parsing precedes session/auth/routes.
  app.use(express.json());
  app.use(apiErrorMiddleware);
  const response = await request(app).post("/api/PRIVATE_PATH_SENTINEL?token=QUERY_SENTINEL")
    .set("Content-Type", "application/json").send('{"password":"BODY_SENTINEL",');
  expect(response.status).toBe(400);
  expect(response.body).toEqual({ success: false, error: { code: "INVALID_JSON", message: "Malformed JSON in request body." } });
  const serialized = output.mock.calls.map((call) => String(call[0])).join("\n");
  expect(serialized).not.toMatch(/PRIVATE_PATH_SENTINEL|QUERY_SENTINEL|BODY_SENTINEL/);
  expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({
    level: "error", message: "API request failed", route: "unmatched", method: "POST", error: { name: "SyntaxError" },
  });
});

it("logs the controlled matched route template and safe error identity rather than request/error values", async () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = express(); const router = express.Router();
  router.get("/:id", (req, _res, next) => {
    req.requestId = "synthetic-request";
    next(Object.assign(new Error("Failed query: SELECT ERROR_PAYLOAD_SENTINEL"), { code: "ECONNRESET" }));
  });
  app.use("/api/receipts", router);
  app.use(apiErrorMiddleware);
  const response = await request(app).get("/api/receipts/PARAM_SENTINEL?secret=QUERY_SENTINEL");
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ success: false, error: { code: "INTERNAL_ERROR", message: "An internal error occurred. Please try again." } });
  const serialized = output.mock.calls.map((call) => String(call[0])).join("\n");
  expect(serialized).not.toMatch(/PARAM_SENTINEL|QUERY_SENTINEL|ERROR_PAYLOAD_SENTINEL/);
  const entry = JSON.parse(String(output.mock.calls[0][0]));
  expect(entry).toMatchObject({ message: "API request failed", method: "GET", requestId: "synthetic-request", error: { name: "Error", code: "ECONNRESET" } });
  // Express has unwound the router's baseUrl by the central error boundary;
  // req.route.path remains the source-declared template, without the supplied ID.
  expect(entry.route).toBe("/:id");
});
