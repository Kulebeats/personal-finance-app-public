import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { users, outboxEvents } from "@shared/schema";
import { processEvents } from "../processor";
import { outboxEventService } from "../outbox";
import * as mail from "../../../services/emailService";
import pg from "pg";
import { claimSecurityNotice, beginSecurityNoticeDispatch, completeSecurityNoticeDispatch } from "../../../services/security-notice-dispatch";
import { quietHoursRetryAt } from "../../../services/security-notice-policy";

vi.mock("../../../services/emailService", async (original) => ({ ...await original<typeof import("../../../services/emailService")>(),
  isEmailServiceConfigured: vi.fn(() => false), sendEmail: vi.fn(async () => true) }));
const ids: string[] = [], eventIds: string[] = [];
async function fixture() {
  const id = randomUUID(), recipient = `security-dispatch-${id}@example.invalid`;
  await db.insert(users).values({ id, email: recipient, username: `dispatch-${id}`, passwordHash: "!synthetic-not-a-login!", emailVerified: true, timezone: "Africa/Lusaka" });
  ids.push(id);
  await pool.query("INSERT INTO user_notification_preferences (user_id,notification_type,in_app_enabled,email_enabled) VALUES ($1,'password_changed',true,true)", [id]);
  const [event] = await db.insert(outboxEvents).values({ eventType: "security.notice.requested", aggregateType: "security_audit", aggregateId: randomUUID(),
    payload: { version: 1, userId: id, kind: "password_changed", channel: "email", recipient, occurredAt: new Date().toISOString() } }).returning();
  eventIds.push(event.id);
  vi.spyOn(outboxEventService, "getPendingEvents").mockImplementation(async () => {
    const [current] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, event.id));
    return current ? [current] : [];
  });
  return { id, eventId: event.id, recipient };
}
async function read(id: string) { return (await db.select().from(outboxEvents).where(eq(outboxEvents.id, id)))[0]; }
describe("security notice dispatcher uses persisted outcomes", () => {
  beforeEach(() => { vi.mocked(mail.isEmailServiceConfigured).mockReturnValue(false); vi.mocked(mail.sendEmail).mockResolvedValue(true); });
  afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
  afterAll(async () => {
    for (const id of eventIds) await db.delete(outboxEvents).where(eq(outboxEvents.id, id));
    for (const id of ids) await db.delete(users).where(eq(users.id, id));
  });
  it("has an explicit handler and records known non-dispatch as retryable, never completed", async () => {
    const item = await fixture();
    expect(await processEvents()).toBe(0);
    expect(await read(item.eventId)).toMatchObject({ status: "failed", retryCount: 1, lastError: "email_transport_unavailable", dispatchStartedAt: null });
    expect(mail.sendEmail).not.toHaveBeenCalled();
    await pool.query("UPDATE outbox_events SET next_retry_at = now() - interval '1 second' WHERE id = $1", [item.eventId]);
    vi.mocked(mail.isEmailServiceConfigured).mockReturnValue(true);
    expect(await processEvents()).toBe(1);
    expect(await read(item.eventId)).toMatchObject({ status: "completed", retryCount: 1 });
    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
  });
  it("duplicate workers invoke one transport and count only the acknowledged outcome", async () => {
    const item = await fixture();
    vi.mocked(mail.isEmailServiceConfigured).mockReturnValue(true);
    expect((await Promise.all([processEvents(), processEvents()])).sort()).toEqual([0, 1]);
    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
    expect(mail.sendEmail).toHaveBeenCalledWith({ to: item.recipient, subject: "Password changed", html: expect.any(String), text: expect.any(String) });
    expect(await read(item.eventId)).toMatchObject({ status: "completed", dispatchGeneration: 1 });
  });
  it("a crash before intent can recover its expired lease, fencing stale start and completion", async () => {
    const item = await fixture();
    vi.mocked(mail.isEmailServiceConfigured).mockReturnValue(true);
    const stale = (await claimSecurityNotice(item.eventId))!;
    expect(stale).not.toBeNull();
    expect(await claimSecurityNotice(item.eventId)).toBeNull();
    await pool.query("UPDATE outbox_events SET dispatch_lease_until = now() - interval '1 second' WHERE id = $1", [item.eventId]);
    const current = (await claimSecurityNotice(item.eventId))!;
    expect(current.generation).toBe(stale.generation + 1);
    expect(current.token).not.toBe(stale.token);
    expect(await beginSecurityNoticeDispatch(stale)).toBeNull();
    expect(await beginSecurityNoticeDispatch(current)).toMatchObject({ recipient: item.recipient });
    expect(await completeSecurityNoticeDispatch(stale)).toBe(false);
    expect(await completeSecurityNoticeDispatch(current)).toBe(true);
    expect(mail.sendEmail).not.toHaveBeenCalled(); // state machine exercise, no claimed transport delivery
  });
  it("a crash after committed intent stays unknown and generic helpers cannot overwrite or requeue it", async () => {
    const item = await fixture();
    vi.mocked(mail.isEmailServiceConfigured).mockReturnValue(true);
    const claim = (await claimSecurityNotice(item.eventId))!;
    expect(await beginSecurityNoticeDispatch(claim)).not.toBeNull();
    await pool.query("UPDATE outbox_events SET dispatch_lease_until = now() - interval '1 second' WHERE id = $1", [item.eventId]);
    expect(await claimSecurityNotice(item.eventId)).toBeNull();
    expect(await beginSecurityNoticeDispatch(claim)).toBeNull();
    await outboxEventService.markFailed(item.eventId, "must_not_replace_unknown");
    await outboxEventService.markCompleted(item.eventId);
    await outboxEventService.retryDeadLetter(item.eventId);
    expect(await outboxEventService.markProcessing(item.eventId)).toBe(false);
    expect(await read(item.eventId)).toMatchObject({ status: "unknown", retryCount: 0 });
    expect(await processEvents()).toBe(0);
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });
  it.each(["false", "throw"])("lost or negative acknowledgment (%s) stays unknown with no blind retry", async (failure) => {
    const item = await fixture();
    vi.mocked(mail.isEmailServiceConfigured).mockReturnValue(true);
    if (failure === "false") vi.mocked(mail.sendEmail).mockResolvedValue(false);
    else vi.mocked(mail.sendEmail).mockRejectedValue(new Error("Synthetic ambiguous SMTP acknowledgment"));
    expect(await processEvents()).toBe(0);
    expect(await read(item.eventId)).toMatchObject({ status: "unknown", retryCount: 0, processedAt: null });
    expect(await processEvents()).toBe(0);
    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
  });
  it("a database failure after acknowledged send retains unknown instead of resending", async () => {
    const item = await fixture();
    vi.mocked(mail.isEmailServiceConfigured).mockReturnValue(true);
    const original = pg.Client.prototype.query;
    const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: any[]) {
      const text = typeof args[0] === "string" ? args[0] : args[0]?.text;
      const values = args[0]?.values ?? args[1];
      if (text?.startsWith('update "outbox_events"') && values?.includes("completed")) throw new Error("Synthetic post-send database failure");
      return (original as any).apply(this, args);
    } as any);
    try { expect(await processEvents()).toBe(0); }
    finally { spy.mockRestore(); }
    expect(await read(item.eventId)).toMatchObject({ status: "unknown", processedAt: null });
    expect(await processEvents()).toBe(0);
    expect(mail.sendEmail).toHaveBeenCalledTimes(1);
  });
  it.each(["preference", "erasure"])("rechecks %s between claim and dispatch", async (change) => {
    const item = await fixture();
    vi.mocked(mail.isEmailServiceConfigured).mockReturnValue(true);
    const claim = (await claimSecurityNotice(item.eventId))!;
    if (change === "preference") await pool.query("UPDATE user_notification_preferences SET email_enabled = false WHERE user_id = $1", [item.id]);
    else await pool.query("UPDATE users SET erased_at = now() WHERE id = $1", [item.id]);
    expect(await beginSecurityNoticeDispatch(claim)).toBeNull();
    expect(await read(item.eventId)).toMatchObject({ status: "suppressed", lastError: change === "preference" ? "email_preference_disabled" : "subject_erased" });
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });
  it("persists a quiet-hours deferral in the subject timezone without consuming an attempt", async () => {
    const item = await fixture();
    vi.mocked(mail.isEmailServiceConfigured).mockReturnValue(true);
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lusaka", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).split(":").map(Number);
    const minute = parts[0] * 60 + parts[1];
    const time = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
    await pool.query("INSERT INTO user_quiet_hours(user_id,enabled,start_time,end_time) VALUES ($1,true,$2,$3)", [item.id, time((minute + 1410) % 1440), time((minute + 30) % 1440)]);
    expect(await processEvents()).toBe(0);
    const deferred = await read(item.eventId);
    expect(deferred).toMatchObject({ status: "pending", retryCount: 0, lastError: "quiet_hours_deferred", dispatchStartedAt: null });
    expect(deferred.nextRetryAt!.getTime()).toBeGreaterThan(Date.now());
    expect(mail.sendEmail).not.toHaveBeenCalled();
    // Check the actual polling predicate rather than the fixture selector.
    vi.mocked(outboxEventService.getPendingEvents).mockRestore();
    expect((await outboxEventService.getPendingEvents(1000)).some((event) => event.id === item.eventId)).toBe(false);
  });
  it("resolves cross-midnight and DST quiet hours in real instants and rejects invalid configuration", () => {
    const quiet = { enabled: true, startTime: "22:00:00", endTime: "06:00:00" };
    expect(quietHoursRetryAt(quiet, "Africa/Lusaka", new Date("2026-10-15T21:00:00Z"))?.toISOString()).toBe("2026-10-16T04:00:00.000Z");
    expect(quietHoursRetryAt({ ...quiet, startTime: "01:00:00", endTime: "03:00:00" }, "America/New_York", new Date("2026-11-01T05:30:00Z"))?.toISOString()).toBe("2026-11-01T08:00:00.000Z");
    expect(quietHoursRetryAt(quiet, "Africa/Lusaka", new Date("2026-10-15T10:00:00Z"))).toBeNull();
    expect(() => quietHoursRetryAt(quiet, "Invalid/Zone", new Date())).toThrow();
    expect(() => quietHoursRetryAt({ ...quiet, endTime: quiet.startTime }, "UTC", new Date())).toThrow();
  });
  it("rejects an unexpected payload field without completing it or invoking transport", async () => {
    const item = await fixture();
    vi.mocked(mail.isEmailServiceConfigured).mockReturnValue(true);
    await pool.query("UPDATE outbox_events SET payload = payload || $2::jsonb WHERE id = $1", [item.eventId, JSON.stringify({ token: "synthetic-denied-secret" })]);
    expect(await processEvents()).toBe(0);
    expect(await read(item.eventId)).toMatchObject({ status: "dead_letter", lastError: "invalid_security_notice_payload" });
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });
  it("preserves the existing non-security unhandled event behavior", async () => {
    const item = await fixture();
    await pool.query("UPDATE outbox_events SET event_type = 'test.unhandled' WHERE id = $1", [item.eventId]);
    expect(await processEvents()).toBe(1);
    expect(await read(item.eventId)).toMatchObject({ status: "completed" });
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });
});
