/**
 * Auth Step-Up MFA Tests
 *
 * Verifies the requireStepUp middleware behavior, including:
 * - Tiered TTL enforcement (FINANCIAL, SETTINGS, DESTRUCTIVE)
 * - Session state verification
 * - Expiry handling
 *
 * @module modules/auth/__tests__/auth.stepup.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import session from "express-session";
import { requireStepUp, setStepUpVerified, STEP_UP_TTL } from "../../../middleware/requireStepUp";

describe("Step-Up MFA Middleware", () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(
      session({
        secret: "test-secret",
        resave: false,
        saveUninitialized: false,
      }),
    );

    // Dummy protected routes
    app.post("/test/settings", requireStepUp("SETTINGS"), (req, res) => {
      res.json({ success: true, message: "Settings Updated" });
    });

    app.post("/test/financial", requireStepUp("FINANCIAL"), (req, res) => {
      res.json({ success: true, message: "Money Moved" });
    });

    app.post("/test/destructive", requireStepUp("DESTRUCTIVE"), (req, res) => {
      res.json({ success: true, message: "Account Deleted" });
    });

    // Helper to set session state
    app.post("/test/set-session", (req, res) => {
      if (req.body.stepUpVerifiedAt) {
        req.session.stepUpVerifiedAt = req.body.stepUpVerifiedAt;
        req.session.stepUpSessionId = req.sessionID;
        req.session.stepUpUserId = req.body.userId;
      }
      if (req.body.userId) {
        req.session.userId = req.body.userId;
      }
      res.json({ success: true });
    });
  });

  it("should block request when step-up is missing", async () => {
    const res = await request(app).post("/test/settings");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("STEP_UP_REQUIRED");
    expect(res.body.requiresStepUp).toBe(true);
    expect(res.body.level).toBe("SETTINGS");
  });

  it("should allow request when step-up is fresh (SETTINGS)", async () => {
    const agent = request.agent(app);

    // Set step-up verification timestamp to NOW
    await agent.post("/test/set-session").send({
      stepUpVerifiedAt: Date.now(),
      userId: "123e4567-e89b-12d3-a456-426614174000",
    });

    const res = await agent.post("/test/settings");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("should enforce FINANCIAL TTL (5 mins)", async () => {
    const agent = request.agent(app);

    // Set verification to 6 minutes ago (Expired for FINANCIAL)
    const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
    await agent.post("/test/set-session").send({
      stepUpVerifiedAt: sixMinutesAgo,
      userId: "123e4567-e89b-12d3-a456-426614174000",
    });

    // Should fail for FINANCIAL
    const resFinancial = await agent.post("/test/financial");
    expect(resFinancial.status).toBe(401);

    // But should succeed for SETTINGS (15 mins TTL)
    const resSettings = await agent.post("/test/settings");
    expect(resSettings.status).toBe(200);
  });

  it("should enforce DESTRUCTIVE TTL (5 min)", async () => {
    const agent = request.agent(app);

    // A 2-minute-old step-up is now WITHIN the relaxed 5-min DESTRUCTIVE window.
    await agent.post("/test/set-session").send({
      stepUpVerifiedAt: Date.now() - 2 * 60 * 1000,
      userId: "123e4567-e89b-12d3-a456-426614174000",
    });
    const resWithinWindow = await agent.post("/test/destructive");
    expect(resWithinWindow.status).toBe(200);

    // Older than 5 minutes → expired for DESTRUCTIVE, but SETTINGS (15 min) is still valid.
    await agent.post("/test/set-session").send({
      stepUpVerifiedAt: Date.now() - 6 * 60 * 1000,
      userId: "123e4567-e89b-12d3-a456-426614174000",
    });
    const resDestructive = await agent.post("/test/destructive");
    expect(resDestructive.status).toBe(401);

    const resSettings = await agent.post("/test/settings");
    expect(resSettings.status).toBe(200);
  });
  it("rejects copied step-up state when bound to a different session", async () => {
    app.post("/test/copied-step-up", (req, res) => {
      req.session.userId = "123e4567-e89b-12d3-a456-426614174000";
      setStepUpVerified(req);
      req.session.stepUpSessionId = "different-session";
      res.json({ success: true });
    });
    const agent = request.agent(app);
    await agent.post("/test/copied-step-up");
    await agent.post("/test/settings").expect(401);
  });
});
