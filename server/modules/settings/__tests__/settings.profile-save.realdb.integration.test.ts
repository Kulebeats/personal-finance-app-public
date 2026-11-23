/**
 * PUT /api/settings/profile saves every field the profile form offers, refuses
 * unknown keys, and keeps personal values out of audit rows, error bodies and
 * other household members' views. Real HTTP against real Postgres.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { auditLogs, householdMembers, households, users } from "@shared/schema";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import type { HouseholdMemberDto } from "@shared/household-members";

const password = "SyntheticProfileSave123!";
const householdId = randomUUID();
const ids: string[] = [];
let app: Awaited<ReturnType<typeof getTestApp>>;
let owner: { id: string; cookie: string };
let member: { id: string; cookie: string };

// Distinctive synthetic values so any leak is detectable by substring.
const mobile = "+260971234561";
const work = "+260961234562";
const home = "0211234563";
const income = "987654.32";
const street = "Plot 4417 Synthetic Crescent";
// AH-07: NRC is collected (OI-04 proposal: stored as entered, owner-only).
const nrc = "418263/57/1";
const fullProfile = {
  fullName: "Synthetic Saver",
  firstName: "Synthetic",
  lastName: "Saver",
  displayName: "SynSaver",
  birthday: "1988-03-14",
  birthdayHideYear: true,
  timezone: "Africa/Lusaka",
  bio: "Synthetic profile used by the profile-save test.",
  gender: "female",
  phoneNumberMobile: mobile,
  phoneNumberWork: work,
  phoneNumberHome: home,
  occupation: "Accountant",
  address: {
    addressLine1: street,
    addressLine2: "Unit 2",
    city: "Lusaka",
    state: "Lusaka Province",
    postalCode: "10101",
    country: "ZM",
  },
  annualIncome: income,
  incomeFrequency: "annual",
  employmentStatus: "self-employed",
  investmentGoal: "home_purchase",
  riskTolerance: "medium",
  nrc,
  socialLinks: {
    linkedin: "https://linkedin.com/in/synthetic-saver",
    facebook: "",
    twitter: "https://x.com/synsaver",
    github: "https://github.com/synthetic-saver",
    email: "saver@example.invalid",
    website: "https://example.invalid/saver",
  },
};
// Every saved private value, each distinctive enough to find by substring.
const personalValues = [
  mobile, work, home, income, street, nrc, fullProfile.birthday, fullProfile.address.state,
  fullProfile.occupation, fullProfile.employmentStatus, fullProfile.investmentGoal,
  fullProfile.socialLinks.linkedin, fullProfile.socialLinks.email,
];
// Identity fields the session/auth payloads are allowed to carry (toPublicUserDto).
const sessionUserKeys = ["id", "username", "email", "emailVerified", "fullName", "firstName", "lastName", "displayName", "timezone", "profilePictureUrl", "bannerUrl", "bio", "createdAt", "lastLoginAt", "mfaEnabled", "mfaMethod"].sort();

function expectNoPersonalValues(value: unknown, extra: string[] = []) {
  const text = JSON.stringify(value);
  for (const secret of [...personalValues, ...extra]) expect({ secret, leaked: text.includes(secret) }).toEqual({ secret, leaked: false });
}

async function fixture(role: "owner" | "member") {
  const id = randomUUID();
  const email = `profile-save-${id}@example.invalid`;
  await db.insert(users).values({
    id, email, username: `profile-save-${id}`, passwordHash: await hashPassword(password),
    emailVerified: true, fullName: `Synthetic ${role}`,
  });
  ids.push(id);
  await db.insert(householdMembers).values({ userId: id, householdId, role });
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return { id, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") };
}

describe("PUT /api/settings/profile saves every offered field", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values({ id: householdId, name: "Synthetic profile save" });
    owner = await fixture("owner");
    member = await fixture("member");
  });

  afterAll(async () => {
    for (const id of ids) {
      await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [id]);
    }
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    for (const id of ids) await db.delete(users).where(eq(users.id, id));
  });

  it("round-trips every field through PUT then GET", async () => {
    const put = await request(app).put("/api/settings/profile").set("Cookie", owner.cookie)
      .send(fullProfile).expect(200);
    const get = await request(app).get("/api/settings/profile").set("Cookie", owner.cookie).expect(200);

    for (const body of [put.body.data.profile, get.body.data.profile]) {
      for (const [key, value] of Object.entries(fullProfile)) {
        expect({ key, value: body[key] }).toEqual({ key, value });
      }
    }
    const [stored] = await db.select().from(users).where(eq(users.id, owner.id));
    // Calendar day stored exactly as sent; saving it back does not shift it.
    expect(stored.birthday).toBe(fullProfile.birthday);
    await request(app).put("/api/settings/profile").set("Cookie", owner.cookie)
      .send({ birthday: get.body.data.profile.birthday }).expect(200);
    const [resaved] = await db.select().from(users).where(eq(users.id, owner.id));
    expect(resaved.birthday).toBe(fullProfile.birthday);
    expect(stored.annualIncome).toBe(income);
    expect(stored.phoneNumberMobile).toBe(mobile);
    expect(stored.address).toEqual(fullProfile.address);
  });

  it("clears optional fields sent empty", async () => {
    await request(app).put("/api/settings/profile").set("Cookie", owner.cookie)
      .send({ phoneNumberWork: "", annualIncome: "", riskTolerance: "", nrc: "" }).expect(200);
    const [stored] = await db.select().from(users).where(eq(users.id, owner.id));
    expect([stored.phoneNumberWork, stored.annualIncome, stored.riskTolerance, stored.nrc]).toEqual([null, null, null, null]);
    await request(app).put("/api/settings/profile").set("Cookie", owner.cookie).send(fullProfile).expect(200);
  });

  it("refuses an unknown key with a 400 naming it and saves nothing", async () => {
    const response = await request(app).put("/api/settings/profile").set("Cookie", owner.cookie)
      .send({ fullName: "Must Not Save", salaryRange: "ZMW 10,000 - 20,000" }).expect(400);

    // Salary range was removed (AH-07): the field, the API and the column.
    expect(response.body.error.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "salaryRange", code: "unrecognized_keys" })]),
    );
    expect(JSON.stringify(response.body).includes("10,000")).toBe(false);
    const [stored] = await db.select().from(users).where(eq(users.id, owner.id));
    expect(stored.fullName).toBe(fullProfile.fullName);
    expect(stored).not.toHaveProperty("salaryRangeEncrypted");
  });

  it("names an invalid field without echoing the submitted value", async () => {
    const response = await request(app).put("/api/settings/profile").set("Cookie", owner.cookie)
      .send({ annualIncome: "-4242.42", gender: "gender-sentinel-value", phoneNumberMobile: "555-0199", nrc: "98765432" }).expect(400);

    const fields = response.body.error.fields.map((error: { field: string }) => error.field).sort();
    expect(fields).toEqual(["annualIncome", "gender", "nrc", "phoneNumberMobile"]);
    for (const value of ["-4242.42", "gender-sentinel-value", "555-0199", "98765432"]) {
      expect(JSON.stringify(response.body).includes(value)).toBe(false);
    }
  });

  it("audits the changed field names, never their values", async () => {
    await request(app).put("/api/settings/profile").set("Cookie", owner.cookie)
      .send({ ...fullProfile, phoneNumberHome: "0211234564", occupation: "Auditor" }).expect(200);
    const [row] = await db.select().from(auditLogs)
      .where(and(eq(auditLogs.userId, owner.id), eq(auditLogs.entityType, "user"), eq(auditLogs.action, "UPDATE")))
      .orderBy(desc(auditLogs.createdAt)).limit(1);

    expect(row).toBeDefined();
    expect((row.details as { changedFields?: string[] }).changedFields).toEqual(["occupation", "phoneNumberHome"]);
    expect(JSON.stringify(row.details).includes("0211234564")).toBe(false);
    const allRows = await db.select().from(auditLogs).where(eq(auditLogs.userId, owner.id));
    expect(allRows.length).toBeGreaterThan(0);
    for (const audit of allRows) expectNoPersonalValues(audit.details);
    await request(app).put("/api/settings/profile").set("Cookie", owner.cookie).send(fullProfile).expect(200);
  });

  it("another member of the household cannot read the saved personal fields", async () => {
    const responses = await Promise.all([
      request(app).get("/api/settings/profile").set("Cookie", member.cookie).expect(200),
      request(app).get("/api/auth/me").set("Cookie", member.cookie).expect(200),
      request(app).get("/api/household/members").set("Cookie", member.cookie).expect(200),
      request(app).get("/api/household/general").set("Cookie", member.cookie),
    ]);

    expect(responses[0].body.data.profile.id).toBe(member.id);
    // Neither the owner's birthday nor bio reaches another member.
    for (const response of responses) expectNoPersonalValues(response.body, [fullProfile.bio]);
    const members = responses[2].body.data.members as Array<Record<string, unknown>>;
    const ownerRow = members.find(row => row.userId === owner.id);
    expect(ownerRow).toBeDefined();
    // AH-05 flat member DTO as a plain member sees it: no email (shared/household-members.ts).
    expect(Object.keys(ownerRow!).sort()).toEqual(["joinedAt", "name", "role", "userId"] satisfies (keyof HouseholdMemberDto)[]);
  });

  it("no log line carries the NRC while it is saved, read, refused and seen by another member", async () => {
    const lines: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(level =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); }));
    try {
      await request(app).put("/api/settings/profile").set("Cookie", owner.cookie).send({ nrc: "" }).expect(200);
      await request(app).put("/api/settings/profile").set("Cookie", owner.cookie).send({ nrc }).expect(200);
      await request(app).get("/api/settings/profile").set("Cookie", owner.cookie).expect(200);
      await request(app).put("/api/settings/profile").set("Cookie", owner.cookie).send({ nrc: `${nrc}x` }).expect(400);
      await request(app).get("/api/household/members").set("Cookie", member.cookie).expect(200);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(lines.some(line => line.includes("Profile updated"))).toBe(true);
    expect(lines.filter(line => line.includes(nrc))).toEqual([]);
  });

  it("the owner's own session payloads carry identity only, not the saved private fields", async () => {
    const me = await request(app).get("/api/auth/me").set("Cookie", owner.cookie).expect(200);
    expect(Object.keys(me.body.data.user).sort()).toEqual(sessionUserKeys);
    expectNoPersonalValues(me.body);

    const session = await request(app).get("/api/auth/session").set("Cookie", owner.cookie).expect(200);
    expect(Object.keys(session.body.data.subject).sort()).toEqual(["displayName", "email", "id"]);
    expectNoPersonalValues(session.body, [fullProfile.bio]);
  });
});
