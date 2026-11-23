/**
 * R16.2 / OPS-010: per-channel delivery outcomes, quiet hours, escaping and push-not-configured.
 * Real Postgres and the real service and routes; only the two outbound transports (SMTP, web push)
 * are stubbed, which is what lets a single channel fail.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { userNotificationPreferences } from "@shared/schema";
import { NOTIFICATION_TYPES } from "@shared/notificationTypes";
import { db, pool } from "../../../db";
import { createSignedHousehold, type SignedHousehold } from "../../../__tests__/signed-household-fixture";
import { deleteSeededSessions, seedLivePushSubscription } from "../../../__tests__/push-fixtures";

const transports = vi.hoisted(() => ({ sendEmail: vi.fn(), sendNotification: vi.fn() }));
vi.mock("../../../services/emailService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../services/emailService")>()),
  sendEmail: transports.sendEmail,
}));
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: transports.sendNotification },
}));

import { notificationService } from "../../../services/notification/service";
import { isWithinWindow } from "../../../services/notification/quiet-hours-window";

const TYPE = NOTIFICATION_TYPES.LARGE_TRANSACTION;
let fx: SignedHousehold;

const notify = (key: string, extra: { title?: string; body?: string } = {}) =>
  notificationService.notifyDetailed(fx.userId, fx.householdId, TYPE, {
    title: extra.title ?? "Test event", body: extra.body ?? "Body", actionUrl: "/transactions", dedupeKey: key,
  });

async function ledger(key: string) {
  const rows = (await pool.query(
    "SELECT channel, status, attempts, reason FROM notification_deliveries WHERE user_id=$1 AND event_key=$2 ORDER BY channel", [fx.userId, key],
  )).rows;
  return Object.fromEntries(rows.map(row => [row.channel, row]));
}

const hm = (at: Date) => `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")}`;
const quiet = (body: object) => request(fx.app).put("/api/notifications/quiet-hours").set(fx.headers).send(body);

describe("R16.2 notification outcomes (real Postgres, stubbed transports)", () => {
  beforeAll(async () => {
    fx = await createSignedHousehold("r16-outcomes");
    await db.insert(userNotificationPreferences).values({
      userId: fx.userId, notificationType: TYPE, inAppEnabled: true, emailEnabled: true, pushEnabled: true,
    });
    // Registered from a live session, as production does; a row with no live session gets no push.
    await seedLivePushSubscription(fx.userId, {
      endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`, keys: { p256dh: "synthetic", auth: "synthetic" },
    });
    process.env.VAPID_PUBLIC_KEY = "synthetic-public";
    process.env.VAPID_PRIVATE_KEY = "synthetic-private";
  }, 30000);

  beforeEach(async () => {
    transports.sendEmail.mockReset().mockResolvedValue(true);
    transports.sendNotification.mockReset().mockResolvedValue({ statusCode: 201 });
    process.env.VAPID_PUBLIC_KEY = "synthetic-public";
    process.env.VAPID_PRIVATE_KEY = "synthetic-private";
    await pool.query("DELETE FROM user_quiet_hours WHERE user_id=$1", [fx.userId]);
  });

  afterAll(async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    if (fx) await deleteSeededSessions([fx.userId]);
    if (fx) await fx.cleanup();
  });

  it("records e-mail failure and push success separately, retries only the e-mail, once", async () => {
    const key = `r16:${randomUUID()}`;
    transports.sendEmail.mockResolvedValueOnce(false);

    const first = await notify(key);
    expect(first.channels).toEqual({ email: "failed", push: "sent" });
    expect(first.delivered).toBe(true);
    expect(await ledger(key)).toMatchObject({ email: { status: "failed", attempts: 1 }, push: { status: "sent", attempts: 1 } });

    const retry = await notify(key);
    expect(retry.channels).toEqual({ email: "sent", push: "sent" });
    expect(retry.delivered).toBe(true);
    expect(await ledger(key)).toMatchObject({ email: { status: "sent", attempts: 2 }, push: { status: "sent", attempts: 1 } });
    expect(transports.sendEmail).toHaveBeenCalledTimes(2);
    expect(transports.sendNotification).toHaveBeenCalledTimes(1);

    const again = await notify(key);
    expect(again.delivered).toBe(false);
    expect(transports.sendEmail).toHaveBeenCalledTimes(2);
    expect(transports.sendNotification).toHaveBeenCalledTimes(1);
  });

  it("never retries an unknown outcome and never treats it as failed", async () => {
    const key = `r16:${randomUUID()}`;
    transports.sendNotification.mockRejectedValueOnce(new Error("socket hang up"));

    const first = await notify(key);
    expect(first.channels.push).toBe("unknown");
    expect(first.channels.email).toBe("sent");

    const second = await notify(key);
    expect(second.delivered).toBe(false);
    expect(await ledger(key)).toMatchObject({ push: { status: "unknown", attempts: 1 }, email: { status: "sent", attempts: 1 } });
    expect(transports.sendNotification).toHaveBeenCalledTimes(1);
    expect(transports.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("treats a push the service rejected with an HTTP status as failed, and retries it", async () => {
    const key = `r16:${randomUUID()}`;
    transports.sendNotification.mockRejectedValueOnce(Object.assign(new Error("unavailable"), { statusCode: 503 }));

    expect((await notify(key)).channels.push).toBe("failed");
    expect((await notify(key)).channels.push).toBe("sent");
    expect(await ledger(key)).toMatchObject({ push: { status: "sent", attempts: 2 }, email: { status: "sent", attempts: 1 } });
  });

  it("counts actual outcomes for a household: a deduplicated repeat counts zero, a real retry counts one", async () => {
    const data = { title: "Household event", body: "Body", dedupeKey: `r16:${randomUUID()}` };
    transports.sendEmail.mockResolvedValueOnce(false);

    expect(await notificationService.notifyHousehold(fx.householdId, TYPE, data)).toBe(1);
    expect(await notificationService.notifyHousehold(fx.householdId, TYPE, data)).toBe(1);
    expect(await notificationService.notifyHousehold(fx.householdId, TYPE, data)).toBe(0);
  });

  it("escapes user text in the e-mail HTML", async () => {
    await notify(`r16:${randomUUID()}`, { title: "<b>Rent</b>", body: `Paid <img src=x onerror="alert(1)"> & done` });

    const html = String(transports.sendEmail.mock.calls[0][0].html);
    expect(html).toContain("&lt;b&gt;Rent&lt;/b&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; done");
    expect(html).not.toContain("<b>Rent</b>");
    expect(html).not.toContain("<img");
  });

  describe("quiet hours", () => {
    it("suppresses both channels inside the window and does not resend them afterwards", async () => {
      const now = Date.now();
      await quiet({ enabled: true, startTime: hm(new Date(now - 3_600_000)), endTime: hm(new Date(now + 3_600_000)), timezone: "UTC" }).expect(200);
      const key = `r16:${randomUUID()}`;

      const first = await notify(key);
      expect(first.channels).toEqual({ email: "suppressed", push: "suppressed" });
      expect(await ledger(key)).toMatchObject({ email: { reason: "quiet_hours" }, push: { reason: "quiet_hours" } });
      expect(transports.sendEmail).not.toHaveBeenCalled();
      expect(transports.sendNotification).not.toHaveBeenCalled();

      await quiet({ enabled: false, startTime: "22:00", endTime: "07:00", timezone: "UTC" }).expect(200);
      expect((await notify(key)).delivered).toBe(false);
      expect(transports.sendEmail).not.toHaveBeenCalled();
    });

    it("delivers outside the window", async () => {
      const now = Date.now();
      await quiet({ enabled: true, startTime: hm(new Date(now + 3_600_000)), endTime: hm(new Date(now + 7_200_000)), timezone: "UTC" }).expect(200);

      expect((await notify(`r16:${randomUUID()}`)).channels).toEqual({ email: "sent", push: "sent" });
    });

    it("reads the window as written, including across midnight", () => {
      expect(isWithinWindow("23:30", "22:00", "07:00")).toBe(true);
      expect(isWithinWindow("06:59", "22:00", "07:00")).toBe(true);
      expect(isWithinWindow("07:00", "22:00", "07:00")).toBe(false);
      expect(isWithinWindow("12:00", "22:00", "07:00")).toBe(false);
      expect(isWithinWindow("12:00", "09:00", "17:00")).toBe(true);
    });

    it("saves and returns the user's own settings, with an audit row", async () => {
      const body = { enabled: true, startTime: "22:00", endTime: "07:00", timezone: "Africa/Lusaka" };
      const auditCount = async () => Number((await pool.query(
        "SELECT count(*) AS n FROM audit_logs WHERE user_id=$1 AND entity_type='quiet_hours' AND entity_id=$1 AND action='UPDATE'", [fx.userId],
      )).rows[0].n);
      const before = await auditCount();

      await quiet(body).expect(200);

      const read = await request(fx.app).get("/api/notifications/quiet-hours").set(fx.headers).expect(200);
      expect(read.body.data).toEqual(body);
      expect(await auditCount()).toBe(before + 1);
    });

    it.each([
      ["an unknown time zone", { enabled: true, startTime: "22:00", endTime: "07:00", timezone: "Mars/Phobos" }],
      ["identical start and end", { enabled: true, startTime: "08:00", endTime: "08:00", timezone: "UTC" }],
      ["an out-of-range time", { enabled: true, startTime: "25:00", endTime: "07:00", timezone: "UTC" }],
      ["an unknown field", { enabled: true, startTime: "22:00", endTime: "07:00", timezone: "UTC", userId: randomUUID() }],
    ])("refuses %s with 400 and saves nothing", async (_label, body) => {
      const res = await quiet(body);

      expect(res.status).toBe(400);
      expect((await pool.query("SELECT 1 FROM user_quiet_hours WHERE user_id=$1", [fx.userId])).rows).toEqual([]);
    });
  });

  describe("push not configured", () => {
    it("answers the VAPID key route with a feature-off state, not a 500", async () => {
      delete process.env.VAPID_PUBLIC_KEY;

      const res = await request(fx.app).get("/api/notifications/push/vapid-key").set(fx.headers);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ configured: false, publicKey: null });
    });

    it("records push as suppressed (not failed) and does not call the transport", async () => {
      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
      const key = `r16:${randomUUID()}`;

      const outcome = await notify(key);

      expect(outcome.channels).toEqual({ email: "sent", push: "suppressed" });
      expect(await ledger(key)).toMatchObject({ push: { status: "suppressed", reason: "push_not_configured" } });
      expect(transports.sendNotification).not.toHaveBeenCalled();
    });
  });
});
