import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import pg from "pg";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { users } from "@shared/schema";
import * as auth from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";

const password = "SyntheticNotice123!", changed = "SyntheticNoticeChanged456!";
const ids: string[] = [];
let app: Awaited<ReturnType<typeof getTestApp>>;
async function fixture() {
  const id = randomUUID(), email = `r01-notice-${id}@example.invalid`;
  const hash = await auth.hashPassword(password);
  await db.insert(users).values({ id, email, username: `notice-${id}`, passwordHash: hash, emailVerified: true, timezone: "Africa/Lusaka" });
  ids.push(id);
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  const cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  await request(app).post("/api/settings/security/step-up").set("Cookie", cookie).send({ password }).expect(200);
  return { id, email, hash, cookie };
}
function change(user: Awaited<ReturnType<typeof fixture>>) {
  return request(app).put("/api/settings/security/password").set("Cookie", user.cookie)
    .send({ currentPassword: password, newPassword: changed, confirmPassword: changed });
}
async function token(userId: string) {
  const raw = randomBytes(32).toString("hex");
  await pool.query("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [userId, createHash("sha256").update(raw).digest("hex")]);
  return raw;
}

describe("R01 atomic sanitized security notices", () => {
  beforeAll(async () => { app = await getTestApp(); });
  afterAll(async () => {
    vi.restoreAllMocks();
    for (const id of ids) {
      await pool.query("DELETE FROM outbox_events WHERE payload->>'userId' = $1", [id]);
      await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1", [id]);
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [id]);
      await db.delete(users).where(eq(users.id, id));
    }
  });
  it.each(["change", "reset"] as const)("%s commits its security audit, notice and credential as one unit", async (kind) => {
    const user = await fixture();
    if (kind === "change") await change(user).expect(200);
    else await request(app).post("/api/auth/reset-password").send({ token: await token(user.id), newPassword: changed }).expect(200);
    const { rows: audits } = await pool.query("SELECT id, event_type, details FROM security_audit_logs WHERE user_id = $1 AND event_type = $2", [user.id, kind === "change" ? "PASSWORD_CHANGE" : "PASSWORD_RESET_COMPLETE"]);
    expect(audits).toHaveLength(1);
    expect(audits[0].details).toEqual({ action: kind === "change" ? "password_change" : "password_reset", sessionsRevoked: true });
    const { rows } = await pool.query("SELECT aggregate_id, payload, status, last_error FROM outbox_events WHERE payload->>'userId' = $1 AND event_type = 'security.notice.requested'", [user.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].aggregate_id).toBe(audits[0].id);
    expect(rows[0]).toMatchObject({ status: "suppressed", last_error: "email_preference_disabled" });
    expect(Object.keys(rows[0].payload).sort()).toEqual(["channel", "kind", "occurredAt", "recipient", "userId", "version"]);
    expect(rows[0].payload).toMatchObject({ version: 1, userId: user.id, kind: "password_changed", recipient: user.email, channel: "email" });
    const serialized = JSON.stringify({ audits, rows });
    for (const secret of [password, changed, user.hash]) expect(serialized).not.toContain(secret);
    expect((await pool.query("SELECT type, dedupe_key FROM notifications WHERE user_id = $1 AND type = 'password_changed'", [user.id])).rows)
      .toEqual([{ type: "password_changed", dedupe_key: `security:${audits[0].id}:in_app` }]);
  });
  it.each([ ["change", "outbox_events"], ["reset", "outbox_events"], ["change", "security_audit_logs"], ["reset", "security_audit_logs"] ] as const)("an actual %s/%s insertion failure rolls back credentials, audit and notice", async (kind, table) => {
    const user = await fixture(), raw = await token(user.id);
    const original = pg.Client.prototype.query;
    const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: any[]) {
      const text = typeof args[0] === "string" ? args[0] : args[0]?.text;
      if (text?.startsWith(`insert into "${table}"`)) {
        return (original as any).apply(this, args).then(() => { throw new Error("Synthetic failure after actual outbox insertion"); });
      }
      return (original as any).apply(this, args);
    } as any);
    try {
      if (kind === "change") await change(user).expect(500);
      else await request(app).post("/api/auth/reset-password").send({ token: raw, newPassword: changed }).expect(500);
    } finally { spy.mockRestore(); }
    expect((await pool.query("SELECT password_hash, security_generation FROM users WHERE id = $1", [user.id])).rows[0]).toEqual({ password_hash: user.hash, security_generation: 0 });
    expect((await pool.query("SELECT id FROM security_audit_logs WHERE user_id = $1 AND event_type IN ('PASSWORD_CHANGE','PASSWORD_RESET_COMPLETE')", [user.id])).rows).toHaveLength(0);
    expect((await pool.query("SELECT id FROM outbox_events WHERE payload->>'userId' = $1", [user.id])).rows).toHaveLength(0);
    expect((await pool.query("SELECT used_at FROM password_reset_tokens WHERE user_id = $1", [user.id])).rows[0].used_at).toBeNull();
    await request(app).get("/api/auth/me").set("Cookie", user.cookie).expect(200);
  });
  it("retains audit and explicit email suppression when both notice channels are opted out", async () => {
    const user = await fixture();
    await pool.query("INSERT INTO user_notification_preferences(user_id,notification_type,in_app_enabled,email_enabled) VALUES ($1,'password_changed',false,false)", [user.id]);
    await change(user).expect(200);
    expect((await pool.query("SELECT id FROM security_audit_logs WHERE user_id = $1 AND event_type = 'PASSWORD_CHANGE'", [user.id])).rows).toHaveLength(1);
    expect((await pool.query("SELECT id FROM notifications WHERE user_id = $1 AND type = 'password_changed'", [user.id])).rows).toHaveLength(0);
    expect((await pool.query("SELECT status, last_error FROM outbox_events WHERE payload->>'userId' = $1", [user.id])).rows)
      .toEqual([{ status: "suppressed", last_error: "email_preference_disabled" }]);
  });
  it("the database rejects duplicate event/recipient/channel identity case-insensitively", async () => {
    const user = await fixture();
    await change(user).expect(200);
    await expect(pool.query(`INSERT INTO outbox_events(event_type,aggregate_type,aggregate_id,payload)
      SELECT event_type,aggregate_type,aggregate_id,jsonb_set(payload,'{recipient}',to_jsonb(upper(payload->>'recipient')))
      FROM outbox_events WHERE payload->>'userId' = $1`, [user.id])).rejects.toMatchObject({ code: "23505" });
    expect((await pool.query("SELECT id FROM outbox_events WHERE payload->>'userId' = $1", [user.id])).rows).toHaveLength(1);
  });
});
