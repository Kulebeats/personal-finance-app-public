/**
 * NEW-38 "no login noise": a sign-in from a device the user already has a
 * live session on sends no new-device notice; a sign-in from a new device
 * does. Real HTTP sign-ins against real Postgres: the device check reads the
 * real `user_sessions` rows (auth.session.service.ts finalizeLogin →
 * isKnownDeviceSession), and the notice is the real `new_login` in-app row,
 * keyed by the session it announces (`login:<sessionId>`).
 *
 * The notice is fire-and-forget, so each positive case waits for its row, and
 * the known-device case is judged after a later new-device notice has landed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { users } from "@shared/schema";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";

const password = "SyntheticKnownDevice123!";
const userId = randomUUID();
const email = `known-device-${userId}@example.test`;
const WINDOWS_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const NOTICE_WAIT_MS = 10_000;
const POLL_MS = 100;
let app: Awaited<ReturnType<typeof getTestApp>>;

/** Signs in from the given browser and returns the new session's id (the tracking row's token). */
async function signIn(userAgent: string): Promise<string> {
  const known = new Set(await sessionIds());
  await request(app).post("/api/auth/login").set("User-Agent", userAgent).send({ email, password }).expect(200);
  const fresh = (await sessionIds()).filter((id) => !known.has(id));
  expect(fresh).toHaveLength(1);
  return fresh[0];
}

async function sessionIds(): Promise<string[]> {
  const { rows } = await pool.query<{ session_token: string }>("SELECT session_token FROM user_sessions WHERE user_id = $1", [userId]);
  return rows.map((row) => row.session_token);
}

async function noticeKeys(): Promise<string[]> {
  const { rows } = await pool.query<{ dedupe_key: string }>(
    "SELECT dedupe_key FROM notifications WHERE user_id = $1 AND type = 'new_login' ORDER BY created_at", [userId]);
  return rows.map((row) => row.dedupe_key);
}

async function waitForNotice(sessionId: string): Promise<void> {
  const deadline = Date.now() + NOTICE_WAIT_MS;
  while (Date.now() < deadline) {
    if ((await noticeKeys()).includes(`login:${sessionId}`)) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`no new_login notice for session ${sessionId} within ${NOTICE_WAIT_MS} ms`);
}

describe("NEW-38 a sign-in from a known device sends no new-device notice", () => {
  let firstDevice: string;
  let sameDeviceAgain: string;
  let newDevice: string;

  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(users).values({
      id: userId, email, username: `known-device-${userId}`, passwordHash: await hashPassword(password), emailVerified: true,
    });
    // In-app only, so the probe is the notifications row and no e-mail is attempted.
    await pool.query(
      "INSERT INTO user_notification_preferences(user_id, notification_type, in_app_enabled, email_enabled, push_enabled) VALUES ($1, 'new_login', true, false, false)",
      [userId]);

    firstDevice = await signIn(WINDOWS_CHROME);
    await waitForNotice(firstDevice);
    sameDeviceAgain = await signIn(WINDOWS_CHROME);
    newDevice = await signIn(IPHONE_SAFARI);
    await waitForNotice(newDevice);
  }, 60000);

  afterAll(async () => {
    await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [userId]);
    await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1", [userId]);
    await db.delete(users).where(eq(users.id, userId));
  });

  it("notifies the first sign-in, which comes from a device the user has never used", async () => {
    expect(await noticeKeys()).toContain(`login:${firstDevice}`);
  });

  it("sends no notice for a second sign-in from the same browser and OS", async () => {
    expect(await noticeKeys()).not.toContain(`login:${sameDeviceAgain}`);
  });

  it("still notifies a sign-in from a different device", async () => {
    expect(await noticeKeys()).toEqual([`login:${firstDevice}`, `login:${newDevice}`]);
  });
});
