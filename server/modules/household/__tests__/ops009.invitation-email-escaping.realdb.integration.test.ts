/**
 * OPS-009: user-controlled names are HTML-escaped in the invitation e-mail.
 * An owner whose display name and household name carry markup invites a new
 * address over real HTTP (POST /api/household/invite → invitations.controller
 * → buildInvitationEmailTemplate). The outgoing message is captured at the
 * mail boundary (sendEmail), and its HTML must carry the names as text only:
 * escaped, never as live tags or attributes. Real HTTP against real Postgres.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { auditLogs, householdInvitations, householdMembers, households, users } from "@shared/schema";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";

type SentMail = { to: string; subject: string; html: string; text?: string };
const mail = vi.hoisted(() => ({ sent: [] as SentMail[] }));
vi.mock("../../../services/emailService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/emailService")>();
  return {
    ...actual,
    isEmailServiceConfigured: vi.fn(() => true),
    sendEmail: vi.fn(async (message: SentMail) => { mail.sent.push(message); return true; }),
  };
});

const password = "SyntheticInviteEscaping123!";
const ownerId = randomUUID();
const householdId = randomUUID();
const ownerEmail = `invite-escaping-${ownerId}@example.test`;
const inviteeEmail = `invite-escaping-invitee-${ownerId}@example.test`;
const INVITER_NAME = `<img src=x onerror="alert('inviter')">`;
const HOUSEHOLD_NAME = `<script>alert("household")</script> & Sons`;
let app: Awaited<ReturnType<typeof getTestApp>>;
let status: number;
let html: string;

describe("OPS-009 invitation e-mail escapes the inviter and household names", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(users).values({
      id: ownerId, email: ownerEmail, username: `invite-escaping-${ownerId}`, fullName: INVITER_NAME,
      passwordHash: await hashPassword(password), emailVerified: true,
    });
    await db.insert(households).values({ id: householdId, name: HOUSEHOLD_NAME, currency: "ZMW" });
    await db.insert(householdMembers).values({ householdId, userId: ownerId, role: "owner" });
    const login = await request(app).post("/api/auth/login").send({ email: ownerEmail, password }).expect(200);
    const cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");

    const res = await request(app).post("/api/household/invite").set("Cookie", cookie).send({ email: inviteeEmail, role: "member" });
    status = res.status;
    const invitation = mail.sent.find((message) => message.to === inviteeEmail);
    html = invitation?.html ?? "";
  }, 30000);

  afterAll(async () => {
    await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [ownerId]);
    await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1", [ownerId]);
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(householdInvitations).where(eq(householdInvitations.householdId, householdId));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    await db.delete(users).where(eq(users.id, ownerId));
  });

  it("creates the invitation and sends one e-mail to the invitee", () => {
    expect(status).toBe(201);
    expect(mail.sent.filter((message) => message.to === inviteeEmail)).toHaveLength(1);
    expect(html).not.toBe("");
  });

  it("carries both names escaped as text", () => {
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(&#39;inviter&#39;)&quot;&gt;");
    expect(html).toContain("&lt;script&gt;alert(&quot;household&quot;)&lt;/script&gt; &amp; Sons");
  });

  it("contains none of the injected markup as live HTML", () => {
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).not.toContain(`onerror="`);
    expect(html).not.toContain("& Sons");
  });
});
