import { describe, expect, it } from "vitest";
import express, { type ErrorRequestHandler } from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import { doubleCsrf } from "csrf-csrf";
import request from "supertest";
import { createCsrfPolicyMiddleware } from "../csrf-policy";

const verificationPaths = ["/api/auth/verify-email", "/api/settings/security/email/verify"];
const ordinaryPaths = [
  "/api/settings/security/email/resend", "/api/settings/security/email/change",
  "/api/settings/security/email/cancel", "/api/household",
];

/** Real CSRF/session middleware only. HTTP fixture cookies are deliberately
 * insecure for Supertest; this is not the production app or a TLS-cookie proof. */
function component(policyEnvironment: string | (() => string | undefined) = "production") {
  const app = express();
  app.use(express.json());
  app.use(session({
    name: "component.sid", secret: "synthetic-component-session-secret",
    store: new session.MemoryStore(), resave: false, saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, sameSite: "lax" },
  }));
  app.use(cookieParser());
  const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
    getSecret: () => "synthetic-component-csrf-secret",
    getSessionIdentifier: (req) => req.sessionID,
    cookieName: "component.csrf",
    cookieOptions: { secure: false, httpOnly: true, sameSite: "lax", path: "/" },
    size: 64,
    getCsrfTokenFromRequest: (req) => req.headers["x-csrf-token"] as string,
  });
  // Exercise the app's actual policy consumer, without changing protected NODE_ENV.
  const getEnvironment = typeof policyEnvironment === "function" ? policyEnvironment : () => policyEnvironment;
  app.use(createCsrfPolicyMiddleware(doubleCsrfProtection, getEnvironment));
  app.get("/fixture/session", (req, res, next) => {
    req.session.userId = "00000000-0000-4000-8000-000000000001";
    req.session.save((error) => error ? next(error) : res.json({ fixtureSession: true }));
  });
  app.get("/api/csrf-token", (req, res) => res.json({ csrfToken: generateCsrfToken(req, res) }));
  app.all("*", (_req, res) => res.json({ reachedHandler: true }));
  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error && typeof error === "object" && "code" in error && error.code === "EBADCSRFTOKEN") {
      res.status(403).json({ code: "CSRF_INVALID" });
      return;
    }
    res.status(500).json({ code: "UNEXPECTED_COMPONENT_ERROR" });
  };
  app.use(errorHandler);
  return app;
}

describe("real csrf-csrf enforcement with the app's request policy", () => {
  it.each(verificationPaths)("permits the exact token-consumer POST %s without ambient cookies or CSRF", async (path) => {
    const response = await request(component()).post(path).send({ token: "synthetic-bearer-for-handler-only" });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ reachedHandler: true });
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it.each(verificationPaths)("uses the canonical req.path when %s has a query string", async (path) => {
    const response = await request(component()).post(`${path}?source=synthetic-mail`)
      .send({ token: "synthetic-bearer-for-handler-only" }).expect(200);
    expect(response.body).toEqual({ reachedHandler: true });
  });

  it.each(verificationPaths)("does not make %s an exemption for other unsafe methods", async (path) => {
    const app = component();
    for (const method of ["put", "patch", "delete", "trace"] as const) {
      const response = await request(app)[method](path).send({ token: "synthetic" });
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ code: "CSRF_INVALID" });
    }
  });

  it.each(verificationPaths)("does not normalize neighboring, encoded or differently cased forms of %s", async (path) => {
    const app = component();
    for (const neighbor of [
      `${path}/`, `${path}/extra`, `${path}-extra`, path.toUpperCase(),
      path.replace("verify", "%76erify"), path.replace("/api/", "/api/v1/"),
    ]) {
      const response = await request(app).post(neighbor).send({ token: "synthetic" });
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ code: "CSRF_INVALID" });
    }
  });

  it.each(ordinaryPaths)("preserves missing/wrong-CSRF rejection and valid-cookie controls for %s", async (path) => {
    const app = component(), agent = request.agent(app);
    await agent.get("/fixture/session").expect(200);
    const prepared = await agent.get("/api/csrf-token").expect(200);
    const token = prepared.body.csrfToken;
    expect(typeof token).toBe("string");
    expect((await agent.post(path).send({}).expect(403)).body).toEqual({ code: "CSRF_INVALID" });
    await agent.post(path).set("x-csrf-token", "wrong-token").send({}).expect(403);
    const valid = await agent.post(path).set("x-csrf-token", token).send({}).expect(200);
    expect(valid.body).toEqual({ reachedHandler: true });
    // A copied cookie/header pair remains bound to the session that minted it.
    const csrfCookie = (prepared.headers["set-cookie"] as unknown as string[])
      .find((cookie) => cookie.startsWith("component.csrf="))!.split(";")[0];
    await request(app).post(path).set("Cookie", csrfCookie).set("x-csrf-token", token).send({}).expect(403);
  });

  it.each(verificationPaths)("handles the fresh anonymous token-GET sequence for %s without persisting identity", async (path) => {
    const app = component(), agent = request.agent(app);
    const prepared = await agent.get("/api/csrf-token").expect(200);
    expect((prepared.headers["set-cookie"] as unknown as string[]).some((cookie) => cookie.startsWith("component.sid=")))
      .toBe(false);
    const response = await agent.post(path).set("x-csrf-token", prepared.body.csrfToken)
      .send({ token: "synthetic-bearer-for-handler-only" }).expect(200);
    expect(response.body).toEqual({ reachedHandler: true });
    expect(response.headers["set-cookie"]).toBeUndefined();
    await agent.post("/api/household").set("x-csrf-token", prepared.body.csrfToken).send({}).expect(403);
  });

  it.each([
    "/api/csrf-token", "/healthz", "/healthz/ready", "/api/cron/synthetic",
    "/api/auth/login", "/api/auth/verify-mfa", "/api/auth/mfa/verify",
    "/api/auth/mfa/resend", "/api/auth/resend-verification",
    "/api/auth/forgot-password", "/api/auth/reset-password",
    "/api/auth/register", "/api/auth/logout",
  ])("preserves the existing exemption for %s", async (path) => {
    await request(component()).post(path).send({}).expect(200);
  });

  it("preserves safe methods and the existing test-mode selection without mutating the process environment", async () => {
    const before = process.env.NODE_ENV;
    const app = component();
    await request(app).get("/api/ordinary").expect(200);
    await request(app).head("/api/ordinary").expect(200);
    await request(app).options("/api/ordinary").expect(200);
    await request(component("test")).post("/api/ordinary").send({}).expect(200);
    expect(process.env.NODE_ENV).toBe(before);
    expect(before).toBe("test");
  });

  it("reads the environment provider for each request rather than freezing it at construction", async () => {
    let selectedEnvironment = "test";
    const app = component(() => selectedEnvironment);
    await request(app).post("/api/ordinary").send({}).expect(200);
    selectedEnvironment = "production";
    await request(app).post("/api/ordinary").send({}).expect(403);
    expect(process.env.NODE_ENV).toBe("test");
  });
});
